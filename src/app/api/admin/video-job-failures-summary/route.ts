import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { VIDEO_JOBS_COLLECTION } from '@/lib/server/firestoreNamespaces';
import type { VideoJobDocument } from '@/types/videoJobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FAILED_VIDEO_JOB_SCAN_LIMIT = 5000;
const READ_ONLY_TOKEN_MIN_LENGTH = 32;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function requireAdmin() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return null;
  }

  return session;
}

function getConfiguredReadOnlyToken() {
  return (
    process.env.EXECUTIVE_SUMMARY_READ_TOKEN ||
    process.env.RON_EXECUTIVE_SUMMARY_TOKEN ||
    process.env.UGMOVIES_EXECUTIVE_SUMMARY_READ_TOKEN ||
    ''
  ).trim();
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getRequestReadOnlyToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  return (
    bearerMatch?.[1] ||
    request.headers.get('x-executive-summary-token') ||
    request.headers.get('x-ugmovies-executive-summary-token') ||
    ''
  ).trim();
}

function hasValidReadOnlyToken(request: Request) {
  const configuredToken = getConfiguredReadOnlyToken();
  const requestToken = getRequestReadOnlyToken(request);

  if (
    configuredToken.length < READ_ONLY_TOKEN_MIN_LENGTH ||
    requestToken.length < READ_ONLY_TOKEN_MIN_LENGTH
  ) {
    return false;
  }

  return constantTimeEqual(requestToken, configuredToken);
}

async function requireReadAccess(request: Request) {
  if (hasValidReadOnlyToken(request)) {
    return true;
  }

  return Boolean(await requireAdmin());
}

async function readFirestoreCount(query: unknown) {
  const aggregateSnapshot = await (query as {
    count: () => {
      get: () => Promise<{
        data: () => {
          count?: number;
        };
      }>;
    };
  })
    .count()
    .get();

  const count = Number(aggregateSnapshot.data().count || 0);
  return Number.isFinite(count) ? count : 0;
}

function toMillis(value: unknown) {
  if (!value) return 0;

  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoOrNull(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

function normalizeMessage(message: unknown) {
  return String(message || '').replace(/\s+/g, ' ').trim();
}

function classifyFailure(message: unknown) {
  const text = normalizeMessage(message).toLowerCase();

  if (!text) return 'missing error message';
  if (/cancelled by admin/.test(text)) return 'cancelled by admin';
  if (/not a usable mp4|only direct mp4 links are supported|detected format/.test(text)) return 'unsupported file/container';
  if (/could not be parsed|invalid data found|moov atom|ffprobe|inspection/.test(text)) return 'invalid or damaged video file';
  if (/not enough free disk|free disk space/.test(text)) return 'low vps disk space';
  if (/max file size|too large|content-length|payload too large/.test(text)) return 'source file too large';
  if (/403|401|forbidden|unauthorized|access denied|hotlink|permission/.test(text)) return 'source link blocked access';
  if (/404|not found|410|gone/.test(text)) return 'source link missing';
  if (/timeout|timed out|stalled|deadline exceeded/.test(text)) return 'network timeout/stalled';
  if (/econnreset|etimedout|eai_again|fetch failed|socket hang up|connection reset|network/.test(text)) return 'network connection failed';
  if (/request aborted|one or more of the specified parts could not be found|multipart/.test(text)) return 'r2 multipart upload failed';
  if (/quota|resource_exhausted|ramp up limit/.test(text)) return 'firestore quota/throttling';
  if (/ffmpeg|conversion failed|encoder|transcod|non-monotonous|aac|h264/.test(text)) return 'ffmpeg processing failed';

  return 'other';
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

export async function GET(request: Request) {
  try {
    if (!(await requireReadAccess(request))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const failedJobsQuery = adminDb.collection(VIDEO_JOBS_COLLECTION).where('status', '==', 'failed');
    const [totalFailedJobs, failedJobsSnapshot] = await Promise.all([
      readFirestoreCount(failedJobsQuery),
      failedJobsQuery.limit(FAILED_VIDEO_JOB_SCAN_LIMIT).get(),
    ]);

    const now = Date.now();
    const oneDayAgo = now - ONE_DAY_MS;
    const sevenDaysAgo = now - 7 * ONE_DAY_MS;
    const thirtyDaysAgo = now - 30 * ONE_DAY_MS;
    const countByFailureReason = new Map<string, number>();

    let latestFailedAt = 0;
    let oldestFailedAt = 0;
    let failuresInLast24h = 0;
    let failuresInLast7d = 0;
    let failuresInLast30d = 0;

    for (const doc of failedJobsSnapshot.docs) {
      const job = doc.data() as VideoJobDocument;
      const failedAt = Math.max(toMillis(job.updatedAt), toMillis(job.createdAt));

      latestFailedAt = Math.max(latestFailedAt, failedAt);
      oldestFailedAt = oldestFailedAt ? Math.min(oldestFailedAt, failedAt || oldestFailedAt) : failedAt;

      if (failedAt >= oneDayAgo) failuresInLast24h += 1;
      if (failedAt >= sevenDaysAgo) failuresInLast7d += 1;
      if (failedAt >= thirtyDaysAgo) failuresInLast30d += 1;

      increment(countByFailureReason, classifyFailure(job.errorMessage));
    }

    const sortedFailureReasons = [...countByFailureReason.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([reason, count]) => ({ reason, count }));

    return NextResponse.json({
      totalFailedJobs,
      scannedFailedJobs: failedJobsSnapshot.size,
      scanLimit: FAILED_VIDEO_JOB_SCAN_LIMIT,
      sourceCollection: VIDEO_JOBS_COLLECTION,
      failureReasonField: 'errorMessage',
      timestampFieldsUsed: ['updatedAt', 'createdAt'],
      latestFailedJobTimestamp: toIsoOrNull(latestFailedAt),
      oldestFailedJobTimestamp: toIsoOrNull(oldestFailedAt),
      topFailureReasons: sortedFailureReasons.slice(0, 10),
      countByFailureReason: Object.fromEntries(sortedFailureReasons.map((entry) => [entry.reason, entry.count])),
      failuresInLast24h,
      failuresInLast7d,
      failuresInLast30d,
      summaryIsPartial: totalFailedJobs > failedJobsSnapshot.size,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[video-job-failures-summary] failed', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load video job failures summary.',
      },
      { status: 500 }
    );
  }
}
