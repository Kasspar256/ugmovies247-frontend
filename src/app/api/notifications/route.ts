import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getCurrentAuthSession } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type NotificationDocument = {
  userId: string;
  title: string;
  body: string;
  path: string;
  movieId: string;
  source: string;
  readAt: string;
  createdAt: string;
  updatedAt: string;
};

function normalizeNotification(id: string, data: Partial<NotificationDocument>) {
  return {
    id,
    title: String(data.title || 'UG Movies 247'),
    body: String(data.body || 'You have a new update.'),
    path: String(data.path || '/notifications'),
    movieId: String(data.movieId || ''),
    source: String(data.source || 'app'),
    read: Boolean(data.readAt),
    readAt: String(data.readAt || ''),
    createdAt: String(data.createdAt || ''),
  };
}

export async function GET() {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { adminDb } = await import('@/lib/firebaseAdmin');

  try {
    const snapshot = await adminDb
      .collection('user_notifications')
      .where('userId', '==', session.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const notifications = snapshot.docs.map((doc) => normalizeNotification(doc.id, doc.data()));
    const unreadCount = notifications.filter((notification) => !notification.read).length;

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.warn('[notifications] ordered inbox read failed, retrying without orderBy', error);

    const snapshot = await adminDb
      .collection('user_notifications')
      .where('userId', '==', session.uid)
      .limit(50)
      .get();

    const notifications = snapshot.docs
      .map((doc) => normalizeNotification(doc.id, doc.data()))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const unreadCount = notifications.filter((notification) => !notification.read).length;

    return NextResponse.json({ notifications, unreadCount });
  }
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || 'UG Movies 247').trim();
  const messageBody = String(body.body || 'You have a new update.').trim();
  const path = String(body.path || '/notifications').trim();
  const movieId = String(body.movieId || '').trim();
  const source = String(body.source || 'push').trim();
  const now = new Date().toISOString();

  if (!title || !messageBody) {
    return NextResponse.json({ error: 'Title and body are required.' }, { status: 400 });
  }

  const { adminDb } = await import('@/lib/firebaseAdmin');
  const ref = adminDb.collection('user_notifications').doc();

  await ref.set({
    userId: session.uid,
    title,
    body: messageBody,
    path: path.startsWith('/') ? path : '/notifications',
    movieId,
    source,
    readAt: '',
    createdAt: now,
    updatedAt: now,
  } satisfies NotificationDocument);

  return NextResponse.json({ notification: normalizeNotification(ref.id, {
    title,
    body: messageBody,
    path,
    movieId,
    source,
    readAt: '',
    createdAt: now,
  }) });
}

export async function PATCH(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const notificationId = String(body.notificationId || '').trim();
  const markAllRead = body.markAllRead === true;
  const now = new Date().toISOString();
  const { adminDb } = await import('@/lib/firebaseAdmin');

  if (markAllRead) {
    const snapshot = await adminDb
      .collection('user_notifications')
      .where('userId', '==', session.uid)
      .where('readAt', '==', '')
      .limit(450)
      .get();

    if (!snapshot.empty) {
      const batch = adminDb.batch();
      snapshot.docs.forEach((doc) => batch.set(doc.ref, { readAt: now, updatedAt: now }, { merge: true }));
      await batch.commit();
    }

    return NextResponse.json({ success: true });
  }

  if (!notificationId) {
    return NextResponse.json({ error: 'notificationId is required.' }, { status: 400 });
  }

  const ref = adminDb.collection('user_notifications').doc(notificationId);
  const snapshot = await ref.get();

  if (!snapshot.exists || snapshot.data()?.userId !== session.uid) {
    return NextResponse.json({ error: 'Notification not found.' }, { status: 404 });
  }

  await ref.set(
    {
      readAt: now,
      updatedAt: now,
      readCount: FieldValue.increment(1),
    },
    { merge: true }
  );

  return NextResponse.json({ success: true });
}
