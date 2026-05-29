'use client';

import { useEffect } from 'react';

function isNativeAppShell() {
  if (typeof window === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  const capacitor = (window as typeof window & {
    Capacitor?: { isNativePlatform?: () => boolean };
  }).Capacitor;
  let isCapacitorNative = false;

  if (capacitor && typeof capacitor.isNativePlatform === 'function') {
    isCapacitorNative = Boolean(capacitor.isNativePlatform());
  }

  return userAgent.indexOf('Ugmovies247App') !== -1 || isCapacitorNative;
}

function clearUgmServiceWorkersAndCaches() {
  const tasks: Promise<unknown>[] = [];

  if ('serviceWorker' in navigator) {
    tasks.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined)
    );
  }

  if ('caches' in window) {
    tasks.push(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith('ugmovies247-'))
              .map((key) => caches.delete(key))
          )
        )
        .catch(() => undefined)
    );
  }

  return Promise.all(tasks);
}

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !window.isSecureContext
    ) {
      return;
    }

    if (process.env.NODE_ENV !== 'production' || isNativeAppShell()) {
      void clearUgmServiceWorkersAndCaches().catch(() => undefined);
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        void registration.update().catch(() => undefined);
      } catch (error) {
        console.warn('[service-worker] registration failed', error);
      }
    };

    if (document.readyState === 'complete') {
      void register();
      return;
    }

    window.addEventListener('load', register, { once: true });

    return () => {
      window.removeEventListener('load', register);
    };
  }, []);

  return null;
}
