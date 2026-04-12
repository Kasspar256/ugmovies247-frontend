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
      return 'This sign-in method is disabled for the active Firebase project. Enable it in Firebase Console > Authentication > Sign-in method.';
    case 'auth/popup-blocked':
      return 'The Google sign-in popup was blocked. Allow popups or retry and the app will redirect you to Google.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was closed before it finished.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google sign-in in Firebase Authentication settings.';
    case 'auth/account-exists-with-different-credential':
      return 'An account with this email already exists with a different sign-in method.';
    case 'auth/network-request-failed':
      return 'Network request failed. Check your internet connection and try again.';
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
    diagnostics.push('DEV action needed: enable Email/Password and Google in Firebase Console > Authentication > Sign-in method for this DEV project.');
  }

  if (code === 'auth/unauthorized-domain') {
    diagnostics.push('DEV action needed: add your current domain to Firebase Console > Authentication > Settings > Authorized domains.');
  }

  if (/secure session|session/i.test(message)) {
    diagnostics.push('Session route failed after Firebase sign-in. Check server env vars, Firebase Admin credentials, and /api/auth/session logs.');
  }

  if (/quota exceeded|resource_exhausted/i.test(message)) {
    diagnostics.push('Firebase is throttling this project right now. Reduce repeated login attempts and verify you are testing on the DEV project only.');
  }

  return diagnostics;
}
