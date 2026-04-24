'use client';

export { getAuthDevDiagnostics, getFirebaseAuthErrorMessage } from './devDiagnostics';
import {
  clearAuthStatusCache,
  fetchAuthStatus,
  primeAuthStatusCache,
  type ClientAuthStatus,
} from './status-client';
import { clearPublicMovieCache, fetchPublicMovies } from '@/lib/publicMovies';
import { fetchHomePageCategories, warmHomePageArtwork } from '@/lib/homePageClient';
import { buildHomeCollections } from '@/lib/homeRows';
import { dedupeSeriesMovies } from '@/lib/moviePresentation';
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
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
const SESSION_CONFIRM_RETRY_DELAYS_MS = [0, 180, 420];
const GOOGLE_REDIRECT_USER_TIMEOUT_MS = 5000;

function buildOptimisticAuthStatus(fallbackUser: {
  name: string;
  email: string;
  role: 'user' | 'admin';
}): ClientAuthStatus {
  return {
    authenticated: true,
    user: {
      id: '',
      name: fallbackUser.name || 'User',
      email: fallbackUser.email || '',
      role: fallbackUser.role,
    },
  };
}

function buildSessionValidationError(
  reason?: 'session_replaced' | 'session_revoked' | 'session_missing'
) {
  const error = new Error(
    reason === 'session_replaced'
      ? 'Your session has ended because this account was signed in on another device.'
      : reason === 'session_revoked'
        ? 'Your session has ended. Please sign in again to continue.'
        : "We couldn't complete your sign-in. Please try again."
  ) as Error & { code?: string };

  error.code =
    reason === 'session_replaced'
      ? 'auth/session-replaced'
      : reason === 'session_revoked'
        ? 'auth/session-revoked'
        : 'auth/session-not-established';

  return error;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function confirmServerAuthSession(fallbackUser: {
  name: string;
  email: string;
  role: 'user' | 'admin';
}) {
  const optimisticStatus = buildOptimisticAuthStatus(fallbackUser);
  primeAuthStatusCache(optimisticStatus);

  for (let attempt = 0; attempt < SESSION_CONFIRM_RETRY_DELAYS_MS.length; attempt += 1) {
    const retryDelay = SESSION_CONFIRM_RETRY_DELAYS_MS[attempt];

    if (retryDelay > 0) {
      await delay(retryDelay);
    }

    const status = await fetchAuthStatus({ force: true });

    if (!status.authenticated) {
      if (status.code === 'auth/device-limit-exceeded') {
        clearAuthStatusCache();
        const error = new Error(
          status.error ||
            'This account is already active on the maximum number of allowed devices. Please log out from another device and try again.'
        ) as Error & { code?: string };
        error.code = 'auth/device-limit-exceeded';
        throw error;
      }

      const isFinalAttempt = attempt === SESSION_CONFIRM_RETRY_DELAYS_MS.length - 1;
      const canRetry = status.reason === 'session_missing' && !isFinalAttempt;

      if (canRetry) {
        continue;
      }

      if (status.reason === 'session_missing') {
        return optimisticStatus;
      }

      clearAuthStatusCache();
      throw buildSessionValidationError(status.reason);
    }

    const normalizedStatus: ClientAuthStatus = {
      authenticated: true,
      user: {
        id: status.user?.id || '',
        name: status.user?.name || fallbackUser.name || 'User',
        email: status.user?.email || fallbackUser.email || '',
        role: status.user?.role === 'admin' ? 'admin' : fallbackUser.role,
      },
    };

    primeAuthStatusCache(normalizedStatus);
    return normalizedStatus;
  }

  return optimisticStatus;
}

async function warmPostLoginAppData(role: 'user' | 'admin') {
  if (role === 'admin') {
    return;
  }

  try {
    const [movies, homePageCategories] = await Promise.all([
      fetchPublicMovies({ force: true, refreshEntitlement: true }),
      fetchHomePageCategories({ force: true }),
    ]);
    const normalizedMovies = dedupeSeriesMovies(movies);
    const { homeRows } = buildHomeCollections({
      movies: normalizedMovies,
      homePageCategories,
      activeCategory: 'ALL',
    });
    const prioritizedArtworkMovies = dedupeSeriesMovies([
      ...normalizedMovies.slice(0, 1),
      ...homeRows.slice(0, 3).flatMap((row) =>
        row.movies.slice(0, row.usesSeriesBackdropCards ? 3 : 6)
      ),
    ]);
    warmHomePageArtwork(prioritizedArtworkMovies.length ? prioritizedArtworkMovies : normalizedMovies, 28);
  } catch {
    // Keep sign-in fast even if background warming fails.
  }
}

async function parseAuthResponse(response: Response) {
  const payload = (await response.clone().json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    success?: boolean;
    role?: 'user' | 'admin';
    redirectTo?: string;
    message?: string;
  };
  const responseText = await response.text().catch(() => '');

  if (!response.ok) {
    const isDeviceLimitStatusFallback =
      response.status === 409 &&
      (response.url.includes('/api/auth/login') || response.url.includes('/api/auth/session'));
    const normalizedErrorMessage =
      payload.error ||
      payload.message ||
      (isDeviceLimitStatusFallback
        ? 'This account is already active on the maximum number of allowed devices. Please log out from another device and try again.'
        : '') ||
      (/maximum number of allowed devices|maximum number of devices/i.test(responseText)
        ? 'This account is already active on the maximum number of allowed devices. Please log out from another device and try again.'
        : '');
    const normalizedCode =
      payload.code ||
      (isDeviceLimitStatusFallback ? 'auth/device-limit-exceeded' : '') ||
      (/maximum number of allowed devices|maximum number of devices/i.test(
        `${payload.error || ''} ${payload.message || ''} ${responseText}`
      )
        ? 'auth/device-limit-exceeded'
        : '');
    const error = new Error(
      normalizedErrorMessage || "We couldn't sign you in right now. Please try again."
    ) as Error & {
      code?: string;
    };
    error.code = normalizedCode || 'auth/request-failed';
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

function isGoogleUser(user: User | null | undefined) {
  return Boolean(
    user &&
      user.providerData?.some((provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID)
  );
}

async function waitForGoogleRedirectUser(timeoutMs = GOOGLE_REDIRECT_USER_TIMEOUT_MS) {
  if (isGoogleUser(auth.currentUser)) {
    return auth.currentUser;
  }

  return new Promise<User | null>((resolve) => {
    let settled = false;
    let timeoutId: number | undefined;
    let unsubscribe = () => undefined;

    const finish = (user: User | null | undefined) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      unsubscribe();
      resolve(isGoogleUser(user) ? user : null);
    };

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (isGoogleUser(user)) {
          finish(user);
        }
      },
      () => finish(null)
    );

    timeoutId = window.setTimeout(() => {
      finish(auth.currentUser);
    }, timeoutMs);
  });
}

export function hasPendingGoogleRedirectSignIn() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.sessionStorage.getItem(GOOGLE_REMEMBER_ME_KEY) !== null;
}

