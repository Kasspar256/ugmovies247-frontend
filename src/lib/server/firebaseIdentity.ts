import { NextResponse } from 'next/server';
import { AUTH_SESSION_MAX_AGE_MS } from '@/lib/auth/constants';
import {
  AUTH_ROLE_COOKIE,
  AUTH_SESSION_COOKIE,
  getAuthCookieConfig,
  getRoleCookieValue,
  isAdminEmail,
} from '@/lib/auth/server';
import { adminAuth, adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getSubscriptionSnapshotFromData } from '@/lib/server/subscriptions';

type FirebaseIdentitySuccess = Record<string, unknown>;

type FirebaseIdentityError = Error & {
  code?: string;
  status?: number;
};

function getFirebaseWebApiKey() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '';

  if (!apiKey) {
    throw Object.assign(new Error('Missing NEXT_PUBLIC_FIREBASE_API_KEY for Firebase Auth.'), {
      code: 'auth/configuration-missing',
      status: 500,
    });
  }

  return apiKey;
}

function mapIdentityError(code: string, message: string) {
  switch (code) {
    case 'EMAIL_EXISTS':
      return {
        code: 'auth/email-already-in-use',
        message: 'An account with that email already exists.',
        status: 409,
      };
    case 'INVALID_EMAIL':
      return {
        code: 'auth/invalid-email',
        message: 'Enter a valid email address.',
        status: 400,
      };
    case 'WEAK_PASSWORD':
      return {
        code: 'auth/weak-password',
        message: 'Choose a stronger password with at least 6 characters.',
        status: 400,
      };
    case 'EMAIL_NOT_FOUND':
    case 'INVALID_PASSWORD':
    case 'INVALID_LOGIN_CREDENTIALS':
      return {
        code: 'auth/invalid-credential',
        message: 'Incorrect email or password.',
        status: 401,
      };
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':
    case 'RESET_PASSWORD_EXCEED_LIMIT':
      return {
        code: 'auth/too-many-requests',
        message: 'Too many attempts. Please wait and try again.',
        status: 429,
      };
    case 'OPERATION_NOT_ALLOWED':
    case 'PASSWORD_LOGIN_DISABLED':
      return {
        code: 'auth/operation-not-allowed',
        message:
          'Email/Password sign-in is disabled for the active Firebase project. Enable it in Firebase Console > Authentication > Sign-in method.',
        status: 403,
      };
    case 'QUOTA_EXCEEDED':
    case 'RESOURCE_EXHAUSTED':
      return {
        code: 'auth/quota-exceeded',
        message: 'Firebase auth quota is temporarily exhausted. Please wait a bit and try again.',
        status: 429,
      };
    default:
      return {
        code: 'auth/request-failed',
        message: message || code || 'Authentication failed.',
        status: 400,
      };
  }
}

async function callIdentityToolkit(path: string, body: Record<string, unknown>) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(getFirebaseWebApiKey())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    }
  );

  const payload = (await response.json().catch(() => ({}))) as
    | FirebaseIdentitySuccess
    | { error?: { message?: string } };

  if (!response.ok) {
    const rawMessage = String(
      (payload as { error?: { message?: string } }).error?.message || 'Authentication failed.'
    );
    const primaryCode = rawMessage.split(':')[0]?.trim() || rawMessage.trim();
    const mapped = mapIdentityError(primaryCode, rawMessage);
    throw Object.assign(new Error(mapped.message), {
      code: mapped.code,
      status: mapped.status,
    } as FirebaseIdentityError);
  }

  return payload;
}

function nowIso() {
  return new Date().toISOString();
}

export async function createAuthSessionResponse(options: {
  idToken: string;
  requestedName?: string;
  rememberMe?: boolean;
}) {
  const adminSetupError = getFirebaseAdminSetupError();

  if (adminSetupError) {
    return NextResponse.json(
      { error: `Firebase Admin is not configured for the active environment. ${adminSetupError}` },
      { status: 500 }
    );
  }

  const decoded = await adminAuth.verifyIdToken(options.idToken);
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
    options.requestedName?.trim() ||
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

  const sessionCookie = await adminAuth.createSessionCookie(options.idToken, {
    expiresIn: AUTH_SESSION_MAX_AGE_MS,
  });

  const response = NextResponse.json({
    success: true,
    role,
    redirectTo: role === 'admin' ? '/admin' : '/',
  });

  const cookieConfig = getAuthCookieConfig();
  const cookieMaxAge = options.rememberMe === false ? undefined : AUTH_SESSION_MAX_AGE_MS / 1000;

  response.cookies.set(AUTH_SESSION_COOKIE, sessionCookie, {
    ...cookieConfig,
    ...(cookieMaxAge ? { maxAge: cookieMaxAge } : {}),
  });
  response.cookies.set(AUTH_ROLE_COOKIE, getRoleCookieValue(role), {
    ...cookieConfig,
    ...(cookieMaxAge ? { maxAge: cookieMaxAge } : {}),
  });

  return response;
}

export async function signInWithPasswordServer(email: string, password: string) {
  return callIdentityToolkit('accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true,
  });
}

export async function signUpWithPasswordServer(options: {
  name: string;
  email: string;
  password: string;
}) {
  const payload = await callIdentityToolkit('accounts:signUp', {
    email: options.email,
    password: options.password,
    returnSecureToken: true,
  });

  const localId = String(payload.localId || '');

  if (localId) {
    await adminAuth.updateUser(localId, { displayName: options.name }).catch((error) => {
      console.warn('[auth] failed to set display name after signup', error);
    });
  }

  return payload;
}

export async function sendPasswordResetEmailServer(email: string) {
  return callIdentityToolkit('accounts:sendOobCode', {
    requestType: 'PASSWORD_RESET',
    email,
  });
}
