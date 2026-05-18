import type { SubscriptionSnapshot } from '@/types/subscriptions';
import { resolveUserAvatar } from '@/lib/avatarPresets';
import { isAppInReview } from '@/lib/appReview';
import { getHydratedClientDeviceHeaders } from '@/lib/auth/deviceIdentity';

export type AccountNotificationPreferences = {
  marketing: boolean;
  productUpdates: boolean;
};

export type AccountProfile = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: string;
  emailVerificationSentAt: string;
  role: 'user' | 'admin';
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  avatarPresetId?: string;
  avatarUrl: string;
  notificationPreferences?: AccountNotificationPreferences;
  subscription?: SubscriptionSnapshot;
};

type AuthMeResponse = {
  user?: AccountProfile;
  error?: string;
};

type CachedAccountProfile = {
  profile: AccountProfile;
  cachedAt: number;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: AccountNotificationPreferences = {
  marketing: false,
  productUpdates: true,
};

const ACCOUNT_PROFILE_CACHE_KEY = 'ugmovies247.account-profile.v1';
const ACCOUNT_PROFILE_CACHE_TTL_MS = 1000 * 60 * 60 * 2;

let inMemoryAccountProfile: CachedAccountProfile | null = null;

function canUsePersistentStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isFreshAccountProfileCache(cache: CachedAccountProfile | null) {
  return Boolean(cache && Date.now() - cache.cachedAt < ACCOUNT_PROFILE_CACHE_TTL_MS);
}

function normalizeAccountProfile(profile: AccountProfile) {
  return {
    ...profile,
    emailVerified: profile.emailVerified === true,
    ...resolveUserAvatar({
      avatarPresetId: profile.avatarPresetId,
      avatarUrl: profile.avatarUrl,
      fallbackSeed: profile.id || profile.email,
    }),
    notificationPreferences: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(profile.notificationPreferences || {}),
    },
  } satisfies AccountProfile;
}

function persistAccountProfile(profile: AccountProfile) {
  const cache = {
    profile,
    cachedAt: Date.now(),
  } satisfies CachedAccountProfile;

  inMemoryAccountProfile = cache;

  if (!canUsePersistentStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Keep the in-memory profile cache when persistent storage is unavailable.
  }
}

function readAccountProfileFromPersistentStorage() {
  if (!canUsePersistentStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ACCOUNT_PROFILE_CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedAccountProfile>;

    if (!parsed.profile || typeof parsed.cachedAt !== 'number') {
      return null;
    }

    return {
      profile: normalizeAccountProfile(parsed.profile as AccountProfile),
      cachedAt: parsed.cachedAt,
    } satisfies CachedAccountProfile;
  } catch {
    return null;
  }
}

function readAnyAccountProfileCache() {
  return inMemoryAccountProfile || readAccountProfileFromPersistentStorage();
}

export function readCachedAccountProfile() {
  if (isFreshAccountProfileCache(inMemoryAccountProfile)) {
    return inMemoryAccountProfile?.profile || null;
  }

  const storedCache = readAccountProfileFromPersistentStorage();

  if (isFreshAccountProfileCache(storedCache)) {
    inMemoryAccountProfile = storedCache;
    return storedCache?.profile || null;
  }

  const staleCache = readAnyAccountProfileCache();

  if (staleCache?.profile) {
    inMemoryAccountProfile = staleCache;
    return staleCache.profile;
  }

  return null;
}

export function clearAccountProfileCache() {
  inMemoryAccountProfile = null;

  try {
    window.localStorage?.removeItem(ACCOUNT_PROFILE_CACHE_KEY);
    window.sessionStorage?.removeItem(ACCOUNT_PROFILE_CACHE_KEY);
  } catch {
    // Ignore storage removal failures and keep the in-memory cache cleared.
  }
}

async function parseResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

export async function fetchAccountProfile() {
  const response = await fetch('/api/auth/me', {
    headers: await getHydratedClientDeviceHeaders(),
    credentials: 'include',
    cache: 'no-store',
  }).catch(() => {
    const cachedProfile = readAnyAccountProfileCache()?.profile;

    if (cachedProfile) {
      return null;
    }

    throw new Error('Your profile could not be loaded.');
  });

  if (!response) {
    const cachedProfile = readAnyAccountProfileCache()?.profile;

    if (cachedProfile) {
      return cachedProfile;
    }

    throw new Error('Your profile could not be loaded.');
  }

  const payload = await parseResponse<AuthMeResponse>(response).catch((error) => {
    const cachedProfile = readAnyAccountProfileCache()?.profile;

    if (cachedProfile) {
      return { user: cachedProfile } satisfies AuthMeResponse;
    }

    throw error;
  });

  if (!payload.user) {
    throw new Error('Your profile could not be loaded.');
  }

  const profile = normalizeAccountProfile(payload.user);
  persistAccountProfile(profile);

  return profile;
}

export async function updateAccountProfile(input: {
  name: string;
  avatarPresetId?: string;
  notificationPreferences?: Partial<AccountNotificationPreferences>;
}) {
  const response = await fetch('/api/auth/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await getHydratedClientDeviceHeaders()) },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  const payload = await parseResponse<{ success: boolean }>(response);
  clearAccountProfileCache();
  return payload;
}

export async function deleteAccount(confirm: string) {
  const response = await fetch('/api/auth/me', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(await getHydratedClientDeviceHeaders()) },
    credentials: 'include',
    body: JSON.stringify({ confirm }),
  });

  const payload = await parseResponse<{ success: boolean }>(response);
  clearAccountProfileCache();
  return payload;
}

export function getAccountInitials(name?: string, email?: string) {
  const source = (name || email || 'UG').trim();

  if (!source) {
    return 'UG';
  }

  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export function formatAccountDate(
  value?: string,
  options?: { includeTime?: boolean; fallback?: string }
) {
  if (!value) {
    return options?.fallback || 'Not available';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return options?.fallback || 'Not available';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(options?.includeTime
      ? {
          hour: 'numeric',
          minute: '2-digit',
        }
      : {}),
  }).format(date);
}

export function getAccountBadge(profile: Pick<AccountProfile, 'role' | 'subscription'>) {
  if (profile.role === 'admin') {
    return 'Admin';
  }

  if (isAppInReview) {
    return 'User';
  }

  if (profile.subscription?.isActive) {
    return 'Premium';
  }

  return 'Free';
}

export function getAccountAccessLabel(profile: Pick<AccountProfile, 'role' | 'subscription'>) {
  if (profile.role === 'admin') {
    return 'Admin Access';
  }

  if (isAppInReview) {
    return 'Free Discovery Access';
  }

  if (profile.subscription?.isActive && profile.subscription.planName) {
    return profile.subscription.planName;
  }

  return 'Free Access';
}
