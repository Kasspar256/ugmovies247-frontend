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
  };
};

type CachedClientAuthStatus = {
  value: ClientAuthStatus;
  cachedAt: number;
};

const AUTH_STATUS_TTL_MS = 1000 * 60;

let cachedAuthStatus: CachedClientAuthStatus | null = null;
let inFlightAuthStatusRequest: Promise<ClientAuthStatus> | null = null;

function isFreshAuthStatus(cache: CachedClientAuthStatus | null) {
  return Boolean(cache && Date.now() - cache.cachedAt < AUTH_STATUS_TTL_MS);
}

export function readCachedAuthStatus() {
  return isFreshAuthStatus(cachedAuthStatus) ? cachedAuthStatus?.value || null : null;
}

export function primeAuthStatusCache(value: ClientAuthStatus) {
  cachedAuthStatus = {
    value,
    cachedAt: Date.now(),
  };
}

export function clearAuthStatusCache() {
  cachedAuthStatus = null;
  inFlightAuthStatusRequest = null;
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
            }
          : undefined,
      };

      cachedAuthStatus = {
        value,
        cachedAt: Date.now(),
      };

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
