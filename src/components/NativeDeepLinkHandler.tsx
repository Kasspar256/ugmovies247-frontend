'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

function getSafePathFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.searchParams.get('path') || '/profile/payments';

    return path.startsWith('/') && !path.startsWith('//') ? path : '/profile/payments';
  } catch {
    return '/profile/payments';
  }
}

export default function NativeDeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let removed = false;
    let listener: { remove: () => Promise<void> } | null = null;

    App.addListener('appUrlOpen', ({ url }) => {
      router.replace(getSafePathFromUrl(url));
    }).then((nextListener) => {
      if (removed) {
        void nextListener.remove();
        return;
      }

      listener = nextListener;
    });

    return () => {
      removed = true;
      void listener?.remove();
    };
  }, [router]);

  return null;
}
