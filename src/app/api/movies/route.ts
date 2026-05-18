import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession } from '@/lib/auth/server';
import {
  getViewerEntitlement,
  getSubscriptionSnapshotFromData,
} from '@/lib/server/subscriptions';
import type { SubscriptionEntitlement } from '@/types/subscriptions';
import {
  clearMovieCatalogQuotaFailure,
  type CachedMovieCatalog,
  inMemoryMovieCache,
  isFreshMovieCache,
  isMovieCatalogQuotaBlocked,
  pickMovieCatalogCache,
  persistMovieCatalog,
  readMovieCatalogFromDisk,
  recordMovieCatalogQuotaFailure,
  setInMemoryMovieCache,
} from '@/lib/server/movieCatalogCache';
import {
  getMediaCollectionName,
  TRAILER_MEDIA_COLLECTION,
} from '@/lib/server/movieCollection';
import { isAppInReview } from '@/lib/appReview';
import { getMappedTrailerUrlForTitle } from '@/lib/reviewTrailers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PUBLIC_MOVIE_FALLBACK_TIMEOUT_MS = 1000 * 4;

const DEFAULT_ENTITLEMENT: SubscriptionEntitlement = {
  hasPremiumAccess: false,
  requiresSubscription: true,
  subscription: getSubscriptionSnapshotFromData(null),
};

function isPremiumAccessTier(accessTier: unknown) {
  return accessTier !== 'free';
}

function isPlaybackAssetReady(asset: Record<string, unknown>) {
  const jobStatus = typeof asset.jobStatus === 'string' ? asset.jobStatus : '';
  return !jobStatus || jobStatus === 'ready';
}

function sanitizeEpisodeForViewer(
  episode: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(episode.accessTier);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const sanitizedEpisode = {
    ...episode,
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
  };

  if (!isLocked) {
    if (!isPlaybackAssetReady(episode)) {
      return {
        ...sanitizedEpisode,
        video_url: '',
        sourceUrl: '',
        sourceFileName: '',
        subscriptionRequired,
        isLocked: false,
      };
    }

    return {
      ...sanitizedEpisode,
      subscriptionRequired,
      isLocked: false,
    };
  }

  return {
    ...sanitizedEpisode,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    subscriptionRequired,
    isLocked: true,
  };
}

function sanitizeMoviePartForViewer(
  part: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(part.accessTier);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const sanitizedPart = {
    ...part,
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
  };

  if (!isLocked) {
    if (!isPlaybackAssetReady(part)) {
      return {
        ...sanitizedPart,
        video_url: '',
        sourceUrl: '',
        sourceFileName: '',
        subscriptionRequired,
        isLocked: false,
      };
    }

    return {
      ...sanitizedPart,
      subscriptionRequired,
      isLocked: false,
    };
  }

  return {
    ...sanitizedPart,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    subscriptionRequired,
    isLocked: true,
  };
}

function sanitizeMovieForViewerLocally(
  movie: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(movie.accessTier);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const parts = Array.isArray(movie.parts)
    ? movie.parts.map((part) =>
        sanitizeMoviePartForViewer(part as Record<string, unknown>, entitlement)
      )
    : [];
  const seasons = Array.isArray(movie.seasons)
    ? movie.seasons.map((season) => {
        const rawSeason = season as Record<string, unknown>;
        const episodes = Array.isArray(rawSeason.episodes)
          ? rawSeason.episodes.map((episode) =>
              sanitizeEpisodeForViewer(episode as Record<string, unknown>, entitlement)
            )
          : [];

        return {
          ...rawSeason,
          episodes,
        };
      })
    : [];

  if (!isLocked) {
    const shouldExposePrimaryMovieSource = parts.length === 0 && isPlaybackAssetReady(movie);

    return {
      ...movie,
      video_url: shouldExposePrimaryMovieSource ? String(movie.video_url || '') : '',
      sourceUrl: shouldExposePrimaryMovieSource ? String(movie.sourceUrl || '') : '',
      sourceFileName: shouldExposePrimaryMovieSource ? String(movie.sourceFileName || '') : '',
      parts,
      seasons,
      masterPlaylistUrl: '',
      availableRenditions: [],
      playbackType: 'mp4',
      accessTier: subscriptionRequired ? 'premium' : 'free',
      subscriptionRequired,
      isLocked: false,
    };
  }

  return {
    ...movie,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    parts,
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
    seasons,
    accessTier: 'premium',
    subscriptionRequired: true,
    isLocked: true,
  };
}

