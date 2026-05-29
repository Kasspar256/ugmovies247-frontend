import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminMessaging } from '@/lib/firebaseAdmin';
import type { Movie } from '@/types/movie';
import { MOVIES_COLLECTION } from './firestoreNamespaces';

const USER_NOTIFICATION_QUERY_LIMIT = 1500;
const FCM_MULTICAST_LIMIT = 500;

type Recipient = {
  token: string;
  userRef: FirebaseFirestore.DocumentReference;
};

type UploadNotificationMovie = Partial<Movie> & {
  id: string;
  latestUploadPushNotifiedAt?: unknown;
};

function getBaseUrl() {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://ugmovies247.com'
  ).replace(/\/$/, '');
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasPlayableSource(movie: Partial<Movie>) {
  if (readString(movie.video_url) || readString(movie.masterPlaylistUrl)) {
    return true;
  }

  if ((movie.parts || []).some((part) => readString(part.video_url) || readString(part.masterPlaylistUrl))) {
    return true;
  }

  return (movie.seasons || []).some((season) =>
    (season.episodes || []).some((episode) => readString(episode.video_url) || readString(episode.masterPlaylistUrl))
  );
}

function getNotificationImage(movie: Partial<Movie>) {
  return (
    readString(movie.overriddenBackdrop) ||
    readString(movie.overriddenPlayerBackdrop) ||
    readString(movie.playerBackdrop) ||
    readString(movie.heroPoster) ||
    readString(movie.poster)
  );
}

function getMovieTitle(movie: Partial<Movie>) {
  return readString(movie.title) || readString(movie.name) || 'New upload';
}

function getContentType(movie: Partial<Movie>) {
  return movie.contentType === 'series' || (movie.seasons || []).length > 0 ? 'series' : 'movie';
}

function isInvalidTokenError(code: string) {
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    code === 'messaging/invalid-argument'
  );
}

async function getFcmRecipients() {
  const snapshot = await adminDb.collection('users').limit(USER_NOTIFICATION_QUERY_LIMIT).get();
  const seenTokens = new Set<string>();
  const recipients: Recipient[] = [];

  snapshot.docs.forEach((doc) => {
    const token = readString(doc.data().fcmToken);

    if (!token || seenTokens.has(token)) {
      return;
    }

    seenTokens.add(token);
    recipients.push({
      token,
      userRef: doc.ref,
    });
  });

  return recipients;
}

async function clearInvalidTokens(recipients: Recipient[], invalidIndexes: number[]) {
  if (!invalidIndexes.length) {
    return;
  }

  const timestamp = new Date().toISOString();
  const batch = adminDb.batch();

  invalidIndexes.slice(0, 450).forEach((index) => {
    const recipient = recipients[index];

    if (!recipient) {
      return;
    }

    batch.set(
      recipient.userRef,
      {
        fcmToken: FieldValue.delete(),
        fcmTokenInvalidatedAt: timestamp,
        notificationsUpdatedAt: timestamp,
      },
      { merge: true }
    );
  });

  await batch.commit().catch((error) => {
    console.warn(
      '[upload-notifications] failed to clear invalid FCM tokens',
      error instanceof Error ? error.message : error
    );
  });
}

export async function sendLatestUploadPushNotification(movieId: string) {
  const normalizedMovieId = movieId.trim();

  if (!normalizedMovieId) {
    return { sent: false, skipped: true, reason: 'missing_movie_id' };
  }

  const movieRef = adminDb.collection(MOVIES_COLLECTION).doc(normalizedMovieId);
  const timestamp = new Date().toISOString();
  const movie = await adminDb.runTransaction(async (transaction): Promise<UploadNotificationMovie | null> => {
    const snapshot = await transaction.get(movieRef);

    if (!snapshot.exists) {
      return null;
    }

    const data: UploadNotificationMovie = {
      id: snapshot.id,
      ...(snapshot.data() as Partial<Movie>),
    };

    if (data.latestUploadPushNotifiedAt) {
      return null;
    }

    if (!hasPlayableSource(data)) {
      return null;
    }

    transaction.set(
      movieRef,
      {
        latestUploadPushStatus: 'sending',
        latestUploadPushAttemptedAt: timestamp,
        latestUploadPushUpdatedAt: timestamp,
      },
      { merge: true }
    );

    return data;
  });

  if (!movie) {
    return { sent: false, skipped: true, reason: 'already_notified_or_not_ready' };
  }

  const recipients = await getFcmRecipients();
  const title = getMovieTitle(movie);
  const contentType = getContentType(movie);
  const route = `/movie/${encodeURIComponent(normalizedMovieId)}?fresh=1&fromUpload=1`;
  const link = `${getBaseUrl()}${route}`;
  const image = getNotificationImage(movie);
  let successCount = 0;
  let failureCount = 0;
  const invalidRecipientIndexes: number[] = [];

  for (let offset = 0; offset < recipients.length; offset += FCM_MULTICAST_LIMIT) {
    const chunk = recipients.slice(offset, offset + FCM_MULTICAST_LIMIT);

    if (!chunk.length) {
      continue;
    }

    const response = await adminMessaging.sendEachForMulticast({
      tokens: chunk.map((recipient) => recipient.token),
      notification: {
        title: contentType === 'series' ? 'New series uploaded' : 'New movie uploaded',
        body: `${title} is ready to watch on UGMOVIES247.`,
      },
      data: {
        type: 'latest_upload',
        movieId: normalizedMovieId,
        contentType,
        route,
        title,
        image,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'latest_uploads',
          sound: 'default',
          imageUrl: image || undefined,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
        fcmOptions: image ? { imageUrl: image } : undefined,
      },
      webpush: {
        fcmOptions: {
          link,
        },
        notification: {
          icon: '/siteicon.png',
          badge: '/favicon.png',
          image: image || undefined,
        },
      },
    });

    successCount += response.successCount;
    failureCount += response.failureCount;
    response.responses.forEach((result, index) => {
      const code = result.error?.code || '';

      if (!result.success && isInvalidTokenError(code)) {
        invalidRecipientIndexes.push(offset + index);
      }
    });
  }

  await clearInvalidTokens(recipients, invalidRecipientIndexes);
  await movieRef.set(
    {
      latestUploadPushStatus: failureCount > 0 && successCount === 0 ? 'failed' : 'sent',
      latestUploadPushNotifiedAt: timestamp,
      latestUploadPushUpdatedAt: new Date().toISOString(),
      latestUploadPushSuccessCount: successCount,
      latestUploadPushFailureCount: failureCount,
      latestUploadPushRecipientCount: recipients.length,
    },
    { merge: true }
  );

  return {
    sent: successCount > 0,
    skipped: false,
    successCount,
    failureCount,
    recipientCount: recipients.length,
  };
}
