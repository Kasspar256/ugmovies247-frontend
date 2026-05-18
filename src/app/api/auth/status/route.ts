import { NextResponse } from 'next/server';
import {
  AUTH_DEVICE_COOKIE,
  AUTH_DEVICE_SESSION_COOKIE,
  getAuthCookieConfig,
  getCurrentAuthSession,
  getRequestAuthSessionValidation,
  recoverManagedAuthSessionFromRequest,
} from '@/lib/auth/server';
import { AUTH_DEVICE_COOKIE_MAX_AGE_MS, AUTH_SESSION_MAX_AGE_MS } from '@/lib/auth/constants';
import {
  AUTH_DEVICE_LIMIT_EXCEEDED_CODE,
  AUTH_DEVICE_LIMIT_EXCEEDED_MESSAGE,
  DeviceLimitExceededError,
} from '@/lib/server/authSessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const validation = await getRequestAuthSessionValidation(request);

    if (!validation.session) {
      if (validation.reason === 'session_missing') {
        const recovered = await recoverManagedAuthSessionFromRequest(request, {
          hydrateUserRecord: true,
        });

        if (recovered.session && recovered.managedSession) {
          const sessionExpiresAt = new Date(Date.now() + AUTH_SESSION_MAX_AGE_MS);
          const response = NextResponse.json({
            authenticated: true,
            user: {
              id: recovered.session.uid,
              name: recovered.session.userRecord.name,
              email: recovered.session.userRecord.email,
              role: recovered.session.userRecord.role,
              emailVerified: recovered.session.userRecord.emailVerified === true,
            },
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

    const hydratedSession = await getCurrentAuthSession({ hydrateUserRecord: true }).catch(() => null);
    const session = hydratedSession || validation.session;

    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.uid,
        name: session.userRecord.name,
        email: session.userRecord.email,
        role: session.userRecord.role,
        emailVerified: session.userRecord.emailVerified === true,
      },
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

    console.error('[auth] status failed', error);
    return NextResponse.json(
      {
        authenticated: false,
        reason: 'session_missing',
        error: 'Could not verify the current session.',
      },
      { status: 500 }
    );
  }
}
