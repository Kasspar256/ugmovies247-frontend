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
  const currentCache = (await readMovieCatalogFromDisk()) || inMemoryMovieCache;

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
  };

  setInMemoryMovieCache(nextCache);
  await persistMovieCatalog(nextCache);
}
