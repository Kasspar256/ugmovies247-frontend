import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import {
  AUTH_ROLE_COOKIE,
  AUTH_SESSION_COOKIE,
  getAuthCookieConfig,
  getRoleCookieValue,
  isAdminEmail,
} from '@/lib/auth/server';
import { AUTH_SESSION_MAX_AGE_MS } from '@/lib/auth/constants';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { getSubscriptionSnapshotFromData } from '@/lib/server/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || 'unknown';
}

function nowIso() {
  return new Date().toISOString();
}

export async function POST(request: Request) {
  try {
    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        { error: `Firebase Admin is not configured for the active environment. ${adminSetupError}` },
        { status: 500 }
      );
    }

    const ip = getRequestIp(request);
    const rateLimit = checkRateLimit(`auth-session:${ip}`, {
      limit: 20,
      windowMs: 1000 * 60 * 10,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many authentication attempts. Please wait and try again.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const idToken = String(body.idToken || '');
    const requestedName = String(body.name || '').trim();

    if (!idToken) {
      return NextResponse.json({ error: 'Missing authentication token.' }, { status: 400 });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = decoded.email || '';

    if (!email) {
      return NextResponse.json({ error: 'Authenticated account is missing an email.' }, { status: 400 });
    }

    const userRef = adminDb.collection('users').doc(decoded.uid);
    const existingSnapshot = await userRef.get();
    const existing = existingSnapshot.data() as Record<string, unknown> | undefined;
    const role = (existing?.role === 'admin' || isAdminEmail(email)) ? 'admin' : 'user';

    if (existing?.isActive === false) {
      return NextResponse.json(
        { error: 'This account is not active. Please contact support.' },
        { status: 403 }
      );
    }

    const timestamp = nowIso();
    const resolvedName =
      requestedName ||
      (typeof decoded.name === 'string' ? decoded.name : '') ||
      String(existing?.name || '') ||
      'User';

    try {
      if (existing?.role !== role) {
        await adminAuth.setCustomUserClaims(decoded.uid, { role });
      }
    } catch (claimsError) {
      console.warn('[auth] custom claims sync failed', claimsError);
    }

    try {
      await userRef.set(
        {
          id: decoded.uid,
          name: resolvedName,
          email,
          authProvider: decoded.firebase.sign_in_provider || 'password',
          role,
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp,
          lastLoginAt: timestamp,
          isActive: existing?.isActive !== false,
          avatarUrl:
            String(existing?.avatarUrl || '') ||
            (typeof decoded.picture === 'string' ? decoded.picture : ''),
          notificationPreferences: existing?.notificationPreferences || {
            marketing: false,
            productUpdates: true,
          },
          subscription:
            existing?.subscription && typeof existing.subscription === 'object'
              ? existing.subscription
              : getSubscriptionSnapshotFromData(null),
        },
        { merge: true }
      );
    } catch (userRecordError) {
      console.warn('[auth] user record sync failed', userRecordError);
    }

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: AUTH_SESSION_MAX_AGE_MS,
    });

    const response = NextResponse.json({
      success: true,
      role,
      redirectTo: role === 'admin' ? '/admin' : '/',
    });

    response.cookies.set(AUTH_SESSION_COOKIE, sessionCookie, {
      ...getAuthCookieConfig(),
      maxAge: AUTH_SESSION_MAX_AGE_MS / 1000,
    });
    response.cookies.set(AUTH_ROLE_COOKIE, getRoleCookieValue(role), {
      ...getAuthCookieConfig(),
      maxAge: AUTH_SESSION_MAX_AGE_MS / 1000,
    });

    return response;
  } catch (error) {
    console.error('[auth] session creation failed', error);
    const message =
      error instanceof Error ? error.message || 'Could not create a secure session.' : 'Could not create a secure session.';

    return NextResponse.json(
      {
        error:
          /RESOURCE_EXHAUSTED|quota exceeded/i.test(message)
            ? 'Firebase auth quota is temporarily exhausted. Please wait a bit and try again.'
            : message,
      },
      { status: 401 }
    );
  }
}
