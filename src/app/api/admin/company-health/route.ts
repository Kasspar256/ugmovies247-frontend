import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAdminControlCenterPayload } from '@/lib/server/adminControlCenter';
import { VIDEO_JOBS_COLLECTION } from '@/lib/server/firestoreNamespaces';
import {
  MOVIE_REQUESTS_COLLECTION,
  REQUEST_PROCESSING_JOBS_COLLECTION,
  REQUEST_PROCESSOR_QUEUE,
} from '@/lib/server/movieRequests';
import {
  getActiveSubscriptionValueForProvider,
  getCompletedPaymentAmountForProviderInRange,
} from '@/lib/server/subscriptions';
import type { ExecutiveMissingMetric, ExecutiveSummaryPayload } from '@/types/executiveSummary';
import type { VideoJobDocument } from '@/types/videoJobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PaymentMonthSummary = {
  cardAmount: number;
  mobileMoneyAmount: number;
  activeSubscriptionValue: number;
};

type RequestSummary = {
  requestCount: number;
  pendingRequests: number;
};

type VideoJobSummary = {
  activeVideoJobs: number;
  failedVideoJobs: number;
};

type RequestJobSummary = {
  failedRequestJobs: number;
};

type VideoJobFailuresSummary = {
  totalFailedJobs: number;
  scannedFailedJobs: number;
  scanLimit: number;
  sourceCollection: string;
  failureReasonField: 'errorMessage';
  timestampFieldsUsed: string[];
  latestFailedJobTimestamp: string | null;
  oldestFailedJobTimestamp: string | null;
  topFailureReasons: Array<{ reason: string; count: number }>;
  countByFailureReason: Record<string, number>;
  failuresInLast24h: number;
  failuresInLast7d: number;
  failuresInLast30d: number;
  summaryIsPartial: boolean;
  timestamp: string;
};

const ACTIVE_VIDEO_JOB_STATUSES = new Set(['queued', 'downloading', 'inspecting', 'processing', 'uploading']);
const PENDING_REQUEST_STATUSES = new Set(['pending', 'new']);
const ADMIN_USERS_LIST_LIMIT = 200;
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

function getCurrentMonthRangeIso() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
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

async function getPaymentMonthSummary(): Promise<PaymentMonthSummary> {
  const { startIso, endIso } = getCurrentMonthRangeIso();
  const [cardAmount, mobileMoneyAmount, activeSubscriptionValue] = await Promise.all([
    getCompletedPaymentAmountForProviderInRange('payfast', startIso, endIso),
    getCompletedPaymentAmountForProviderInRange('pawapay', startIso, endIso),
    getActiveSubscriptionValueForProvider('pawapay'),
  ]);

  return { cardAmount, mobileMoneyAmount, activeSubscriptionValue };
}

async function getRequestSummary(): Promise<RequestSummary> {
  const [requestCount, pendingRequests] = await Promise.all([
    readFirestoreCount(adminDb.collection(MOVIE_REQUESTS_COLLECTION)),
    readFirestoreCount(
      adminDb
        .collection(MOVIE_REQUESTS_COLLECTION)
        .where('status', 'in', Array.from(PENDING_REQUEST_STATUSES))
    ),
  ]);

  return { requestCount, pendingRequests };
}

async function getVideoJobSummary(): Promise<VideoJobSummary> {
  const [activeVideoJobs, failedVideoJobs] = await Promise.all([
    readFirestoreCount(
      adminDb
        .collection(VIDEO_JOBS_COLLECTION)
        .where('status', 'in', Array.from(ACTIVE_VIDEO_JOB_STATUSES))
    ),
    readFirestoreCount(adminDb.collection(VIDEO_JOBS_COLLECTION).where('status', '==', 'failed')),
  ]);

  return { activeVideoJobs, failedVideoJobs };
}

