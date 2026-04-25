import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { sendPasswordResetTransactionalEmail } from '@/lib/server/transactionalEmails';

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

    if (!email) {
      return NextResponse.json({ error: 'Enter the email address linked to your account.' }, { status: 400 });
    }

    const ipRateLimit = checkRateLimit(`auth-reset:ip:${ip}`, {
      limit: 5,
      windowMs: 1000 * 60 * 20,
    });
    const emailRateLimit = checkRateLimit(`auth-reset:email:${email}`, {
      limit: 3,
      windowMs: 1000 * 60 * 20,
    });

    if (!ipRateLimit.allowed || !emailRateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many reset attempts. Please wait and try again.', code: 'auth/too-many-requests' },
        { status: 429 }
      );
    }

    const firebaseUser = await adminAuth.getUserByEmail(email).catch(() => null);

    if (!firebaseUser) {
      return NextResponse.json({
        success: true,
        message: 'Password reset email sent. Check your inbox and spam folder.',
      });
    }

    const userSnapshot = await adminDb.collection('users').doc(firebaseUser.uid).get();
    const userData = userSnapshot.data() as { name?: string; emailVerified?: boolean } | undefined;
    const emailVerified = firebaseUser.emailVerified === true || userData?.emailVerified === true;

    if (!emailVerified) {
      return NextResponse.json(
        {
          error: 'Please verify your email before resetting your password.',
          code: 'auth/email-not-verified',
        },
        { status: 403 }
      );
    }

    await sendPasswordResetTransactionalEmail({
      id: firebaseUser.uid,
      name: userData?.name || firebaseUser.displayName || 'User',
      email,
    });

    return NextResponse.json({
      success: true,
      message: 'Password reset email sent. Check your inbox and spam folder.',
    });
  } catch (error) {
    console.error('[auth] password reset failed', error);
    const authError = error as Error & { code?: string; status?: number };
    return NextResponse.json(
      {
        error: authError.message || 'Failed to send reset email.',
        code: authError.code || 'auth/request-failed',
      },
      { status: authError.status || 400 }
    );
  }
}
