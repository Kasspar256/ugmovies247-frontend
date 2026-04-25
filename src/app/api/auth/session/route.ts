import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { createAuthSessionResponse, normalizeAuthRouteError } from '@/lib/server/firebaseIdentity';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { sendProviderWelcomeEmail } from '@/lib/server/transactionalEmails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: Request) {
  try {
    const ip = getRequestIp(request);
    const rateLimit = checkRateLimit(`auth-session:${ip}`, {
      limit: 20,
      windowMs: 1000 * 60 * 10,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many authentication attempts. Please wait and try again.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const idToken = String(body.idToken || '');
    const requestedName = String(body.name || '').trim();
    const rememberMe = body.rememberMe !== false;

    if (!idToken) {
      return NextResponse.json({ error: 'Missing authentication token.' }, { status: 400 });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = String(decoded.email || '').trim().toLowerCase();
    const provider = decoded.firebase.sign_in_provider || 'password';
    const existingUserSnapshot = await adminDb.collection('users').doc(decoded.uid).get();
    const shouldSendProviderWelcome = Boolean(email && provider !== 'password' && !existingUserSnapshot.exists);

    const response = await createAuthSessionResponse({
      request,
      idToken,
      requestedName,
      rememberMe,
    });

    if (response.status < 400 && shouldSendProviderWelcome) {
      await sendProviderWelcomeEmail({
        id: decoded.uid,
        name: requestedName || (typeof decoded.name === 'string' ? decoded.name : '') || 'User',
        email,
      });
    }

    return response;
  } catch (error) {
    console.error('[auth] session creation failed', error);
    const authError = normalizeAuthRouteError(error, {
      message: 'We could not finish signing you in right now. Please try again.',
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
