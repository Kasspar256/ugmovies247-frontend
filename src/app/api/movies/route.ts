import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getRequestAuthSession } from '@/lib/auth/server';
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
  refreshInMemoryMovieCacheFromDiskIfNewer,
  setInMemoryMovieCache,
} from '@/lib/server/movieCatalogCache';
import {
  getMediaCollectionName,
  TRAILER_MEDIA_COLLECTION,
} from '@/lib/server/movieCollection';
import { isAppInReview } from '@/lib/appReview';
import { getMappedTrailerUrlForTitle } from '@/lib/reviewTrailers';
import {
  isPublicMovieReady,
  isPublicPlaybackAssetReady,
} from '@/lib/publicReadiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PUBLIC_MOVIE_FALLBACK_TIMEOUT_MS = 1000 * 4;
const MAX_PUBLIC_CATALOG_PAGE_SIZE = 240;
let movieCatalogBackgroundRefreshPromise: Promise<CachedMovieCatalog | null> | null = null;

const DEFAULT_ENTITLEMENT: SubscriptionEntitlement = {
  hasPremiumAccess: false,
  requiresSubscription: true,
  subscription: getSubscriptionSnapshotFromData(null),
};
const CATALOG_READINESS_OPTIONS = { allowLockedPlaceholder: true };

function isPremiumAccessTier(accessTier: unknown, subscriptionRequired?: unknown) {
  if (subscriptionRequired === false) {
    return false;
  }

  return accessTier !== 'free';
}

