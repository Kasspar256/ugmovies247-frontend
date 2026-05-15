import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getCurrentAuthSession();

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
    await adminDb.collection('users').doc(session.uid).set(
      {
        fcmToken: token,
        fcmTokenPlatform: String(body.platform || 'android'),
        fcmTokenUpdatedAt: timestamp,
        notificationsUpdatedAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true }
    );

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
