import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { createAuthSessionResponse, signUpWithPasswordServer } from '@/lib/server/firebaseIdentity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || 'unknown';
}

export async function POST(request: Request) {
  try {
    const ip = getRequestIp(request);
    const body = await request.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!name) {
      return NextResponse.json({ error: 'Enter your name.' }, { status: 400 });
    }

    if (!email) {
      return NextResponse.json({ error: 'Enter your email address.' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long.', code: 'auth/weak-password' },
        { status: 400 }
      );
    }

    const ipRateLimit = checkRateLimit(`auth-signup:ip:${ip}`, {
      limit: 6,
      windowMs: 1000 * 60 * 20,
    });
    const emailRateLimit = checkRateLimit(`auth-signup:email:${email}`, {
      limit: 4,
      windowMs: 1000 * 60 * 20,
    });

    if (!ipRateLimit.allowed || !emailRateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please wait and try again.', code: 'auth/too-many-requests' },
        { status: 429 }
      );
    }

    const payload = await signUpWithPasswordServer({ name, email, password });
    const idToken = String(payload.idToken || '');

    if (!idToken) {
      return NextResponse.json({ error: 'Missing Firebase authentication token.' }, { status: 502 });
    }

    return createAuthSessionResponse({ idToken, requestedName: name, rememberMe: true });
  } catch (error) {
    console.error('[auth] signup failed', error);
    const authError = error as Error & { code?: string; status?: number };
    return NextResponse.json(
      {
        error: authError.message || 'Authentication failed.',
        code: authError.code || 'auth/request-failed',
      },
      { status: authError.status || 400 }
    );
  }
}

