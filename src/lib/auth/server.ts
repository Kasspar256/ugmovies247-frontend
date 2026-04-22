import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import {
  ADMIN_EMAILS,
  AUTH_DEVICE_COOKIE,
  AUTH_DEVICE_SESSION_COOKIE,
  AUTH_ROLE_COOKIE,
  AUTH_SESSION_COOKIE,
} from './constants';
import {
  createManagedAuthSession,
  validateManagedAuthSessionFromCookieValues,
} from '@/lib/server/authSessions';
import { resolveEffectiveSubscriptionState } from '@/lib/server/subscriptions';
import type { SubscriptionSnapshot } from '@/types/subscriptions';
import type { AuthInvalidReason } from '@/types/authSessions';
import { resolveUserAvatar } from '@/lib/avatarPresets';

export type UserRole = 'user' | 'admin';

export type AppUserRecord = {
  id: string;
  name: string;
  email: string;
  authProvider: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  isActive: boolean;
  avatarPresetId?: string;
  avatarUrl?: string;
  notificationPreferences?: {
    marketing: boolean;
    productUpdates: boolean;
  };
  subscription?: SubscriptionSnapshot;
};

export type AuthSession = {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  userRecord: AppUserRecord;
};

export type AuthSessionValidationResult = {
  session: AuthSession | null;
  reason?: AuthInvalidReason;
};

export type RecoveredManagedAuthSession = {
  deviceCookieValue: string;
  sessionCookieValue: string;
};

export type AuthSessionRecoveryResult = AuthSessionValidationResult & {
  recovered: boolean;
  managedSession?: RecoveredManagedAuthSession;
};

function buildFallbackUserRecord(
  uid: string,
  fallback: { email?: string; name?: string; role?: UserRole }
) {
  const now = new Date().toISOString();
  const fallbackRole = normalizeUserRole(fallback.role || (isAdminEmail(fallback.email) ? 'admin' : 'user'));
  const avatar = resolveUserAvatar({
    fallbackSeed: uid || fallback.email || fallback.name || 'ugmovies247-user',
  });

  return {
    id: uid,
    name: fallback.name || 'User',
    email: fallback.email || '',
    authProvider: 'password',
    role: fallbackRole,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    isActive: true,
    avatarPresetId: avatar.avatarPresetId,
    avatarUrl: avatar.avatarUrl,
    notificationPreferences: {
      marketing: false,
      productUpdates: true,
    },
    subscription: undefined,
  } satisfies AppUserRecord;
}

function normalizeUserRole(value: unknown): UserRole {
  return value === 'admin' ? 'admin' : 'user';
}

export function getCookieValueFromRequest(request: Request | NextRequest, name: string) {
  const cookieHeader = request.headers.get('cookie') || '';
  const parts = cookieHeader.split(';').map((entry) => entry.trim());
  const matches = parts.filter((entry) => entry.startsWith(`${name}=`));

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const value = decodeURIComponent(matches[index].slice(name.length + 1));

    if (value) {
      return value;
    }
  }

  return '';
}

function getLatestCookieValue(cookieValues: Array<{ value: string }>) {
  return cookieValues.map((cookie) => cookie.value).filter(Boolean).at(-1) || '';
}

export function isAdminEmail(email?: string | null) {
  return Boolean(email && ADMIN_EMAILS.includes(email.toLowerCase()));
}

async function fetchUserRecord(uid: string, fallback: { email?: string; name?: string }) {
  const now = new Date().toISOString();
  const fallbackRole = normalizeUserRole(isAdminEmail(fallback.email) ? 'admin' : 'user');

  try {
    const snapshot = await adminDb.collection('users').doc(uid).get();
    const data = snapshot.data() as Partial<AppUserRecord> | undefined;
    const avatar = resolveUserAvatar({
      avatarPresetId: typeof data?.avatarPresetId === 'string' ? data.avatarPresetId : '',
      avatarUrl: typeof data?.avatarUrl === 'string' ? data.avatarUrl : '',
      fallbackSeed: uid || fallback.email || fallback.name || 'ugmovies247-user',
    });

    return {
      id: uid,
      name: data?.name || fallback.name || 'User',
      email: data?.email || fallback.email || '',
      authProvider: data?.authProvider || 'password',
      role: normalizeUserRole(data?.role || fallbackRole),
      createdAt: data?.createdAt || now,
      updatedAt: data?.updatedAt || now,
      lastLoginAt: data?.lastLoginAt || now,
      isActive: data?.isActive !== false,
      avatarPresetId: avatar.avatarPresetId,
      avatarUrl: avatar.avatarUrl,
      notificationPreferences: data?.notificationPreferences || {
        marketing: false,
        productUpdates: true,
      },
      subscription:
        data?.subscription && typeof data.subscription === 'object'
          ? (data.subscription as SubscriptionSnapshot)
          : undefined,
    };
  } catch (error) {
    console.warn('[auth] failed to read user profile from Firestore, using session fallback', error);
  }

  return buildFallbackUserRecord(uid, {
    email: fallback.email,
    name: fallback.name,
    role: fallbackRole,
  });
}