async function getRequestJobSummary(): Promise<RequestJobSummary> {
  const failedRequestJobs = await readFirestoreCount(
    adminDb
      .collection(REQUEST_PROCESSING_JOBS_COLLECTION)
      .where('processorQueue', '==', REQUEST_PROCESSOR_QUEUE)
      .where('status', '==', 'failed')
  );

  return { failedRequestJobs };
}

function addMissingMetric(
  missingMetrics: ExecutiveMissingMetric[],
  metric: string,
  reason: string
) {
  if (!missingMetrics.some((entry) => entry.metric === metric)) {
    missingMetrics.push({ metric, reason });
  }
}

function addMissingMetrics(
  missingMetrics: ExecutiveMissingMetric[],
  metrics: string[],
  reason: string
) {
  for (const metric of metrics) {
    addMissingMetric(missingMetrics, metric, reason);
  }
}

function buildExecutiveWarnings(input: {
  pendingRequests: number | null;
  failedRequestJobs: number | null;
  activeVideoJobs: number | null;
  failedVideoJobs: number | null;
  missingMetrics: ExecutiveMissingMetric[];
}) {
  const warnings: string[] = [];

  if (typeof input.failedRequestJobs === 'number' && input.failedRequestJobs > 0) {
    warnings.push(`${input.failedRequestJobs} request fulfillment jobs failed.`);
  }

  if (typeof input.failedVideoJobs === 'number' && input.failedVideoJobs > 0) {
    warnings.push(`${input.failedVideoJobs} video processing jobs failed.`);
  }

  if (typeof input.pendingRequests === 'number' && input.pendingRequests > 0) {
    warnings.push(`${input.pendingRequests} viewer requests are pending review.`);
  }

  if (typeof input.activeVideoJobs === 'number' && input.activeVideoJobs > 0) {
    warnings.push(`${input.activeVideoJobs} video jobs are currently active.`);
  }

  const unavailableMetrics = input.missingMetrics.filter((entry) => entry.metric !== 'revenueThisMonth');

  if (unavailableMetrics.length > 0) {
    warnings.push(`${unavailableMetrics.length} executive metrics are unavailable from current read-only sources.`);
  }

  return warnings;
}

