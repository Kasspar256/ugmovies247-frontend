'use client';

export { getAuthDevDiagnostics, getFirebaseAuthErrorMessage } from './devDiagnostics';
import {
  clearAuthStatusCache,
  fetchAuthStatus,
  primeAuthStatusCache,
  type ClientAuthStatus,
} from './status-client';
import { clearAccountProfileCache } from '@/lib/accountProfile';
import { clearPublicMovieCache, fetchPublicMovies } from '@/lib/publicMovies';
import { fetchHomePageCategories, warmHomePageArtwork } from '@/lib/homePageClient';
import { buildHomeCollections } from '@/lib/homeRows';
import { dedupeSeriesMovies } from '@/lib/moviePresentation';
import { getNativeFirebaseAuthentication, isNativeAndroidApp } from '@/lib/mobile/nativeApp';
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithCredential,
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
const GOOGLE_REDIRECT_COOKIE = 'ugmovies247_google_redirect';
const SESSION_CONFIRM_RETRY_DELAYS_MS = [0, 180, 420];
const GOOGLE_REDIRECT_USER_TIMEOUT_MS = 12000;
const GOOGLE_REDIRECT_MARKER_MAX_AGE_MS = 10 * 60 * 1000;
const GOOGLE_SIGN_IN_TIMEOUT_MS = 35 * 1000;
const GOOGLE_TOKEN_TIMEOUT_MS = 12 * 1000;

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function setGoogleRedirectCookie(value: string, maxAgeSeconds = 10 * 60) {
  if (typeof document === 'undefined') {
    return;
  }

  const secureAttribute =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';

  document.cookie = `${GOOGLE_REDIRECT_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secureAttribute}`;
}

function readGoogleRedirectCookie() {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookies = document.cookie ? document.cookie.split('; ') : [];
  const entry = cookies.find((cookie) => cookie.startsWith(`${GOOGLE_REDIRECT_COOKIE}=`));

  if (!entry) {
    return null;
  }

  return entry.slice(`${GOOGLE_REDIRECT_COOKIE}=`.length) || null;
}

function clearGoogleRedirectCookie() {
  if (typeof document === 'undefined') {
    return;
  }

  const secureAttribute =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';

  document.cookie = `${GOOGLE_REDIRECT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secureAttribute}`;
}

function serializeGooglePreference(value: boolean) {
  return `${value ? '1' : '0'}:${Date.now()}`;
}

function parseGooglePreferenceMarker(rawValue: string | null) {
  if (!rawValue) {
    return null;
  }

  const [rememberValue, createdAtValue] = rawValue.split(':');
  const rememberMe = rememberValue === '0' ? false : rememberValue === '1' ? true : null;

  if (rememberMe === null) {
    return null;
  }

  if (!createdAtValue) {
    return {
      rememberMe,
      isFresh: false,
      isLegacy: true,
    };
  }

  const createdAt = Number(createdAtValue);
  const isFresh =
    Number.isFinite(createdAt) &&
    createdAt > 0 &&
    Date.now() - createdAt <= GOOGLE_REDIRECT_MARKER_MAX_AGE_MS;

  return {
    rememberMe,
    isFresh,
    isLegacy: false,
  };
}

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

function buildAuthTimeoutError(message: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = 'auth/google-sign-in-timeout';
  return error;
}

function withAuthTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(buildAuthTimeoutError(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
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
    warmHomePageArtwork(prioritizedArtworkMovies.length ? prioritizedArtworkMovies : normalizedMovies, 8);
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

function getFirebaseErrorMessage(error: unknown) {
  return typeof (error as { message?: string })?.message === 'string'
    ? (error as { message: string }).message
    : '';
}

function rememberGooglePreference(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  const serializedValue = serializeGooglePreference(value);
  setGoogleRedirectCookie(serializedValue);

  try {
    window.sessionStorage.setItem(GOOGLE_REMEMBER_ME_KEY, serializedValue);
  } catch {
    // Ignore storage failures and fall back to local storage below.
  }

  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(GOOGLE_REMEMBER_ME_KEY, serializedValue);
  } catch {
    // Ignore storage failures and let the auth flow continue.
  }
}

function consumeGooglePreference(defaultValue = true) {
  if (typeof window === 'undefined') {
    return defaultValue;
  }

  const storedValues: Array<{ value: string | null; source: 'storage' | 'cookie' }> = [];

  try {
    storedValues.push({
      value: window.sessionStorage.getItem(GOOGLE_REMEMBER_ME_KEY),
      source: 'storage',
    });
    window.sessionStorage.removeItem(GOOGLE_REMEMBER_ME_KEY);
  } catch {
    // Ignore storage failures and continue with other markers.
  }

  if (canUseLocalStorage()) {
    try {
      storedValues.push({
        value: window.localStorage.getItem(GOOGLE_REMEMBER_ME_KEY),
        source: 'storage',
      });
      window.localStorage.removeItem(GOOGLE_REMEMBER_ME_KEY);
    } catch {
      // Ignore storage failures and continue with cookie marker.
    }
  }

  storedValues.push({ value: readGoogleRedirectCookie(), source: 'cookie' });

  clearGoogleRedirectCookie();

  for (const storedValue of storedValues) {
    const marker = parseGooglePreferenceMarker(storedValue.value);

    if (marker?.isFresh) {
      return marker.rememberMe;
    }
  }

  const legacyCookieMarker = storedValues
    .filter((storedValue) => storedValue.source === 'cookie')
    .map((storedValue) => parseGooglePreferenceMarker(storedValue.value))
    .find((marker) => marker?.isLegacy);

  if (legacyCookieMarker) {
    return legacyCookieMarker.rememberMe;
  }

  return defaultValue;
}

function clearGooglePreference() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.removeItem(GOOGLE_REMEMBER_ME_KEY);
  } catch {
    // Ignore cleanup failures.
  }

  if (!canUseLocalStorage()) {
    clearGoogleRedirectCookie();
    return;
  }

  try {
    window.localStorage.removeItem(GOOGLE_REMEMBER_ME_KEY);
  } catch {
    // Ignore cleanup failures.
  }

  clearGoogleRedirectCookie();
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

  let foundStaleMarker = false;

  try {
    const sessionMarker = parseGooglePreferenceMarker(
      window.sessionStorage.getItem(GOOGLE_REMEMBER_ME_KEY)
    );

    if (sessionMarker?.isFresh) {
      return true;
    }

    foundStaleMarker = foundStaleMarker || Boolean(sessionMarker);
  } catch {
    // Ignore session storage failures and check local storage below.
  }

  const cookieMarker = parseGooglePreferenceMarker(readGoogleRedirectCookie());

  if (cookieMarker?.isFresh || cookieMarker?.isLegacy) {
    return true;
  }

  foundStaleMarker = foundStaleMarker || Boolean(cookieMarker);

  if (canUseLocalStorage()) {
    try {
      const localMarker = parseGooglePreferenceMarker(
        window.localStorage.getItem(GOOGLE_REMEMBER_ME_KEY)
      );

      if (localMarker?.isFresh) {
        return true;
      }

      foundStaleMarker = foundStaleMarker || Boolean(localMarker);
    } catch {
      // Ignore local storage failures and rely on cookie/session markers.
    }
  }

  if (foundStaleMarker) {
    clearGooglePreference();
  }

  return false;
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
  await confirmServerAuthSession({
    name: options.name || 'User',
    email: options.email || '',
    role: session.role,
  });
  void warmPostLoginAppData(session.role);

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
  if (isNativeAndroidApp() || isMobileBrowser()) {
    return false;
  }

  const code = getFirebaseErrorCode(error);
  const message = getFirebaseErrorMessage(error);

  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/operation-not-supported-in-this-environment' ||
    /doesn'?t support credential manager|credential manager|no credentials available|no credential/i.test(message)
  );
}

function isMobileBrowser() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function createGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

