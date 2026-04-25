import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { consumePasswordResetToken } from '@/lib/server/emailTokens';
import { sendPasswordChangedEmail } from '@/lib/server/transactionalEmails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = String(body.token || '').trim();
    const password = String(body.password || '');

    if (!token) {
      return NextResponse.json({ error: 'Missing password reset token.' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters long.' }, { status: 400 });
    }

    const consumed = await consumePasswordResetToken(token);

    if (!consumed.ok) {
      return NextResponse.json(
        { error: 'This password reset link is invalid or has expired.' },
        { status: 400 }
      );
    }

    await adminAuth.updateUser(consumed.token.userId, { password });
    await adminAuth.revokeRefreshTokens(consumed.token.userId).catch(() => undefined);

    const userSnapshot = await adminDb.collection('users').doc(consumed.token.userId).get();
    const userData = userSnapshot.data() as { name?: string } | undefined;

    void sendPasswordChangedEmail({
      id: consumed.token.userId,
      name: userData?.name || 'User',
      email: consumed.token.email,
    });

    return NextResponse.json({
      success: true,
      message: 'Your password has been changed successfully.',
    });
  } catch (error) {
    console.error('[auth] password reset confirmation failed', error);
    return NextResponse.json(
      { error: 'Password reset could not be completed.' },
      { status: 500 }
    );
  }
}

