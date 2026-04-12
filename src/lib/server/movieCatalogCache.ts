import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

export const MOVIE_CACHE_TTL_MS = 1000 * 60 * 2;
export const MOVIE_CACHE_PATH = path.join(process.cwd(), '.runtime-cache', 'movies-catalog.json');

export type CachedMovieCatalog = {
  movies: Array<Record<string, unknown>>;
  cachedAt: string;
};

export let inMemoryMovieCache: CachedMovieCatalog | null = null;

export function setInMemoryMovieCache(cache: CachedMovieCatalog | null) {
  inMemoryMovieCache = cache;
}

export function isFreshMovieCache(cache: CachedMovieCatalog | null) {
  if (!cache?.cachedAt) {
    return false;
  }

  return Date.now() - new Date(cache.cachedAt).getTime() < MOVIE_CACHE_TTL_MS;
}

export async function readMovieCatalogFromDisk() {
  try {
    const raw = await readFile(MOVIE_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CachedMovieCatalog;

    if (!Array.isArray(parsed.movies) || typeof parsed.cachedAt !== 'string') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function persistMovieCatalog(cache: CachedMovieCatalog) {
  try {
    await mkdir(path.dirname(MOVIE_CACHE_PATH), { recursive: true });
    await writeFile(MOVIE_CACHE_PATH, JSON.stringify(cache), 'utf8');
  } catch (error) {
    console.warn('[movie-cache] failed to persist movie cache', error);
  }
}

export async function removeMovieFromCatalogCache(movieId: string) {
  const currentCache = (await readMovieCatalogFromDisk()) || inMemoryMovieCache;

  if (!currentCache?.movies?.length) {
    return;
  }

  const nextCache: CachedMovieCatalog = {
    movies: currentCache.movies.filter((movie) => String(movie.id || '') !== movieId),
    cachedAt: new Date().toISOString(),
  };

  setInMemoryMovieCache(nextCache);
  await persistMovieCatalog(nextCache);
}
