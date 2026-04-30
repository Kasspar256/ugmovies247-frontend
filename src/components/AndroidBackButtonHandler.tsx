'use client';

import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { Toast } from '@capacitor/toast';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { isNativeAndroidApp } from '@/lib/mobile/nativeApp';

const HOME_PATHS = new Set(['/', '/browse']);
const EXIT_PRESS_WINDOW_MS = 2000;

function isHomeRoute(pathname: string) {
  return HOME_PATHS.has(pathname);
}

export default function AndroidBackButtonHandler() {
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);
  const lastHomeBackPressRef = useRef(0);

  useEffect(() => {
    pathnameRef.current = pathname;

    if (!isHomeRoute(pathname)) {
      lastHomeBackPressRef.current = 0;
    }
  }, [pathname]);

  useEffect(() => {
    if (!isNativeAndroidApp()) {
      return;
    }

    let listener: PluginListenerHandle | null = null;
    let mounted = true;

    void App.addListener('backButton', async ({ canGoBack }) => {
      const currentPathname = pathnameRef.current || '/';

      if (isHomeRoute(currentPathname)) {
        const now = Date.now();

        if (now - lastHomeBackPressRef.current <= EXIT_PRESS_WINDOW_MS) {
          await App.exitApp();
          return;
        }

        lastHomeBackPressRef.current = now;
        await Toast.show({
          text: 'Press again to exit',
          duration: 'short',
          position: 'bottom',
        }).catch(() => undefined);
        return;
      }

      lastHomeBackPressRef.current = 0;

      if (canGoBack && typeof window !== 'undefined' && window.history.length > 1) {
        router.back();
        return;
      }

      router.replace('/browse');
    })
      .then((handle) => {
        if (!mounted) {
          void handle.remove();
          return;
        }

        listener = handle;
      })
      .catch((error) => {
        console.warn('[android-back-button] Failed to register back button listener.', error);
      });

    return () => {
      mounted = false;
      void listener?.remove();
    };
  }, [router]);

  return null;
}
