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
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';

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

function sanitizeEpisodeForViewer(
  episode: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(episode.accessTier);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;

  if (!isLocked) {
    return {
      ...episode,
      subscriptionRequired,
      isLocked: false,
    };
  }

  return {
    ...episode,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    masterPlaylistUrl: '',
    availableRenditions: [],
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
    return {
      ...movie,
      seasons,
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
    masterPlaylistUrl: '',
    availableRenditions: [],
    seasons,
    accessTier: 'premium',
    subscriptionRequired: true,
    isLocked: true,
  };
}

function hasPublicPlaybackAsset(movieDoc: Record<string, unknown>) {
  const movieJobStatus = typeof movieDoc.jobStatus === 'string' ? movieDoc.jobStatus : '';
  const hasPrimaryPlaybackAsset = Boolean(movieDoc.masterPlaylistUrl || movieDoc.video_url);

  if ((!movieJobStatus || movieJobStatus === 'ready') && hasPrimaryPlaybackAsset) {
    return true;
  }

  const seasons = Array.isArray(movieDoc.seasons) ? movieDoc.seasons : [];

  return seasons.some((season) => {
    const rawSeason = season as Record<string, unknown>;
    const episodes = Array.isArray(rawSeason.episodes) ? rawSeason.episodes : [];

    return episodes.some((episode) => {
      const rawEpisode = episode as Record<string, unknown>;
      const episodeJobStatus =
        typeof rawEpisode.jobStatus === 'string' ? rawEpisode.jobStatus : '';

      return (
        (!episodeJobStatus || episodeJobStatus === 'ready') &&
        Boolean(rawEpisode.masterPlaylistUrl || rawEpisode.video_url)
      );
    });
  });
}

async function readMovieSnapshotWithFallback(hasFallback: boolean) {
  const queryPromise = adminDb.collection(MOVIES_COLLECTION).orderBy('date_added', 'desc').get();

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

async function fetchMovieCatalog() {
  if (isFreshMovieCache(inMemoryMovieCache)) {
    return inMemoryMovieCache;
  }

  const diskCache = await readMovieCatalogFromDisk();
  const staleCache = pickMovieCatalogCache(inMemoryMovieCache, diskCache);

  if (isFreshMovieCache(diskCache)) {
    setInMemoryMovieCache(diskCache);
    return diskCache;
  }

  if (staleCache?.movies?.length && isMovieCatalogQuotaBlocked()) {
    if (diskCache) {
      setInMemoryMovieCache(diskCache);
    }

    return staleCache;
  }

  try {
    const snapshot = await readMovieSnapshotWithFallback(Boolean(staleCache?.movies?.length));
    const cache: CachedMovieCatalog = {
      movies: snapshot.docs.map((movieDoc) => ({
        id: movieDoc.id,
        ...movieDoc.data(),
      })),
      cachedAt: new Date().toISOString(),
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
    const session = await getCurrentAuthSession();
    const entitlement = session
      ? await getViewerEntitlement(session.uid, {
          email: session.email,
          role: session.role,
        })
      : DEFAULT_ENTITLEMENT;

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        { error: 'Movie catalog backend is not configured.', detail: adminSetupError },
        { status: 500 }
      );
    }

    const catalog = await fetchMovieCatalog();
    const movies = catalog.movies
      .filter((movieDoc) => hasPublicPlaybackAsset(movieDoc))
      .map((movieDoc) =>
        sanitizeMovieForViewerLocally(
          movieDoc,
          entitlement
        )
      );

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
