import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import {
  getFcmRecipients,
  getNotificationImageUrl,
  normalizeNotificationImageUrl,
  sendPushNotificationToRecipients,
} from '@/lib/server/uploadNotifications';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import type { Movie } from '@/types/movie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizePath(value: unknown) {
  const path = String(value || '/notifications').trim();
  return path.startsWith('/') ? path : '/notifications';
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  const normalized = String(value || '').trim();
  return normalized ? [normalized] : [];
}

function resolveMovieId(value: unknown, path: string) {
  const explicitMovieId = String(value || '').trim();

  if (explicitMovieId) {
    return explicitMovieId;
  }

  const match = path.match(/\/movie\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

async function resolveNotificationImage(inputImage: unknown, movieId: string) {
  const image = normalizeNotificationImageUrl(inputImage);

  if (image || !movieId) {
    return image;
  }

  const snapshot = await adminDb.collection(MOVIES_COLLECTION).doc(movieId).get().catch(() => null);

  if (!snapshot?.exists) {
    return '';
  }

  return getNotificationImageUrl(snapshot.data() as Partial<Movie>);
}

async function createInboxNotifications(
  recipients: Awaited<ReturnType<typeof getFcmRecipients>>,
  input: {
    title: string;
    body: string;
    path: string;
    movieId: string;
    source: string;
  }
) {
  const timestamp = new Date().toISOString();
  const userIds = Array.from(
    new Set(recipients.map((recipient) => recipient.userId || '').filter(Boolean))
  );
  let written = 0;

  for (let offset = 0; offset < userIds.length; offset += 450) {
    const chunk = userIds.slice(offset, offset + 450);

    if (!chunk.length) {
      continue;
    }

    const batch = adminDb.batch();

    chunk.forEach((userId) => {
      const ref = adminDb.collection('user_notifications').doc();
      batch.set(ref, {
        userId,
        title: input.title,
        body: input.body,
        path: input.path,
        movieId: input.movieId,
        source: input.source,
        readAt: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentAuthSession({ hydrateUserRecord: true });

    if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        {
          error: 'Firebase Admin messaging is not configured.',
          detail: adminSetupError,
        },
        { status: 500 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(body.title || 'UGMOVIES247').trim();
    const message = String(body.body || body.message || '').trim();
    const path = normalizePath(body.path || body.route);
    const movieId = resolveMovieId(body.movieId, path);
    const image = await resolveNotificationImage(body.image || body.imageUrl, movieId);
    const target = String(body.target || body.audience || 'all').trim().toLowerCase();
    const tokens = normalizeStringArray(body.token || body.tokens);
    const userIds = normalizeStringArray(body.userId || body.userIds);
    const emails = normalizeStringArray(body.email || body.emails);

    if (!title || !message) {
      return NextResponse.json({ error: 'Title and message are required.' }, { status: 400 });
    }

    const recipients =
      target === 'all' && !tokens.length && !userIds.length && !emails.length
        ? await getFcmRecipients()
        : await getFcmRecipients({ tokens, userIds, emails });

    if (!recipients.length) {
      return NextResponse.json(
        {
          error: 'No registered push tokens matched this notification target.',
          recipientCount: 0,
          successCount: 0,
          failureCount: 0,
        },
        { status: 400 }
      );
    }

    const source = target === 'all' ? 'admin_broadcast' : 'admin_targeted';
    const delivery = await sendPushNotificationToRecipients(recipients, {
      title,
      body: message,
      route: path,
      image,
      channelId: 'latest_uploads',
      data: {
        type: source,
        route: path,
        movieId,
        image,
      },
    });
    const inboxCount = await createInboxNotifications(recipients, {
      title,
      body: message,
      path,
      movieId,
      source,
    }).catch((error) => {
      console.warn('[admin-notifications] inbox write failed', error);
      return 0;
    });

    if (!delivery.sent) {
      return NextResponse.json(
        {
          error: 'FCM accepted no device tokens for this notification.',
          ...delivery,
          inboxCount,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      ...delivery,
      inboxCount,
    });
  } catch (error) {
    console.error('[admin-notifications] send failed', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to send notification.',
      },
      { status: 500 }
    );
  }
}
