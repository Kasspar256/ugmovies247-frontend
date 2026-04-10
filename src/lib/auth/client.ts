'use client';

import {
  browserSessionPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type UserCredential,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
export { getAuthDevDiagnostics, getFirebaseAuthErrorMessage } from './devDiagnostics';
let persistenceReady: Promise<void> | null = null;
let persistenceMode: 'local' | 'session' = 'local';

async function ensurePersistence(mode: 'local' | 'session' = 'local') {
  if (!persistenceReady || persistenceMode !== mode) {
    persistenceMode = mode;
    persistenceReady = setPersistence(
      auth,
      mode === 'session' ? browserSessionPersistence : browserLocalPersistence
    ).catch((error) => {
      console.error('[auth] failed to set persistence', error);
    });
  }

  await persistenceReady;
}

async function createServerSession(options: { idToken: string; name?: string }) {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Failed to create a secure session.');
  }

  return payload as { success: boolean; role: 'user' | 'admin'; redirectTo: string };
}

export async function loginWithEmailPassword(
  email: string,
  password: string,
  options?: { rememberMe?: boolean }
) {
  await ensurePersistence(options?.rememberMe === false ? 'session' : 'local');
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const idToken = await credential.user.getIdToken(true);
  const session = await createServerSession({ idToken, name: credential.user.displayName || '' });
  return { credential, session };
}

export async function signupWithEmailPassword(options: {
  name: string;
  email: string;
  password: string;
}) {
  await ensurePersistence();
  const credential = await createUserWithEmailAndPassword(auth, options.email, options.password);
  await updateProfile(credential.user, { displayName: options.name });
  const idToken = await credential.user.getIdToken(true);
  const session = await createServerSession({ idToken, name: options.name });
  return { credential, session };
}

export async function logoutCurrentUser() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
    });
  } finally {
    await signOut(auth);
  }
}

export async function sendResetPasswordEmail(email: string) {
  await ensurePersistence();
  await sendPasswordResetEmail(auth, email);
}
