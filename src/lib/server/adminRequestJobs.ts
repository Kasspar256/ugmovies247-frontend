import { adminDb } from '@/lib/firebaseAdmin';
import {
  REQUEST_PROCESSING_JOBS_COLLECTION,
  REQUEST_PROCESSOR_QUEUE,
  TELEGRAM_REQUEST_PROCESSOR_QUEUE,
} from '@/lib/server/movieRequests';
import type { RequestProcessingJob, RequestProcessingJobStatus } from '@/types/admin';

function timestampToIso(value: unknown) {
  if (!value) return '';

  if (typeof value === 'string') return value;

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

function normalizeNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeJobStatus(value: unknown): RequestProcessingJobStatus {
  return value === 'queued' ||
    value === 'claimed' ||
    value === 'downloading' ||
    value === 'inspecting' ||
    value === 'processing' ||
    value === 'uploading' ||
    value === 'ready' ||
    value === 'uploaded' ||
    value === 'failed'
    ? value
    : 'queued';
}

export function mapRequestJobDoc(doc: { id: string; data: () => Record<string, unknown> }): RequestProcessingJob {
  const data = doc.data() || {};

  return {
    id: doc.id,
    requestId: String(data.requestId || ''),
    movieId: String(data.movieId || ''),
    title: String(data.title || 'Untitled request job'),
    userEmail: String(data.userEmail || ''),
    contentType: data.contentType === 'series' ? 'series' : 'movie',
    seasonNumber:
      data.seasonNumber === null || data.seasonNumber === undefined
        ? null
        : Math.max(1, Math.round(normalizeNumber(data.seasonNumber))),
    episodeNumber:
      data.episodeNumber === null || data.episodeNumber === undefined
        ? null
        : Math.max(1, Math.round(normalizeNumber(data.episodeNumber))),
    episodeTitle: String(data.episodeTitle || ''),
    episodeDescription: String(data.episodeDescription || ''),
    status: normalizeJobStatus(data.status),
    progress: Math.max(0, Math.min(100, normalizeNumber(data.progress))),
    currentStage: String(data.currentStage || ''),
    sourceUrl: String(data.sourceUrl || ''),
    sourceFileName: String(data.sourceFileName || ''),
    sourceFileSizeBytes:
      data.sourceFileSizeBytes === null || data.sourceFileSizeBytes === undefined
        ? null
        : normalizeNumber(data.sourceFileSizeBytes),
    publicVideoUrl: String(data.publicVideoUrl || ''),
    telegramFileId: String(data.telegramFileId || ''),
    telegramChatId: String(data.telegramChatId || ''),
    telegramMessageId:
      typeof data.telegramMessageId === 'number' || typeof data.telegramMessageId === 'string'
        ? data.telegramMessageId
        : '',
    errorMessage: String(data.errorMessage || ''),
    workerId: String(data.workerId || ''),
    processorQueue: String(data.processorQueue || ''),
    workerHeartbeatAt: timestampToIso(data.workerHeartbeatAt),
    queuedAt: timestampToIso(data.queuedAt),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    startedAt: timestampToIso(data.startedAt),
    completedAt: timestampToIso(data.completedAt),
  };
}

export function isRequestFulfillmentJob(job: RequestProcessingJob) {
  if (job.processorQueue === TELEGRAM_REQUEST_PROCESSOR_QUEUE) {
    return false;
  }

  if (job.id.startsWith('telegram-') || job.telegramChatId || job.telegramMessageId) {
    return false;
  }

  return job.processorQueue === REQUEST_PROCESSOR_QUEUE && Boolean(job.requestId && job.movieId);
}

export async function listRequestFulfillmentJobsForAdmin(limit = 500) {
  try {
    const snapshot = await adminDb
      .collection(REQUEST_PROCESSING_JOBS_COLLECTION)
      .where('processorQueue', '==', REQUEST_PROCESSOR_QUEUE)
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(mapRequestJobDoc).filter(isRequestFulfillmentJob);
  } catch (error) {
    console.warn('[admin-request-jobs] filtered request queue query failed, using safe fallback', error);

    try {
      const snapshot = await adminDb
        .collection(REQUEST_PROCESSING_JOBS_COLLECTION)
        .where('processorQueue', '==', REQUEST_PROCESSOR_QUEUE)
        .limit(limit)
        .get();

      return snapshot.docs
        .map(mapRequestJobDoc)
        .filter(isRequestFulfillmentJob)
        .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''));
    } catch (fallbackError) {
      console.warn('[admin-request-jobs] processor queue fallback failed, using broad safe scan', fallbackError);

      const snapshot = await adminDb
        .collection(REQUEST_PROCESSING_JOBS_COLLECTION)
        .orderBy('updatedAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(mapRequestJobDoc).filter(isRequestFulfillmentJob);
    }
  }
}
