import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  MOVIE_REQUESTS_COLLECTION,
  REQUEST_PROCESSING_JOBS_COLLECTION,
  REQUEST_PROCESSOR_QUEUE,
  TELEGRAM_REQUEST_PROCESSOR_QUEUE,
} from '@/lib/server/movieRequests';
import type { RequestProcessingJob, RequestProcessingJobStatus } from '@/types/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return null;
  }

  return session;
}

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

function mapRequestJobDoc(doc: { id: string; data: () => Record<string, unknown> }): RequestProcessingJob {
  const data = doc.data() || {};

  return {
    id: doc.id,
    requestId: String(data.requestId || ''),
    movieId: String(data.movieId || ''),
    title: String(data.title || 'Untitled request job'),
    userEmail: String(data.userEmail || ''),
    contentType: data.contentType === 'series' ? 'series' : 'movie',
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

function isRequestFulfillmentJob(job: RequestProcessingJob) {
  if (job.processorQueue === TELEGRAM_REQUEST_PROCESSOR_QUEUE) {
    return false;
  }

  if (job.id.startsWith('telegram-') || job.telegramChatId || job.telegramMessageId) {
    return false;
  }

  return job.processorQueue === REQUEST_PROCESSOR_QUEUE && Boolean(job.requestId && job.movieId);
}

function getRequestJobId(body: Record<string, unknown>) {
  return String(body.id || body.jobId || '').trim();
}

function getRequestJobAction(body: Record<string, unknown>) {
  const action = String(body.action || '').trim().toLowerCase();
  return action === 'retry' || action === 'delete' ? action : '';
}

async function listRequestFulfillmentJobs(limit = 500) {
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

export async function GET() {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const jobs = await listRequestFulfillmentJobs(500);

    return NextResponse.json({ jobs, limit: 500 });
  } catch (error) {
    console.error('[admin-request-jobs] failed to list request jobs', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load request processing jobs.',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = getRequestJobId(body);
    const action = getRequestJobAction(body);

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing request job action.' }, { status: 400 });
    }

    const jobRef = adminDb.collection(REQUEST_PROCESSING_JOBS_COLLECTION).doc(id);
    const snapshot = await jobRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Request job not found.' }, { status: 404 });
    }

    const job = mapRequestJobDoc({ id: snapshot.id, data: () => snapshot.data() || {} });

    if (!isRequestFulfillmentJob(job)) {
      return NextResponse.json({ error: 'This is not a request fulfillment job.' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const requestRef = job.requestId ? adminDb.collection(MOVIE_REQUESTS_COLLECTION).doc(job.requestId) : null;

    if (action === 'delete') {
      await jobRef.delete();

      if (requestRef) {
        await requestRef.set(
          {
            status: 'pending',
            processingJobId: '',
            workerStatus: 'deleted',
            workerError: '',
            progress: 0,
            currentStage: 'Removed from request processing queue',
            updatedAt: timestamp,
            lastActionAt: timestamp,
          },
          { merge: true }
        );
      }

      return NextResponse.json({ ok: true, deleted: true });
    }

    await jobRef.set(
      {
        status: 'queued',
        progress: 0,
        workerId: '',
        workerHeartbeatAt: null,
        startedAt: null,
        completedAt: null,
        errorMessage: '',
        currentStage: 'Queued for request VPS final processing',
        queuedAt: timestamp,
        updatedAt: timestamp,
        serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (requestRef) {
      await requestRef.set(
        {
          status: 'processing',
          processingJobId: job.id,
          workerStatus: 'queued',
          workerError: '',
          progress: 0,
          currentStage: 'Queued for request VPS final processing',
          updatedAt: timestamp,
          lastActionAt: timestamp,
        },
        { merge: true }
      );
    }

    return NextResponse.json({ ok: true, retried: true });
  } catch (error) {
    console.error('[admin-request-jobs] failed to update request job', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update request processing job.',
      },
      { status: 500 }
    );
  }
}
