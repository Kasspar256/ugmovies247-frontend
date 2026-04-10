import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { ADMIN_EMAILS, AUTH_ROLE_COOKIE, AUTH_SESSION_COOKIE } from './constants';
import type { SubscriptionSnapshot } from '@/types/subscriptions';

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

function normalizeUserRole(value: unknown): UserRole {
  return value === 'admin' ? 'admin' : 'user';
}

function getCookieValueFromRequest(request: Request | NextRequest, name: string) {
  const cookieHeader = request.headers.get('cookie') || '';
  const parts = cookieHeader.split(';').map((entry) => entry.trim());
  const match = parts.find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

export function isAdminEmail(email?: string | null) {
  return Boolean(email && ADMIN_EMAILS.includes(email.toLowerCase()));
}

async function fetchUserRecord(uid: string, fallback: { email?: string; name?: string }) {
  const snapshot = await adminDb.collection('users').doc(uid).get();
  const data = snapshot.data() as Partial<AppUserRecord> | undefined;
  const now = new Date().toISOString();

  return {
    id: uid,
    name: data?.name || fallback.name || 'User',
    email: data?.email || fallback.email || '',
    authProvider: data?.authProvider || 'password',
    role: normalizeUserRole(data?.role || (isAdminEmail(fallback.email) ? 'admin' : 'user')),
    createdAt: data?.createdAt || now,
    updatedAt: data?.updatedAt || now,
    lastLoginAt: data?.lastLoginAt || now,
    isActive: data?.isActive !== false,
    avatarUrl: data?.avatarUrl || '',
    notificationPreferences: data?.notificationPreferences || {
      marketing: false,
      productUpdates: true,
    },
    subscription:
      data?.subscription && typeof data.subscription === 'object'
        ? (data.subscription as SubscriptionSnapshot)
        : undefined,
  };
}

export async function getAuthSessionFromSessionCookie(sessionCookie: string) {
  if (!sessionCookie) {
    return null;
  }

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    const email = decoded.email || '';
    const name = typeof decoded.name === 'string' ? decoded.name : '';
    const userRecord = await fetchUserRecord(decoded.uid, { email, name });

    if (!userRecord.isActive) {
      return null;
    }

    return {
      uid: decoded.uid,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role,
      userRecord,
    } as AuthSession;
  } catch (error) {
    return null;
  }
}

export async function getRequestAuthSession(request: Request | NextRequest) {
  const sessionCookie = getCookieValueFromRequest(request, AUTH_SESSION_COOKIE);
  return getAuthSessionFromSessionCookie(sessionCookie);
}

export async function getCurrentAuthSession() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(AUTH_SESSION_COOKIE)?.value || '';
  return getAuthSessionFromSessionCookie(sessionCookie);
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
    domain: process.env.AUTH_COOKIE_DOMAIN || undefined,
  };
}

export function getRoleCookieValue(role: UserRole) {
  return role === 'admin' ? 'admin' : 'user';
}

export { AUTH_ROLE_COOKIE, AUTH_SESSION_COOKIE };
