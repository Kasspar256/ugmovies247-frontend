'use client';

export { getAuthDevDiagnostics, getFirebaseAuthErrorMessage } from './devDiagnostics';
import { clearAuthStatusCache, primeAuthStatusCache } from './status-client';
import { clearPublicMovieCache } from '@/lib/publicMovies';
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

type SessionResponse = {
  success: boolean;
  role: 'user' | 'admin';
  redirectTo: string;
};

const GOOGLE_REMEMBER_ME_KEY = 'ugmovies247_google_auth_remember_me';

async function parseAuthResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    success?: boolean;
    role?: 'user' | 'admin';
    redirectTo?: string;
    message?: string;
  };

  if (!response.ok) {
    const error = new Error(payload.error || 'Authentication failed.') as Error & { code?: string };
    error.code = payload.code || 'auth/request-failed';
    throw error;
  }

  return payload;
}

function getFirebaseErrorCode(error: unknown) {
  return typeof (error as { code?: string })?.code === 'string'
    ? (error as { code: string }).code
    : '';
}

function rememberGooglePreference(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(GOOGLE_REMEMBER_ME_KEY, value ? '1' : '0');
}

function consumeGooglePreference(defaultValue = true) {
  if (typeof window === 'undefined') {
    return defaultValue;
  }

  const stored = window.sessionStorage.getItem(GOOGLE_REMEMBER_ME_KEY);
  window.sessionStorage.removeItem(GOOGLE_REMEMBER_ME_KEY);

  if (stored === '0') {
    return false;
  }

  if (stored === '1') {
    return true;
  }

  return defaultValue;
}

function clearGooglePreference() {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(GOOGLE_REMEMBER_ME_KEY);
}

async function createSessionFromIdToken(options: {
  idToken: string;
  name?: string;
  email?: string;
  rememberMe?: boolean;
}) {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      idToken: options.idToken,
      name: options.name || '',
      rememberMe: options.rememberMe !== false,
    }),
  });

  const session = (await parseAuthResponse(response)) as SessionResponse;
  clearPublicMovieCache();
  primeAuthStatusCache({
    authenticated: true,
    user: {
      id: '',
      name: options.name || 'User',
      email: options.email || '',
      role: session.role,
    },
  });

  return session;
}

async function syncGoogleUserToSession(user: User, rememberMe: boolean) {
  try {
    const idToken = await user.getIdToken();
    const session = await createSessionFromIdToken({
      idToken,
      name: user.displayName || '',
      email: user.email || '',
      rememberMe,
    });

    return { session, redirected: false as const };
  } finally {
    clearGooglePreference();
    await signOut(auth).catch(() => undefined);
  }
}

function shouldFallbackToRedirect(error: unknown) {
  const code = getFirebaseErrorCode(error);

  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/operation-not-supported-in-this-environment'
  );
}

function createGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export async function loginWithEmailPassword(
  email: string,
  password: string,
  options?: { rememberMe?: boolean }
) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email,
      password,
      rememberMe: options?.rememberMe !== false,
    }),
  });

  const session = (await parseAuthResponse(response)) as SessionResponse;
  clearPublicMovieCache();
  primeAuthStatusCache({
    authenticated: true,
    user: {
      id: '',
      name: 'User',
      email,
      role: session.role,
    },
  });
  return { credential: null, session };
}

export async function signupWithEmailPassword(options: {
  name: string;
  email: string;
  password: string;
}) {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(options),
  });

  const session = (await parseAuthResponse(response)) as SessionResponse;
  clearPublicMovieCache();
  primeAuthStatusCache({
    authenticated: true,
    user: {
      id: '',
      name: options.name || 'User',
      email: options.email,
      role: session.role,
    },
  });
  return { credential: null, session };
}

export async function continueWithGoogle(options?: { rememberMe?: boolean }) {
  const rememberMe = options?.rememberMe !== false;

  rememberGooglePreference(rememberMe);

  try {
    const result = await signInWithPopup(auth, createGoogleProvider());
    return syncGoogleUserToSession(result.user, rememberMe);
  } catch (error) {
    if (shouldFallbackToRedirect(error)) {
      await signInWithRedirect(auth, createGoogleProvider());
      return { redirected: true as const };
    }

    clearGooglePreference();
    await signOut(auth).catch(() => undefined);
    throw error;
  }
}

export async function completeGoogleRedirectSignIn() {
  const rememberMe = consumeGooglePreference(true);

  try {
    const result = await getRedirectResult(auth);

    if (!result?.user) {
      return null;
    }

    return syncGoogleUserToSession(result.user, rememberMe);
  } catch (error) {
    const code = getFirebaseErrorCode(error);

    if (code === 'auth/no-auth-event' || code === 'auth/null-user') {
      clearGooglePreference();
      return null;
    }

    clearGooglePreference();
    await signOut(auth).catch(() => undefined);
    throw error;
  }
}

export async function logoutCurrentUser() {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to sign out.');
  }

  await signOut(auth).catch(() => undefined);
  clearPublicMovieCache();
  clearAuthStatusCache();
}

export async function sendResetPasswordEmail(email: string) {
  const response = await fetch('/api/auth/password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });

  return parseAuthResponse(response);
}
