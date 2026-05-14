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
    case 'auth/device-limit-exceeded':
      return 'This account is already active on the maximum number of allowed devices. Please log out from another device and try again.';
    case 'auth/session-not-established':
      return "We couldn't complete your sign-in. Please try again.";
    case 'auth/session-replaced':
      return 'Your session has ended because this account was signed in on another device.';
    case 'auth/session-revoked':
      return 'Your session has ended. Please sign in again to continue.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is disabled for the active Firebase project. Enable it in Firebase Console > Authentication > Sign-in method.';
    case 'auth/popup-blocked':
      return 'Google sign-in could not open on this device. Please try again, or use email sign-in below.';
    case 'auth/native-google-unavailable':
      return 'Google sign-in needs the latest app update on this device. Please use email sign-in for now, or update the app and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/user-cancelled':
    case 'auth/redirect-cancelled-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled. You can try again whenever you are ready.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google sign-in in Firebase Authentication settings.';
    case 'auth/account-exists-with-different-credential':
      return 'An account with this email already exists with a different sign-in method.';
    case 'auth/network-request-failed':
      return 'Network request failed. Check your internet connection and try again.';
    default:
      if (/doesn'?t support credential manager|credential manager/i.test(message)) {
        return 'Google sign-in is not available on this device right now. Please sign in with email below, or update Google Play services and try Google again.';
      }

      if (/no credentials available|no credential/i.test(message)) {
        return 'Google did not return an account on this device. Try Google again and choose an account, or sign in with email below.';
      }

      if (/idp denied access|user refuses|user denied|permission|user-cancelled|cancelled/i.test(message)) {
        return 'Google sign-in was cancelled. You can try again whenever you are ready.';
      }

      if (/missing initial state|sessionStorage|signInWithRedirect|storage-partitioned/i.test(message)) {
        return 'Google sign-in could not be completed in this browser session. Please return to the app and try again.';
      }

      if (/maximum number of allowed devices|maximum number of devices/i.test(message)) {
        return 'This account is already active on the maximum number of allowed devices. Please log out from another device and try again.';
      }

      if (/RESOURCE_EXHAUSTED|quota exceeded/i.test(message)) {
        return 'Firebase auth quota is temporarily exhausted. Please wait a bit and try again.';
      }

      return message || "We couldn't sign you in right now. Please try again.";
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
