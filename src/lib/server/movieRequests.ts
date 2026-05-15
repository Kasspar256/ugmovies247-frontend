import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { adminDb } from '@/lib/firebaseAdmin';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import {
  sendAdminMovieRequestAlert,
  sendMovieRequestUserUpdate,
} from '@/lib/server/requestNotifications';
import type { AdminRequest, AdminRequestStatus } from '@/types/admin';

export const MOVIE_REQUESTS_COLLECTION = 'movie_requests';
export const REQUEST_PROCESSING_JOBS_COLLECTION = 'request_processing_jobs';
export const REQUEST_PROCESSOR_QUEUE = 'request-vps';

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeString(entry))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
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
  const releaseYear = normalizeNumber(data.releaseYear);
  const tmdbId = normalizeNumber(data.tmdbId) ?? normalizeNumber(data.tmdb_id);
  const seasonNumber = normalizeNumber(data.seasonNumber);
  const episodeNumber = normalizeNumber(data.episodeNumber);
  const progress = normalizeNumber(data.progress) ?? normalizeNumber(data.processingProgress);

  return {
    id: doc.id,
    title: movieTitle,
    movieTitle,
    contentType: data.contentType === 'series' ? 'series' : 'movie',
    originalTitle: normalizeString(data.originalTitle) || normalizeString(data.original_title),
    overview: normalizeString(data.overview),
    description: normalizeString(data.description),
    poster: normalizeString(data.poster),
    backdrop: normalizeString(data.backdrop),
    banner: normalizeString(data.banner),
    releaseDate: normalizeString(data.releaseDate) || normalizeString(data.release_date),
    releaseYear,
    genres: normalizeStringList(data.genres),
    category: normalizeStringList(data.category),
    tmdbId,
    seasonNumber,
    episodeNumber,
    seasonTitle: normalizeString(data.seasonTitle),
    episodeTitle: normalizeString(data.episodeTitle),
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
    sourceFileSizeBytes: normalizeNumber(data.sourceFileSizeBytes),
    movieId: normalizeString(data.movieId),
    customReply: normalizeString(data.customReply),
    rejectionMessage: normalizeString(data.rejectionMessage),
    processorQueue: normalizeString(data.processorQueue),
    processingJobId: normalizeString(data.processingJobId),
    progress: progress ?? undefined,
    currentStage: normalizeString(data.currentStage),
    workerStatus: normalizeString(data.workerStatus),
    workerError: normalizeString(data.workerError),
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

type AdvancedMovieRequestFulfillmentInput = {
  sourceUrl: string;
  adminNotes?: string;
  sourceFileName?: string;
  sourceFileSizeBytes?: number | string | null;
  title?: string;
  originalTitle?: string;
  description?: string;
  overview?: string;
  poster?: string;
  backdrop?: string;
  banner?: string;
  genres?: string[] | string;
  category?: string[] | string;
  vj?: string;
  releaseDate?: string;
  releaseYear?: number | string | null;
  tmdbId?: number | string | null;
  contentType?: 'movie' | 'series';
  seasonNumber?: number | string | null;
  episodeNumber?: number | string | null;
  seasonTitle?: string;
  episodeTitle?: string;
};

function getReleaseYear(input: AdvancedMovieRequestFulfillmentInput) {
  const explicitYear = normalizeNumber(input.releaseYear);

  if (explicitYear) {
    return explicitYear;
  }

  const match = normalizeString(input.releaseDate).match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function createMovieId(requestId: string, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);

  return `request-${slug || 'movie'}-${requestId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
}

function buildCommonMovieShell(options: {
  request: AdminRequest;
  movieId: string;
  input: AdvancedMovieRequestFulfillmentInput;
  title: string;
  sourceUrl: string;
  timestamp: string;
}) {
  const overview =
    normalizeString(options.input.overview) ||
    normalizeString(options.input.description) ||
    normalizeString(options.request.notes);
  const poster = normalizeString(options.input.poster);
  const backdrop = normalizeString(options.input.backdrop) || normalizeString(options.input.banner);
  const genres = normalizeStringList(options.input.genres);
  const category = normalizeStringList(options.input.category);
  const tmdbId = normalizeNumber(options.input.tmdbId);
  const sourceFileSizeBytes = normalizeNumber(options.input.sourceFileSizeBytes);

  return {
    id: options.movieId,
    movieId: options.movieId,
    title: options.title,
    original_title: normalizeString(options.input.originalTitle) || options.title,
    overview,
    description: overview,
    poster,
    backdrop,
    banner: backdrop,
    genres,
    category: category.length ? category : ['Latest Movies on Ugmovies247'],
    vj: normalizeString(options.input.vj) || options.request.preferredVj || 'Unknown',
    release_date: normalizeString(options.input.releaseDate),
    releaseYear: getReleaseYear(options.input),
    tmdb_id: tmdbId,
    sourceUrl: options.sourceUrl,
    sourceFileName: normalizeString(options.input.sourceFileName),
    sourceFileSizeBytes,
    sourceType: 'direct_url',
    sourcePipeline: 'request_vps_import',
    processorQueue: REQUEST_PROCESSOR_QUEUE,
    processingProgress: 0,
    currentStage: 'Queued for request VPS',
    jobStatus: 'queued',
    errorMessage: '',
    playbackType: 'mp4',
    accessTier: 'premium',
    subscriptionRequired: true,
    status: 'processing',
    requestId: options.request.id,
    createdAt: options.timestamp,
    updatedAt: options.timestamp,
    date_added: options.timestamp,
  };
}

function buildMovieShell(options: {
  request: AdminRequest;
  movieId: string;
  input: AdvancedMovieRequestFulfillmentInput;
  title: string;
  sourceUrl: string;
  timestamp: string;
}) {
  return {
    ...buildCommonMovieShell(options),
    contentType: 'movie',
    video_url: '',
  };
}

function buildSeriesShell(options: {
  request: AdminRequest;
  movieId: string;
  input: AdvancedMovieRequestFulfillmentInput;
  title: string;
  sourceUrl: string;
  timestamp: string;
}) {
  const common = buildCommonMovieShell(options);
  const seasonNumber = Math.max(1, Math.round(normalizeNumber(options.input.seasonNumber) || 1));
  const episodeNumber = Math.max(1, Math.round(normalizeNumber(options.input.episodeNumber) || 1));
  const episodeTitle =
    normalizeString(options.input.episodeTitle) ||
    `${options.title} S${seasonNumber}E${episodeNumber}`;
  const seasonTitle =
    normalizeString(options.input.seasonTitle) || `Season ${seasonNumber}`;

  return {
    ...common,
    contentType: 'series',
    video_url: '',
    seasons: [
      {
        seasonNumber,
        title: seasonTitle,
        overview: common.overview,
        poster: common.poster,
        tmdb_id: common.tmdb_id,
        episodes: [
          {
            episodeNumber,
            title: episodeTitle,
            description: common.description,
            overview: common.overview,
            poster: common.poster,
            video_url: '',
            sourceUrl: options.sourceUrl,
            sourceFileName: common.sourceFileName,
            sourceFileSizeBytes: common.sourceFileSizeBytes,
            sourceType: 'direct_url',
            sourcePipeline: 'request_vps_import',
            jobStatus: 'queued',
            processingProgress: 0,
            errorMessage: '',
            playbackType: 'mp4',
            accessTier: 'premium',
            subscriptionRequired: true,
            createdAt: options.timestamp,
            updatedAt: options.timestamp,
          },
        ],
      },
    ],
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
  const { ref } = await getMovieRequest(requestId);
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
}

export async function sendVjVarianceMovieRequest(requestId: string, message: string) {
  const reply = message.trim();

  if (!reply) {
    throw new Error('Write the VJ variance message before notifying the user.');
  }

  const { ref, request } = await getMovieRequest(requestId);
  const timestamp = nowIso();

  await ref.set(
    {
      status: 'replied',
      customReply: reply,
      adminNotes: reply,
      communicationType: 'vj_variance',
      updatedAt: timestamp,
      lastActionAt: timestamp,
    },
    { merge: true }
  );

  await sendMovieRequestUserUpdate({
    request,
    status: 'replied',
    subject: 'Update on your movie request version',
    title: 'Movie request version update',
    message: reply,
    lines: [`Requested title: ${request.title}`],
  });
}

export async function replyToMovieRequest(requestId: string, message: string) {
  return sendVjVarianceMovieRequest(requestId, message);
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
    sourceFileSizeBytes?: number | string | null;
  }
) {
  return queueAdvancedMovieRequestFulfillment(requestId, input);
}

export async function queueAdvancedMovieRequestFulfillment(
  requestId: string,
  input: AdvancedMovieRequestFulfillmentInput
) {
  const sourceUrl = input.sourceUrl.trim();

  if (!sourceUrl) {
    throw new Error('Paste the raw movie or series link before queuing fulfillment.');
  }

  const { ref, request } = await getMovieRequest(requestId);
  const timestamp = nowIso();
  const title = normalizeString(input.title) || request.title;
  const contentType = input.contentType === 'series' ? 'series' : 'movie';
  const movieId = request.movieId || createMovieId(requestId, title);
  const processingJobId = `${requestId}-${randomUUID().slice(0, 12)}`;
  const sourceFileName = normalizeString(input.sourceFileName);
  const sourceFileSizeBytes = normalizeNumber(input.sourceFileSizeBytes);
  const commonShellOptions = {
    request,
    movieId,
    input,
    title,
    sourceUrl,
    timestamp,
  };
  const movieShell =
    contentType === 'series'
      ? buildSeriesShell(commonShellOptions)
      : buildMovieShell(commonShellOptions);
  const readyMovieShell =
    contentType === 'series'
      ? {
          ...movieShell,
          status: 'live',
          jobStatus: 'ready',
          currentStage: 'Live and ready to watch',
          processingProgress: 100,
          errorMessage: '',
          processedAt: timestamp,
          updatedAt: timestamp,
          seasons: Array.isArray((movieShell as { seasons?: unknown }).seasons)
            ? (movieShell as { seasons: Array<Record<string, unknown>> }).seasons.map((season) => ({
                ...season,
                episodes: Array.isArray(season.episodes)
                  ? season.episodes.map((episode) => ({
                      ...episode,
                      video_url: sourceUrl,
                      jobStatus: 'ready',
                      processingProgress: 100,
                      currentStage: 'Live and ready to watch',
                      errorMessage: '',
                      updatedAt: timestamp,
                      processedAt: timestamp,
                    }))
                  : [],
              }))
            : [],
        }
      : {
          ...movieShell,
          video_url: sourceUrl,
          status: 'live',
          jobStatus: 'ready',
          currentStage: 'Live and ready to watch',
          processingProgress: 100,
          errorMessage: '',
          processedAt: timestamp,
          updatedAt: timestamp,
        };

  await adminDb.collection(MOVIES_COLLECTION).doc(movieId).set(readyMovieShell, { merge: true });

  await adminDb.collection(REQUEST_PROCESSING_JOBS_COLLECTION).doc(processingJobId).set({
    id: processingJobId,
    requestId,
    movieId,
    title,
    userId: request.userId || request.requesterId || '',
    userEmail: request.userEmail || request.requesterEmail || '',
    fcmToken: request.fcmToken || '',
    contentType,
    sourceUrl,
    sourceFileName,
    sourceFileSizeBytes,
    publicVideoUrl: sourceUrl,
    status: 'uploaded',
    progress: 100,
    currentStage: 'Published from Telegram worker link',
    errorMessage: '',
    processorQueue: 'request-telegram-link-publish',
    movieShell: readyMovieShell,
    seasonNumber: contentType === 'series' ? Math.max(1, Math.round(normalizeNumber(input.seasonNumber) || 1)) : null,
    episodeNumber: contentType === 'series' ? Math.max(1, Math.round(normalizeNumber(input.episodeNumber) || 1)) : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    queuedAt: timestamp,
    completedAt: timestamp,
    serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  await ref.set(
    {
      status: 'uploaded',
      sourceUrl,
      rawFileUrl: sourceUrl,
      sourceFileName,
      sourceFileSizeBytes,
      movieId,
      processingJobId,
      contentType,
      title,
      movieTitle: title,
      originalTitle: normalizeString(input.originalTitle),
      overview: normalizeString(input.overview) || normalizeString(input.description),
      description: normalizeString(input.description) || normalizeString(input.overview),
      poster: normalizeString(input.poster),
      backdrop: normalizeString(input.backdrop),
      banner: normalizeString(input.banner),
      genres: normalizeStringList(input.genres),
      category: normalizeStringList(input.category),
      vj: normalizeString(input.vj) || request.preferredVj || '',
      releaseDate: normalizeString(input.releaseDate),
      releaseYear: getReleaseYear(input),
      tmdbId: normalizeNumber(input.tmdbId),
      seasonNumber: contentType === 'series' ? Math.max(1, Math.round(normalizeNumber(input.seasonNumber) || 1)) : null,
      episodeNumber: contentType === 'series' ? Math.max(1, Math.round(normalizeNumber(input.episodeNumber) || 1)) : null,
      seasonTitle: normalizeString(input.seasonTitle),
      episodeTitle: normalizeString(input.episodeTitle),
      adminNotes: input.adminNotes?.trim() || request.adminNotes || '',
      processorQueue: 'request-telegram-link-publish',
      queuedAt: timestamp,
      uploadedAt: timestamp,
      updatedAt: timestamp,
      lastActionAt: timestamp,
      workerStatus: 'done',
      workerError: '',
      progress: 100,
      currentStage: 'Live and ready to watch',
    },
    { merge: true }
  );

  await sendMovieRequestUserUpdate({
    request: {
      ...request,
      title,
      movieTitle: title,
      movieId,
      status: 'uploaded',
    },
    status: 'uploaded',
    subject: 'Your movie request is ready',
    title: 'Your movie request is ready!',
    message: `"${title}" is now ready to watch.`,
    movieId,
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
      progress: 100,
      currentStage: 'Live and ready to watch',
    },
    { merge: true }
  );

  if (request.processingJobId) {
    await adminDb.collection(REQUEST_PROCESSING_JOBS_COLLECTION).doc(request.processingJobId).set(
      {
        status: 'uploaded',
        progress: 100,
        currentStage: 'Live and ready to watch',
        completedAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true }
    );
  }

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
