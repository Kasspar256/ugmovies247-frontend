import * as admin from 'firebase-admin';
import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PushTokenDocument = {
  userId?: string;
  email?: string;
  token?: string;
  platform?: string;
  isActive?: boolean;
  lastRegisteredAt?: string;
};

function normalizePath(path: string, movieId: string) {
  if (movieId) {
    return `/movie/${encodeURIComponent(movieId)}`;
  }

  return path.startsWith('/') ? path : '/notifications';
}

async function requireAdmin() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return null;
  }

  return session;
}

function uniqueByToken(tokens: PushTokenDocument[]) {
  const seen = new Set<string>();
  return tokens.filter((entry) => {
    const token = String(entry.token || '').trim();

    if (!token || seen.has(token)) {
      return false;
    }

    seen.add(token);
    return true;
  });
}

async function sendPushes(tokens: PushTokenDocument[], input: {
  title: string;
  body: string;
  path: string;
  movieId: string;
  notificationIdByUserId: Map<string, string>;
}) {
  const activeTokens = uniqueByToken(tokens);
  let successCount = 0;
  let failureCount = 0;

  for (const tokenDoc of activeTokens) {
    const userId = String(tokenDoc.userId || '');
    const token = String(tokenDoc.token || '');
    const notificationId = input.notificationIdByUserId.get(userId) || '';

    try {
      await admin.messaging().send({
        token,
        notification: {
          title: input.title,
          body: input.body,
        },
        data: {
          title: input.title,
          body: input.body,
          path: input.path,
          movieId: input.movieId,
          notificationId,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'movie_updates',
            sound: 'default',
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
      });

      successCount += 1;
    } catch (error) {
      failureCount += 1;
      console.warn('[admin-notifications] push send failed', error);
    }
  }

  return { attempted: activeTokens.length, successCount, failureCount };
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const title = String(body.title || '').trim();
    const messageBody = String(body.body || '').trim();
    const audience = String(body.audience || 'all').trim();
    const targetUserId = String(body.userId || '').trim();
    const targetEmail = String(body.email || '').trim().toLowerCase();
    const movieId = String(body.movieId || '').trim();
    const path = normalizePath(String(body.path || '/notifications').trim(), movieId);

    if (!title || !messageBody) {
      return NextResponse.json({ error: 'Title and message are required.' }, { status: 400 });
    }

    if (title.length > 120) {
      return NextResponse.json({ error: 'Title must be 120 characters or less.' }, { status: 400 });
    }

    if (messageBody.length > 4000) {
      return NextResponse.json({ error: 'Message must be 4000 characters or less.' }, { status: 400 });
    }

    if (audience === 'user' && !targetUserId && !targetEmail) {
      return NextResponse.json({ error: 'Choose a user ID or email for a single-user notification.' }, { status: 400 });
    }

    const { adminDb } = await import('@/lib/firebaseAdmin');

    let tokenQuery = adminDb.collection('push_tokens').where('isActive', '==', true).limit(500);

    if (audience === 'user' && targetUserId) {
      tokenQuery = adminDb
        .collection('push_tokens')
        .where('isActive', '==', true)
        .where('userId', '==', targetUserId)
        .limit(50);
    } else if (audience === 'user' && targetEmail) {
      tokenQuery = adminDb
        .collection('push_tokens')
        .where('isActive', '==', true)
        .where('email', '==', targetEmail)
        .limit(50);
    }

    const tokenSnapshot = await tokenQuery.get();
    const tokens = tokenSnapshot.docs.map((doc) => doc.data() as PushTokenDocument);
    const userIds = Array.from(new Set(tokens.map((token) => String(token.userId || '')).filter(Boolean)));

    if (userIds.length === 0) {
      return NextResponse.json({ error: 'No active push recipients found.' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const notificationIdByUserId = new Map<string, string>();

    for (let index = 0; index < userIds.length; index += 450) {
      const chunk = userIds.slice(index, index + 450);
      const batch = adminDb.batch();

      for (const userId of chunk) {
        const ref = adminDb.collection('user_notifications').doc();
        notificationIdByUserId.set(userId, ref.id);

        batch.set(ref, {
          userId,
          title,
          body: messageBody,
          path,
          movieId,
          source: 'admin_broadcast',
          readAt: '',
          createdAt: now,
          updatedAt: now,
          createdBy: session.email || session.uid,
        });
      }

      await batch.commit();
    }

    const pushResult = await sendPushes(tokens, {
      title,
      body: messageBody,
      path,
      movieId,
      notificationIdByUserId,
    });

    return NextResponse.json({
      success: true,
      recipientCount: userIds.length,
      attemptedPushes: pushResult.attempted,
      sentPushes: pushResult.successCount,
      failedPushes: pushResult.failureCount,
    });
  } catch (error) {
    console.error('[admin-notifications] failed to send notification', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send notification.' },
      { status: 500 }
    );
  }
}
