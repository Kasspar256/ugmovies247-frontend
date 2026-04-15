type CachedAdminResponse = {
  value: unknown;
  cachedAt: number;
};

const DEFAULT_ADMIN_FETCH_TTL_MS = 1000 * 15;
const DEFAULT_ADMIN_FETCH_TIMEOUT_MS = 1000 * 15;

const adminResponseCache = new Map<string, CachedAdminResponse>();
const inFlightAdminRequests = new Map<string, Promise<unknown>>();

function isFreshAdminResponse(cache: CachedAdminResponse | undefined, ttlMs: number) {
  return Boolean(cache && Date.now() - cache.cachedAt < ttlMs);
}

export function clearAdminFetchCache(urlPrefix?: string) {
  if (!urlPrefix) {
    adminResponseCache.clear();
    inFlightAdminRequests.clear();
    return;
  }

  for (const key of adminResponseCache.keys()) {
    if (key.startsWith(urlPrefix)) {
      adminResponseCache.delete(key);
    }
  }

  for (const key of inFlightAdminRequests.keys()) {
    if (key.startsWith(urlPrefix)) {
      inFlightAdminRequests.delete(key);
    }
  }
}

export async function fetchAdminJson<T>(
  url: string,
  options?: {
    force?: boolean;
    ttlMs?: number;
    timeoutMs?: number;
  }
): Promise<T> {
  const ttlMs = options?.ttlMs ?? DEFAULT_ADMIN_FETCH_TTL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_ADMIN_FETCH_TIMEOUT_MS;

  if (!options?.force) {
    const cached = adminResponseCache.get(url);

    if (isFreshAdminResponse(cached, ttlMs)) {
      return cached?.value as T;
    }

    const inFlight = inFlightAdminRequests.get(url);

    if (inFlight) {
      return inFlight as Promise<T>;
    }
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  const request = fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    signal: controller.signal,
  })
    .then(async (response) => {
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || `Failed to load ${url}.`);
      }

      adminResponseCache.set(url, {
        value: payload,
        cachedAt: Date.now(),
      });

      return payload;
    })
    .catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Admin request timed out. Please refresh and try again.');
      }

      throw error;
    })
    .finally(() => {
      window.clearTimeout(timeout);
      inFlightAdminRequests.delete(url);
    });

  inFlightAdminRequests.set(url, request);
  return request as Promise<T>;
}
