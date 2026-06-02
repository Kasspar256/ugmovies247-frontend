import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getRequestAuthSession } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hashFcmToken(token: string) {
  return createHash('sha256').update(token).digest('hex').slice(0, 40);
}

export async function POST(request: Request) {
  try {
    const session = await getRequestAuthSession(request);

    if (!session) {
      return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      platform?: string;
    };
    const token = String(body.token || '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Missing FCM token.' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const platform = String(body.platform || 'android');
    const tokenHash = hashFcmToken(token);
    const userRef = adminDb.collection('users').doc(session.uid);
    const tokenRef = adminDb.collection('notification_tokens').doc(tokenHash);
    const batch = adminDb.batch();

    batch.set(
      userRef,
      {
        fcmToken: token,
        fcmTokenPlatform: platform,
        fcmTokenMap: {
          [tokenHash]: {
            token,
            platform,
            updatedAt: timestamp,
          },
        },
        fcmTokenUpdatedAt: timestamp,
        notificationsUpdatedAt: timestamp,
        emailLower: session.email.toLowerCase(),
        updatedAt: timestamp,
      },
      { merge: true }
    );
    batch.set(
      tokenRef,
      {
        tokenHash,
        token,
        userId: session.uid,
        userEmail: session.email,
        userEmailLower: session.email.toLowerCase(),
        platform,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastRegisteredAt: timestamp,
      },
      { merge: true }
    );

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[notifications] failed to register FCM token', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to register notification token.',
      },
      { status: 500 }
    );
  }
}
