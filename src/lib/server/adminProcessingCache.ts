import {
  persistAdminCache,
  readPersistedAdminCache,
  type PersistedAdminCache,
} from './adminRuntimeCache';

type TimedProcessingCache<T> = {
  value: T;
  cachedAt: number;
};

const PROCESSING_QUOTA_COOLDOWN_MS = 1000 * 60 * 10;
const processingQuotaBlockedUntil = new Map<string, number>();

let videoJobsCache: TimedProcessingCache<unknown> | null = null;
const repairCandidatesCache = new Map<string, TimedProcessingCache<unknown>>();

function isQuotaLikeProcessingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /resource_exhausted|quota exceeded|timed out|deadline exceeded/i.test(message);
}

function isFreshProcessingCache<T>(cache: TimedProcessingCache<T> | null, ttlMs: number) {
  return Boolean(cache && Date.now() - cache.cachedAt < ttlMs);
}

function pickLatestProcessingCache<T>(
  ...caches: Array<TimedProcessingCache<T> | PersistedAdminCache<T> | null | undefined>
) {
  return (
    caches
      .filter(
        (cache): cache is TimedProcessingCache<T> | PersistedAdminCache<T> =>
          Boolean(cache && typeof cache.cachedAt === 'number')
      )
      .sort((left, right) => right.cachedAt - left.cachedAt)[0] || null
  );
}

function isProcessingQuotaBlocked(resource: string) {
  return (processingQuotaBlockedUntil.get(resource) || 0) > Date.now();
}

function recordProcessingQuotaFailure(resource: string, error: unknown) {
  if (!isQuotaLikeProcessingError(error)) {
    return;
  }

  processingQuotaBlockedUntil.set(resource, Date.now() + PROCESSING_QUOTA_COOLDOWN_MS);
}

function clearProcessingQuotaFailure(resource: string) {
  processingQuotaBlockedUntil.delete(resource);
}

async function readProcessingCachedValue<T>(options: {
  resource: string;
  cache: TimedProcessingCache<T> | null;
  ttlMs: number;
  loader: () => Promise<T>;
  onWrite: (cache: TimedProcessingCache<T> | null) => void;
}) {
  const persistedCache = await readPersistedAdminCache<T>(options.resource);
  const bestCache = pickLatestProcessingCache(options.cache, persistedCache);

  if (isFreshProcessingCache(bestCache, options.ttlMs)) {
    if (bestCache !== options.cache) {
      options.onWrite({
        value: bestCache.value,
        cachedAt: bestCache.cachedAt,
      });
    }

    return bestCache?.value as T;
  }

  if (isProcessingQuotaBlocked(options.resource) && bestCache?.value) {
    if (bestCache !== options.cache) {
      options.onWrite({
        value: bestCache.value,
        cachedAt: bestCache.cachedAt,
      });
    }

    return bestCache.value;
  }

  try {
    const value = await options.loader();
    const nextCache = {
      value,
      cachedAt: Date.now(),
    };

    options.onWrite(nextCache);
    await persistAdminCache(options.resource, nextCache);
    clearProcessingQuotaFailure(options.resource);
    return value;
  } catch (error) {
    recordProcessingQuotaFailure(options.resource, error);

    if (bestCache?.value) {
      if (bestCache !== options.cache) {
        options.onWrite({
          value: bestCache.value,
          cachedAt: bestCache.cachedAt,
        });
      }

      return bestCache.value;
    }

    throw error;
  }
}

export async function readCachedVideoJobs<T>(loader: () => Promise<T>, ttlMs = 1000 * 30) {
  return readProcessingCachedValue<T>({
    resource: 'video-jobs',
    cache: videoJobsCache as TimedProcessingCache<T> | null,
    ttlMs,
    loader,
    onWrite: (cache) => {
      videoJobsCache = cache as TimedProcessingCache<unknown> | null;
    },
  });
}

export async function readCachedRepairCandidates<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = 1000 * 60 * 5
) {
  return readProcessingCachedValue<T>({
    resource: `video-repairs-${key}`,
    cache: (repairCandidatesCache.get(key) as TimedProcessingCache<T> | null) || null,
    ttlMs,
    loader,
    onWrite: (cache) => {
      if (cache) {
        repairCandidatesCache.set(key, cache as TimedProcessingCache<unknown>);
      } else {
        repairCandidatesCache.delete(key);
      }
    },
  });
}

export function clearAdminProcessingCache(resources?: Array<'jobs' | 'repairs'>) {
  const targets = resources?.length ? resources : ['jobs', 'repairs'];

  if (targets.includes('jobs')) {
    videoJobsCache = null;
    clearProcessingQuotaFailure('video-jobs');
  }

  if (targets.includes('repairs')) {
    repairCandidatesCache.clear();

    for (const resource of processingQuotaBlockedUntil.keys()) {
      if (resource.startsWith('video-repairs-')) {
        processingQuotaBlockedUntil.delete(resource);
      }
    }
  }
}

export function isProcessingQuotaErrorMessage(message: string) {
  return /resource_exhausted|quota exceeded|timed out|deadline exceeded/i.test(message);
}
