import { NextResponse } from 'next/server';
import {
  AUTH_DEVICE_COOKIE,
  AUTH_DEVICE_SESSION_COOKIE,
  AUTH_ROLE_COOKIE,
  AUTH_SESSION_COOKIE,
  getAuthCookieConfig,
  getCurrentAuthSession,
} from '@/lib/auth/server';
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
  const session = await getCurrentAuthSession({ hydrateUserRecord: true });

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
      emailVerified: session.userRecord.emailVerified === true,
      emailVerifiedAt: session.userRecord.emailVerifiedAt,
      emailVerificationSentAt: session.userRecord.emailVerificationSentAt,
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
  const session = await getCurrentAuthSession({ hydrateUserRecord: true });

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

async function deleteCollectionDocumentsForUser(collectionName: string, userId: string) {
  const { adminDb } = await import('@/lib/firebaseAdmin');

  while (true) {
    const snapshot = await adminDb
      .collection(collectionName)
      .where('userId', '==', userId)
      .limit(450)
      .get();

    if (snapshot.empty) {
      return;
    }

    const batch = adminDb.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

export async function DELETE(request: Request) {
  const session = await getCurrentAuthSession({ hydrateUserRecord: true });

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role === 'admin') {
    return NextResponse.json({ error: 'Admin accounts cannot be deleted here.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  if (String(body.confirm || '').trim() !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm account deletion.' }, { status: 400 });
  }

  try {
    const { adminAuth, adminDb } = await import('@/lib/firebaseAdmin');
    const userId = session.uid;

    await Promise.all([
      deleteCollectionDocumentsForUser('downloads', userId),
      deleteCollectionDocumentsForUser('watchlist', userId),
      deleteCollectionDocumentsForUser('likes', userId),
      deleteCollectionDocumentsForUser('subscription_payments', userId),
      deleteCollectionDocumentsForUser('subscription_override_audit_logs', userId),
      deleteCollectionDocumentsForUser('auth_sessions', userId),
    ]);

    await Promise.all([
      adminDb.collection('users').doc(userId).delete(),
      adminDb.collection('user_subscriptions').doc(userId).delete(),
      adminDb.collection('subscription_recurring_agreements').doc(userId).delete(),
      adminDb.collection('subscription_overrides').doc(userId).delete(),
      adminDb.collection('user_auth_session_state').doc(userId).delete(),
    ]);

    await adminAuth.deleteUser(userId).catch((error) => {
      if (error?.code !== 'auth/user-not-found') {
        throw error;
      }
    });

    const response = NextResponse.json({ success: true });
    for (const cookieName of [
      AUTH_SESSION_COOKIE,
      AUTH_ROLE_COOKIE,
      AUTH_DEVICE_COOKIE,
      AUTH_DEVICE_SESSION_COOKIE,
      'ugm_session',
      'ugm_role',
    ]) {
      response.cookies.set(cookieName, '', {
        ...getAuthCookieConfig(),
        maxAge: 0,
      });
    }

    return response;
  } catch (error) {
    console.error('[auth] account deletion failed', error);
    return NextResponse.json({ error: 'Account deletion failed. Please contact support.' }, { status: 500 });
  }
}
