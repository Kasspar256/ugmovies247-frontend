import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { getViewerEntitlement } from '@/lib/server/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const entitlement = await getViewerEntitlement(session.uid, {
    email: session.email,
    role: session.role,
  });

  return NextResponse.json({
    user: {
      id: session.uid,
      name: session.userRecord.name,
      email: session.userRecord.email,
      role: session.userRecord.role,
      createdAt: session.userRecord.createdAt,
      updatedAt: session.userRecord.updatedAt,
      lastLoginAt: session.userRecord.lastLoginAt,
      avatarUrl: session.userRecord.avatarUrl || '',
      notificationPreferences: session.userRecord.notificationPreferences,
      subscription: entitlement.subscription,
    },
  });
}

export async function PATCH(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const name = String(body.name || '').trim();
    const avatarUrl = String(body.avatarUrl || '').trim();
    const timestamp = new Date().toISOString();

    if (!name) {
      return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
    }

    const { adminAuth, adminDb } = await import('@/lib/firebaseAdmin');
    await adminAuth.updateUser(session.uid, {
      displayName: name,
      photoURL: avatarUrl || undefined,
    });
    await adminDb.collection('users').doc(session.uid).set(
      {
        name,
        avatarUrl,
        updatedAt: timestamp,
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[auth] profile update failed', error);
    return NextResponse.json({ error: 'Failed to update profile.' }, { status: 500 });
  }
}
