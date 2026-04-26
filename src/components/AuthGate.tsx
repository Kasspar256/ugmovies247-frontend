'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  clearAuthStatusCache,
  fetchAuthStatus,
  readCachedAuthStatus,
} from '@/lib/auth/status-client';
import { logoutCurrentUser } from '@/lib/auth/client';
import { isLegalRoute } from '@/lib/legalRoutes';

const AUTH_SESSION_HEARTBEAT_MS = 1000 * 20;

const AUTH_FREE_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/admin',
  '/mobile-checkout',
];

function isAuthFreePath(pathname: string) {
  return (
    pathname === '/' ||
    isLegalRoute(pathname) ||
    AUTH_FREE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

function getLoginReason(reason?: 'session_replaced' | 'session_revoked' | 'session_missing') {
  if (reason === 'session_replaced') {
    return 'session-replaced';
  }

  if (reason === 'session_revoked') {
    return 'session-revoked';
  }

  return 'session-missing';
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const redirectingRef = useRef(false);

  const shouldSkip = useMemo(() => isAuthFreePath(pathname), [pathname]);

  useEffect(() => {
    if (shouldSkip) {
      redirectingRef.current = false;
    }
  }, [shouldSkip]);

  useEffect(() => {
    if (shouldSkip) {
      return;
    }

    let active = true;

    const redirectToLogin = async (reason?: 'session_replaced' | 'session_revoked' | 'session_missing') => {
      if (!active || redirectingRef.current) {
        return;
      }

      redirectingRef.current = true;
      clearAuthStatusCache();

      if (reason === 'session_replaced' || reason === 'session_revoked') {
        await logoutCurrentUser().catch(async () => {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
          }).catch(() => undefined);
        });
      }

      const redirectTarget = pathname || '/';
      const search = new URLSearchParams({
        redirect: redirectTarget,
      });

      if (reason) {
        search.set('reason', getLoginReason(reason));
      }

      router.replace(`/login?${search.toString()}`);
    };

    const sendHeartbeat = async () => {
      if (!active || redirectingRef.current || document.visibilityState !== 'visible') {
        return;
      }

      try {
        const response = await fetch('/api/auth/heartbeat', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
        });

        if (response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          reason?: 'session_replaced' | 'session_revoked' | 'session_missing';
        };

        await redirectToLogin(payload.reason || 'session_missing');
      } catch (error) {
        console.warn('[auth-gate] heartbeat failed', error);
      }
    };

    const checkSession = async () => {
      const cachedStatus = readCachedAuthStatus();

      if (cachedStatus) {
        if (!cachedStatus.authenticated) {
          await redirectToLogin(cachedStatus.reason);
          return;
        }

        void sendHeartbeat();
        return;
      }

      const status = await fetchAuthStatus({ force: true }).catch(() => ({
        authenticated: false,
        reason: 'session_missing' as const,
      }));

      if (!active) {
        return;
      }

      if (status.authenticated) {
        return;
      }

      await redirectToLogin(status.reason);
    };

    void checkSession();

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void sendHeartbeat();
      }
    }, AUTH_SESSION_HEARTBEAT_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void sendHeartbeat();
      }
    };

    const handleFocus = () => {
      void sendHeartbeat();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pathname, router, shouldSkip]);

  return <>{children}</>;
}
