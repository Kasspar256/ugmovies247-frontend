import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { getViewerEntitlement } from '@/lib/server/subscriptions';
import {
  getDefaultAvatarPresetId,
  isValidAvatarPresetId,
  resolveAvatarPresetUrl,
  resolveUserAvatar,
} from '@/lib/avatarPresets';

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
      avatarPresetId: session.userRecord.avatarPresetId || '',
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
    const avatarPresetId = String(
      body.avatarPresetId || session.userRecord.avatarPresetId || getDefaultAvatarPresetId(session.uid)
    ).trim();
    const rawNotificationPreferences =
      body.notificationPreferences && typeof body.notificationPreferences === 'object'
        ? body.notificationPreferences
        : null;
    const notificationPreferences = rawNotificationPreferences
      ? {
          marketing: Boolean(rawNotificationPreferences.marketing),
          productUpdates:
            rawNotificationPreferences.productUpdates === undefined
              ? true
              : Boolean(rawNotificationPreferences.productUpdates),
        }
      : null;
    const timestamp = new Date().toISOString();

    if (!name) {
      return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
    }

    if (!isValidAvatarPresetId(avatarPresetId)) {
      return NextResponse.json({ error: 'Choose a valid avatar preset.' }, { status: 400 });
    }

    const { adminAuth, adminDb } = await import('@/lib/firebaseAdmin');
    const resolvedAvatar = resolveUserAvatar({
      avatarPresetId,
      avatarUrl: resolveAvatarPresetUrl(avatarPresetId),
      fallbackSeed: session.uid,
    });

    await adminAuth.updateUser(session.uid, {
      displayName: name,
    });
    await adminDb.collection('users').doc(session.uid).set(
      {
        name,
        avatarPresetId: resolvedAvatar.avatarPresetId,
        avatarUrl: '',
        ...(notificationPreferences ? { notificationPreferences } : {}),
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
