'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  clearAuthStatusCache,
  fetchAuthStatus,
  readCachedAuthStatus,
  type ClientAuthStatus,
} from '@/lib/auth/status-client';
import { logoutCurrentUser, restoreServerSessionFromClientAuth } from '@/lib/auth/client';
import { getHydratedClientDeviceHeaders } from '@/lib/auth/deviceIdentity';
import { notifyLocalPremiumAccessUpdated, readLocalPremiumAccessSnapshot } from '@/lib/clientAccessState';
import { isLegalRoute } from '@/lib/legalRoutes';

const AUTH_SESSION_HEARTBEAT_MS = 1000 * 20;

const AUTH_FREE_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/admin',
  '/movie',
  '/cardspayments',
  '/mobile-checkout',
  '/profile',
  '/subscribe',
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
    notifyLocalPremiumAccessUpdated();

    const syncLocalAccess = () => {
      readLocalPremiumAccessSnapshot();
      notifyLocalPremiumAccessUpdated();
    };

    window.addEventListener('storage', syncLocalAccess);
    window.addEventListener('focus', syncLocalAccess);

    return () => {
      window.removeEventListener('storage', syncLocalAccess);
      window.removeEventListener('focus', syncLocalAccess);
    };
  }, []);

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
          headers: await getHydratedClientDeviceHeaders(),
          credentials: 'include',
          cache: 'no-store',
        });

        if (response.ok) {
          notifyLocalPremiumAccessUpdated();
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          reason?: 'session_replaced' | 'session_revoked' | 'session_missing';
        };

        if (payload.reason === 'session_replaced' || payload.reason === 'session_revoked') {
          await redirectToLogin(payload.reason);
          return;
        }

        const restoredSession = await restoreServerSessionFromClientAuth().catch(() => null);

        if (restoredSession) {
          notifyLocalPremiumAccessUpdated();
          return;
        }

        const status = await fetchAuthStatus({ force: true });

        if (status.authenticated) {
          notifyLocalPremiumAccessUpdated();
          return;
        }

        if (status.reason === 'session_replaced' || status.reason === 'session_revoked') {
          await redirectToLogin(status.reason);
        }
      } catch (error) {
        console.warn('[auth-gate] heartbeat failed', error);
      }
    };

    const checkSession = async () => {
      const cachedStatus = readCachedAuthStatus();

      if (cachedStatus) {
        if (!cachedStatus.authenticated) {
          if (
            cachedStatus.reason === 'session_replaced' ||
            cachedStatus.reason === 'session_revoked'
          ) {
            await redirectToLogin(cachedStatus.reason);
            return;
          }

          if (readLocalPremiumAccessSnapshot().hasPremiumAccess) {
            notifyLocalPremiumAccessUpdated();
            void sendHeartbeat();
            return;
          }

          await redirectToLogin(cachedStatus.reason);
          return;
        }

        notifyLocalPremiumAccessUpdated();
        void sendHeartbeat();
        return;
      }

      const status = await fetchAuthStatus({ force: true }).catch(async (error) => {
        console.warn('[auth-gate] background auth status refresh failed', error);

        const restoredSession = await restoreServerSessionFromClientAuth().catch(() => null);

        if (restoredSession) {
          notifyLocalPremiumAccessUpdated();
          return {
            authenticated: true,
            code: 'offline_restored_session',
          } as ClientAuthStatus;
        }

        return null;
      });

      if (!active) {
        return;
      }

      if (!status) {
        return;
      }

      if (status.authenticated) {
        notifyLocalPremiumAccessUpdated();
        return;
      }

      if (status.reason === 'session_replaced' || status.reason === 'session_revoked') {
        await redirectToLogin(status.reason);
        return;
      }

      if (readLocalPremiumAccessSnapshot().hasPremiumAccess) {
        notifyLocalPremiumAccessUpdated();
        return;
      }

      const restoredSession = await restoreServerSessionFromClientAuth().catch(() => null);

      if (restoredSession) {
        notifyLocalPremiumAccessUpdated();
        return;
      }

      if (!readCachedAuthStatus()) {
        await redirectToLogin(status.reason);
      }
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
