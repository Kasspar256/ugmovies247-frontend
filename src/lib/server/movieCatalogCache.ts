import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { FIRESTORE_ENV_NAMESPACE, MOVIES_COLLECTION } from './firestoreNamespaces';
import {
  setPublicBootstrapCatalogFromMovieCache,
  upsertPublicBootstrapMovie,
} from './publicCatalogBootstrap';

export const MOVIE_CACHE_TTL_MS = 1000 * 60 * 60 * 2;
export const MOVIE_CACHE_QUOTA_COOLDOWN_MS = 1000 * 60 * 10;
export const MOVIE_CACHE_DISK_REFRESH_CHECK_MS = 1000 * 10;
export const MOVIE_CACHE_PATH = path.join(
  process.cwd(),
  '.runtime-cache',
  `movies-catalog.${FIRESTORE_ENV_NAMESPACE}.json`
);

export type CachedMovieCatalog = {
  movies: Array<Record<string, unknown>>;
  cachedAt: string;
  collectionName?: string;
  reviewOnly?: boolean;
};

export let inMemoryMovieCache: CachedMovieCatalog | null = null;
let movieCatalogQuotaBlockedUntil = 0;
let lastDiskRefreshCheckAt = 0;

export function setInMemoryMovieCache(cache: CachedMovieCatalog | null) {
  inMemoryMovieCache = cache;
  setPublicBootstrapCatalogFromMovieCache(cache);
}

function isMovieCatalogQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /resource_exhausted|quota exceeded|timed out/i.test(message);
}

export function setMovieCatalogQuotaCooldown(durationMs = MOVIE_CACHE_QUOTA_COOLDOWN_MS) {
  movieCatalogQuotaBlockedUntil = Date.now() + durationMs;
}

export function recordMovieCatalogQuotaFailure(error: unknown) {
  if (!isMovieCatalogQuotaError(error)) {
    return false;
  }

  setMovieCatalogQuotaCooldown();
  return true;
}

export function clearMovieCatalogQuotaFailure() {
  movieCatalogQuotaBlockedUntil = 0;
}

export function isMovieCatalogQuotaBlocked() {
  return movieCatalogQuotaBlockedUntil > Date.now();
}

export function pickMovieCatalogCache(
  ...caches: Array<CachedMovieCatalog | null | undefined>
) {
  return caches
    .filter((cache): cache is CachedMovieCatalog => Boolean(cache?.movies?.length))
    .sort(
      (left, right) =>
        new Date(right.cachedAt || 0).getTime() - new Date(left.cachedAt || 0).getTime()
    )[0] || null;
}

export function isFreshMovieCache(cache: CachedMovieCatalog | null) {
  if (!cache?.cachedAt || !cache.movies?.length) {
    return false;
  }

  return Date.now() - new Date(cache.cachedAt).getTime() < MOVIE_CACHE_TTL_MS;
}

