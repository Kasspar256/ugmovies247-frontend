import { normalizeMovie, type Movie } from '@/types/movie';
import { isAppInReview } from '@/lib/appReview';
import { isPublicMovieReady } from '@/lib/publicReadiness';

type CachedPublicMovieCatalog = {
  movies: Movie[];
  cachedAt: number;
  lastSyncedAt?: string;
};

const PUBLIC_MOVIE_CACHE_KEY = isAppInReview
  ? 'ugmovies247.public-movies.review.v1'
  : 'ugmovies247.public-movies.v2';
const PUBLIC_MOVIE_CACHE_TTL_MS = 1000 * 60 * 60 * 2;
const CLIENT_PUBLIC_READINESS_OPTIONS = { allowLockedPlaceholder: true };

let inMemoryMovieCatalog: CachedPublicMovieCatalog | null = null;
let inFlightMovieCatalogRequest: Promise<Movie[]> | null = null;
let inFlightMovieDeltaRequest: Promise<Movie[]> | null = null;
let lastBackgroundMovieRefreshAt = 0;

export const PUBLIC_MOVIES_UPDATED_EVENT = 'ugmovies247:public-movies-updated';

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

  const normalizedMovies = payload.map((movie) =>
    normalizeMovie(String((movie as Record<string, unknown>).id || ''), movie as Record<string, unknown>)
  );

  return isAppInReview
    ? normalizedMovies
    : normalizedMovies.filter((movie) => isPublicMovieReady(movie, CLIENT_PUBLIC_READINESS_OPTIONS));
}

function filterPublicReadyMovies(movies: Movie[]) {
  return isAppInReview
    ? movies
    : movies.filter((movie) => isPublicMovieReady(movie, CLIENT_PUBLIC_READINESS_OPTIONS));
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

  window.dispatchEvent(new CustomEvent(PUBLIC_MOVIES_UPDATED_EVENT));
}

export function clearPublicMovieCache() {
  inMemoryMovieCatalog = null;
  inFlightMovieCatalogRequest = null;
  inFlightMovieDeltaRequest = null;

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
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
    } satisfies CachedPublicMovieCatalog;
  } catch {
    return null;
  }
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
  }

  return 0;
}

function getMovieSyncTimestampMs(movie: Movie) {
  return Math.max(
    readTimestampMs(movie.updatedAt),
    readTimestampMs(movie.createdAt),
    readTimestampMs(movie.date_added),
    readTimestampMs(movie.processedAt)
  );
}

function getCatalogSyncTimestampMs(cache: CachedPublicMovieCatalog | null) {
  if (!cache?.movies?.length) {
    return 0;
  }

  return Math.max(
    readTimestampMs(cache.lastSyncedAt),
    ...cache.movies.map(getMovieSyncTimestampMs)
  );
}

function getCatalogSyncIso(cache: CachedPublicMovieCatalog | null) {
  const timestamp = getCatalogSyncTimestampMs(cache);
  return timestamp > 0 ? new Date(timestamp).toISOString() : '';
}

function mergeCatalogMovies(existingMovies: Movie[], incomingMovies: Movie[]) {
  const existingOrder = new Map<string, number>();
  const moviesById = new Map<string, Movie>();

  existingMovies.forEach((movie, index) => {
    existingOrder.set(movie.id, index);
    moviesById.set(movie.id, movie);
  });

  incomingMovies.forEach((movie, index) => {
    existingOrder.set(movie.id, existingOrder.get(movie.id) ?? -1000 + index);
    moviesById.set(movie.id, movie);
  });

  return Array.from(moviesById.values()).sort((left, right) => {
    const rightTimestamp = getMovieSyncTimestampMs(right);
    const leftTimestamp = getMovieSyncTimestampMs(left);

    if (rightTimestamp !== leftTimestamp) {
      return rightTimestamp - leftTimestamp;
    }

    return (existingOrder.get(left.id) ?? 0) - (existingOrder.get(right.id) ?? 0);
  });
}

export function subscribePublicMovieUpdates(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(PUBLIC_MOVIES_UPDATED_EVENT, listener);

  return () => {
    window.removeEventListener(PUBLIC_MOVIES_UPDATED_EVENT, listener);
  };
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
  return filterPublicReadyMovies(getBestAvailableCatalog()?.movies || getAnyAvailableCatalog()?.movies || []);
}

function findCachedPublicMovie(movieId: string) {
  const normalizedMovieId = movieId.trim();

  if (!normalizedMovieId) {
    return null;
  }

  return (
    readCachedPublicMovies().find((movie) =>
      movie.id === normalizedMovieId || movie.movieId === normalizedMovieId
    ) || null
  );
}

