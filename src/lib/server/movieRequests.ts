import * as admin from 'firebase-admin';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  sendAdminMovieRequestAlert,
  sendMovieRequestUserUpdate,
} from '@/lib/server/requestNotifications';
import type { AdminRequest, AdminRequestStatus } from '@/types/admin';

export const MOVIE_REQUESTS_COLLECTION = 'movie_requests';
export const REQUEST_PROCESSOR_QUEUE = 'request-vps';

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampToIso(value: unknown) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  return '';
}

function normalizeRequestStatus(value: unknown): AdminRequestStatus {
  return value === 'pending' ||
    value === 'processing' ||
    value === 'uploaded' ||
    value === 'rejected' ||
    value === 'replied' ||
    value === 'new' ||
    value === 'reviewing' ||
    value === 'planned' ||
    value === 'closed'
    ? value
    : 'pending';
}

function mapMovieRequestDoc(
  doc: { id: string; data: () => Record<string, unknown> | undefined }
): AdminRequest {
  const data = (doc.data() || {}) as Record<string, unknown>;
  const movieTitle = normalizeString(data.movieTitle) || normalizeString(data.title) || 'Untitled request';
  const userId = normalizeString(data.userId) || normalizeString(data.requesterId);
  const userEmail = normalizeString(data.userEmail) || normalizeString(data.requesterEmail);
  const createdAt =
    timestampToIso(data.timestamp) ||
    normalizeString(data.createdAt) ||
    normalizeString(data.updatedAt);

  return {
    id: doc.id,
    title: movieTitle,
    movieTitle,
    preferredVj: normalizeString(data.preferredVj),
    notes: normalizeString(data.notes),
    status: normalizeRequestStatus(data.status),
    requesterId: userId,
    requesterName: normalizeString(data.requesterName),
    requesterEmail: userEmail,
    userId,
    userEmail,
    fcmToken: normalizeString(data.fcmToken),
    sourceUrl: normalizeString(data.sourceUrl) || normalizeString(data.rawFileUrl),
    sourceFileName: normalizeString(data.sourceFileName),
    movieId: normalizeString(data.movieId),
    customReply: normalizeString(data.customReply),
    rejectionMessage: normalizeString(data.rejectionMessage),
    processorQueue: normalizeString(data.processorQueue),
    queuedAt: normalizeString(data.queuedAt),
    uploadedAt: normalizeString(data.uploadedAt),
    rejectedAt: normalizeString(data.rejectedAt),
    timestamp: timestampToIso(data.timestamp),
    adminNotes: normalizeString(data.adminNotes),
    createdAt,
    updatedAt: normalizeString(data.updatedAt) || createdAt,
  };
}

export async function listMovieRequestsForAdmin(limit = 200) {
  try {
    const snapshot = await adminDb
      .collection(MOVIE_REQUESTS_COLLECTION)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(mapMovieRequestDoc);
  } catch (error) {
    console.warn('[movie-requests] ordered list failed, falling back to plain scan', error);
    const snapshot = await adminDb.collection(MOVIE_REQUESTS_COLLECTION).limit(limit).get();
    return snapshot.docs
      .map(mapMovieRequestDoc)
      .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''));
  }
}

export async function createMovieRequest(input: {
  movieTitle: string;
  preferredVj?: string;
  notes?: string;
  userId: string;
  userEmail: string;
  requesterName?: string;
  fcmToken?: string;
}) {
  const movieTitle = input.movieTitle.trim();

  if (!movieTitle) {
    throw new Error('Movie title is required.');
  }

  if (!input.userId.trim()) {
    throw new Error('You need to sign in before requesting a movie.');
  }

  const timestamp = nowIso();
  const ref = adminDb.collection(MOVIE_REQUESTS_COLLECTION).doc();
  let fcmToken = input.fcmToken?.trim() || '';

  if (!fcmToken) {
    const userSnapshot = await adminDb.collection('users').doc(input.userId.trim()).get().catch(() => null);
    const userData = userSnapshot?.data() as { fcmToken?: string } | undefined;
    fcmToken = userData?.fcmToken?.trim() || '';
  }

  const payload = {
    userId: input.userId.trim(),
    userEmail: input.userEmail.trim().toLowerCase(),
    requesterId: input.userId.trim(),
    requesterEmail: input.userEmail.trim().toLowerCase(),
    requesterName: input.requesterName?.trim() || 'User',
    fcmToken,
    movieTitle,
    title: movieTitle,
    preferredVj: input.preferredVj?.trim() || '',
    notes: input.notes?.trim() || '',
    status: 'pending' satisfies AdminRequestStatus,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: timestamp,
    updatedAt: timestamp,
    adminNotes: '',
    processorQueue: REQUEST_PROCESSOR_QUEUE,
  };

  await ref.set(payload);

  const request = mapMovieRequestDoc(await ref.get());
  await sendAdminMovieRequestAlert(request);
  return request;
}

