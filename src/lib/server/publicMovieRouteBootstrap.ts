import { getCurrentAuthSession } from '@/lib/auth/server';
import { isAppInReview } from '@/lib/appReview';
import { getMovieListingKey, isSeriesMovie } from '@/lib/moviePresentation';
import { isPublicMovieReady, isPublicPlaybackAssetReady } from '@/lib/publicReadiness';
import {
  getSubscriptionSnapshotFromData,
  getViewerEntitlement,
} from '@/lib/server/subscriptions';
import type { SubscriptionEntitlement } from '@/types/subscriptions';
import { normalizeMovie, type Movie } from '@/types/movie';
import { getMovieCatalogCacheForBootstrap } from './publicCatalogBootstrapLoader';

type RawMovie = Record<string, unknown>;

const ROUTE_BOOTSTRAP_READINESS_OPTIONS = { allowLockedPlaceholder: true };
const AUTH_BOOTSTRAP_TIMEOUT_MS = 150;
const ENTITLEMENT_BOOTSTRAP_TIMEOUT_MS = 250;

const DEFAULT_ENTITLEMENT: SubscriptionEntitlement = {
  hasPremiumAccess: false,
  requiresSubscription: true,
  subscription: getSubscriptionSnapshotFromData(null),
};

function resolveAfter<T>(value: T, timeoutMs: number) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), timeoutMs);
  });
}

function isPremiumAccessTier(accessTier: unknown, subscriptionRequired?: unknown) {
  if (subscriptionRequired === false) {
    return false;
  }

  return accessTier !== 'free';
}

function stripPlaybackFields(entry: RawMovie) {
  return {
    ...entry,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
  };
}

function keepReadyPlaybackFields(entry: RawMovie) {
  return {
    ...entry,
    video_url: String(entry.video_url || ''),
    sourceUrl: String(entry.sourceUrl || ''),
    sourceFileName: String(entry.sourceFileName || ''),
    masterPlaylistUrl: String(entry.masterPlaylistUrl || ''),
    availableRenditions: Array.isArray(entry.availableRenditions) ? entry.availableRenditions : [],
    playbackType: entry.playbackType === 'hls' ? 'hls' : 'mp4',
  };
}

function sanitizeEpisodeForInitialPlayer(
  episode: RawMovie,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(episode.accessTier, episode.subscriptionRequired);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const baseEpisode = keepReadyPlaybackFields({
    ...episode,
    subscriptionRequired,
  });

  if (!isLocked && isPublicPlaybackAssetReady(episode)) {
    return {
      ...baseEpisode,
      isLocked: false,
    };
  }

  return {
    ...stripPlaybackFields(baseEpisode),
    isLocked,
  };
}

function sanitizeMoviePartForInitialPlayer(
  part: RawMovie,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(part.accessTier, part.subscriptionRequired);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const basePart = keepReadyPlaybackFields({
    ...part,
    subscriptionRequired,
  });

  if (!isLocked && isPublicPlaybackAssetReady(part)) {
    return {
      ...basePart,
      isLocked: false,
    };
  }

  return {
    ...stripPlaybackFields(basePart),
    isLocked,
  };
}

function sanitizeMovieForInitialPlayer(
  movie: RawMovie,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(movie.accessTier, movie.subscriptionRequired);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const parts = Array.isArray(movie.parts)
    ? movie.parts.map((part) =>
        sanitizeMoviePartForInitialPlayer(part as RawMovie, entitlement)
      )
    : [];
  const seasons = Array.isArray(movie.seasons)
    ? movie.seasons.map((season) => {
        const rawSeason = season as RawMovie;
        const episodes = Array.isArray(rawSeason.episodes)
          ? rawSeason.episodes.map((episode) =>
              sanitizeEpisodeForInitialPlayer(episode as RawMovie, entitlement)
            )
          : [];

        return {
          ...rawSeason,
          episodes,
        };
      })
    : [];

  const shouldExposePrimaryMovieSource =
    !isLocked && parts.length === 0 && isPublicPlaybackAssetReady(movie);

  return {
    ...movie,
    video_url: shouldExposePrimaryMovieSource ? String(movie.video_url || '') : '',
    sourceUrl: shouldExposePrimaryMovieSource ? String(movie.sourceUrl || '') : '',
    sourceFileName: shouldExposePrimaryMovieSource ? String(movie.sourceFileName || '') : '',
    masterPlaylistUrl: shouldExposePrimaryMovieSource ? String(movie.masterPlaylistUrl || '') : '',
    availableRenditions:
      shouldExposePrimaryMovieSource && Array.isArray(movie.availableRenditions)
        ? movie.availableRenditions
        : [],
    playbackType:
      shouldExposePrimaryMovieSource && movie.playbackType === 'hls' ? 'hls' : 'mp4',
    parts,
    seasons,
    accessTier: subscriptionRequired ? 'premium' : 'free',
    subscriptionRequired,
    isLocked,
  };
}

