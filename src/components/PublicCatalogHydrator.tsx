'use client';

import { useEffect } from 'react';
import { fetchHomePageCategories } from '@/lib/homePageClient';
import {
  fetchPublicMovies,
  refreshPublicMoviesInBackground,
  readCachedPublicMovies,
} from '@/lib/publicMovies';

export default function PublicCatalogHydrator() {
  useEffect(() => {
    let cancelled = false;
    let removeListeners: (() => void) | null = null;

    const startHydration = () => {
      if (cancelled) {
        return;
      }

      const hasCachedCatalog = readCachedPublicMovies().length > 0;

      if (hasCachedCatalog) {
        refreshPublicMoviesInBackground();
      } else {
        void fetchPublicMovies({ refreshEntitlement: true }).catch(() => undefined);
      }

      void fetchHomePageCategories().catch(() => undefined);

      const refresh = () => {
        if (document.visibilityState && document.visibilityState !== 'visible') {
          return;
        }

        refreshPublicMoviesInBackground();
        void fetchHomePageCategories().catch(() => undefined);
      };

      window.addEventListener('focus', refresh);
      window.addEventListener('pageshow', refresh);
      document.addEventListener('visibilitychange', refresh);

      removeListeners = () => {
        window.removeEventListener('focus', refresh);
        window.removeEventListener('pageshow', refresh);
        document.removeEventListener('visibilitychange', refresh);
      };
    };

    const timer = window.setTimeout(startHydration, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      removeListeners?.();
    };
  }, []);

  return null;
}
