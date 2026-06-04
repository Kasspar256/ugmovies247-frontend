import { normalizeMovie, type Movie } from '@/types/movie';
import { isAppInReview } from '@/lib/appReview';
import { getHydratedClientDeviceHeaders } from '@/lib/auth/deviceIdentity';
import {
  isPublicMovieReady,
  isPublicPlaybackAssetReady,
} from '@/lib/publicReadiness';

type CachedPublicMovieCatalog = {
  movies: Movie[];
  cachedAt: number;
  lastSyncedAt?: string;
  partial?: boolean;
};

type PersistentCatalogStore = {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<T>;
  removeItem(key: string): Promise<void>;
};

const PUBLIC_MOVIE_CACHE_KEY = isAppInReview
  ? 'ugmovies247.public-movies.review.v1'
  : 'ugmovies247.public-movies.v9';
const PUBLIC_MOVIE_CACHE_LEGACY_KEYS = [
  PUBLIC_MOVIE_CACHE_KEY,
  'ugmovies247.public-movies.review.v1',
  'ugmovies247.public-movies.v1',
  'ugmovies247.public-movies.v2',
  'ugmovies247.public-movies.v3',
  'ugmovies247.public-movies.v4',
  'ugmovies247.public-movies.v5',
  'ugmovies247.public-movies.v6',
  'ugmovies247.public-movies.v7',
  'ugmovies247.public-movies.v8',
];
const PUBLIC_MOVIE_CACHE_TTL_MS = 1000 * 60 * 60 * 2;
const CLIENT_PUBLIC_READINESS_OPTIONS = { allowLockedPlaceholder: true };

let inMemoryMovieCatalog: CachedPublicMovieCatalog | null = null;
let inFlightMovieCatalogRequest: Promise<Movie[]> | null = null;
let inFlightMovieDeltaRequest: Promise<Movie[]> | null = null;
let persistentCatalogStorePromise: Promise<PersistentCatalogStore | null> | null = null;
let persistentCatalogReadPromise: Promise<CachedPublicMovieCatalog | null> | null = null;
let lastBackgroundMovieRefreshAt = 0;

export const PUBLIC_MOVIES_UPDATED_EVENT = 'ugmovies247:public-movies-updated';

function dispatchPublicMoviesUpdated() {
  if (typeof window === 'undefined') {
    return;
  }

  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(PUBLIC_MOVIES_UPDATED_EVENT));
  }, 0);
}

function canUseBrowserStorage() {
  return typeof window !== 'undefined';
}

async function getPersistentCatalogStore() {
  if (!canUseBrowserStorage()) {
    return null;
  }

  if (!persistentCatalogStorePromise) {
    persistentCatalogStorePromise = import('localforage')
      .then(({ default: localforage }) =>
        localforage.createInstance({
          name: 'ugmovies247',
          storeName: 'public_movie_catalog',
        }) as PersistentCatalogStore
      )
      .catch((error) => {
        console.warn('[movies-cache] IndexedDB catalog store unavailable', error);
        return null;
      });
  }

  return persistentCatalogStorePromise;
}

function isFreshCatalog(cache: CachedPublicMovieCatalog | null) {
  return Boolean(cache && Date.now() - cache.cachedAt < PUBLIC_MOVIE_CACHE_TTL_MS);
}

