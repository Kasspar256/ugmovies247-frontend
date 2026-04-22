import { NextResponse } from 'next/server';
import {
  AUTH_DEVICE_COOKIE,
  AUTH_DEVICE_SESSION_COOKIE,
  getAuthCookieConfig,
  getRequestAuthSessionValidation,
  recoverManagedAuthSessionFromRequest,
} from '@/lib/auth/server';
import { AUTH_DEVICE_COOKIE_MAX_AGE_MS } from '@/lib/auth/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const validation = await getRequestAuthSessionValidation(request);

  if (!validation.session) {
    if (validation.reason === 'session_missing') {
      const recovered = await recoverManagedAuthSessionFromRequest(request, {
        hydrateUserRecord: false,
      });

      if (recovered.session && recovered.managedSession) {
        const response = NextResponse.json({
          authenticated: true,
          user: {
            id: recovered.session.uid,
            name: recovered.session.userRecord.name,
            email: recovered.session.userRecord.email,
            role: recovered.session.userRecord.role,
          },
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

  return NextResponse.json({
    authenticated: true,
    user: {
      id: validation.session.uid,
      name: validation.session.userRecord.name,
      email: validation.session.userRecord.email,
      role: validation.session.userRecord.role,
    },
  });
}
