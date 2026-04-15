'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fetchAuthStatus } from '@/lib/auth/status-client';

const AUTH_FREE_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/admin',
  '/terms',
  '/privacy-policy',
  '/dcma',
];

function isAuthFreePath(pathname: string) {
  return AUTH_FREE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const shouldSkip = useMemo(() => isAuthFreePath(pathname), [pathname]);

  useEffect(() => {
    let active = true;

    if (shouldSkip) {
      return () => {
        active = false;
      };
    }

    const checkSession = async () => {
      try {
        const status = await fetchAuthStatus();

        if (!active) {
          return;
        }

        if (status.authenticated) {
          return;
        }
      } catch (error) {
        console.warn('[auth-gate] session check failed', error);
      }

      if (!active) {
        return;
      }

      const redirectTarget = pathname || '/';
      router.replace(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
    };

    void checkSession();

    return () => {
      active = false;
    };
  }, [pathname, router, shouldSkip]);

  return <>{children}</>;
}
