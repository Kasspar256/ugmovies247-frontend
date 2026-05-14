import { normalizeMovie, type Movie } from '@/types/movie';
import { isAppInReview } from '@/lib/appReview';

type CachedPublicMovieCatalog = {
  movies: Movie[];
  cachedAt: number;
};

const PUBLIC_MOVIE_CACHE_KEY = isAppInReview
  ? 'ugmovies247.public-movies.review.v1'
  : 'ugmovies247.public-movies.v2';
const PUBLIC_MOVIE_CACHE_TTL_MS = 1000 * 60 * 60;

let inMemoryMovieCatalog: CachedPublicMovieCatalog | null = null;
let inFlightMovieCatalogRequest: Promise<Movie[]> | null = null;

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
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

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(PUBLIC_MOVIE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore session storage write failures and keep the in-memory cache.
  }
}

export function clearPublicMovieCache() {
  inMemoryMovieCatalog = null;
  inFlightMovieCatalogRequest = null;

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(PUBLIC_MOVIE_CACHE_KEY);
    window.sessionStorage.removeItem('ugmovies247.public-movies.review.v1');
    window.sessionStorage.removeItem('ugmovies247.public-movies.v1');
    window.sessionStorage.removeItem('ugmovies247.public-movies.v2');
  } catch {
    // Ignore session storage removal failures and keep the cache cleared in memory.
  }
}

function readCatalogFromSessionStorage() {
  if (!canUseSessionStorage()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PUBLIC_MOVIE_CACHE_KEY);

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

  const diskCache = readCatalogFromSessionStorage();

  if (isFreshCatalog(diskCache) && (diskCache?.movies?.length || 0) > 0) {
    inMemoryMovieCatalog = diskCache;
    return diskCache;
  }

  return null;
}

export function readCachedPublicMovies(): Movie[] {
  return getBestAvailableCatalog()?.movies || [];
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
      const staleCatalog = inMemoryMovieCatalog || readCatalogFromSessionStorage();

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
