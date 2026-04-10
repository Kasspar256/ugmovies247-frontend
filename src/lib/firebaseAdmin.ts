import * as admin from 'firebase-admin';

let firebaseAdminInitError = '';
let firebaseAdminApp: admin.app.App | null = null;

function getFirebaseProjectId() {
  return process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
}

function getRequiredAdminEnvError() {
  if (!getFirebaseProjectId()) {
    return 'Missing FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID for Firebase Admin.';
  }

  if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return 'Missing Firebase Admin credentials. Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.';
  }

  return '';
}

try {
  const envError = getRequiredAdminEnvError();

  if (envError) {
    firebaseAdminInitError = envError;
  } else if (admin.apps.length) {
    firebaseAdminApp = admin.app();
  } else {
    firebaseAdminApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: getFirebaseProjectId(),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      projectId: getFirebaseProjectId(),
    });
  }
} catch (error) {
  console.error('Firebase admin initialization error', error);
  firebaseAdminInitError =
    error instanceof Error ? error.message : 'Unknown Firebase admin initialization error.';
}

export function getFirebaseAdminSetupError() {
  if (firebaseAdminInitError) {
    return firebaseAdminInitError;
  }

  if (!firebaseAdminApp && !admin.apps.length) {
    return 'Firebase Admin failed to initialize.';
  }

  return '';
}

function getActiveAdminApp() {
  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  if (admin.apps.length) {
    return admin.app();
  }

  throw new Error(getFirebaseAdminSetupError() || 'Firebase Admin is not initialized.');
}

export const adminDb = admin.firestore(getActiveAdminApp());
export const adminAuth = admin.auth(getActiveAdminApp());