async function buildExecutiveSummary(): Promise<ExecutiveSummaryPayload> {
  const [
    controlCenterResult,
    paymentSummaryResult,
    requestSummaryResult,
    videoJobSummaryResult,
    requestJobSummaryResult,
  ] = await Promise.allSettled([
    getAdminControlCenterPayload(),
    getPaymentMonthSummary(),
    getRequestSummary(),
    getVideoJobSummary(),
    getRequestJobSummary(),
  ]);

  const missingMetrics: ExecutiveMissingMetric[] = [];

  const controlCenter =
    controlCenterResult.status === 'fulfilled' ? controlCenterResult.value : null;
  const paymentSummary =
    paymentSummaryResult.status === 'fulfilled' ? paymentSummaryResult.value : null;
  const requestSummary =
    requestSummaryResult.status === 'fulfilled' ? requestSummaryResult.value : null;
  const videoJobSummary =
    videoJobSummaryResult.status === 'fulfilled' ? videoJobSummaryResult.value : null;
  const requestJobSummary =
    requestJobSummaryResult.status === 'fulfilled' ? requestJobSummaryResult.value : null;

  if (!controlCenter) {
    addMissingMetrics(
      missingMetrics,
      ['usersTotal', 'activeSubscribers', 'movieCount', 'seriesCount'],
      controlCenterResult.status === 'rejected'
        ? controlCenterResult.reason instanceof Error
          ? controlCenterResult.reason.message
          : 'Failed to load admin control-center summary.'
        : 'Admin control-center summary was unavailable.'
    );
  }

  if (!paymentSummary) {
    addMissingMetrics(
      missingMetrics,
      ['activeSubscriptionValue', 'cardRevenueThisMonth', 'mobileMoneyRevenueThisMonth'],
      paymentSummaryResult.status === 'rejected'
        ? paymentSummaryResult.reason instanceof Error
          ? paymentSummaryResult.reason.message
          : 'Failed to load payment summary.'
        : 'Payment summary was unavailable.'
    );
  }

  if (!requestSummary) {
    addMissingMetrics(
      missingMetrics,
      ['requestCount', 'pendingRequests'],
      requestSummaryResult.status === 'rejected'
        ? requestSummaryResult.reason instanceof Error
          ? requestSummaryResult.reason.message
          : 'Failed to load request counts.'
        : 'Request counts were unavailable.'
    );
  }

  if (!videoJobSummary) {
    addMissingMetrics(
      missingMetrics,
      ['activeVideoJobs', 'failedVideoJobs'],
      videoJobSummaryResult.status === 'rejected'
        ? videoJobSummaryResult.reason instanceof Error
          ? videoJobSummaryResult.reason.message
          : 'Failed to load video job counts.'
        : 'Video job counts were unavailable.'
    );
  }

  if (!requestJobSummary) {
    addMissingMetric(
      missingMetrics,
      'failedRequestJobs',
      requestJobSummaryResult.status === 'rejected'
        ? requestJobSummaryResult.reason instanceof Error
          ? requestJobSummaryResult.reason.message
          : 'Failed to load request job counts.'
        : 'Request job counts were unavailable.'
    );
  }

  addMissingMetric(
    missingMetrics,
    'revenueThisMonth',
    'Existing APIs expose card revenue in ZAR and mobile money revenue in UGX, so a safe combined total requires currency conversion context.'
  );

  const movies = controlCenter?.movies || [];
  const userMetrics = controlCenter?.userMetrics || null;
  const userMetricsMayBeFallbackCapped = Boolean(
    controlCenter &&
      userMetrics?.source === 'list-fallback' &&
      controlCenter.users.length >= ADMIN_USERS_LIST_LIMIT
  );

  if (userMetricsMayBeFallbackCapped) {
    addMissingMetrics(
      missingMetrics,
      ['usersTotal', 'activeSubscribers'],
      'Firestore user count aggregation was unavailable and the fallback user list is capped, so safe user totals cannot be guaranteed.'
    );
  }

  const summary: ExecutiveSummaryPayload = {
    usersTotal: userMetrics && !userMetricsMayBeFallbackCapped ? userMetrics.totalUsers : null,
    activeSubscribers:
      userMetrics && !userMetricsMayBeFallbackCapped ? userMetrics.activeSubscribers : null,
    revenueThisMonth: null,
    activeSubscriptionValue: paymentSummary?.activeSubscriptionValue ?? null,
    cardRevenueThisMonth: paymentSummary?.cardAmount ?? null,
    mobileMoneyRevenueThisMonth: paymentSummary?.mobileMoneyAmount ?? null,
    movieCount: controlCenter
      ? movies.filter((movie) => movie.contentType !== 'series').length
      : null,
    seriesCount: controlCenter
      ? movies.filter((movie) => movie.contentType === 'series').length
      : null,
    requestCount: requestSummary?.requestCount ?? null,
    pendingRequests: requestSummary?.pendingRequests ?? null,
    failedRequestJobs: requestJobSummary?.failedRequestJobs ?? null,
    activeVideoJobs: videoJobSummary?.activeVideoJobs ?? null,
    failedVideoJobs: videoJobSummary?.failedVideoJobs ?? null,
    mobileMoneyCurrency: 'UGX',
    cardCurrency: 'ZAR',
    activeSubscriptionValueCurrency: 'UGX',
    topOperationalWarnings: [],
    missingMetrics,
    timestamp: new Date().toISOString(),
  };

  summary.topOperationalWarnings = buildExecutiveWarnings({
    pendingRequests: summary.pendingRequests,
    failedRequestJobs: summary.failedRequestJobs,
    activeVideoJobs: summary.activeVideoJobs,
    failedVideoJobs: summary.failedVideoJobs,
    missingMetrics,
  }).slice(0, 5);

  return summary;
}