function shouldPreferGoogleRedirect() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /android|iphone|ipad|mobile/i.test(navigator.userAgent || '');
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
  await confirmServerAuthSession({
    name: options.name || 'User',
    email: options.email || '',
    role: session.role,
  });
  await warmPostLoginAppData(session.role);

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
  await confirmServerAuthSession({
    name: 'User',
    email,
    role: session.role,
  });
  await warmPostLoginAppData(session.role);
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
  await confirmServerAuthSession({
    name: options.name || 'User',
    email: options.email,
    role: session.role,
  });
  await warmPostLoginAppData(session.role);
  return { credential: null, session };
}

export async function continueWithGoogle(options?: { rememberMe?: boolean }) {
  const rememberMe = options?.rememberMe !== false;
  const provider = createGoogleProvider();

  rememberGooglePreference(rememberMe);

  if (shouldPreferGoogleRedirect()) {
    await signInWithRedirect(auth, provider);
    return { redirected: true as const };
  }

  try {
    const result = await signInWithPopup(auth, provider);
    return syncGoogleUserToSession(result.user, rememberMe);
  } catch (error) {
    if (shouldFallbackToRedirect(error)) {
      await signInWithRedirect(auth, provider);
      return { redirected: true as const };
    }

    clearGooglePreference();
    await signOut(auth).catch(() => undefined);
    throw error;
  }
}

export async function completeGoogleRedirectSignIn() {
  if (!hasPendingGoogleRedirectSignIn()) {
    return null;
  }

  const rememberMe = consumeGooglePreference(true);

  try {
    const result = await getRedirectResult(auth);

    if (result?.user) {
      return syncGoogleUserToSession(result.user, rememberMe);
    }

    const redirectedUser = await waitForGoogleRedirectUser();

    if (!redirectedUser) {
      return null;
    }

    return syncGoogleUserToSession(redirectedUser, rememberMe);
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
