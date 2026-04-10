'use client';

export { getAuthDevDiagnostics, getFirebaseAuthErrorMessage } from './devDiagnostics';

type SessionResponse = {
  success: boolean;
  role: 'user' | 'admin';
  redirectTo: string;
};

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
  return { credential: null, session };
}

export async function logoutCurrentUser() {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to sign out.');
  }
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

