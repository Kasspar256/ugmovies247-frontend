import { NextResponse } from 'next/server';
import { APP_REVIEW_SESSION_COOKIE } from '@/lib/appReview';
import {
  AUTH_DEVICE_SESSION_COOKIE,
  AUTH_ROLE_COOKIE,
  AUTH_SESSION_COOKIE,
  getAuthCookieConfig,
  getRequestAuthSession,
} from '@/lib/auth/server';
import { endManagedAuthSession } from '@/lib/server/authSessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEGACY_AUTH_SESSION_COOKIE = 'ugm_session';
const LEGACY_AUTH_ROLE_COOKIE = 'ugm_role';

export async function POST(request: Request) {
  const session = await getRequestAuthSession(request);
  const response = NextResponse.json({ success: true });

  if (session) {
    await endManagedAuthSession({
      request,
      userId: session.uid,
      endedReason: 'logout',
    }).catch((error) => {
      console.warn('[auth] failed to end managed auth session during logout', error);
    });
  }

  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    ...getAuthCookieConfig(),
    maxAge: 0,
  });
  response.cookies.set(AUTH_ROLE_COOKIE, '', {
    ...getAuthCookieConfig(),
    maxAge: 0,
  });
  response.cookies.set(AUTH_DEVICE_SESSION_COOKIE, '', {
    ...getAuthCookieConfig(),
    maxAge: 0,
  });
  response.cookies.set(LEGACY_AUTH_SESSION_COOKIE, '', {
    ...getAuthCookieConfig(),
    maxAge: 0,
  });
  response.cookies.set(LEGACY_AUTH_ROLE_COOKIE, '', {
    ...getAuthCookieConfig(),
    maxAge: 0,
  });
  response.cookies.set(APP_REVIEW_SESSION_COOKIE, '', {
    ...getAuthCookieConfig(),
    httpOnly: false,
    maxAge: 0,
  });

  return response;
}
