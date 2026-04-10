import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

export const missingFirebaseEnv = [
  !firebaseConfig.apiKey ? 'NEXT_PUBLIC_FIREBASE_API_KEY' : null,
  !firebaseConfig.authDomain ? 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN' : null,
  !firebaseConfig.projectId ? 'NEXT_PUBLIC_FIREBASE_PROJECT_ID' : null,
  !firebaseConfig.storageBucket ? 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET' : null,
  !firebaseConfig.messagingSenderId ? 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID' : null,
  !firebaseConfig.appId ? 'NEXT_PUBLIC_FIREBASE_APP_ID' : null,
].filter(Boolean) as string[];

for (const envKey of missingFirebaseEnv) {
  console.warn(`[firebase] Missing environment variable: ${envKey}`);
}

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