export async function readMovieCatalogFromDisk() {
  try {
    const raw = await readFile(MOVIE_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CachedMovieCatalog;

    if (
      !Array.isArray(parsed.movies) ||
      parsed.movies.length === 0 ||
      typeof parsed.cachedAt !== 'string'
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function refreshInMemoryMovieCacheFromDiskIfNewer(options?: {
  collectionName?: string;
  reviewOnly?: boolean;
  force?: boolean;
  minIntervalMs?: number;
}) {
  const now = Date.now();
  const minIntervalMs = options?.minIntervalMs ?? MOVIE_CACHE_DISK_REFRESH_CHECK_MS;

  if (!options?.force && now - lastDiskRefreshCheckAt < minIntervalMs) {
    return inMemoryMovieCache;
  }

  lastDiskRefreshCheckAt = now;

  try {
    const diskStat = await stat(MOVIE_CACHE_PATH);
    const memoryCachedAt = inMemoryMovieCache?.cachedAt
      ? new Date(inMemoryMovieCache.cachedAt).getTime()
      : 0;

    if (
      !options?.force &&
      inMemoryMovieCache?.movies?.length &&
      Number.isFinite(diskStat.mtimeMs) &&
      diskStat.mtimeMs <= memoryCachedAt
    ) {
      return inMemoryMovieCache;
    }
  } catch {
    return inMemoryMovieCache;
  }

  const diskCache = await readMovieCatalogFromDisk();

  if (!diskCache?.movies?.length) {
    return inMemoryMovieCache;
  }

  if (
    options?.collectionName &&
    diskCache.collectionName &&
    diskCache.collectionName !== options.collectionName
  ) {
    return inMemoryMovieCache;
  }

  if (typeof options?.reviewOnly === 'boolean') {
    if (options.reviewOnly && diskCache.reviewOnly !== true) {
      return inMemoryMovieCache;
    }

    if (!options.reviewOnly && diskCache.reviewOnly === true) {
      return inMemoryMovieCache;
    }
  }

  const diskCachedAt = diskCache.cachedAt ? new Date(diskCache.cachedAt).getTime() : 0;
  const memoryCachedAt = inMemoryMovieCache?.cachedAt
    ? new Date(inMemoryMovieCache.cachedAt).getTime()
    : 0;

  if (!inMemoryMovieCache?.movies?.length || diskCachedAt > memoryCachedAt) {
    setInMemoryMovieCache(diskCache);
  }

  return inMemoryMovieCache;
}

export async function persistMovieCatalog(cache: CachedMovieCatalog) {
  setInMemoryMovieCache(cache);

  try {
    await mkdir(path.dirname(MOVIE_CACHE_PATH), { recursive: true });
    await writeFile(MOVIE_CACHE_PATH, JSON.stringify(cache), 'utf8');
  } catch (error) {
    console.warn('[movie-cache] failed to persist movie cache', error);
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

function sortCatalogMovies(movies: Array<Record<string, unknown>>) {
  return [...movies].sort((left, right) => getMovieTimestamp(right) - getMovieTimestamp(left));
}

export async function upsertMovieInCatalogCache(movie: Record<string, unknown>) {
  const movieId = String(movie.id || movie.movieId || '');

  if (!movieId) {
    return;
  }

  await refreshInMemoryMovieCacheFromDiskIfNewer({
    collectionName: MOVIES_COLLECTION,
    reviewOnly: false,
    force: true,
    minIntervalMs: 0,
  });

  const currentCache = inMemoryMovieCache || (await readMovieCatalogFromDisk());
  const isReviewOnlyCache = currentCache?.reviewOnly === true;

  if (isReviewOnlyCache && movie.is_for_review !== true) {
    return;
  }

  const existingMovies = currentCache?.movies || [];
  const nextMovies = sortCatalogMovies([
    { ...movie, id: movieId },
    ...existingMovies.filter((entry) => String(entry.id || '') !== movieId),
  ]);

  const nextCache: CachedMovieCatalog = {
    movies: nextMovies,
    cachedAt: new Date().toISOString(),
    collectionName: MOVIES_COLLECTION,
    reviewOnly: isReviewOnlyCache ? true : undefined,
  };

  setInMemoryMovieCache(nextCache);
  upsertPublicBootstrapMovie({ ...movie, id: movieId });
  await persistMovieCatalog(nextCache);
}

export async function removeMovieFromCatalogCache(movieId: string) {
  await updateMovieInCatalogCache(movieId, () => null);
}

export async function removeEpisodeFromCatalogCache(
  movieId: string,
  seasonNumber: number,
  episodeNumber: number
) {
  await updateMovieInCatalogCache(movieId, (movie) => {
    const seasons = Array.isArray(movie.seasons)
      ? movie.seasons
          .map((season) => {
            if (Number(season?.seasonNumber) !== seasonNumber) {
              return season;
            }

            const episodes = Array.isArray(season.episodes)
              ? season.episodes.filter(
                  (episode) => Number(episode?.episodeNumber) !== episodeNumber
                )
              : [];

            return {
              ...season,
              episodes,
            };
          })
          .filter((season) => Array.isArray(season?.episodes) && season.episodes.length > 0)
      : [];

    return {
      ...movie,
      seasons,
      updatedAt: new Date().toISOString(),
    };
  });
}

async function updateMovieInCatalogCache(
  movieId: string,
  updater: (movie: Record<string, unknown>) => Record<string, unknown> | null
) {
  await refreshInMemoryMovieCacheFromDiskIfNewer({
    collectionName: MOVIES_COLLECTION,
    reviewOnly: false,
    force: true,
    minIntervalMs: 0,
  });

  const currentCache = inMemoryMovieCache || (await readMovieCatalogFromDisk());

  if (!currentCache?.movies?.length) {
    return;
  }

  const nextCache: CachedMovieCatalog = {
    movies: currentCache.movies
      .map((movie) => {
        if (String(movie.id || '') !== movieId) {
          return movie;
        }

        return updater(movie);
      })
      .filter((movie): movie is Record<string, unknown> => Boolean(movie)),
    cachedAt: new Date().toISOString(),
    collectionName: MOVIES_COLLECTION,
    reviewOnly: currentCache.reviewOnly === true ? true : undefined,
  };

  setInMemoryMovieCache(nextCache);
  await persistMovieCatalog(nextCache);
}
