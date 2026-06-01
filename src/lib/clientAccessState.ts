import { readCachedAccountProfile } from '@/lib/accountProfile';
import { readCachedAuthStatus } from '@/lib/auth/status-client';
import type { Movie } from '@/types/movie';

const SUBSCRIPTION_DATA_CACHE_KEY = 'ugmovies247.subscribe-data.v1';
export const LOCAL_PREMIUM_ACCESS_UPDATED_EVENT = 'ugmovies247:local-premium-access-updated';

export type LocalPremiumAccessSnapshot = {
  hasPremiumAccess: boolean;
  source:
    | 'admin_profile'
    | 'admin_auth'
    | 'subscription_profile'
    | 'subscription_cache'
    | 'raw_local_snapshot'
    | 'none';
};

function canUseBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readSubscriptionDataCache() {
  if (!canUseBrowserStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SUBSCRIPTION_DATA_CACHE_KEY);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as {
      value?: {
        entitlement?: {
          hasPremiumAccess?: boolean;
          subscription?: {
            isActive?: boolean;
          };
        };
      };
    };
  } catch {
    return null;
  }
}

function objectHasPremiumAccessMarker(value: unknown, depth = 0): boolean {
  if (!value || depth > 5) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => objectHasPremiumAccessMarker(item, depth + 1));
  }

  if (typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (record.role === 'admin') {
    return true;
  }

  if (
    record.premium_active === true ||
    record.premiumActive === true ||
    record.isPremium === true ||
    record.isPremiumActive === true ||
    record.hasPremiumAccess === true
  ) {
    return true;
  }

  if (
    record.subscription &&
    typeof record.subscription === 'object' &&
    (record.subscription as Record<string, unknown>).isActive === true
  ) {
    return true;
  }

  return Object.values(record).some((item) => objectHasPremiumAccessMarker(item, depth + 1));
}

function readRawLocalPremiumSnapshot() {
  if (!canUseBrowserStorage()) {
    return false;
  }

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (!key || !key.startsWith('ugmovies247.')) {
        continue;
      }

      const raw = window.localStorage.getItem(key);

      if (!raw) {
        continue;
      }

      try {
        if (objectHasPremiumAccessMarker(JSON.parse(raw))) {
          return true;
        }
      } catch {
        const normalized = raw.toLowerCase();

        if (
          normalized.includes('"premium_active":true') ||
          normalized.includes('"premiumactive":true') ||
          normalized.includes('"haspremiumaccess":true') ||
          normalized.includes('"role":"admin"')
        ) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }

  return false;
}

export function readLocalPremiumAccessSnapshot(): LocalPremiumAccessSnapshot {
  const cachedProfile = readCachedAccountProfile();

  if (cachedProfile?.role === 'admin') {
    return { hasPremiumAccess: true, source: 'admin_profile' };
  }

  if (cachedProfile?.subscription?.isActive === true) {
    return { hasPremiumAccess: true, source: 'subscription_profile' };
  }

  const cachedAuthStatus = readCachedAuthStatus();

  if (cachedAuthStatus?.authenticated && cachedAuthStatus.user?.role === 'admin') {
    return { hasPremiumAccess: true, source: 'admin_auth' };
  }

  const subscriptionCache = readSubscriptionDataCache();
  const cachedEntitlement = subscriptionCache?.value?.entitlement;

  if (
    cachedEntitlement?.hasPremiumAccess === true ||
    cachedEntitlement?.subscription?.isActive === true
  ) {
    return { hasPremiumAccess: true, source: 'subscription_cache' };
  }

  if (readRawLocalPremiumSnapshot()) {
    return { hasPremiumAccess: true, source: 'raw_local_snapshot' };
  }

  return { hasPremiumAccess: false, source: 'none' };
}

export function notifyLocalPremiumAccessUpdated() {
  if (typeof window === 'undefined') {
    return;
  }

  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(LOCAL_PREMIUM_ACCESS_UPDATED_EVENT));
  }, 0);
}

function unlockMovieEntry<T extends { isLocked?: boolean; subscriptionRequired?: boolean }>(entry: T): T {
  if (!entry.isLocked && entry.subscriptionRequired !== true) {
    return entry;
  }

  return {
    ...entry,
    isLocked: false,
  };
}

export function applyLocalPremiumAccessToMovie(movie: Movie, hasPremiumAccess: boolean): Movie {
  if (!hasPremiumAccess) {
    return movie;
  }

  return {
    ...unlockMovieEntry(movie),
    parts: movie.parts?.map((part) => unlockMovieEntry(part)) || [],
    seasons:
      movie.seasons?.map((season) => ({
        ...season,
        episodes: season.episodes?.map((episode) => unlockMovieEntry(episode)) || [],
      })) || [],
  };
}

export function applyLocalPremiumAccessToCatalog(
  movies: Movie[],
  hasPremiumAccess: boolean
): Movie[] {
  return hasPremiumAccess
    ? movies.map((movie) => applyLocalPremiumAccessToMovie(movie, true))
    : movies;
}
