import { NextResponse } from 'next/server';
import {
  AUTH_DEVICE_COOKIE,
  AUTH_DEVICE_SESSION_COOKIE,
  getAuthCookieConfig,
  getRequestAuthSessionValidation,
  recoverManagedAuthSessionFromRequest,
} from '@/lib/auth/server';
import { AUTH_DEVICE_COOKIE_MAX_AGE_MS } from '@/lib/auth/constants';
import { touchManagedAuthSession } from '@/lib/server/authSessions';

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
          const response = NextResponse.json({
            success: true,
            authenticated: true,
          });

          response.cookies.set(AUTH_DEVICE_COOKIE, recovered.managedSession.deviceCookieValue, {
            ...getAuthCookieConfig(),
            maxAge: AUTH_DEVICE_COOKIE_MAX_AGE_MS / 1000,
          });
          response.cookies.set(
            AUTH_DEVICE_SESSION_COOKIE,
            recovered.managedSession.sessionCookieValue,
            getAuthCookieConfig()
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
    console.error('[auth] heartbeat failed', error);
    return NextResponse.json(
      { error: 'Could not refresh the active session.' },
      { status: 500 }
    );
  }
}