async function fetchPublicMovieDelta(cache: CachedPublicMovieCatalog) {
  if (inFlightMovieDeltaRequest) {
    return inFlightMovieDeltaRequest;
  }

  const since = getCatalogSyncIso(cache);

  if (!since) {
    return fetchPublicMovies({ force: true });
  }

  inFlightMovieDeltaRequest = fetch(`/api/movies?since=${encodeURIComponent(since)}`, {
    credentials: 'include',
    cache: 'no-store',
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || 'Failed to sync new movies.');
      }

      const incomingMovies = normalizeCatalogMovies(payload.movies);
      const currentCache = getAnyAvailableCatalog() || cache;
      const movies = incomingMovies.length
        ? mergeCatalogMovies(currentCache.movies || [], incomingMovies)
        : currentCache.movies || [];

      persistCatalog({
        movies,
        cachedAt: Date.now(),
        lastSyncedAt: getCatalogSyncIso({ movies, cachedAt: Date.now() }),
      });

      return movies;
    })
    .catch((error) => {
      console.warn('[movies-cache] delta sync failed, keeping local catalog', error);
      return filterPublicReadyMovies((getAnyAvailableCatalog() || cache).movies || []);
    })
    .finally(() => {
      inFlightMovieDeltaRequest = null;
    });

  return inFlightMovieDeltaRequest;
}

export function refreshPublicMoviesInBackground(options?: { refreshEntitlement?: boolean }) {
  if (typeof window === 'undefined') {
    return;
  }

  const now = Date.now();

  if (!options?.refreshEntitlement && now - lastBackgroundMovieRefreshAt < 1000 * 30) {
    return;
  }

  lastBackgroundMovieRefreshAt = now;
  const cache = getAnyAvailableCatalog();

  if (options?.refreshEntitlement || !cache?.movies?.length) {
    void fetchPublicMovies({ force: true, refreshEntitlement: options?.refreshEntitlement }).catch(() => undefined);
    return;
  }

  void fetchPublicMovieDelta(cache).catch(() => undefined);
}

export async function fetchPublicMovies(options?: { force?: boolean; refreshEntitlement?: boolean }): Promise<Movie[]> {
  const forceRefresh = options?.force === true;
  const shouldRefreshEntitlement = options?.refreshEntitlement === true;

  if (forceRefresh && inFlightMovieCatalogRequest) {
    return inFlightMovieCatalogRequest;
  }

  if (!forceRefresh) {
    const cachedCatalog = getBestAvailableCatalog();

    if (cachedCatalog) {
      refreshPublicMoviesInBackground({
        refreshEntitlement: shouldRefreshEntitlement,
      });
      return filterPublicReadyMovies(cachedCatalog.movies);
    }

    const staleCatalog = getAnyAvailableCatalog();

    if (staleCatalog?.movies?.length) {
      refreshPublicMoviesInBackground({
        refreshEntitlement: shouldRefreshEntitlement,
      });
      return filterPublicReadyMovies(staleCatalog.movies);
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
        lastSyncedAt: getCatalogSyncIso({ movies, cachedAt: Date.now() }),
      });

      return movies;
    })
    .catch((error) => {
      const staleCatalog = inMemoryMovieCatalog || readCatalogFromPersistentStorage();

      if (staleCatalog?.movies?.length) {
        return filterPublicReadyMovies(staleCatalog.movies);
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

  const cachedMovie = findCachedPublicMovie(normalizedMovieId);
  const response = await fetch(`/api/movies/${encodeURIComponent(normalizedMovieId)}?fresh=1`, {
    credentials: 'include',
    cache: 'no-store',
  }).catch(() => null);

  if (!response) {
    return cachedMovie;
  }

  const payload = await response.json().catch(() => ({}));

  if (response.status === 404 || response.status === 409) {
    return null;
  }

  if (!response.ok) {
    if (cachedMovie && response.status >= 500) {
      return cachedMovie;
    }

    throw new Error(payload.detail || payload.error || 'Failed to load movie.');
  }

  if (!payload.movie || typeof payload.movie !== 'object') {
    return null;
  }

  const movie = normalizeMovie(String(payload.movie.id || normalizedMovieId), payload.movie as Record<string, unknown>);
  const publicMovie =
    isAppInReview || isPublicMovieReady(movie, CLIENT_PUBLIC_READINESS_OPTIONS) ? movie : null;

  if (publicMovie) {
    const cache = getAnyAvailableCatalog();

    if (cache?.movies?.length) {
      const movies = mergeCatalogMovies(cache.movies, [publicMovie]);
      persistCatalog({
        movies,
        cachedAt: Date.now(),
        lastSyncedAt: getCatalogSyncIso({ movies, cachedAt: Date.now() }),
      });
    }
  }

  return publicMovie;
}
