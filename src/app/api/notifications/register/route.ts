import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession({ hydrateUserRecord: true });

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || '').trim();
    const platform = String(body.platform || 'android').trim() || 'android';

    if (!token || token.length < 20) {
      return NextResponse.json({ error: 'A valid push token is required.' }, { status: 400 });
    }

    const { adminDb } = await import('@/lib/firebaseAdmin');
    const now = new Date().toISOString();
    const tokenHash = hashToken(token);
    const tokenRef = adminDb.collection('push_tokens').doc(`${session.uid}_${tokenHash}`);

    await tokenRef.set(
      {
        userId: session.uid,
        email: session.email,
        token,
        tokenHash,
        platform,
        isActive: true,
        lastRegisteredAt: now,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );

    await adminDb.collection('users').doc(session.uid).set(
      {
        pushNotifications: {
          enabled: true,
          latestTokenHash: tokenHash,
          platform,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[notifications] failed to register push token', error);
    return NextResponse.json({ error: 'Push registration failed.' }, { status: 500 });
  }
}
