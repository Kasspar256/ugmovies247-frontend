'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';

const NAVIGATION_SCROLL_KEY = 'ugmovies247.navigation-scroll.v1';

function readScrollMap() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    return JSON.parse(window.sessionStorage.getItem(NAVIGATION_SCROLL_KEY) || '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function writeScrollPosition(key: string, value: number) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const scrollMap = readScrollMap();
    scrollMap[key] = value;
    window.sessionStorage.setItem(NAVIGATION_SCROLL_KEY, JSON.stringify(scrollMap));
  } catch {
    // Session scroll retention is best-effort only.
  }
}

function restoreScrollPosition(value: number) {
  let frameCount = 0;
  let frameHandle = 0;

  const restore = () => {
    window.scrollTo({ top: value, behavior: 'auto' });
    frameCount += 1;

    if (frameCount < 8 && Math.abs((window.scrollY || 0) - value) > 2) {
      frameHandle = window.requestAnimationFrame(restore);
    }
  };

  frameHandle = window.requestAnimationFrame(restore);

  return () => window.cancelAnimationFrame(frameHandle);
}

export default function NavigationStateRetainer() {
  const pathname = usePathname();
  const routeKey = useMemo(
    () =>
      typeof window === 'undefined'
        ? pathname || '/'
        : `${pathname || '/'}${window.location.search || ''}`,
    [pathname]
  );
  const lastRouteKeyRef = useRef(routeKey);

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    const previousRouteKey = lastRouteKeyRef.current;
    writeScrollPosition(previousRouteKey, window.scrollY || 0);
    lastRouteKeyRef.current = routeKey;

    const savedScrollY = readScrollMap()[routeKey];

    if (typeof savedScrollY === 'number' && savedScrollY > 0) {
      return restoreScrollPosition(savedScrollY);
    }

    return undefined;
  }, [routeKey]);

  useEffect(() => {
    const saveCurrentRoute = () => {
      writeScrollPosition(lastRouteKeyRef.current, window.scrollY || 0);
    };

    window.addEventListener('pagehide', saveCurrentRoute);
    window.addEventListener('beforeunload', saveCurrentRoute);
    window.addEventListener('visibilitychange', saveCurrentRoute);

    return () => {
      saveCurrentRoute();
      window.removeEventListener('pagehide', saveCurrentRoute);
      window.removeEventListener('beforeunload', saveCurrentRoute);
      window.removeEventListener('visibilitychange', saveCurrentRoute);
    };
  }, []);

  return null;
}
