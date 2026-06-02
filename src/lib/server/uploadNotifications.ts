import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminMessaging } from '@/lib/firebaseAdmin';
import type { Movie } from '@/types/movie';
import { MOVIES_COLLECTION } from './firestoreNamespaces';

const USER_NOTIFICATION_PAGE_SIZE = 500;
const FCM_MULTICAST_LIMIT = 500;

type Recipient = {
  token: string;
  tokenHash?: string;
  userId?: string;
  userRef?: FirebaseFirestore.DocumentReference;
  tokenRef?: FirebaseFirestore.DocumentReference;
};

export type PushDeliveryPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
  route?: string;
  link?: string;
  image?: string;
  channelId?: string;
  channelName?: string;
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

function shouldTreatAsTmdbImagePath(src: string) {
  return (
    /^\/[^/].*\.(jpe?g|png|webp)$/i.test(src) &&
    !/^\/(?:_next|api|uploads?|static|favicon|siteicon|logow?\.|manifest)/i.test(src)
  );
}

export function normalizeNotificationImageUrl(value: unknown) {
  const image = readString(value);

  if (!image) {
    return '';
  }

  if (image.startsWith('//')) {
    return `https:${image}`;
  }

  if (/^image\.tmdb\.org\//i.test(image)) {
    return `https://${image}`;
  }

  if (shouldTreatAsTmdbImagePath(image)) {
    return `https://image.tmdb.org/t/p/w780${image}`;
  }

  if (image.startsWith('/')) {
    return `${getBaseUrl()}${image}`;
  }

  try {
    const parsed = new URL(image);

    if (parsed.protocol === 'http:' && parsed.hostname === 'ugmovies247.com') {
      parsed.protocol = 'https:';
    }

    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
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

export function getNotificationImageUrl(movie: Partial<Movie>) {
  return normalizeNotificationImageUrl(
    readString(movie.overriddenPlayerBackdrop) ||
      readString(movie.overriddenBackdrop) ||
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

function collectRecipientsFromUserDocs(
  docs: FirebaseFirestore.QueryDocumentSnapshot[] | FirebaseFirestore.DocumentSnapshot[],
  seenTokens: Set<string>,
  recipients: Recipient[]
) {
  docs.forEach((doc) => {
    const data = doc.data();

    if (!data) {
      return;
    }

    const legacyToken = readString(data.fcmToken);
    const tokenMap =
      data.fcmTokenMap && typeof data.fcmTokenMap === 'object'
        ? (data.fcmTokenMap as Record<string, unknown>)
        : {};
    const mappedRecipients = Object.entries(tokenMap)
      .map(([tokenHash, entry]) => {
        const token =
          typeof entry === 'string'
            ? readString(entry)
            : entry && typeof entry === 'object'
              ? readString((entry as Record<string, unknown>).token)
              : '';

        return { token, tokenHash };
      })
      .filter((entry) => Boolean(entry.token));
    const allTokens = [
      ...mappedRecipients,
      ...(legacyToken ? [{ token: legacyToken, tokenHash: undefined }] : []),
    ];

    allTokens.forEach(({ token, tokenHash }) => {
      if (!token || seenTokens.has(token)) {
        return;
      }

      seenTokens.add(token);
      recipients.push({
        token,
        tokenHash,
        userId: doc.id,
        userRef: doc.ref,
      });
    });
  });
}

function collectRecipientsFromTokenDocs(
  docs: FirebaseFirestore.QueryDocumentSnapshot[] | FirebaseFirestore.DocumentSnapshot[],
  seenTokens: Set<string>,
  recipients: Recipient[]
) {
  docs.forEach((doc) => {
    const data = doc.data();

    if (!data || data.active === false) {
      return;
    }

    const token = readString(data.token);

    if (!token || seenTokens.has(token)) {
      return;
    }

    seenTokens.add(token);
    recipients.push({
      token,
      tokenHash: readString(data.tokenHash) || doc.id,
      userId: readString(data.userId),
      tokenRef: doc.ref,
    });
  });
}

async function collectAllTokenDocs(seenTokens: Set<string>, recipients: Recipient[]) {
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (true) {
    let query = adminDb
      .collection('notification_tokens')
      .orderBy(FieldPath.documentId())
      .limit(USER_NOTIFICATION_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get().catch(() => null);

    if (!snapshot || snapshot.empty) {
      break;
    }

    collectRecipientsFromTokenDocs(snapshot.docs, seenTokens, recipients);
    lastDoc = snapshot.docs[snapshot.docs.length - 1] || null;

    if (snapshot.size < USER_NOTIFICATION_PAGE_SIZE) {
      break;
    }
  }
}

async function getAllFcmRecipients() {
  const seenTokens = new Set<string>();
  const recipients: Recipient[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  await collectAllTokenDocs(seenTokens, recipients);

  while (true) {
    let query = adminDb
      .collection('users')
      .orderBy(FieldPath.documentId())
      .limit(USER_NOTIFICATION_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    collectRecipientsFromUserDocs(snapshot.docs, seenTokens, recipients);
    lastDoc = snapshot.docs[snapshot.docs.length - 1] || null;

    if (snapshot.size < USER_NOTIFICATION_PAGE_SIZE) {
      break;
    }
  }

  return recipients;
}

async function getUserFcmRecipients(options: { userIds?: string[]; emails?: string[]; tokens?: string[] }) {
  const seenTokens = new Set<string>();
  const recipients: Recipient[] = [];
  const userIds = Array.from(new Set((options.userIds || []).map((value) => value.trim()).filter(Boolean)));
  const emails = Array.from(new Set((options.emails || []).map((value) => value.trim().toLowerCase()).filter(Boolean)));

  (options.tokens || []).forEach((token) => {
    const normalizedToken = readString(token);

    if (!normalizedToken || seenTokens.has(normalizedToken)) {
      return;
    }

    seenTokens.add(normalizedToken);
    recipients.push({ token: normalizedToken });
  });

  if (userIds.length) {
    const refs = userIds.map((userId) => adminDb.collection('users').doc(userId));
    const snapshots = await adminDb.getAll(...refs);
    collectRecipientsFromUserDocs(snapshots, seenTokens, recipients);

    for (const userId of userIds) {
      const tokenSnapshot = await adminDb
        .collection('notification_tokens')
        .where('userId', '==', userId)
        .limit(25)
        .get()
        .catch(() => null);

      if (tokenSnapshot?.empty === false) {
        collectRecipientsFromTokenDocs(tokenSnapshot.docs, seenTokens, recipients);
      }
    }
  }

  for (let offset = 0; offset < emails.length; offset += 10) {
    const emailChunk = emails.slice(offset, offset + 10);

    if (!emailChunk.length) {
      continue;
    }

    const snapshot = await adminDb
      .collection('users')
      .where('emailLower', 'in', emailChunk)
      .limit(50)
      .get()
      .catch(() => null);

    if (snapshot?.empty === false) {
      collectRecipientsFromUserDocs(snapshot.docs, seenTokens, recipients);
      continue;
    }

    const fallbackSnapshot = await adminDb
      .collection('users')
      .where('email', 'in', emailChunk)
      .limit(50)
      .get()
      .catch(() => null);

    if (fallbackSnapshot?.empty === false) {
      collectRecipientsFromUserDocs(fallbackSnapshot.docs, seenTokens, recipients);
    }

    const tokenSnapshot = await adminDb
      .collection('notification_tokens')
      .where('userEmailLower', 'in', emailChunk)
      .limit(50)
      .get()
      .catch(() => null);

    if (tokenSnapshot?.empty === false) {
      collectRecipientsFromTokenDocs(tokenSnapshot.docs, seenTokens, recipients);
    }
  }

  return recipients;
}

async function clearInvalidTokens(recipients: Recipient[], invalidIndexes: number[]) {
  if (!invalidIndexes.length) {
    return;
  }

  const timestamp = new Date().toISOString();
  const batch = adminDb.batch();
  let writeCount = 0;

  invalidIndexes.slice(0, 450).forEach((index) => {
    const recipient = recipients[index];

    if (!recipient) {
      return;
    }

    if (recipient.userRef) {
      const payload: Record<string, unknown> = {
        fcmTokenInvalidatedAt: timestamp,
        notificationsUpdatedAt: timestamp,
      };

      if (recipient.tokenHash) {
        payload[`fcmTokenMap.${recipient.tokenHash}`] = FieldValue.delete();
      } else {
        payload.fcmToken = FieldValue.delete();
      }

      batch.update(recipient.userRef, payload);
      writeCount += 1;
    }

    if (recipient.tokenRef) {
      batch.set(
        recipient.tokenRef,
        {
          active: false,
          invalidatedAt: timestamp,
          updatedAt: timestamp,
        },
        { merge: true }
      );
      writeCount += 1;
    }
  });

  if (!writeCount) {
    return;
  }

  await batch.commit().catch((error) => {
    console.warn(
      '[upload-notifications] failed to clear invalid FCM tokens',
      error instanceof Error ? error.message : error
    );
  });
}

export async function getFcmRecipients(options?: {
  userIds?: string[];
  emails?: string[];
  tokens?: string[];
}) {
  if (options?.userIds?.length || options?.emails?.length || options?.tokens?.length) {
    return getUserFcmRecipients(options);
  }

  return getAllFcmRecipients();
}

export async function sendPushNotificationToRecipients(
  recipients: Recipient[],
  payload: PushDeliveryPayload
) {
  const route = payload.route || payload.data?.route || '/notifications';
  const link = payload.link || `${getBaseUrl()}${route.startsWith('/') ? route : `/${route}`}`;
  const channelId = payload.channelId || 'latest_uploads';
  const image = normalizeNotificationImageUrl(payload.image);
  const invalidRecipientIndexes: number[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let offset = 0; offset < recipients.length; offset += FCM_MULTICAST_LIMIT) {
    const chunk = recipients.slice(offset, offset + FCM_MULTICAST_LIMIT);

    if (!chunk.length) {
      continue;
    }

    const response = await adminMessaging.sendEachForMulticast({
      tokens: chunk.map((recipient) => recipient.token),
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: image || undefined,
      },
      data: {
        ...(payload.data || {}),
        title: payload.title,
        body: payload.body,
        route,
        channelId,
        image,
      },
      android: {
        priority: 'high',
        notification: {
          channelId,
          icon: 'ic_notification',
          sound: 'default',
          imageUrl: image || undefined,
          defaultSound: true,
          defaultVibrateTimings: true,
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
          requireInteraction: true,
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

  return {
    sent: successCount > 0,
    successCount,
    failureCount,
    recipientCount: recipients.length,
    invalidTokenCount: invalidRecipientIndexes.length,
  };
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
  const image = getNotificationImageUrl(movie);

  if (!recipients.length) {
    await movieRef.set(
      {
        latestUploadPushStatus: 'no_recipients',
        latestUploadPushUpdatedAt: new Date().toISOString(),
        latestUploadPushSuccessCount: 0,
        latestUploadPushFailureCount: 0,
        latestUploadPushRecipientCount: 0,
      },
      { merge: true }
    );

    return {
      sent: false,
      skipped: true,
      reason: 'no_registered_recipients',
      successCount: 0,
      failureCount: 0,
      recipientCount: 0,
    };
  }

  const delivery = await sendPushNotificationToRecipients(recipients, {
    title: contentType === 'series' ? 'New series uploaded' : 'New movie uploaded',
    body: `${title} is ready to watch on UGMOVIES247.`,
    route,
    link,
    image,
    channelId: 'latest_uploads',
    data: {
      type: 'latest_upload',
      movieId: normalizedMovieId,
      contentType,
      route,
      title,
      image,
    },
  });
  const pushUpdate: Record<string, unknown> = {
    latestUploadPushStatus:
      delivery.failureCount > 0 && delivery.successCount === 0 ? 'failed' : 'sent',
    latestUploadPushUpdatedAt: new Date().toISOString(),
    latestUploadPushSuccessCount: delivery.successCount,
    latestUploadPushFailureCount: delivery.failureCount,
    latestUploadPushRecipientCount: delivery.recipientCount,
  };

  if (delivery.successCount > 0) {
    pushUpdate.latestUploadPushNotifiedAt = timestamp;
  }

  await movieRef.set(pushUpdate, { merge: true });

  return {
    sent: delivery.successCount > 0,
    skipped: false,
    successCount: delivery.successCount,
    failureCount: delivery.failureCount,
    recipientCount: delivery.recipientCount,
  };
}