async function resolveAuthSessionValidation(options: {
  sessionCookie: string;
  roleHint?: string;
  deviceCookie?: string;
  managedSessionCookie?: string;
  hydrateUserRecord?: boolean;
}): Promise<AuthSessionValidationResult> {
  if (!options.sessionCookie) {
    return { session: null, reason: 'session_missing' };
  }

  try {
    const decoded = await adminAuth.verifySessionCookie(options.sessionCookie, true);
    const email = decoded.email || '';
    const name = typeof decoded.name === 'string' ? decoded.name : '';
    const hintedRole = normalizeUserRole(options.roleHint);
    const decodedRole = normalizeUserRole((decoded as { role?: string }).role);
    const resolvedRole = hintedRole === 'admin' || decodedRole === 'admin' || isAdminEmail(email)
      ? 'admin'
      : 'user';
    const shouldSkipFirestoreProfileRead =
      options.hydrateUserRecord === false || resolvedRole === 'admin';
    const userRecord = shouldSkipFirestoreProfileRead
      ? buildFallbackUserRecord(decoded.uid, { email, name, role: resolvedRole })
      : await fetchUserRecord(decoded.uid, { email, name });

    if (!userRecord.isActive) {
      return { session: null, reason: 'session_revoked' };
    }

    if (options.deviceCookie !== undefined || options.managedSessionCookie !== undefined) {
      const validation = await validateManagedAuthSessionFromCookieValues({
        userId: decoded.uid,
        deviceId: options.deviceCookie || '',
        managedSessionCookie: options.managedSessionCookie || '',
      });

      if (!validation.valid) {
        return {
          session: null,
          reason: validation.reason,
        };
      }
    }

    return {
      session: {
        uid: decoded.uid,
        email: userRecord.email,
        name: userRecord.name,
        role: userRecord.role,
        userRecord,
      } as AuthSession,
    };
  } catch {
    return { session: null, reason: 'session_missing' };
  }
}

async function resolveSessionFromVerifiedCookie(options: {
  uid: string;
  email: string;
  name: string;
  roleHint?: string;
  request?: Request | NextRequest;
  hydrateUserRecord?: boolean;
  recoverManagedSession?: boolean;
}): Promise<AuthSessionRecoveryResult> {
  const hintedRole = normalizeUserRole(options.roleHint);
  const resolvedRole = hintedRole === 'admin' || isAdminEmail(options.email) ? 'admin' : 'user';
  const shouldSkipFirestoreProfileRead =
    options.hydrateUserRecord === false || resolvedRole === 'admin';
  const userRecord = shouldSkipFirestoreProfileRead
    ? buildFallbackUserRecord(options.uid, {
        email: options.email,
        name: options.name,
        role: resolvedRole,
      })
    : await fetchUserRecord(options.uid, {
        email: options.email,
        name: options.name,
      });

  if (!userRecord.isActive) {
    return {
      session: null,
      reason: 'session_revoked',
      recovered: false,
    };
  }

  let managedSession: RecoveredManagedAuthSession | undefined;

  if (options.recoverManagedSession && options.request) {
    const effectiveSubscriptionSnapshot =
      (await resolveEffectiveSubscriptionState(options.uid).then((state) => state.effectiveSnapshot)) ||
      userRecord.subscription ||
      null;

    userRecord.subscription = effectiveSubscriptionSnapshot || undefined;

    const createdManagedSession = await createManagedAuthSession({
      request: options.request,
      userId: options.uid,
      role: userRecord.role,
      subscriptionSnapshot: effectiveSubscriptionSnapshot,
    });

    managedSession = {
      deviceCookieValue: createdManagedSession.deviceCookieValue,
      sessionCookieValue: createdManagedSession.sessionCookieValue,
    };
  }

  return {
    session: {
      uid: options.uid,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role,
      userRecord,
    },
    recovered: Boolean(managedSession),
    managedSession,
  };
}