function sanitizeMovieForReviewMode(movie: Record<string, unknown>) {
  const stripPlaybackFields = (entry: Record<string, unknown>) => ({
    ...entry,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
    accessTier: 'free',
    subscriptionRequired: false,
    isLocked: false,
  });

  const parts = Array.isArray(movie.parts)
    ? movie.parts.map((part) => stripPlaybackFields(part as Record<string, unknown>))
    : [];
  const seasons = Array.isArray(movie.seasons)
    ? movie.seasons.map((season) => {
        const rawSeason = season as Record<string, unknown>;
        const episodes = Array.isArray(rawSeason.episodes)
          ? rawSeason.episodes.map((episode) => stripPlaybackFields(episode as Record<string, unknown>))
          : [];

        return {
          ...rawSeason,
          episodes,
        };
      })
    : [];

  return {
    ...stripPlaybackFields(movie),
    parts,
    seasons,
  };
}

function hasPlayableAsset(asset: Record<string, unknown>) {
  if (!isPlaybackAssetReady(asset)) {
    return false;
  }

  if (
    String(asset.video_url || '').trim() ||
    String(asset.sourceUrl || '').trim() ||
    String(asset.masterPlaylistUrl || '').trim()
  ) {
    return true;
  }

  const renditions = Array.isArray(asset.availableRenditions) ? asset.availableRenditions : [];
  return renditions.some((rendition) =>
    Boolean(String((rendition as Record<string, unknown>).playlistUrl || '').trim())
  );
}

function hasPublicPlaybackAsset(movieDoc: Record<string, unknown>) {
  if (hasPlayableAsset(movieDoc)) {
    return true;
  }

  const parts = Array.isArray(movieDoc.parts) ? movieDoc.parts : [];

  if (parts.some((part) => hasPlayableAsset(part as Record<string, unknown>))) {
    return true;
  }

  const seasons = Array.isArray(movieDoc.seasons) ? movieDoc.seasons : [];

  return seasons.some((season) => {
    const rawSeason = season as Record<string, unknown>;
    const episodes = Array.isArray(rawSeason.episodes) ? rawSeason.episodes : [];

    return episodes.some((episode) => {
      return hasPlayableAsset(episode as Record<string, unknown>);
    });
  });
}

function hasVisibleCatalogAsset(movieDoc: Record<string, unknown>, collectionName: string) {
  if (collectionName === TRAILER_MEDIA_COLLECTION && String(movieDoc.trailer_url || '').trim()) {
    return true;
  }

  return hasPublicPlaybackAsset(movieDoc);
}

async function readMovieSnapshotWithFallback(
  collectionName: string,
  hasFallback: boolean,
  reviewOnly: boolean
) {
  const collection = adminDb.collection(collectionName);
  const queryPromise = reviewOnly
    ? collection.where('is_for_review', '==', true).get()
    : collection.orderBy('date_added', 'desc').get().then(async (snapshot) => {
        if (!snapshot.empty) {
          return snapshot;
        }

        return collection.get();
      });

  if (!hasFallback) {
    return queryPromise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Movie catalog read timed out while cache fallback was available.'));
    }, PUBLIC_MOVIE_FALLBACK_TIMEOUT_MS);
  });

  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    queryPromise.catch(() => undefined);
  }
}

function matchesCatalogMode(
  cache: CachedMovieCatalog | null,
  collectionName: string,
  reviewOnly: boolean
) {
  if (!cache) {
    return null;
  }

  if (cache.collectionName !== collectionName) {
    return null;
  }

  if (reviewOnly) {
    return cache.reviewOnly === true ? cache : null;
  }

  return cache.reviewOnly === true ? null : cache;
}

