import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { REQUEST_PROCESSING_JOBS_COLLECTION } from '@/lib/server/movieRequests';
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
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    startedAt: timestampToIso(data.startedAt),
    completedAt: timestampToIso(data.completedAt),
  };
}

export async function GET() {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // The request worker runs on a separate VPS and writes with server credentials.
    // The browser reads this queue through this admin API so Firestore client rules
    // do not need to expose internal processing documents.
    const snapshot = await adminDb
      .collection(REQUEST_PROCESSING_JOBS_COLLECTION)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    return NextResponse.json({ jobs: snapshot.docs.map(mapRequestJobDoc) });
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