function isAuthoritativeCatalog(cache: CachedPublicMovieCatalog | null) {
  return Boolean(cache && !cache.partial);
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

function compactPartForPersistentCache(part: NonNullable<Movie['parts']>[number]) {
  return {
    id: part.id,
    label: part.label,
    order: part.order,
    title: part.title || '',
    description: part.description || '',
    video_url: '',
    poster: part.poster || '',
    thumbnail: part.thumbnail || '',
    jobStatus: part.jobStatus,
    processedAt: part.processedAt || '',
    createdAt: part.createdAt || '',
    updatedAt: part.updatedAt || '',
    accessTier: part.accessTier,
    subscriptionRequired: part.subscriptionRequired,
    isLocked: part.isLocked,
    catalogReady: isPublicPlaybackAssetReady(
      part as unknown as Record<string, unknown>,
      CLIENT_PUBLIC_READINESS_OPTIONS
    ),
  };
}

function compactEpisodeForPersistentCache(episode: NonNullable<Movie['seasons']>[number]['episodes'][number]) {
  return {
    episodeNumber: episode.episodeNumber,
    title: episode.title || '',
    description: episode.description || '',
    overview: episode.overview || '',
    video_url: '',
    poster: episode.poster || '',
    thumbnail: episode.thumbnail || '',
    overriddenBackdrop: episode.overriddenBackdrop || '',
    episodeTrailerUrl: episode.episodeTrailerUrl || '',
    jobStatus: episode.jobStatus,
    processedAt: episode.processedAt || '',
    createdAt: episode.createdAt || '',
    updatedAt: episode.updatedAt || '',
    accessTier: episode.accessTier,
    subscriptionRequired: episode.subscriptionRequired,
    isLocked: episode.isLocked,
    catalogReady: isPublicPlaybackAssetReady(
      episode as unknown as Record<string, unknown>,
      CLIENT_PUBLIC_READINESS_OPTIONS
    ),
  };
}

function compactMovieForPersistentCache(movie: Movie): Movie {
  return {
    id: movie.id,
    movieId: movie.movieId || movie.id,
    contentType: movie.contentType,
    title: movie.title,
    original_title: movie.original_title || '',
    name: movie.name || '',
    overview: movie.overview || '',
    description: movie.description || '',
    language: movie.language || '',
    releaseYear: movie.releaseYear ?? null,
    tags: movie.tags || [],
    cast: [],
    poster: movie.poster || '',
    heroPoster: movie.heroPoster || '',
    overriddenBackdrop: movie.overriddenBackdrop || '',
    overriddenPlayerBackdrop: movie.overriddenPlayerBackdrop || '',
    playerBackdrop: movie.playerBackdrop || '',
    genres: movie.genres || [],
    category: movie.category || [],
    vj: movie.vj || '',
    trailerUrl: movie.trailerUrl || '',
    mainSeriesTrailerUrl: movie.mainSeriesTrailerUrl || '',
    trailer_url: movie.trailer_url || '',
    release_date: movie.release_date || '',
    date_added: movie.date_added || '',
    country: movie.country || '',
    tmdb_id: movie.tmdb_id ?? null,
    file_name: movie.file_name || '',
    status: movie.status || '',
    jobStatus: movie.jobStatus,
    processingProgress: movie.processingProgress || 0,
    processedAt: movie.processedAt || '',
    createdAt: movie.createdAt || '',
    updatedAt: movie.updatedAt || '',
    accessTier: movie.accessTier,
    subscriptionRequired: movie.subscriptionRequired,
    isLocked: movie.isLocked,
    catalogReady: isPublicMovieReady(
      movie as unknown as Record<string, unknown>,
      CLIENT_PUBLIC_READINESS_OPTIONS
    ),
    is_for_review: movie.is_for_review,
    is_trending_tiktok: movie.is_trending_tiktok,
    parts: movie.parts?.map(compactPartForPersistentCache) || [],
    seasons:
      movie.seasons?.map((season) => ({
        seasonNumber: season.seasonNumber,
        title: season.title || '',
        overview: season.overview || '',
        poster: season.poster || '',
        overriddenBackdrop: season.overriddenBackdrop || '',
        tmdb_id: season.tmdb_id ?? null,
        episodes: season.episodes.map(compactEpisodeForPersistentCache),
      })) || [],
  };
}

function compactCatalogForPersistentCache(cache: CachedPublicMovieCatalog): CachedPublicMovieCatalog {
  return {
    ...cache,
    movies: cache.movies.map(compactMovieForPersistentCache),
    partial: cache.partial,
  };
}

function normalizePersistentCatalog(payload: unknown) {
  const parsed = payload as Partial<CachedPublicMovieCatalog> | null;

  if (!parsed || !Array.isArray(parsed.movies) || typeof parsed.cachedAt !== 'number') {
    return null;
  }

  return {
    movies: normalizeCatalogMovies(parsed.movies),
    cachedAt: parsed.cachedAt,
    lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
    partial: parsed.partial === true,
  } satisfies CachedPublicMovieCatalog;
}

function removeLegacyPublicMovieStorage() {
  if (!canUseBrowserStorage()) {
    return;
  }

  try {
    PUBLIC_MOVIE_CACHE_LEGACY_KEYS.forEach((key) => {
      window.localStorage?.removeItem(key);
      window.sessionStorage?.removeItem(key);
    });
  } catch {
    // Ignore legacy storage cleanup failures.
  }
}

async function writeCatalogToPersistentStorage(cache: CachedPublicMovieCatalog) {
  const store = await getPersistentCatalogStore();

  if (!store) {
    return;
  }

  try {
    await store.setItem(PUBLIC_MOVIE_CACHE_KEY, compactCatalogForPersistentCache(cache));
    removeLegacyPublicMovieStorage();
  } catch (error) {
    console.warn('[movies-cache] failed to persist IndexedDB catalog', error);
  }
}

async function readCatalogFromPersistentStorageAsync() {
  if (persistentCatalogReadPromise) {
    return persistentCatalogReadPromise;
  }

  persistentCatalogReadPromise = (async () => {
    const store = await getPersistentCatalogStore();

    if (!store) {
      return null;
    }

    try {
      return normalizePersistentCatalog(await store.getItem(PUBLIC_MOVIE_CACHE_KEY));
    } catch (error) {
      console.warn('[movies-cache] failed to read IndexedDB catalog', error);
      return null;
    }
  })();

  return persistentCatalogReadPromise;
}

function persistCatalog(cache: CachedPublicMovieCatalog) {
  if (!cache.movies.length) {
    const existingCatalog = getAnyAvailableCatalog();

    if (existingCatalog?.movies?.length) {
      console.warn('[movies-cache] refused to overwrite local catalog with an empty response');
      return;
    }
  }

  inMemoryMovieCatalog = cache;
  persistentCatalogReadPromise = Promise.resolve(cache);

  void writeCatalogToPersistentStorage(cache);
  dispatchPublicMoviesUpdated();
}

export function clearPublicMovieCache() {
  inMemoryMovieCatalog = null;
  inFlightMovieCatalogRequest = null;
  inFlightMovieDeltaRequest = null;
  persistentCatalogReadPromise = null;

  removeLegacyPublicMovieStorage();
  void getPersistentCatalogStore()
    .then((store) => store?.removeItem(PUBLIC_MOVIE_CACHE_KEY))
    .catch(() => undefined);
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
  const partTimestamps = (movie.parts || []).map((part) =>
    Math.max(
      readTimestampMs(part.updatedAt),
      readTimestampMs(part.createdAt),
      readTimestampMs(part.processedAt)
    )
  );
  const episodeTimestamps = (movie.seasons || []).flatMap((season) =>
    (season.episodes || []).map((episode) =>
      Math.max(
        readTimestampMs(episode.updatedAt),
        readTimestampMs(episode.createdAt),
        readTimestampMs(episode.processedAt)
      )
    )
  );

  return Math.max(
    readTimestampMs(movie.updatedAt),
    readTimestampMs(movie.createdAt),
    readTimestampMs(movie.date_added),
    readTimestampMs(movie.processedAt),
    ...partTimestamps,
    ...episodeTimestamps
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

function getBestAvailableCatalog(options?: { allowPartial?: boolean }) {
  if (
    isFreshCatalog(inMemoryMovieCatalog) &&
    (inMemoryMovieCatalog?.movies?.length || 0) > 0 &&
    (options?.allowPartial || isAuthoritativeCatalog(inMemoryMovieCatalog))
  ) {
    return inMemoryMovieCatalog;
  }

  return null;
}

function getAnyAvailableCatalog() {
  return inMemoryMovieCatalog;
}

export function readCachedPublicMovies(): Movie[] {
  return filterPublicReadyMovies(
    getBestAvailableCatalog({ allowPartial: true })?.movies ||
      getAnyAvailableCatalog()?.movies ||
      []
  );
}

export function hasAuthoritativePublicMovieCatalog() {
  return isAuthoritativeCatalog(getBestAvailableCatalog());
}

export function hasPartialPublicMovieCatalog() {
  return getAnyAvailableCatalog()?.partial === true;
}

export function primePublicMovieCatalog(
  movies: Movie[],
  options?: { cachedAt?: string; partial?: boolean }
) {
  if (typeof window === 'undefined' || !movies.length) {
    return;
  }

  const existingCatalog = getAnyAvailableCatalog();

  if (
    existingCatalog?.movies?.length &&
    !existingCatalog.partial &&
    existingCatalog.movies.length >= movies.length
  ) {
    return;
  }

  inMemoryMovieCatalog = {
    movies: filterPublicReadyMovies(movies),
    cachedAt: options?.cachedAt ? new Date(options.cachedAt).getTime() || Date.now() : Date.now(),
    lastSyncedAt: options?.cachedAt,
    partial: options?.partial !== false,
  };
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
  if (cache.partial) {
    return fetchPublicMovies({ force: true });
  }

  if (inFlightMovieDeltaRequest) {
    return inFlightMovieDeltaRequest;
  }

  const since = getCatalogSyncIso(cache);

  if (!since) {
    return fetchPublicMovies({ force: true });
  }

  const headers = await getHydratedClientDeviceHeaders();

  inFlightMovieDeltaRequest = fetch(`/api/movies?compact=1&since=${encodeURIComponent(since)}`, {
    headers,
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
        partial: false,
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

export function refreshPublicMoviesInBackground(options?: {
  refreshEntitlement?: boolean;
  forceFull?: boolean;
}) {
  if (typeof window === 'undefined') {
    return;
  }

  const now = Date.now();

  if (
    !options?.forceFull &&
    !options?.refreshEntitlement &&
    now - lastBackgroundMovieRefreshAt < 1000 * 30
  ) {
    return;
  }

  lastBackgroundMovieRefreshAt = now;
  const cache = getAnyAvailableCatalog();

  if (options?.forceFull || options?.refreshEntitlement || !cache?.movies?.length || cache.partial) {
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

  if (!forceRefresh && !shouldRefreshEntitlement) {
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
        forceFull: staleCatalog.partial === true,
      });
      return filterPublicReadyMovies(staleCatalog.movies);
    }

    const persistentCatalog = await readCatalogFromPersistentStorageAsync();

    if (persistentCatalog?.movies?.length) {
      inMemoryMovieCatalog = persistentCatalog;

      if (
        isFreshCatalog(persistentCatalog) &&
        (persistentCatalog.partial !== true || isAuthoritativeCatalog(persistentCatalog))
      ) {
        refreshPublicMoviesInBackground({
          refreshEntitlement: shouldRefreshEntitlement,
        });
      } else {
        refreshPublicMoviesInBackground({
          refreshEntitlement: shouldRefreshEntitlement,
          forceFull: persistentCatalog.partial === true,
        });
      }

      return filterPublicReadyMovies(persistentCatalog.movies);
    }

    if (inFlightMovieCatalogRequest) {
      return inFlightMovieCatalogRequest;
    }
  }

  const moviesParams = new URLSearchParams({ compact: '1' });

  if (shouldRefreshEntitlement) {
    moviesParams.set('refreshEntitlement', '1');
  }

  if (forceRefresh) {
    moviesParams.set('force', '1');
  }

  const moviesUrl = `/api/movies?${moviesParams.toString()}`;
  const headers = await getHydratedClientDeviceHeaders();

  inFlightMovieCatalogRequest = fetch(moviesUrl, {
    headers,
    credentials: 'include',
    cache: 'no-store',
  })
    .then(async (response) => {
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || 'Failed to load movies.');
      }

      const movies = normalizeCatalogMovies(payload.movies);
      const staleCatalog = getAnyAvailableCatalog();

      if (!movies.length && staleCatalog?.movies?.length) {
        console.warn('[movies-cache] API returned an empty catalog, keeping local catalog');
        return filterPublicReadyMovies(staleCatalog.movies);
      }

      persistCatalog({
        movies,
        cachedAt: Date.now(),
        lastSyncedAt: getCatalogSyncIso({ movies, cachedAt: Date.now() }),
        partial: false,
      });

      return movies;
    })
    .catch((error) => {
      const staleCatalog = inMemoryMovieCatalog;

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
  const headers = await getHydratedClientDeviceHeaders();
  const response = await fetch(`/api/movies/${encodeURIComponent(normalizedMovieId)}?fresh=1`, {
    headers,
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