function withReviewTrailerFallback(movieDoc: Record<string, unknown>) {
  const trailerUrl =
    String(movieDoc.trailer_url || '').trim() ||
    getMappedTrailerUrlForTitle(String(movieDoc.title || '')) ||
    getMappedTrailerUrlForTitle(String(movieDoc.name || '')) ||
    getMappedTrailerUrlForTitle(String(movieDoc.original_title || '')) ||
    getMappedTrailerUrlForTitle(String(movieDoc.file_name || '')) ||
    getMappedTrailerUrlForTitle(String(movieDoc.sourceFileName || ''));

  return {
    ...movieDoc,
    trailer_url: trailerUrl,
  };
}

function getMovieTimestamp(movie: Record<string, unknown>) {
  const dateAdded = String(movie.date_added || '');
  const updatedAt = String(movie.updatedAt || '');
  const createdAt = String(movie.createdAt || '');
  const candidate = dateAdded || updatedAt || createdAt;
  const timestamp = candidate ? new Date(candidate).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortMovieDocsByUploadDate(movies: Array<Record<string, unknown>>) {
  return [...movies].sort((left, right) => getMovieTimestamp(right) - getMovieTimestamp(left));
}

async function fetchMovieCatalog(collectionName: string, reviewOnly: boolean) {
  const inMemoryCacheForMode = matchesCatalogMode(
    inMemoryMovieCache,
    collectionName,
    reviewOnly
  );

  if (isFreshMovieCache(inMemoryCacheForMode)) {
    return inMemoryCacheForMode;
  }

  const diskCache = await readMovieCatalogFromDisk();
  const diskCacheForMode = matchesCatalogMode(diskCache, collectionName, reviewOnly);
  const staleCache = pickMovieCatalogCache(inMemoryCacheForMode, diskCacheForMode);

  if (isFreshMovieCache(diskCacheForMode)) {
    setInMemoryMovieCache(diskCacheForMode);
    return diskCacheForMode;
  }

  if (staleCache?.movies?.length && isMovieCatalogQuotaBlocked()) {
    if (diskCacheForMode) {
      setInMemoryMovieCache(diskCacheForMode);
    }

    return staleCache;
  }

  try {
    const snapshot = await readMovieSnapshotWithFallback(
      collectionName,
      Boolean(staleCache?.movies?.length),
      reviewOnly
    );
    const movies = sortMovieDocsByUploadDate(
      snapshot.docs.map((movieDoc) =>
        withReviewTrailerFallback({
          id: movieDoc.id,
          ...movieDoc.data(),
        })
      )
    );
    const cache: CachedMovieCatalog = {
      movies,
      cachedAt: new Date().toISOString(),
      collectionName,
      reviewOnly,
    };

    setInMemoryMovieCache(cache);
    await persistMovieCatalog(cache);
    clearMovieCatalogQuotaFailure();
    return cache;
  } catch (error) {
    recordMovieCatalogQuotaFailure(error);

    if (staleCache?.movies?.length) {
      console.warn('[movies-api] Firestore unavailable, serving stale movie cache', error);
      return staleCache;
    }

    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const session = await getCurrentAuthSession({ hydrateUserRecord: true });
    const entitlement = session
      ? await getViewerEntitlement(session.uid, {
          email: session.email,
          role: session.role,
        })
      : DEFAULT_ENTITLEMENT;
    const collectionName = await getMediaCollectionName(request, session?.userRecord || session);

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        { error: 'Movie catalog backend is not configured.', detail: adminSetupError },
        { status: 500 }
      );
    }

    const catalog = await fetchMovieCatalog(collectionName, isAppInReview);
    const movies = catalog.movies
      .filter((movieDoc) => {
        if (isAppInReview) {
          return movieDoc.is_for_review === true;
        }

        if (collectionName === TRAILER_MEDIA_COLLECTION) {
          return hasVisibleCatalogAsset(movieDoc, collectionName);
        }

        return true;
      })
      .map((movieDoc) => {
        const sanitizedMovie = sanitizeMovieForViewerLocally(movieDoc, entitlement);
        return isAppInReview ? sanitizeMovieForReviewMode(sanitizedMovie) : sanitizedMovie;
      });

    return NextResponse.json({ movies, entitlement });
  } catch (error) {
    console.error('[movies-api] failed to load movies', error);
    return NextResponse.json(
      {
        error: 'Failed to load movies.',
        detail: error instanceof Error ? error.message : 'Unknown movies API error.',
      },
      { status: 500 }
    );
  }
}
