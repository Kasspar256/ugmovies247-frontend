'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const AUTH_FREE_PREFIXES = ['/login', '/signup', '/forgot-password', '/admin'];

function isAuthFreePath(pathname: string) {
  return AUTH_FREE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const shouldSkip = useMemo(() => isAuthFreePath(pathname), [pathname]);

  useEffect(() => {
    let active = true;

    if (shouldSkip) {
      setReady(true);
      return () => {
        active = false;
      };
    }

    setReady(false);

    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!active) {
          return;
        }

        if (response.ok) {
          setReady(true);
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

  if (shouldSkip) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4" />
        <p className="text-sm font-bold tracking-[0.28em] uppercase text-white/80">
          Checking Session
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
