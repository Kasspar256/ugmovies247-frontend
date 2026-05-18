import { getClientDeviceHeaders, rememberClientDeviceSession } from '@/lib/auth/deviceIdentity';

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

const AUTH_STATUS_TTL_MS = 1000 * 60 * 5;
const AUTH_STATUS_CACHE_KEY = 'ugmovies247.auth-status.v1';

let cachedAuthStatus: CachedClientAuthStatus | null = null;
let inFlightAuthStatusRequest: Promise<ClientAuthStatus> | null = null;

function canUsePersistentStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isFreshAuthStatus(cache: CachedClientAuthStatus | null) {
  return Boolean(cache && Date.now() - cache.cachedAt < AUTH_STATUS_TTL_MS);
}

function persistAuthStatusCache(cache: CachedClientAuthStatus) {
  cachedAuthStatus = cache;

  if (!canUsePersistentStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(AUTH_STATUS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures and keep the in-memory cache only.
  }
}

function readAuthStatusFromPersistentStorage() {
  if (!canUsePersistentStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(AUTH_STATUS_CACHE_KEY);

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

function readAnyStoredAuthStatus() {
  return cachedAuthStatus || readAuthStatusFromPersistentStorage();
}

export function readCachedAuthStatus() {
  if (isFreshAuthStatus(cachedAuthStatus)) {
    return cachedAuthStatus?.value || null;
  }

  const storedCache = readAuthStatusFromPersistentStorage();

  if (isFreshAuthStatus(storedCache)) {
    cachedAuthStatus = storedCache;
    return storedCache?.value || null;
  }

  const staleCache = readAnyStoredAuthStatus();

  if (staleCache?.value?.authenticated) {
    cachedAuthStatus = staleCache;
    return staleCache.value;
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

  try {
    window.localStorage?.removeItem(AUTH_STATUS_CACHE_KEY);
    window.sessionStorage?.removeItem(AUTH_STATUS_CACHE_KEY);
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
    headers: getClientDeviceHeaders(),
    credentials: 'include',
    cache: 'no-store',
  })
    .then(async (response) => {
      const payload = (await response.json().catch(() => ({}))) as Partial<ClientAuthStatus> & {
        clientSession?: string;
        code?: string;
        error?: string;
      };

      rememberClientDeviceSession(payload.clientSession);

      if (!response.ok) {
        const storedCache = response.status >= 500 ? readAnyStoredAuthStatus() : null;

        if (storedCache?.value?.authenticated) {
          cachedAuthStatus = storedCache;
          return storedCache.value;
        }

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
    .catch(() => {
      const storedCache = readAnyStoredAuthStatus();

      if (storedCache?.value?.authenticated) {
        cachedAuthStatus = storedCache;
        return storedCache.value;
      }

      return {
        authenticated: false,
        reason: 'session_missing',
      } satisfies ClientAuthStatus;
    })
    .finally(() => {
      inFlightAuthStatusRequest = null;
    });

  return inFlightAuthStatusRequest;
}