async function getMovieRequest(requestId: string) {
  const ref = adminDb.collection(MOVIE_REQUESTS_COLLECTION).doc(requestId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new Error('Movie request not found.');
  }

  return {
    ref,
    request: mapMovieRequestDoc(snapshot),
  };
}

export async function updateMovieRequestForAdmin(
  requestId: string,
  input: {
    status?: AdminRequestStatus;
    adminNotes?: string;
    movieId?: string;
  }
) {
  const { ref, request } = await getMovieRequest(requestId);
  const updates: Record<string, unknown> = {
    updatedAt: nowIso(),
  };

  if (input.status) {
    updates.status = input.status;
  }

  if (typeof input.adminNotes === 'string') {
    updates.adminNotes = input.adminNotes.trim();
  }

  if (typeof input.movieId === 'string') {
    updates.movieId = input.movieId.trim();
  }

  await ref.set(updates, { merge: true });

  if (input.status === 'uploaded' && input.movieId) {
    await sendMovieRequestUserUpdate({
      request: {
        ...request,
        movieId: input.movieId.trim(),
        status: 'uploaded',
      },
      status: 'uploaded',
      subject: 'Your movie request is ready',
      title: 'Your movie request is ready!',
      message: `"${request.title}" is now available on UGMOVIES247.`,
      movieId: input.movieId.trim(),
    });
  }
}

export async function replyToMovieRequest(requestId: string, message: string) {
  const reply = message.trim();

  if (!reply) {
    throw new Error('Write a reply before sending it to the user.');
  }

  const { ref, request } = await getMovieRequest(requestId);
  const timestamp = nowIso();

  await ref.set(
    {
      status: 'replied',
      customReply: reply,
      adminNotes: reply,
      updatedAt: timestamp,
      lastActionAt: timestamp,
    },
    { merge: true }
  );

  await sendMovieRequestUserUpdate({
    request,
    status: 'replied',
    subject: 'Update on your movie request',
    title: 'Movie request update',
    message: reply,
    lines: [`Requested title: ${request.title}`],
  });
}

export async function rejectMovieRequest(requestId: string, message?: string) {
  const { ref, request } = await getMovieRequest(requestId);
  const rejectionMessage =
    message?.trim() ||
    `Sorry, "${request.title}" is not available right now. We will keep checking and update the catalog if we find a good copy.`;
  const timestamp = nowIso();

  await ref.set(
    {
      status: 'rejected',
      rejectionMessage,
      updatedAt: timestamp,
      rejectedAt: timestamp,
      lastActionAt: timestamp,
    },
    { merge: true }
  );

  await sendMovieRequestUserUpdate({
    request,
    status: 'rejected',
    subject: 'Movie request unavailable',
    title: 'Movie request unavailable',
    message: rejectionMessage,
    lines: [`Requested title: ${request.title}`],
  });
}

export async function queueMovieRequestFulfillment(
  requestId: string,
  input: {
    sourceUrl: string;
    adminNotes?: string;
    sourceFileName?: string;
  }
) {
  const sourceUrl = input.sourceUrl.trim();

  if (!sourceUrl) {
    throw new Error('Paste the raw movie link before queuing fulfillment.');
  }

  const { ref, request } = await getMovieRequest(requestId);
  const timestamp = nowIso();

  await ref.set(
    {
      status: 'processing',
      sourceUrl,
      rawFileUrl: sourceUrl,
      sourceFileName: input.sourceFileName?.trim() || '',
      adminNotes: input.adminNotes?.trim() || request.adminNotes || '',
      processorQueue: REQUEST_PROCESSOR_QUEUE,
      queuedAt: timestamp,
      updatedAt: timestamp,
      lastActionAt: timestamp,
      workerStatus: 'queued',
      workerError: '',
    },
    { merge: true }
  );

  await sendMovieRequestUserUpdate({
    request,
    status: 'processing',
    subject: 'Your movie request is uploading',
    title: 'Your movie request is uploading',
    message: `"${request.title}" has been accepted and is now being processed. We aim to finish under 5 hours.`,
  });
}

export async function markMovieRequestUploaded(requestId: string, movieId: string) {
  const { ref, request } = await getMovieRequest(requestId);
  const cleanMovieId = movieId.trim();
  const timestamp = nowIso();

  if (!cleanMovieId) {
    throw new Error('Missing uploaded movie ID.');
  }

  await ref.set(
    {
      status: 'uploaded',
      movieId: cleanMovieId,
      uploadedAt: timestamp,
      updatedAt: timestamp,
      workerStatus: 'done',
      workerError: '',
    },
    { merge: true }
  );

  await sendMovieRequestUserUpdate({
    request: {
      ...request,
      movieId: cleanMovieId,
      status: 'uploaded',
    },
    status: 'uploaded',
    subject: 'Your movie request is ready',
    title: 'Your movie request is ready!',
    message: `"${request.title}" is now ready to watch.`,
    movieId: cleanMovieId,
  });
}
