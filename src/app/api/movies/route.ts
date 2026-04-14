import { NextResponse } from 'next/server';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession } from '@/lib/auth/server';
import {
  getViewerEntitlement,
  getSubscriptionSnapshotFromData,
} from '@/lib/server/subscriptions';
import { sanitizeMovieForViewer } from '@/lib/server/contentAccess';
import type { SubscriptionEntitlement } from '@/types/subscriptions';
import {
  type CachedMovieCatalog,
  inMemoryMovieCache,
  isFreshMovieCache,
  persistMovieCatalog,
  readMovieCatalogFromDisk,
  setInMemoryMovieCache,
} from '@/lib/server/movieCatalogCache';
import { getMoviesCollectionRef } from '@/lib/server/movieCollection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ENTITLEMENT: SubscriptionEntitlement = {
  hasPremiumAccess: false,
  requiresSubscription: true,
  subscription: getSubscriptionSnapshotFromData(null),
};

function hasPublicPlaybackAsset(movieDoc: Record<string, unknown>) {
  const movieJobStatus = typeof movieDoc.jobStatus === 'string' ? movieDoc.jobStatus : '';
  const hasPrimaryPlaybackAsset = Boolean(movieDoc.masterPlaylistUrl || movieDoc.video_url);
  const parts = Array.isArray(movieDoc.parts) ? movieDoc.parts : [];

  if ((!movieJobStatus || movieJobStatus === 'ready') && hasPrimaryPlaybackAsset) {
    return true;
  }

  if (
    parts.some((part) => {
      const rawPart = part as Record<string, unknown>;
      const partJobStatus = typeof rawPart.jobStatus === 'string' ? rawPart.jobStatus : '';

      return (
        (!partJobStatus || partJobStatus === 'ready') &&
        Boolean(rawPart.masterPlaylistUrl || rawPart.video_url)
      );
    })
  ) {
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

async function fetchMovieCatalog() {
  if (isFreshMovieCache(inMemoryMovieCache) && (inMemoryMovieCache?.movies?.length || 0) > 0) {
    return inMemoryMovieCache;
  }

  const diskCache = await readMovieCatalogFromDisk();

  if (isFreshMovieCache(diskCache) && (diskCache?.movies?.length || 0) > 0) {
    setInMemoryMovieCache(diskCache);
    return diskCache;
  }

  try {
    const moviesCollection = await getMoviesCollectionRef();
    const snapshot = await moviesCollection.orderBy('date_added', 'desc').get();
    const cache: CachedMovieCatalog = {
      movies: snapshot.docs.map((movieDoc) => ({
        id: movieDoc.id,
        ...movieDoc.data(),
      })),
      cachedAt: new Date().toISOString(),
    };

    setInMemoryMovieCache(cache);
    await persistMovieCatalog(cache);
    return cache;
  } catch (error) {
    const staleCache = diskCache || inMemoryMovieCache;

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
        sanitizeMovieForViewer(
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
