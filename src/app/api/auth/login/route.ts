import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/server/rateLimit';
import {
  createAuthSessionResponse,
  normalizeAuthRouteError,
  signInWithPasswordServer,
} from '@/lib/server/firebaseIdentity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || 'unknown';
}

export async function POST(request: Request) {
  try {
    const ip = getRequestIp(request);
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const rememberMe = body.rememberMe !== false;

    if (!email || !password) {
      return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
    }

    const ipRateLimit = checkRateLimit(`auth-login:ip:${ip}`, {
      limit: 10,
      windowMs: 1000 * 60 * 15,
    });
    const emailRateLimit = checkRateLimit(`auth-login:email:${email}`, {
      limit: 8,
      windowMs: 1000 * 60 * 15,
    });

    if (!ipRateLimit.allowed || !emailRateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait and try again.', code: 'auth/too-many-requests' },
        { status: 429 }
      );
    }

    const payload = await signInWithPasswordServer(email, password);
    const idToken = String(payload.idToken || '');

    if (!idToken) {
      return NextResponse.json({ error: 'Missing Firebase authentication token.' }, { status: 502 });
    }

    return createAuthSessionResponse({ request, idToken, rememberMe });
  } catch (error) {
    console.error('[auth] login failed', error);
    const authError = normalizeAuthRouteError(error, {
      message: 'We could not sign you in right now. Please try again.',
      status: 401,
    });

    return NextResponse.json(
      {
        error: authError.error,
        code: authError.code,
      },
      { status: authError.status }
    );
  }
}
