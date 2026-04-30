import type { SubscriptionSnapshot } from '@/types/subscriptions';
import { resolveUserAvatar } from '@/lib/avatarPresets';
import { isAppInReview } from '@/lib/appReview';

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

  return {
    ...payload.user,
    emailVerified: payload.user.emailVerified === true,
    ...resolveUserAvatar({
      avatarPresetId: payload.user.avatarPresetId,
      avatarUrl: payload.user.avatarUrl,
      fallbackSeed: payload.user.id || payload.user.email,
    }),
    notificationPreferences: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(payload.user.notificationPreferences || {}),
    },
  } satisfies AccountProfile;
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
