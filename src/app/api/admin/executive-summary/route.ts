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

const ACTIVE_VIDEO_JOB_STATUSES = new Set(['queued', 'downloading', 'inspecting', 'processing', 'uploading']);
const PENDING_REQUEST_STATUSES = new Set(['pending', 'new']);
const ADMIN_USERS_LIST_LIMIT = 200;
const READ_ONLY_TOKEN_MIN_LENGTH = 32;

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

async function requireExecutiveSummaryReadAccess(request: Request) {
  if (hasValidReadOnlyToken(request)) {
    return { type: 'read-only-token' as const };
  }

  const session = await requireAdmin();

  if (!session) {
    return null;
  }

  return { type: 'admin-session' as const, session };
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

function buildWarnings(input: {
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

  return warnings.slice(0, 5);
}

export async function GET(request: Request) {
  try {
    const access = await requireExecutiveSummaryReadAccess(request);

    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
        [
          'usersTotal',
          'activeSubscribers',
          'movieCount',
          'seriesCount',
        ],
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

    summary.topOperationalWarnings = buildWarnings({
      pendingRequests: summary.pendingRequests,
      failedRequestJobs: summary.failedRequestJobs,
      activeVideoJobs: summary.activeVideoJobs,
      failedVideoJobs: summary.failedVideoJobs,
      missingMetrics,
    });

    return NextResponse.json(summary);
  } catch (error) {
    console.error('[admin-executive-summary] failed to load summary', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load executive summary.',
      },
      { status: 500 }
    );
  }
}
