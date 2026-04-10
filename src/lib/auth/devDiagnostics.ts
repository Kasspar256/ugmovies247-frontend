import { APP_ENV, FIREBASE_PROJECT_LABEL } from '@/lib/appEnv';
import { missingFirebaseEnv } from '@/lib/firebase';

export function getFirebaseAuthErrorMessage(error: unknown) {
  const message =
    typeof (error as { message?: string })?.message === 'string'
      ? (error as { message: string }).message
      : '';
  const code = typeof (error as { code?: string })?.code === 'string'
    ? (error as { code: string }).code
    : '';

  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with that email already exists.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 6 characters.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait and try again.';
    case 'auth/quota-exceeded':
      return 'Firebase auth quota is temporarily exhausted. Please wait a bit and try again.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is disabled for the active Firebase project. Enable it in Firebase Console > Authentication > Sign-in method.';
    default:
      if (/RESOURCE_EXHAUSTED|quota exceeded/i.test(message)) {
        return 'Firebase auth quota is temporarily exhausted. Please wait a bit and try again.';
      }

      return message || 'Authentication failed.';
  }
}

export function getAuthDevDiagnostics(error: unknown) {
  if (APP_ENV === 'production') {
    return [] as string[];
  }

  const message =
    typeof (error as { message?: string })?.message === 'string'
      ? (error as { message: string }).message
      : '';
  const code = typeof (error as { code?: string })?.code === 'string'
    ? (error as { code: string }).code
    : '';

  const diagnostics: string[] = [
    `Active Firebase project: ${FIREBASE_PROJECT_LABEL}`,
  ];

  if (missingFirebaseEnv.length) {
    diagnostics.push(`Missing public Firebase env vars: ${missingFirebaseEnv.join(', ')}`);
  }

  if (code === 'auth/operation-not-allowed') {
    diagnostics.push('DEV action needed: enable Email/Password in Firebase Console > Authentication > Sign-in method for this DEV project.');
  }

  if (/secure session|session/i.test(message)) {
    diagnostics.push('Session route failed after Firebase sign-in. Check server env vars, Firebase Admin credentials, and /api/auth/session logs.');
  }

  if (/quota exceeded|resource_exhausted/i.test(message)) {
    diagnostics.push('Firebase is throttling this project right now. Reduce repeated login attempts and verify you are testing on the DEV project only.');
  }

  return diagnostics;
}
