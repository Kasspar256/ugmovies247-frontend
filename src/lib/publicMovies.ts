import { normalizeMovie, type Movie } from '@/types/movie';
import { isAppInReview } from '@/lib/appReview';

type CachedPublicMovieCatalog = {
  movies: Movie[];
  cachedAt: number;
};

const PUBLIC_MOVIE_CACHE_KEY = isAppInReview
  ? 'ugmovies247.public-movies.review.v1'
  : 'ugmovies247.public-movies.v2';
const PUBLIC_MOVIE_CACHE_TTL_MS = 1000 * 60 * 60 * 2;

let inMemoryMovieCatalog: CachedPublicMovieCatalog | null = null;
let inFlightMovieCatalogRequest: Promise<Movie[]> | null = null;

function canUsePersistentStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isFreshCatalog(cache: CachedPublicMovieCatalog | null) {
  return Boolean(cache && Date.now() - cache.cachedAt < PUBLIC_MOVIE_CACHE_TTL_MS);
}

function normalizeCatalogMovies(payload: unknown): Movie[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((movie) =>
    normalizeMovie(String((movie as Record<string, unknown>).id || ''), movie as Record<string, unknown>)
  );
}

function persistCatalog(cache: CachedPublicMovieCatalog) {
  inMemoryMovieCatalog = cache;

  if (!canUsePersistentStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(PUBLIC_MOVIE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore persistent storage write failures and keep the in-memory cache.
  }
}

export function clearPublicMovieCache() {
  inMemoryMovieCatalog = null;
  inFlightMovieCatalogRequest = null;

  try {
    window.localStorage?.removeItem(PUBLIC_MOVIE_CACHE_KEY);
    window.localStorage?.removeItem('ugmovies247.public-movies.review.v1');
    window.localStorage?.removeItem('ugmovies247.public-movies.v1');
    window.localStorage?.removeItem('ugmovies247.public-movies.v2');
    window.sessionStorage?.removeItem(PUBLIC_MOVIE_CACHE_KEY);
    window.sessionStorage?.removeItem('ugmovies247.public-movies.review.v1');
    window.sessionStorage?.removeItem('ugmovies247.public-movies.v1');
    window.sessionStorage?.removeItem('ugmovies247.public-movies.v2');
  } catch {
    // Ignore persistent storage removal failures and keep the cache cleared in memory.
  }
}

function readCatalogFromPersistentStorage() {
  if (!canUsePersistentStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PUBLIC_MOVIE_CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedPublicMovieCatalog>;

    if (!Array.isArray(parsed.movies) || typeof parsed.cachedAt !== 'number') {
      return null;
    }

    return {
      movies: normalizeCatalogMovies(parsed.movies),
      cachedAt: parsed.cachedAt,
    } satisfies CachedPublicMovieCatalog;
  } catch {
    return null;
  }
}

function getBestAvailableCatalog() {
  if (isFreshCatalog(inMemoryMovieCatalog) && (inMemoryMovieCatalog?.movies?.length || 0) > 0) {
    return inMemoryMovieCatalog;
  }

  const diskCache = readCatalogFromPersistentStorage();

  if (isFreshCatalog(diskCache) && (diskCache?.movies?.length || 0) > 0) {
    inMemoryMovieCatalog = diskCache;
    return diskCache;
  }

  return null;
}

function getAnyAvailableCatalog() {
  return inMemoryMovieCatalog || readCatalogFromPersistentStorage();
}

export function readCachedPublicMovies(): Movie[] {
  return getBestAvailableCatalog()?.movies || getAnyAvailableCatalog()?.movies || [];
}

export async function fetchPublicMovies(options?: { force?: boolean; refreshEntitlement?: boolean }): Promise<Movie[]> {
  const forceRefresh = options?.force === true;
  const shouldRefreshEntitlement = options?.refreshEntitlement === true;

  if (!forceRefresh) {
    const cachedCatalog = getBestAvailableCatalog();

    if (cachedCatalog) {
      return cachedCatalog.movies;
    }

    if (inFlightMovieCatalogRequest) {
      return inFlightMovieCatalogRequest;
    }
  }

  const moviesUrl = shouldRefreshEntitlement ? '/api/movies?refreshEntitlement=1' : '/api/movies';

  inFlightMovieCatalogRequest = fetch(moviesUrl, {
    credentials: 'include',
    cache: 'no-store',
  })
    .then(async (response) => {
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || 'Failed to load movies.');
      }

      const movies = normalizeCatalogMovies(payload.movies);
      persistCatalog({
        movies,
        cachedAt: Date.now(),
      });

      return movies;
    })
    .catch((error) => {
      const staleCatalog = inMemoryMovieCatalog || readCatalogFromPersistentStorage();

      if (staleCatalog?.movies?.length) {
        return staleCatalog.movies;
      }

      throw error;
    })
    .finally(() => {
      inFlightMovieCatalogRequest = null;
    });

  return inFlightMovieCatalogRequest;
}

export async function fetchPublicMovieById(movieId: string): Promise<Movie | null> {
  const normalizedMovieId = movieId.trim();

  if (!normalizedMovieId) {
    return null;
  }

  const response = await fetch(`/api/movies/${encodeURIComponent(normalizedMovieId)}?fresh=1`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || 'Failed to load movie.');
  }

  if (!payload.movie || typeof payload.movie !== 'object') {
    return null;
  }

  return normalizeMovie(String(payload.movie.id || normalizedMovieId), payload.movie as Record<string, unknown>);
}
