import { NextResponse } from 'next/server';
import { AUTH_ROLE_COOKIE, AUTH_SESSION_COOKIE, getAuthCookieConfig } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEGACY_AUTH_SESSION_COOKIE = 'ugm_session';
const LEGACY_AUTH_ROLE_COOKIE = 'ugm_role';

export async function POST() {
  const response = NextResponse.json({ success: true });

  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    ...getAuthCookieConfig(),
    maxAge: 0,
  });
  response.cookies.set(AUTH_ROLE_COOKIE, '', {
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

  return response;
}