function sanitizeEpisodeForViewer(
  episode: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(episode.accessTier, episode.subscriptionRequired);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const sanitizedEpisode = {
    ...episode,
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
  };

  if (!isLocked) {
    if (!isPublicPlaybackAssetReady(episode)) {
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
  const subscriptionRequired = isPremiumAccessTier(part.accessTier, part.subscriptionRequired);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const sanitizedPart = {
    ...part,
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
  };

  if (!isLocked) {
    if (!isPublicPlaybackAssetReady(part)) {
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
  const subscriptionRequired = isPremiumAccessTier(movie.accessTier, movie.subscriptionRequired);
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
    const shouldExposePrimaryMovieSource = parts.length === 0 && isPublicPlaybackAssetReady(movie);

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

function hasVisibleCatalogAsset(movieDoc: Record<string, unknown>, collectionName: string) {
  if (collectionName === TRAILER_MEDIA_COLLECTION && String(movieDoc.trailer_url || '').trim()) {
    return true;
  }

  return isPublicMovieReady(movieDoc);
}

async function readMovieSnapshotWithFallback(
  collectionName: string,
  hasFallback: boolean,
  reviewOnly: boolean
) {
  const collection = adminDb.collection(collectionName);
  const queryPromise = reviewOnly
    ? collection.where('is_for_review', '==', true).get()
    : (async () => {
        const orderedSnapshot = await collection.orderBy('date_added', 'desc').get().catch(() => null);
        const fullSnapshot = await collection.get();

        if (!orderedSnapshot || orderedSnapshot.empty) {
          return fullSnapshot;
        }

        if (orderedSnapshot.size >= fullSnapshot.size) {
          return orderedSnapshot;
        }

        const docsById = new Map(orderedSnapshot.docs.map((doc) => [doc.id, doc] as const));

        for (const doc of fullSnapshot.docs) {
          docsById.set(doc.id, doc);
        }

        return {
          docs: Array.from(docsById.values()),
        };
      })();

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

function readTimestampMs(value: unknown) {
  if (!value) {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const seconds = typeof record.seconds === 'number' ? record.seconds : null;

    if (seconds !== null) {
      return seconds * 1000;
    }

    if (typeof record.toDate === 'function') {
      const timestamp = (record.toDate as () => Date)().getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    }
  }

  return 0;
}

function getMovieTimestamp(movie: Record<string, unknown>) {
  const partTimestamps = Array.isArray(movie.parts)
    ? movie.parts.map((part) => {
        const rawPart = part as Record<string, unknown>;
        return Math.max(
          readTimestampMs(rawPart.updatedAt),
          readTimestampMs(rawPart.createdAt),
          readTimestampMs(rawPart.processedAt)
        );
      })
    : [];
  const episodeTimestamps = Array.isArray(movie.seasons)
    ? movie.seasons.flatMap((season) => {
        const rawSeason = season as Record<string, unknown>;
        return Array.isArray(rawSeason.episodes)
          ? rawSeason.episodes.map((episode) => {
              const rawEpisode = episode as Record<string, unknown>;
              return Math.max(
                readTimestampMs(rawEpisode.updatedAt),
                readTimestampMs(rawEpisode.createdAt),
                readTimestampMs(rawEpisode.processedAt)
              );
            })
          : [];
      })
    : [];

  return Math.max(
    readTimestampMs(movie.date_added),
    readTimestampMs(movie.updatedAt),
    readTimestampMs(movie.createdAt),
    readTimestampMs(movie.processedAt),
    ...partTimestamps,
    ...episodeTimestamps
  );
}

function sortMovieDocsByUploadDate(movies: Array<Record<string, unknown>>) {
  return [...movies].sort((left, right) => {
    const timestampDifference = getMovieTimestamp(right) - getMovieTimestamp(left);

    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return String(right.id || right.movieId || '').localeCompare(String(left.id || left.movieId || ''));
  });
}

function readBoundedInteger(value: string | null, options: { min: number; max: number }) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(options.min, Math.min(options.max, Math.floor(parsed)));
}

type CatalogPageCursor = {
  id: string;
  timestamp: number;
};

function encodeCatalogCursor(movieDoc: Record<string, unknown> | null | undefined) {
  if (!movieDoc) {
    return '';
  }

  const id = String(movieDoc.id || movieDoc.movieId || '').trim();

  if (!id) {
    return '';
  }

  return Buffer.from(
    JSON.stringify({
      id,
      timestamp: getMovieTimestamp(movieDoc),
    } satisfies CatalogPageCursor),
    'utf8'
  ).toString('base64url');
}

function decodeCatalogCursor(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CatalogPageCursor>;
    const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
    const timestamp = typeof parsed.timestamp === 'number' && Number.isFinite(parsed.timestamp)
      ? parsed.timestamp
      : 0;

    return id ? { id, timestamp } satisfies CatalogPageCursor : null;
  } catch {
    return null;
  }
}

function getCatalogPageStartIndex(
  movies: Array<Record<string, unknown>>,
  cursor: CatalogPageCursor | null,
  fallbackOffset: number
) {
  if (!cursor) {
    return fallbackOffset;
  }

  const cursorIndex = movies.findIndex((movieDoc) => {
    const id = String(movieDoc.id || movieDoc.movieId || '').trim();

    return id === cursor.id;
  });

  return cursorIndex >= 0 ? cursorIndex + 1 : fallbackOffset;
}

function compactPartForCatalog(part: Record<string, unknown>) {
  return {
    id: String(part.id || ''),
    label: String(part.label || ''),
    order: typeof part.order === 'number' ? part.order : 0,
    title: String(part.title || ''),
    description: String(part.description || ''),
    video_url: '',
    poster: String(part.poster || ''),
    thumbnail: String(part.thumbnail || ''),
    jobStatus: part.jobStatus,
    processedAt: String(part.processedAt || ''),
    createdAt: String(part.createdAt || ''),
    updatedAt: String(part.updatedAt || ''),
    accessTier: part.accessTier,
    subscriptionRequired: part.subscriptionRequired,
    isLocked: part.isLocked,
    catalogReady: isPublicPlaybackAssetReady(part, CATALOG_READINESS_OPTIONS),
  };
}

function compactEpisodeForCatalog(episode: Record<string, unknown>) {
  return {
    episodeNumber: typeof episode.episodeNumber === 'number' ? episode.episodeNumber : 0,
    title: String(episode.title || ''),
    description: String(episode.description || ''),
    overview: String(episode.overview || ''),
    video_url: '',
    poster: String(episode.poster || ''),
    thumbnail: String(episode.thumbnail || ''),
    overriddenBackdrop: String(episode.overriddenBackdrop || ''),
    episodeTrailerUrl: String(episode.episodeTrailerUrl || ''),
    jobStatus: episode.jobStatus,
    processedAt: String(episode.processedAt || ''),
    createdAt: String(episode.createdAt || ''),
    updatedAt: String(episode.updatedAt || ''),
    accessTier: episode.accessTier,
    subscriptionRequired: episode.subscriptionRequired,
    isLocked: episode.isLocked,
    catalogReady: isPublicPlaybackAssetReady(episode, CATALOG_READINESS_OPTIONS),
  };
}

function compactMovieForCatalog(movie: Record<string, unknown>) {
  const parts = Array.isArray(movie.parts)
    ? movie.parts.map((part) => compactPartForCatalog(part as Record<string, unknown>))
    : [];
  const seasons = Array.isArray(movie.seasons)
    ? movie.seasons.map((season) => {
        const rawSeason = season as Record<string, unknown>;
        return {
          seasonNumber: typeof rawSeason.seasonNumber === 'number' ? rawSeason.seasonNumber : 0,
          title: String(rawSeason.title || ''),
          overview: String(rawSeason.overview || ''),
          poster: String(rawSeason.poster || ''),
          overriddenBackdrop: String(rawSeason.overriddenBackdrop || ''),
          tmdb_id: typeof rawSeason.tmdb_id === 'number' ? rawSeason.tmdb_id : null,
          episodes: Array.isArray(rawSeason.episodes)
            ? rawSeason.episodes.map((episode) =>
                compactEpisodeForCatalog(episode as Record<string, unknown>)
              )
            : [],
        };
      })
    : [];

  return {
    id: String(movie.id || movie.movieId || ''),
    movieId: String(movie.movieId || movie.id || ''),
    contentType: movie.contentType === 'series' ? 'series' : 'movie',
    title: String(movie.title || movie.name || 'Untitled movie'),
    original_title: String(movie.original_title || ''),
    name: String(movie.name || ''),
    overview: String(movie.overview || ''),
    description: String(movie.description || ''),
    language: String(movie.language || ''),
    releaseYear: typeof movie.releaseYear === 'number' ? movie.releaseYear : null,
    tags: Array.isArray(movie.tags) ? movie.tags : [],
    poster: String(movie.poster || ''),
    heroPoster: String(movie.heroPoster || ''),
    overriddenBackdrop: String(movie.overriddenBackdrop || ''),
    overriddenPlayerBackdrop: String(movie.overriddenPlayerBackdrop || ''),
    playerBackdrop: String(movie.playerBackdrop || ''),
    genres: Array.isArray(movie.genres) ? movie.genres : [],
    category: Array.isArray(movie.category) ? movie.category : [],
    vj: String(movie.vj || ''),
    trailerUrl: String(movie.trailerUrl || ''),
    mainSeriesTrailerUrl: String(movie.mainSeriesTrailerUrl || ''),
    trailer_url: String(movie.trailer_url || ''),
    release_date: String(movie.release_date || ''),
    date_added: String(movie.date_added || ''),
    country: String(movie.country || ''),
    tmdb_id: typeof movie.tmdb_id === 'number' ? movie.tmdb_id : null,
    file_name: String(movie.file_name || ''),
    status: String(movie.status || ''),
    jobStatus: movie.jobStatus,
    processingProgress: typeof movie.processingProgress === 'number' ? movie.processingProgress : 0,
    processedAt: String(movie.processedAt || ''),
    createdAt: String(movie.createdAt || ''),
    updatedAt: String(movie.updatedAt || ''),
    accessTier: movie.accessTier,
    subscriptionRequired: movie.subscriptionRequired,
    isLocked: movie.isLocked,
    catalogReady: isPublicMovieReady(movie, CATALOG_READINESS_OPTIONS),
    is_for_review: movie.is_for_review === true,
    is_trending_tiktok: movie.is_trending_tiktok === true,
    parts,
    seasons,
  };
}

async function fetchMovieCatalog(
  collectionName: string,
  reviewOnly: boolean,
  options?: { forceFresh?: boolean }
) {
  await refreshInMemoryMovieCacheFromDiskIfNewer({
    collectionName,
    reviewOnly,
    force: options?.forceFresh,
  });

  const inMemoryCacheForMode = matchesCatalogMode(
    inMemoryMovieCache,
    collectionName,
    reviewOnly
  );

  if (!options?.forceFresh && isFreshMovieCache(inMemoryCacheForMode)) {
    return inMemoryCacheForMode;
  }

  const diskCache = await readMovieCatalogFromDisk();
  const diskCacheForMode = matchesCatalogMode(diskCache, collectionName, reviewOnly);
  const staleCache = pickMovieCatalogCache(inMemoryCacheForMode, diskCacheForMode);

  if (!options?.forceFresh && isFreshMovieCache(diskCacheForMode)) {
    setInMemoryMovieCache(diskCacheForMode);
    return diskCacheForMode;
  }

  if (!options?.forceFresh && staleCache?.movies?.length) {
    refreshMovieCatalogInBackground(collectionName, reviewOnly, staleCache);
    return staleCache;
  }

  if (staleCache?.movies?.length && isMovieCatalogQuotaBlocked()) {
    if (diskCacheForMode) {
      setInMemoryMovieCache(diskCacheForMode);
    }

    return staleCache;
  }

  return refreshMovieCatalogFromFirestore(collectionName, reviewOnly, staleCache);
}

async function refreshMovieCatalogFromFirestore(
  collectionName: string,
  reviewOnly: boolean,
  staleCache: CachedMovieCatalog | null
) {
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
    const persisted = await persistMovieCatalog(cache, { previousCache: staleCache });

    if (persisted) {
      clearMovieCatalogQuotaFailure();
      return cache;
    }

    if (staleCache?.movies?.length) {
      return staleCache;
    }

    throw new Error('Fresh movie catalog failed integrity validation.');
  } catch (error) {
    recordMovieCatalogQuotaFailure(error);

    if (staleCache?.movies?.length) {
      console.warn('[movies-api] Firestore unavailable, serving stale movie cache', error);
      return staleCache;
    }

    throw error;
  }
}

function refreshMovieCatalogInBackground(
  collectionName: string,
  reviewOnly: boolean,
  staleCache: CachedMovieCatalog
) {
  if (movieCatalogBackgroundRefreshPromise) {
    return;
  }

  movieCatalogBackgroundRefreshPromise = refreshMovieCatalogFromFirestore(
    collectionName,
    reviewOnly,
    staleCache
  )
    .catch((error) => {
      console.warn('[movies-api] background movie catalog refresh failed; keeping stale cache', error);
      return staleCache;
    })
    .finally(() => {
      movieCatalogBackgroundRefreshPromise = null;
    });
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const sinceParam = requestUrl.searchParams.get('since') || '';
    const cursor = decodeCatalogCursor(requestUrl.searchParams.get('cursor'));
    const shouldForceFreshCatalog =
      requestUrl.searchParams.get('force') === '1' ||
      requestUrl.searchParams.get('fresh') === '1';
    const shouldReturnCompactCatalog = requestUrl.searchParams.get('compact') === '1';
    const sinceTimestamp = sinceParam ? new Date(sinceParam).getTime() : 0;
    const shouldReturnDelta = Number.isFinite(sinceTimestamp) && sinceTimestamp > 0;
    const limit = shouldReturnDelta
      ? null
      : readBoundedInteger(requestUrl.searchParams.get('limit'), {
          min: 1,
          max: MAX_PUBLIC_CATALOG_PAGE_SIZE,
        });
    const offset = limit
      ? readBoundedInteger(requestUrl.searchParams.get('offset'), {
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
        }) || 0
      : 0;
    const session = await getRequestAuthSession(request);
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

    const catalog = await fetchMovieCatalog(collectionName, isAppInReview, {
      forceFresh: shouldForceFreshCatalog,
    });
    const visibleMovieDocs = catalog.movies
      .filter((movieDoc) =>
        isAppInReview ? movieDoc.is_for_review === true : hasVisibleCatalogAsset(movieDoc, collectionName)
      );
    const filteredMovieDocs = shouldReturnDelta
      ? visibleMovieDocs.filter((movieDoc) => getMovieTimestamp(movieDoc) > sinceTimestamp)
      : visibleMovieDocs;
    const pageStartIndex = limit
      ? getCatalogPageStartIndex(filteredMovieDocs, cursor, offset)
      : 0;
    const movieDocs = limit
      ? filteredMovieDocs.slice(pageStartIndex, pageStartIndex + limit)
      : filteredMovieDocs;
    const nextCursor = limit && movieDocs.length
      ? encodeCatalogCursor(movieDocs[movieDocs.length - 1])
      : '';
    const hasMore = limit ? pageStartIndex + movieDocs.length < filteredMovieDocs.length : false;
    const movies = movieDocs
      .map((movieDoc) => {
        const sanitizedMovie = sanitizeMovieForViewerLocally(movieDoc, entitlement);
        return isAppInReview ? sanitizeMovieForReviewMode(sanitizedMovie) : sanitizedMovie;
      })
      .map((movieDoc) =>
        shouldReturnCompactCatalog ? compactMovieForCatalog(movieDoc) : movieDoc
      );

    return NextResponse.json({
      movies,
      entitlement,
      delta: shouldReturnDelta,
      since: shouldReturnDelta ? sinceParam : undefined,
      limit: limit || undefined,
      offset: limit ? pageStartIndex : undefined,
      cursor: cursor ? requestUrl.searchParams.get('cursor') : undefined,
      nextCursor: hasMore ? nextCursor : undefined,
      total: limit ? filteredMovieDocs.length : undefined,
      hasMore,
      partial: Boolean(limit),
      serverTime: new Date().toISOString(),
    });
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
