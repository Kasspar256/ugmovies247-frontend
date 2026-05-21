import {
  createEmptyPublicBootstrapPayload,
  readPublicBootstrapCatalogFromMemory,
  setPublicBootstrapCatalogFromMovieCache,
  type PublicCatalogBootstrapPayload,
} from '@/lib/server/publicCatalogBootstrap';
import {
  inMemoryMovieCache,
  readMovieCatalogFromDisk,
  setInMemoryMovieCache,
  type CachedMovieCatalog,
} from '@/lib/server/movieCatalogCache';

let attemptedDiskWarmup = false;
let diskWarmupPromise: Promise<PublicCatalogBootstrapPayload | null> | null = null;

async function warmBootstrapFromDiskOnce() {
  if (attemptedDiskWarmup) {
    return readPublicBootstrapCatalogFromMemory();
  }

  if (diskWarmupPromise) {
    return diskWarmupPromise;
  }

  attemptedDiskWarmup = true;
  diskWarmupPromise = readMovieCatalogFromDisk()
    .then((cache) => {
      if (!cache?.movies?.length) {
        return null;
      }

      setInMemoryMovieCache(cache);
      return setPublicBootstrapCatalogFromMovieCache(cache, 'disk');
    })
    .finally(() => {
      diskWarmupPromise = null;
    });

  return diskWarmupPromise;
}

export async function getPublicCatalogBootstrapPayload(): Promise<PublicCatalogBootstrapPayload> {
  const memoryBootstrap = readPublicBootstrapCatalogFromMemory();

  if (memoryBootstrap?.movies.length) {
    return memoryBootstrap;
  }

  if (inMemoryMovieCache?.movies?.length) {
    const bootstrap = setPublicBootstrapCatalogFromMovieCache(inMemoryMovieCache, 'memory');

    if (bootstrap?.movies.length) {
      return bootstrap;
    }
  }

  const diskBootstrap = await warmBootstrapFromDiskOnce();

  return diskBootstrap?.movies.length ? diskBootstrap : createEmptyPublicBootstrapPayload();
}

export async function getMovieCatalogCacheForBootstrap(): Promise<CachedMovieCatalog | null> {
  if (inMemoryMovieCache?.movies?.length) {
    return inMemoryMovieCache;
  }

  await warmBootstrapFromDiskOnce();

  return inMemoryMovieCache?.movies?.length ? inMemoryMovieCache : null;
}
