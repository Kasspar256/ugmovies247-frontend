'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !window.isSecureContext
    ) {
      return;
    }

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
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
