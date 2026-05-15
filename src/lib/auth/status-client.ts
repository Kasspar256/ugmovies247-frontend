export type ClientAuthStatus = {
  authenticated: boolean;
  reason?: 'session_replaced' | 'session_revoked' | 'session_missing';
  code?: string;
  error?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    role: 'user' | 'admin';
    emailVerified?: boolean;
  };
};

type CachedClientAuthStatus = {
  value: ClientAuthStatus;
  cachedAt: number;
};

const AUTH_STATUS_TTL_MS = 1000 * 60;
const AUTH_STATUS_CACHE_KEY = 'ugmovies247.auth-status.v1';

let cachedAuthStatus: CachedClientAuthStatus | null = null;
let inFlightAuthStatusRequest: Promise<ClientAuthStatus> | null = null;

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function isFreshAuthStatus(cache: CachedClientAuthStatus | null) {
  return Boolean(cache && Date.now() - cache.cachedAt < AUTH_STATUS_TTL_MS);
}

function persistAuthStatusCache(cache: CachedClientAuthStatus) {
  cachedAuthStatus = cache;

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(AUTH_STATUS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures and keep the in-memory cache only.
  }
}

function readAuthStatusFromSessionStorage() {
  if (!canUseSessionStorage()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(AUTH_STATUS_CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedClientAuthStatus>;

    if (
      typeof parsed.cachedAt !== 'number' ||
      !parsed.value ||
      typeof parsed.value !== 'object' ||
      typeof (parsed.value as ClientAuthStatus).authenticated !== 'boolean'
    ) {
      return null;
    }

    return {
      cachedAt: parsed.cachedAt,
      value: parsed.value as ClientAuthStatus,
    } satisfies CachedClientAuthStatus;
  } catch {
    return null;
  }
}

export function readCachedAuthStatus() {
  if (isFreshAuthStatus(cachedAuthStatus)) {
    return cachedAuthStatus?.value || null;
  }

  const storedCache = readAuthStatusFromSessionStorage();

  if (isFreshAuthStatus(storedCache)) {
    cachedAuthStatus = storedCache;
    return storedCache?.value || null;
  }

  return null;
}

export function primeAuthStatusCache(value: ClientAuthStatus) {
  persistAuthStatusCache({
    value,
    cachedAt: Date.now(),
  });
}

export function clearAuthStatusCache() {
  cachedAuthStatus = null;
  inFlightAuthStatusRequest = null;

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(AUTH_STATUS_CACHE_KEY);
  } catch {
    // Ignore storage removal failures and keep the in-memory cache cleared.
  }
}

export async function fetchAuthStatus(options?: { force?: boolean }): Promise<ClientAuthStatus> {
  if (!options?.force) {
    const cached = readCachedAuthStatus();

    if (cached) {
      return cached;
    }

    if (inFlightAuthStatusRequest) {
      return inFlightAuthStatusRequest;
    }
  }

  inFlightAuthStatusRequest = fetch('/api/auth/status', {
    credentials: 'include',
    cache: 'no-store',
  })
    .then(async (response) => {
      const payload = (await response.json().catch(() => ({}))) as Partial<ClientAuthStatus> & {
        code?: string;
        error?: string;
      };

      if (!response.ok) {
        return {
          authenticated: false,
          reason:
            payload.reason === 'session_replaced' ||
            payload.reason === 'session_revoked' ||
            payload.reason === 'session_missing'
              ? payload.reason
              : 'session_missing',
          code: typeof payload.code === 'string' ? payload.code : undefined,
          error: typeof payload.error === 'string' ? payload.error : undefined,
        } satisfies ClientAuthStatus;
      }

      const value: ClientAuthStatus = {
        authenticated: payload.authenticated !== false,
        reason:
          payload.reason === 'session_replaced' ||
          payload.reason === 'session_revoked' ||
          payload.reason === 'session_missing'
            ? payload.reason
            : undefined,
        code: typeof payload.code === 'string' ? payload.code : undefined,
        error: typeof payload.error === 'string' ? payload.error : undefined,
        user: payload.user
          ? {
              id: payload.user.id || '',
              name: payload.user.name || 'User',
              email: payload.user.email || '',
              role: payload.user.role === 'admin' ? 'admin' : 'user',
              emailVerified: payload.user.emailVerified === true,
            }
          : undefined,
      };

      persistAuthStatusCache({
        value,
        cachedAt: Date.now(),
      });

      return value;
    })
    .catch(
      () =>
        ({
          authenticated: false,
          reason: 'session_missing',
        }) satisfies ClientAuthStatus
    )
    .finally(() => {
      inFlightAuthStatusRequest = null;
    });

  return inFlightAuthStatusRequest;
}
