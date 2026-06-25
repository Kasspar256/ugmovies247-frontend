'use client';

import { Capacitor } from '@capacitor/core';

type NativeFirebaseAuthenticationPlugin = {
  signInWithGoogle?: (options?: { useCredentialManager?: boolean }) => Promise<{
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
  if (typeof window === 'undefined' || !isNativeAndroidApp()) {
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

export async function loadNativeFirebaseAuthentication() {
  if (!isNativeAndroidApp()) {
    return null;
  }

  const registeredPlugin = getNativeFirebaseAuthentication();

  if (registeredPlugin?.signInWithGoogle) {
    return registeredPlugin;
  }

  try {
    const module = await import('@capacitor-firebase/authentication');

    return module.FirebaseAuthentication as NativeFirebaseAuthenticationPlugin;
  } catch {
    return registeredPlugin;
  }
}
