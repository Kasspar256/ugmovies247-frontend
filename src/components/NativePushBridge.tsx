'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { initializeNativePushNotifications } from '@/lib/mobile/pushNotifications';

async function isAuthenticated() {
  const response = await fetch('/api/auth/status', {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    return false;
  }

  const payload = (await response.json().catch(() => ({}))) as { authenticated?: boolean };
  return payload.authenticated === true;
}

export default function NativePushBridge() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const registerIfSignedIn = async () => {
      if (!active || !(await isAuthenticated().catch(() => false))) {
        return;
      }

      await initializeNativePushNotifications((path) => {
        router.push(path);
      });
    };

    void registerIfSignedIn();

    const interval = window.setInterval(() => {
      void registerIfSignedIn();
    }, 10_000);

    window.addEventListener('focus', registerIfSignedIn);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', registerIfSignedIn);
    };
  }, [router]);

  return null;
}
