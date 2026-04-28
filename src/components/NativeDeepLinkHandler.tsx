'use client';

import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useRouter } from 'next/navigation';

function getSafePathFromUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);

    if (!['ugmovies247.com', 'www.ugmovies247.com'].includes(url.hostname)) {
      return null;
    }

    return `${url.pathname || '/'}${url.search || ''}${url.hash || ''}`;
  } catch {
    return null;
  }
}

export default function NativeDeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let removeListener: (() => void) | undefined;

    App.addListener('appUrlOpen', (event) => {
      const path = getSafePathFromUrl(event.url);

      if (path) {
        router.push(path);
      }
    }).then((listener) => {
      removeListener = () => {
        void listener.remove();
      };
    });

    return () => {
      removeListener?.();
    };
  }, [router]);

  return null;
}