function toMillis(value: unknown) {
  if (!value) {
    return 0;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const dateValue = (value as { toDate: () => Date }).toDate();
    return dateValue.getTime();
  }

  const parsed = Date.parse(String(value));

  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoOrNull(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Date(value).toISOString();
}

function normalizeMessage(message: unknown) {
  return String(message || '').replace(/\s+/g, ' ').trim();
}

function classifyFailure(message: unknown) {
  const text = normalizeMessage(message).toLowerCase();

  if (!text) {
    return 'missing error message';
  }

  if (/cancelled by admin/.test(text)) {
    return 'cancelled by admin';
  }

  if (/not a usable mp4|only direct mp4 links are supported|detected format/.test(text)) {
    return 'unsupported file/container';
  }

  if (/could not be parsed|invalid data found|moov atom|ffprobe|inspection/.test(text)) {
    return 'invalid or damaged video file';
  }

  if (/not enough free disk|free disk space/.test(text)) {
    return 'low vps disk space';
  }

  if (/max file size|too large|content-length|payload too large/.test(text)) {
    return 'source file too large';
  }

  if (/403|401|forbidden|unauthorized|access denied|hotlink|permission/.test(text)) {
    return 'source link blocked access';
  }

  if (/404|not found|410|gone/.test(text)) {
    return 'source link missing';
  }

  if (/timeout|timed out|stalled|deadline exceeded/.test(text)) {
    return 'network timeout/stalled';
  }

  if (/econnreset|etimedout|eai_again|fetch failed|socket hang up|connection reset|network/.test(text)) {
    return 'network connection failed';
  }

  if (/request aborted|one or more of the specified parts could not be found|multipart/.test(text)) {
    return 'r2 multipart upload failed';
  }

  if (/quota|resource_exhausted|ramp up limit/.test(text)) {
    return 'firestore quota/throttling';
  }

  if (/ffmpeg|conversion failed|encoder|transcod|non-monotonous|aac|h264/.test(text)) {
    return 'ffmpeg processing failed';
  }

  return 'other';
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

async function buildVideoJobFailuresSummary(): Promise<VideoJobFailuresSummary> {
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

    if (failedAt >= oneDayAgo) {
      failuresInLast24h += 1;
    }

    if (failedAt >= sevenDaysAgo) {
      failuresInLast7d += 1;
    }

    if (failedAt >= thirtyDaysAgo) {
      failuresInLast30d += 1;
    }

    increment(countByFailureReason, classifyFailure(job.errorMessage));
  }

  const sortedFailureReasons = [...countByFailureReason.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));

  return {
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
  };
}

function mergeWarnings(input: {
  executiveSummary: ExecutiveSummaryPayload;
  videoJobFailures: VideoJobFailuresSummary;
}) {
  const warnings = new Set<string>();

  for (const warning of input.executiveSummary.topOperationalWarnings || []) {
    warnings.add(warning);
  }

  if (input.videoJobFailures.failuresInLast24h > 0) {
    warnings.add(`${input.videoJobFailures.failuresInLast24h} video jobs failed in the last 24 hours.`);
  }

  if (input.videoJobFailures.failuresInLast7d > 0) {
    warnings.add(`${input.videoJobFailures.failuresInLast7d} video jobs failed in the last 7 days.`);
  }

  const topFailure = input.videoJobFailures.topFailureReasons[0];

  if (topFailure) {
    warnings.add(`Top video failure reason: ${topFailure.reason} (${topFailure.count}).`);
  }

  return [...warnings].slice(0, 8);
}

export async function GET(request: Request) {
  try {
    if (!(await requireReadAccess(request))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [executiveSummary, videoJobFailures] = await Promise.all([
      buildExecutiveSummary(),
      buildVideoJobFailuresSummary(),
    ]);
    const topWarnings = mergeWarnings({ executiveSummary, videoJobFailures });

    return NextResponse.json({
      executiveSummary,
      videoJobFailures,
      topWarnings,
      missingMetrics: executiveSummary.missingMetrics || [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[company-health] failed', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load company health.',
      },
      { status: 500 }
    );
  }
}
