'use client';

import { Capacitor } from '@capacitor/core';

type NativeFirebaseAuthenticationPlugin = {
  signInWithGoogle?: () => Promise<{
    user?: {
      displayName?: string | null;
      email?: string | null;
    } | null;
    credential?: {
      accessToken?: string | null;
      idToken?: string | null;
    } | null;
  }>;
  getIdToken?: () => Promise<{ token?: string | null }>;
  signOut?: () => Promise<void>;
};

export function isNativeAndroidApp() {
  return (
    typeof window !== 'undefined' &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'android'
  );
}

export function getNativeFirebaseAuthentication() {
  if (typeof window === 'undefined') {
    return null;
  }

  const windowCapacitor = (window as typeof window & {
    Capacitor?: { Plugins?: Record<string, unknown> };
  }).Capacitor;
  const capacitorWithPlugins = Capacitor as typeof Capacitor & {
    Plugins?: Record<string, unknown>;
  };

  return (
    windowCapacitor?.Plugins?.FirebaseAuthentication ||
    capacitorWithPlugins.Plugins?.FirebaseAuthentication ||
    null
  ) as NativeFirebaseAuthenticationPlugin | null;
}