export async function getAuthSessionFromSessionCookie(
  sessionCookie: string,
  options?: { roleHint?: string }
) {
  const result = await resolveAuthSessionValidation({
    sessionCookie,
    roleHint: options?.roleHint,
  });

  return result.session;
}

export async function getRequestAuthSessionValidation(request: Request | NextRequest) {
  const sessionCookie = getCookieValueFromRequest(request, AUTH_SESSION_COOKIE);

  if (!sessionCookie) {
    return { session: null, reason: 'session_missing' };
  }
  const roleCookie = getCookieValueFromRequest(request, AUTH_ROLE_COOKIE);
  const deviceCookie = getCookieValueFromRequest(request, AUTH_DEVICE_COOKIE);
  const managedSessionCookie = getCookieValueFromRequest(request, AUTH_DEVICE_SESSION_COOKIE);

  return resolveAuthSessionValidation({
    sessionCookie,
    roleHint: roleCookie,
    deviceCookie,
    managedSessionCookie,
    hydrateUserRecord: false,
  });
}

export async function getRequestAuthSession(request: Request | NextRequest) {
  const result = await getRequestAuthSessionValidation(request);
  return result.session;
}

export async function recoverManagedAuthSessionFromRequest(
  request: Request | NextRequest,
  options?: { hydrateUserRecord?: boolean }
) {
  const sessionCookie = getCookieValueFromRequest(request, AUTH_SESSION_COOKIE);

  if (!sessionCookie) {
    return {
      session: null,
      reason: 'session_missing',
      recovered: false,
    } satisfies AuthSessionRecoveryResult;
  }

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    const email = decoded.email || '';
    const name = typeof decoded.name === 'string' ? decoded.name : '';
    const roleCookie = getCookieValueFromRequest(request, AUTH_ROLE_COOKIE);
    const decodedRole = normalizeUserRole((decoded as { role?: string }).role);
    const roleHint =
      normalizeUserRole(roleCookie) === 'admin' || decodedRole === 'admin' || isAdminEmail(email)
        ? 'admin'
        : 'user';

    return resolveSessionFromVerifiedCookie({
      uid: decoded.uid,
      email,
      name,
      roleHint,
      request,
      hydrateUserRecord: options?.hydrateUserRecord,
      recoverManagedSession: true,
    });
  } catch {
    return {
      session: null,
      reason: 'session_missing',
      recovered: false,
    } satisfies AuthSessionRecoveryResult;
  }
}

export async function getCurrentAuthSessionValidation(options?: { hydrateUserRecord?: boolean }) {
  const cookieStore = await cookies();
  const sessionCookie = getLatestCookieValue(cookieStore.getAll(AUTH_SESSION_COOKIE));
  const roleCookie = getLatestCookieValue(cookieStore.getAll(AUTH_ROLE_COOKIE));
  const deviceCookie = getLatestCookieValue(cookieStore.getAll(AUTH_DEVICE_COOKIE));
  const managedSessionCookie = getLatestCookieValue(cookieStore.getAll(AUTH_DEVICE_SESSION_COOKIE));

  return resolveAuthSessionValidation({
    sessionCookie,
    roleHint: roleCookie,
    deviceCookie,
    managedSessionCookie,
    hydrateUserRecord: options?.hydrateUserRecord,
  });
}

export async function getCurrentAuthSession(options?: { hydrateUserRecord?: boolean }) {
  const result = await getCurrentAuthSessionValidation({
    hydrateUserRecord: options?.hydrateUserRecord === true,
  });
  return result.session;
}

export async function requireUserPage(redirectTo: string) {
  const session = await getCurrentAuthSession();

  if (!session) {
    redirect(`/login?redirect=${encodeURIComponent(redirectTo)}`);
  }

  return session;
}

export async function requireAdminPage(redirectTo = '/admin') {
  const session = await getCurrentAuthSession();

  if (!session) {
    redirect(`/admin/login?redirect=${encodeURIComponent(redirectTo)}`);
  }

  if (session.role !== 'admin') {
    redirect('/login');
  }

  return session;
}

export function getAuthCookieConfig() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function getRoleCookieValue(role: UserRole) {
  return role === 'admin' ? 'admin' : 'user';
}

export {
  AUTH_DEVICE_COOKIE,
  AUTH_DEVICE_SESSION_COOKIE,
  AUTH_ROLE_COOKIE,
  AUTH_SESSION_COOKIE,
};
