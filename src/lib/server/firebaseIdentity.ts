import { NextResponse } from 'next/server';
import {
  AUTH_DEVICE_COOKIE,
  AUTH_DEVICE_COOKIE_MAX_AGE_MS,
  AUTH_DEVICE_SESSION_COOKIE,
  AUTH_SESSION_MAX_AGE_MS,
} from '@/lib/auth/constants';
import {
  AUTH_ROLE_COOKIE,
  AUTH_SESSION_COOKIE,
  getAuthCookieConfig,
  getRoleCookieValue,
  isAdminEmail,
} from '@/lib/auth/server';
import { adminAuth, adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import {
  AUTH_DEVICE_LIMIT_EXCEEDED_CODE,
  AUTH_DEVICE_LIMIT_EXCEEDED_MESSAGE,
  DeviceLimitExceededError,
  createManagedAuthSession,
} from '@/lib/server/authSessions';
import {
  getDeviceLimitForSubscriptionSnapshot,
  getSubscriptionSnapshotFromData,
  resolveEffectiveSubscriptionState,
} from '@/lib/server/subscriptions';
import type { SubscriptionSnapshot } from '@/types/subscriptions';
import {
  getDefaultAvatarPresetId,
} from '@/lib/avatarPresets';

type FirebaseIdentitySuccess = Record<string, unknown>;

type FirebaseSignInSuccess = FirebaseIdentitySuccess & {
  idToken: string;
  refreshToken?: string;
  expiresIn?: string;
  localId?: string;
  email?: string;
};

type FirebaseSignUpSuccess = FirebaseIdentitySuccess & {
  idToken: string;
  refreshToken?: string;
  expiresIn?: string;
  localId?: string;
  email?: string;
};

type FirebasePasswordResetSuccess = FirebaseIdentitySuccess & {
  email?: string;
};

type FirebaseIdentityError = Error & {
  code?: string;
  status?: number;
};

type NormalizedAuthRouteError = {
  error: string;
  code: string;
  status: number;
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

async function callIdentityToolkit<TSuccess extends FirebaseIdentitySuccess>(
  path: string,
  body: Record<string, unknown>
) {
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

  return payload as TSuccess;
}

function nowIso() {
  return new Date().toISOString();
}

async function readExistingUserState(uid: string) {
  try {
    const snapshot = await adminDb.collection('users').doc(uid).get();
    return snapshot.data() as Record<string, unknown> | undefined;
  } catch (error) {
    console.warn('[auth] failed to read user profile from Firestore during session creation', error);
    return undefined;
  }
}

export function normalizeAuthRouteError(
  error: unknown,
  fallback: {
    message: string;
    status: number;
    code?: string;
  }
): NormalizedAuthRouteError {
  const authError = error as Error & { code?: string; status?: number };
  const authMessage = String(authError.message || '');

  if (
    error instanceof DeviceLimitExceededError ||
    authError.code === AUTH_DEVICE_LIMIT_EXCEEDED_CODE ||
    /maximum number of allowed devices|maximum number of devices/i.test(authMessage)
  ) {
    return {
      error: AUTH_DEVICE_LIMIT_EXCEEDED_MESSAGE,
      code: AUTH_DEVICE_LIMIT_EXCEEDED_CODE,
      status: 409,
    };
  }

  return {
    error: authMessage || fallback.message,
    code: authError.code || fallback.code || 'auth/request-failed',
    status: authError.status || fallback.status,
  };
}

export async function createAuthSessionResponse(options: {
  request: Request;
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
  const existing = await readExistingUserState(decoded.uid);
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
  const avatarPresetId =
    typeof existing?.avatarPresetId === 'string' && existing.avatarPresetId
      ? existing.avatarPresetId
      : getDefaultAvatarPresetId(decoded.uid || email);
  const storedEffectiveSubscriptionSnapshot =
    existing?.subscription && typeof existing.subscription === 'object'
      ? getSubscriptionSnapshotFromData(
          existing.subscription as Partial<SubscriptionSnapshot>
        )
      : null;
  const sessionCookiePromise = adminAuth.createSessionCookie(options.idToken, {
    expiresIn: AUTH_SESSION_MAX_AGE_MS,
  });

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
        avatarPresetId,
        avatarUrl: String(existing?.avatarUrl || ''),
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

    if ((typeof decoded.name === 'string' ? decoded.name : '') !== resolvedName) {
      await adminAuth.updateUser(decoded.uid, {
        displayName: resolvedName,
      }).catch((error) => {
        console.warn('[auth] failed to sync display name to Firebase Auth user', error);
      });
    }
  } catch (userRecordError) {
    console.warn('[auth] user record sync failed', userRecordError);
  }

  const [sessionCookie, effectiveSubscriptionSnapshot] = await Promise.all([
    sessionCookiePromise,
    storedEffectiveSubscriptionSnapshot
      ? Promise.resolve(storedEffectiveSubscriptionSnapshot)
      : resolveEffectiveSubscriptionState(decoded.uid).then((state) => state.effectiveSnapshot),
  ]);
  let managedSession: Awaited<ReturnType<typeof createManagedAuthSession>>;

  try {
    managedSession = await createManagedAuthSession({
      request: options.request,
      userId: decoded.uid,
      role,
      subscriptionSnapshot: effectiveSubscriptionSnapshot,
      deviceLimit: getDeviceLimitForSubscriptionSnapshot(effectiveSubscriptionSnapshot, role),
    });
  } catch (error) {
    const normalizedError = normalizeAuthRouteError(error, {
      message: 'Could not create a secure session.',
      status: 401,
    });

    return NextResponse.json(
      {
        error: normalizedError.error,
        code: normalizedError.code,
      },
      { status: normalizedError.status }
    );
  }

  const response = NextResponse.json({
    success: true,
    role,
    redirectTo: role === 'admin' ? '/admin' : '/browse',
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
  response.cookies.set(AUTH_DEVICE_COOKIE, managedSession.deviceCookieValue, {
    ...cookieConfig,
    maxAge: AUTH_DEVICE_COOKIE_MAX_AGE_MS / 1000,
  });
  response.cookies.set(AUTH_DEVICE_SESSION_COOKIE, managedSession.sessionCookieValue, {
    ...cookieConfig,
    ...(cookieMaxAge ? { maxAge: cookieMaxAge } : {}),
  });

  return response;
}

export async function signInWithPasswordServer(email: string, password: string) {
  return callIdentityToolkit<FirebaseSignInSuccess>('accounts:signInWithPassword', {
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
  const payload = await callIdentityToolkit<FirebaseSignUpSuccess>('accounts:signUp', {
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
  return callIdentityToolkit<FirebasePasswordResetSuccess>('accounts:sendOobCode', {
    requestType: 'PASSWORD_RESET',
    email,
  });
}