function buildNativeGoogleUnavailableError() {
  const error = new Error(
    'Google sign-in needs the latest app update on this device. Please use email sign-in for now, or update the app and try again.'
  ) as Error & { code?: string };
  error.code = 'auth/native-google-unavailable';
  return error;
}

async function continueWithNativeGoogle(rememberMe: boolean) {
  const nativeFirebaseAuthentication = getNativeFirebaseAuthentication();

  if (!nativeFirebaseAuthentication?.signInWithGoogle) {
    throw buildNativeGoogleUnavailableError();
  }

  try {
    const result = await withAuthTimeout(
      nativeFirebaseAuthentication.signInWithGoogle({ useCredentialManager: false }),
      GOOGLE_SIGN_IN_TIMEOUT_MS,
      'Google sign-in took too long on this device. Please try again.'
    );
    const firebaseIdTokenResult = nativeFirebaseAuthentication.getIdToken
      ? await withAuthTimeout(
          nativeFirebaseAuthentication.getIdToken(),
          GOOGLE_TOKEN_TIMEOUT_MS,
          'Google sign-in completed, but the secure session token took too long. Please try again.'
        )
      : null;
    const firebaseIdToken =
      typeof firebaseIdTokenResult?.token === 'string' ? firebaseIdTokenResult.token : '';

    if (firebaseIdToken) {
      const session = await createSessionFromIdToken({
        idToken: firebaseIdToken,
        name: result?.user?.displayName || '',
        email: result?.user?.email || '',
        rememberMe,
      });

      return { session, redirected: false as const };
    }

    const googleIdToken =
      typeof result?.credential?.idToken === 'string' ? result.credential.idToken : '';
    const googleAccessToken =
      typeof result?.credential?.accessToken === 'string' ? result.credential.accessToken : '';

    if (googleIdToken || googleAccessToken) {
      const credential = GoogleAuthProvider.credential(
        googleIdToken || null,
        googleAccessToken || null
      );
      const credentialResult = await signInWithCredential(auth, credential);
      return syncGoogleUserToSession(credentialResult.user, rememberMe);
    }

    throw buildNativeGoogleUnavailableError();
  } finally {
    clearGooglePreference();
    await nativeFirebaseAuthentication.signOut?.().catch(() => undefined);
  }
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
  await confirmServerAuthSession({
    name: 'User',
    email,
    role: session.role,
  });
  void warmPostLoginAppData(session.role);
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
  await confirmServerAuthSession({
    name: options.name || 'User',
    email: options.email,
    role: session.role,
  });
  void warmPostLoginAppData(session.role);
  return { credential: null, session };
}

export async function continueWithGoogle(options?: { rememberMe?: boolean }) {
  const rememberMe = options?.rememberMe !== false;
  const provider = createGoogleProvider();

  rememberGooglePreference(rememberMe);

  try {
    if (isNativeAndroidApp()) {
      return continueWithNativeGoogle(rememberMe);
    }

    const result = await withAuthTimeout(
      signInWithPopup(auth, provider),
      GOOGLE_SIGN_IN_TIMEOUT_MS,
      'Google sign-in took too long on this device. Please try again.'
    );
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
  const hasPendingMarker = hasPendingGoogleRedirectSignIn();

  const rememberMe = consumeGooglePreference(true);

  try {
    const result = await getRedirectResult(auth);

    if (result?.user) {
      return syncGoogleUserToSession(result.user, rememberMe);
    }

    if (isGoogleUser(auth.currentUser)) {
      return syncGoogleUserToSession(auth.currentUser, rememberMe);
    }

    if (!hasPendingMarker) {
      return null;
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
  clearAccountProfileCache();
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

export async function confirmPasswordReset(options: { token: string; password: string }) {
  const response = await fetch('/api/auth/password-reset/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(options),
  });

  return parseAuthResponse(response);
}

export async function resendVerificationEmail() {
  const response = await fetch('/api/auth/verification-email', {
    method: 'POST',
    credentials: 'include',
  });

  return parseAuthResponse(response);
}