function sanitizeMovieForReviewMode(movie: RawMovie) {
  const parts = Array.isArray(movie.parts)
    ? movie.parts.map((part) => ({
        ...stripPlaybackFields(part as RawMovie),
        accessTier: 'free',
        subscriptionRequired: false,
        isLocked: false,
      }))
    : [];
  const seasons = Array.isArray(movie.seasons)
    ? movie.seasons.map((season) => {
        const rawSeason = season as RawMovie;
        const episodes = Array.isArray(rawSeason.episodes)
          ? rawSeason.episodes.map((episode) => ({
              ...stripPlaybackFields(episode as RawMovie),
              accessTier: 'free',
              subscriptionRequired: false,
              isLocked: false,
            }))
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
    accessTier: 'free',
    subscriptionRequired: false,
    isLocked: false,
  };
}

function normalizeRawMovie(movie: RawMovie, fallbackId = '') {
  const movieId = String(movie.id || movie.movieId || fallbackId);
  return normalizeMovie(movieId, {
    ...movie,
    id: movieId,
    movieId: String(movie.movieId || movieId),
  });
}

function sanitizeAndNormalizeMovie(
  movie: RawMovie,
  entitlement: SubscriptionEntitlement,
  fallbackId = ''
) {
  const movieId = String(movie.id || movie.movieId || fallbackId);
  const sanitizedMovie = isAppInReview
    ? sanitizeMovieForReviewMode({ ...movie, id: movieId })
    : sanitizeMovieForInitialPlayer({ ...movie, id: movieId }, entitlement);

  return normalizeRawMovie(sanitizedMovie, movieId);
}

async function getFastViewerEntitlement() {
  try {
    const session = await Promise.race([
      getCurrentAuthSession({ hydrateUserRecord: false }),
      resolveAfter<Awaited<ReturnType<typeof getCurrentAuthSession>>>(null, AUTH_BOOTSTRAP_TIMEOUT_MS),
    ]);

    if (!session) {
      return DEFAULT_ENTITLEMENT;
    }

    return await Promise.race([
      getViewerEntitlement(session.uid, {
        email: session.email,
        role: session.role,
      }),
      resolveAfter(DEFAULT_ENTITLEMENT, ENTITLEMENT_BOOTSTRAP_TIMEOUT_MS),
    ]);
  } catch (error) {
    console.warn('[movie-route-bootstrap] using default entitlement for initial render', error);
    return DEFAULT_ENTITLEMENT;
  }
}

function isVisibleMovie(movie: RawMovie) {
  return isAppInReview
    ? movie.is_for_review === true
    : isPublicMovieReady(movie, ROUTE_BOOTSTRAP_READINESS_OPTIONS);
}

function normalizeRouteMovieId(movieId: string) {
  try {
    return decodeURIComponent(movieId || '').trim();
  } catch {
    return (movieId || '').trim();
  }
}

export type PublicMovieRouteBootstrap = {
  movie: Movie | null;
  catalogMovies: Movie[];
  cachedAt: string;
};

export async function getPublicMovieRouteBootstrap(
  movieId: string
): Promise<PublicMovieRouteBootstrap> {
  const normalizedMovieId = normalizeRouteMovieId(movieId);
  const cache = await getMovieCatalogCacheForBootstrap();

  if (!normalizedMovieId || !cache?.movies?.length) {
    return { movie: null, catalogMovies: [], cachedAt: '' };
  }

  const rawMovie = cache.movies.find((candidate) => {
    const candidateId = String(candidate.id || '');
    const candidateMovieId = String(candidate.movieId || '');
    return candidateId === normalizedMovieId || candidateMovieId === normalizedMovieId;
  });

  if (!rawMovie || !isVisibleMovie(rawMovie)) {
    return { movie: null, catalogMovies: [], cachedAt: cache.cachedAt || '' };
  }

  const entitlement = await getFastViewerEntitlement();
  const normalizedRawMovie = normalizeRawMovie(rawMovie, normalizedMovieId);
  const listingKey = getMovieListingKey(normalizedRawMovie);
  const rawCatalogMovies = isSeriesMovie(normalizedRawMovie)
    ? cache.movies.filter((candidate) => {
        if (!isVisibleMovie(candidate)) {
          return false;
        }

        return getMovieListingKey(normalizeRawMovie(candidate)) === listingKey;
      })
    : [rawMovie];
  const catalogMovies = rawCatalogMovies.map((candidate) =>
    sanitizeAndNormalizeMovie(candidate, entitlement)
  );
  const movie =
    catalogMovies.find((candidate) =>
      candidate.id === normalizedMovieId || candidate.movieId === normalizedMovieId
    ) || sanitizeAndNormalizeMovie(rawMovie, entitlement, normalizedMovieId);

  return {
    movie,
    catalogMovies,
    cachedAt: cache.cachedAt || '',
  };
}
