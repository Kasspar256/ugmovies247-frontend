import type { SubscriptionSnapshot } from '@/types/subscriptions';
import { resolveUserAvatar } from '@/lib/avatarPresets';

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

export const DEFAULT_NOTIFICATION_PREFERENCES: AccountNotificationPreferences = {
  marketing: false,
  productUpdates: true,
};

type CachedAccountProfile = {
  profile: AccountProfile;
  cachedAt: number;
};

const ACCOUNT_PROFILE_CACHE_KEY = 'ugmovies247.account-profile.v1';
const ACCOUNT_PROFILE_CACHE_TTL_MS = 1000 * 60 * 10;

let cachedAccountProfile: CachedAccountProfile | null = null;

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
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

function isFreshAccountProfile(cache: CachedAccountProfile | null) {
  return Boolean(cache && Date.now() - cache.cachedAt < ACCOUNT_PROFILE_CACHE_TTL_MS);
}

function persistAccountProfileCache(profile: AccountProfile) {
  cachedAccountProfile = {
    profile,
    cachedAt: Date.now(),
  };

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify(cachedAccountProfile));
  } catch {
    // Keep in-memory cache only when session storage is unavailable.
  }
}

export function readCachedAccountProfile() {
  if (isFreshAccountProfile(cachedAccountProfile)) {
    return cachedAccountProfile?.profile || null;
  }

  if (!canUseSessionStorage()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(ACCOUNT_PROFILE_CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedAccountProfile>;

    if (!parsed.profile || typeof parsed.cachedAt !== 'number') {
      return null;
    }

    const normalized = {
      profile: normalizeAccountProfile(parsed.profile as AccountProfile),
      cachedAt: parsed.cachedAt,
    } satisfies CachedAccountProfile;

    if (!isFreshAccountProfile(normalized)) {
      return null;
    }

    cachedAccountProfile = normalized;
    return normalized.profile;
  } catch {
    return null;
  }
}

export function clearAccountProfileCache() {
  cachedAccountProfile = null;

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(ACCOUNT_PROFILE_CACHE_KEY);
  } catch {
    // Ignore storage failures.
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
    credentials: 'include',
    cache: 'no-store',
  });
  const payload = await parseResponse<AuthMeResponse>(response);

  if (!payload.user) {
    throw new Error('Your profile could not be loaded.');
  }

  const profile = normalizeAccountProfile(payload.user);
  persistAccountProfileCache(profile);

  return profile;
}

export async function updateAccountProfile(input: {
  name: string;
  avatarPresetId?: string;
  notificationPreferences?: Partial<AccountNotificationPreferences>;
}) {
  const response = await fetch('/api/auth/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  return parseResponse<{ success: boolean }>(response);
}

export async function deleteAccount(confirm: string) {
  const response = await fetch('/api/auth/me', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ confirm }),
  });

  return parseResponse<{ success: boolean }>(response);
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

  if (profile.subscription?.isActive) {
    return 'Premium';
  }

  return 'Free';
}

export function getAccountAccessLabel(profile: Pick<AccountProfile, 'role' | 'subscription'>) {
  if (profile.role === 'admin') {
    return 'Admin Access';
  }

  if (profile.subscription?.isActive && profile.subscription.planName) {
    return profile.subscription.planName;
  }

  return 'Free Access';
}
