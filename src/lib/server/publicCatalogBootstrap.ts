import { isAppInReview } from '@/lib/appReview';
import { DEFAULT_HOME_PAGE_CATEGORIES, type HomePageCategoryRecord } from '@/lib/homeRows';
import { dedupeSeriesMovies } from '@/lib/moviePresentation';
import { isPublicMovieReady, isPublicPlaybackAssetReady } from '@/lib/publicReadiness';
import { normalizeMovie, type Movie } from '@/types/movie';

type RawMovie = Record<string, unknown>;

export type PublicCatalogBootstrapPayload = {
  movies: Movie[];
  homePageCategories: HomePageCategoryRecord[];
  cachedAt: string;
  partial: true;
  source: 'memory' | 'disk' | 'empty';
};

const BOOTSTRAP_MOVIE_LIMIT = 96;
const BOOTSTRAP_LATEST_LIMIT = 72;
const BOOTSTRAP_TRENDING_LIMIT = 24;
const BOOTSTRAP_FEATURED_LIMIT = 24;
const BOOTSTRAP_READINESS_OPTIONS = { allowLockedPlaceholder: true };

let inMemoryPublicBootstrapCatalog: PublicCatalogBootstrapPayload | null = null;

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

function getMovieTimestamp(movie: RawMovie | Movie) {
  return Math.max(
    readTimestampMs(movie.date_added),
    readTimestampMs(movie.updatedAt),
    readTimestampMs(movie.createdAt),
    readTimestampMs(movie.processedAt)
  );
}

function sortByUploadDate<T extends RawMovie | Movie>(movies: T[]) {
  return [...movies].sort((left, right) => getMovieTimestamp(right) - getMovieTimestamp(left));
}

function isPremiumAccessTier(accessTier: unknown) {
  return accessTier !== 'free';
}

function compactPartForBootstrap(part: Record<string, unknown>) {
  const subscriptionRequired = isPremiumAccessTier(part.accessTier);

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
    subscriptionRequired,
    isLocked: subscriptionRequired,
    catalogReady: isPublicPlaybackAssetReady(part, BOOTSTRAP_READINESS_OPTIONS),
  };
}

function compactEpisodeForBootstrap(episode: Record<string, unknown>) {
  const subscriptionRequired = isPremiumAccessTier(episode.accessTier);

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
    subscriptionRequired,
    isLocked: subscriptionRequired,
    catalogReady: isPublicPlaybackAssetReady(episode, BOOTSTRAP_READINESS_OPTIONS),
  };
}

export function compactMovieForPublicBootstrap(movie: RawMovie): Movie {
  const subscriptionRequired = isPremiumAccessTier(movie.accessTier);
  const parts = Array.isArray(movie.parts)
    ? movie.parts.map((part) => compactPartForBootstrap(part as Record<string, unknown>))
    : [];
  const seasons = Array.isArray(movie.seasons)
    ? movie.seasons.map((season) => {
        const rawSeason = season as Record<string, unknown>;

        return {
          seasonNumber: typeof rawSeason.seasonNumber === 'number' ? rawSeason.seasonNumber : 0,
          title: String(rawSeason.title || ''),
          overview: String(rawSeason.overview || ''),
          poster: String(rawSeason.poster || ''),
          tmdb_id: typeof rawSeason.tmdb_id === 'number' ? rawSeason.tmdb_id : null,
          episodes: Array.isArray(rawSeason.episodes)
            ? rawSeason.episodes.map((episode) =>
                compactEpisodeForBootstrap(episode as Record<string, unknown>)
              )
            : [],
        };
      })
    : [];

  return normalizeMovie(String(movie.id || movie.movieId || ''), {
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
    cast: [],
    poster: String(movie.poster || ''),
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
    subscriptionRequired,
    isLocked: subscriptionRequired,
    catalogReady: isPublicMovieReady(movie, BOOTSTRAP_READINESS_OPTIONS),
    is_for_review: movie.is_for_review === true,
    is_trending_tiktok: movie.is_trending_tiktok === true,
    parts,
    seasons,
  });
}

function pickBootstrapMovies(movieDocs: RawMovie[]) {
  const visibleMovies = sortByUploadDate(
    movieDocs.filter((movie) =>
      isAppInReview
        ? movie.is_for_review === true
        : isPublicMovieReady(movie, BOOTSTRAP_READINESS_OPTIONS)
    )
  );
  const latestMovies = visibleMovies.slice(0, BOOTSTRAP_LATEST_LIMIT);
  const trendingMovies = visibleMovies
    .filter((movie) => movie.is_trending_tiktok === true)
    .slice(0, BOOTSTRAP_TRENDING_LIMIT);
  const featuredMovies = visibleMovies
    .filter((movie) => Array.isArray(movie.category) && movie.category.length > 0)
    .slice(0, BOOTSTRAP_FEATURED_LIMIT);

  return dedupeSeriesMovies(
    [...latestMovies, ...trendingMovies, ...featuredMovies]
      .map(compactMovieForPublicBootstrap)
      .filter((movie) => movie.id)
  ).slice(0, BOOTSTRAP_MOVIE_LIMIT);
}

export function setPublicBootstrapCatalogFromMovieCache(
  cache: { movies?: RawMovie[]; cachedAt?: string; reviewOnly?: boolean } | null,
  source: 'memory' | 'disk' = 'memory'
) {
  if (!cache?.movies?.length) {
    inMemoryPublicBootstrapCatalog = null;
    return null;
  }

  if (isAppInReview !== (cache.reviewOnly === true) && cache.reviewOnly !== undefined) {
    return inMemoryPublicBootstrapCatalog;
  }

  const movies = pickBootstrapMovies(cache.movies);

  if (!movies.length) {
    inMemoryPublicBootstrapCatalog = null;
    return null;
  }

  inMemoryPublicBootstrapCatalog = {
    movies,
    homePageCategories: DEFAULT_HOME_PAGE_CATEGORIES,
    cachedAt: cache.cachedAt || new Date().toISOString(),
    partial: true,
    source,
  };

  return inMemoryPublicBootstrapCatalog;
}

export function upsertPublicBootstrapMovie(movie: RawMovie) {
  if (isAppInReview && movie.is_for_review !== true) {
    return;
  }

  if (!isAppInReview && !isPublicMovieReady(movie, BOOTSTRAP_READINESS_OPTIONS)) {
    return;
  }

  const nextMovie = compactMovieForPublicBootstrap(movie);
  const currentMovies = inMemoryPublicBootstrapCatalog?.movies || [];
  const nextMovies = dedupeSeriesMovies([nextMovie, ...currentMovies])
    .sort((left, right) => getMovieTimestamp(right) - getMovieTimestamp(left))
    .slice(0, BOOTSTRAP_MOVIE_LIMIT);

  inMemoryPublicBootstrapCatalog = {
    movies: nextMovies,
    homePageCategories: DEFAULT_HOME_PAGE_CATEGORIES,
    cachedAt: new Date().toISOString(),
    partial: true,
    source: 'memory',
  };
}

export function readPublicBootstrapCatalogFromMemory() {
  return inMemoryPublicBootstrapCatalog;
}

export function createEmptyPublicBootstrapPayload(): PublicCatalogBootstrapPayload {
  return {
    movies: [],
    homePageCategories: DEFAULT_HOME_PAGE_CATEGORIES,
    cachedAt: new Date().toISOString(),
    partial: true,
    source: 'empty',
  };
}
