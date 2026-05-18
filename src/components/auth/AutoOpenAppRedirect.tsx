'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { restoreServerSessionFromClientAuth } from '@/lib/auth/client';
import { fetchAuthStatus, readCachedAuthStatus } from '@/lib/auth/status-client';
import { isNativeAndroidApp } from '@/lib/mobile/nativeApp';

function isStandaloneWebApp() {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function shouldShowOpeningScreen() {
  return isNativeAndroidApp() || isStandaloneWebApp() || readCachedAuthStatus()?.authenticated === true;
}

export default function AutoOpenAppRedirect() {
  const router = useRouter();
  const [opening, setOpening] = useState(() => shouldShowOpeningScreen());

  useEffect(() => {
    let active = true;

    const openAppIfSignedIn = async () => {
      const cachedStatus = readCachedAuthStatus();

      if (cachedStatus?.authenticated) {
        router.replace('/browse');
        return;
      }

      try {
        const status = await fetchAuthStatus({ force: true });

        if (!active) {
          return;
        }

        if (status.authenticated) {
          router.replace('/browse');
          return;
        }

        const restoredSession = await restoreServerSessionFromClientAuth().catch(() => null);

        if (!active) {
          return;
        }

        if (restoredSession) {
          router.replace(restoredSession.redirectTo || '/browse');
          return;
        }
      } finally {
        if (active) {
          setOpening(false);
        }
      }
    };

    void openAppIfSignedIn();

    return () => {
      active = false;
    };
  }, [router]);

  if (!opening) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0B0C10] px-6 text-white">
      <div className="flex flex-col items-center gap-5">
        <img
          src="/logow.png"
          alt="UGMOVIES247"
          className="h-24 w-auto scale-[1.85] object-contain drop-shadow-[0_0_42px_rgba(217,4,41,0.34)]"
        />
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-[#D90429]" />
      </div>
    </div>
  );
}
