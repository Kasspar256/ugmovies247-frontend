import { NextResponse } from 'next/server';
import {
  AUTH_DEVICE_COOKIE,
  AUTH_DEVICE_SESSION_COOKIE,
  getAuthCookieConfig,
  getRequestAuthSessionValidation,
  recoverManagedAuthSessionFromRequest,
} from '@/lib/auth/server';
import { AUTH_DEVICE_COOKIE_MAX_AGE_MS, AUTH_SESSION_MAX_AGE_MS } from '@/lib/auth/constants';
import {
  AUTH_DEVICE_LIMIT_EXCEEDED_CODE,
  AUTH_DEVICE_LIMIT_EXCEEDED_MESSAGE,
  DeviceLimitExceededError,
  touchManagedAuthSession,
} from '@/lib/server/authSessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const validation = await getRequestAuthSessionValidation(request);

    if (!validation.session) {
      if (validation.reason === 'session_missing') {
        const recovered = await recoverManagedAuthSessionFromRequest(request, {
          hydrateUserRecord: false,
        });

        if (recovered.session && recovered.managedSession) {
          const sessionExpiresAt = new Date(Date.now() + AUTH_SESSION_MAX_AGE_MS);
          const response = NextResponse.json({
            success: true,
            authenticated: true,
          });

          response.cookies.set(AUTH_DEVICE_COOKIE, recovered.managedSession.deviceCookieValue, {
            ...getAuthCookieConfig(),
            maxAge: AUTH_DEVICE_COOKIE_MAX_AGE_MS / 1000,
            expires: new Date(Date.now() + AUTH_DEVICE_COOKIE_MAX_AGE_MS),
          });
          response.cookies.set(
            AUTH_DEVICE_SESSION_COOKIE,
            recovered.managedSession.sessionCookieValue,
            {
              ...getAuthCookieConfig(),
              maxAge: AUTH_SESSION_MAX_AGE_MS / 1000,
              expires: sessionExpiresAt,
            }
          );

          return response;
        }
      }

      return NextResponse.json(
        {
          authenticated: false,
          reason: validation.reason || 'session_missing',
        },
        { status: 401 }
      );
    }

    const touched = await touchManagedAuthSession({
      request,
      userId: validation.session.uid,
    });

    if (!touched.valid) {
      return NextResponse.json(
        {
          authenticated: false,
          reason: 'reason' in touched ? touched.reason : 'session_missing',
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      authenticated: true,
      lastActivityAt: touched.record.lastActivityAt,
    });
  } catch (error) {
    if (
      error instanceof DeviceLimitExceededError ||
      (error as { code?: string })?.code === AUTH_DEVICE_LIMIT_EXCEEDED_CODE
    ) {
      return NextResponse.json(
        {
          authenticated: false,
          reason: 'session_missing',
          code: AUTH_DEVICE_LIMIT_EXCEEDED_CODE,
          error: AUTH_DEVICE_LIMIT_EXCEEDED_MESSAGE,
        },
        { status: 409 }
      );
    }

    console.error('[auth] heartbeat failed', error);
    return NextResponse.json(
      { error: 'Could not refresh the active session.' },
      { status: 500 }
    );
  }
}
