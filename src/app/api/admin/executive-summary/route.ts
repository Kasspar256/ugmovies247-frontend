import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { getAdminControlCenterPayload } from '@/lib/server/adminControlCenter';
import { readCachedVideoJobs } from '@/lib/server/adminProcessingCache';
import { listRequestFulfillmentJobsForAdmin } from '@/lib/server/adminRequestJobs';
import { listPaymentsForAdminByProvider } from '@/lib/server/subscriptions';
import { listVideoJobs } from '@/lib/server/videoJobs';
import type { ExecutiveMissingMetric, ExecutiveSummaryPayload } from '@/types/executiveSummary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CardPaymentSummary = {
  monthAmount: number;
};

const ACTIVE_VIDEO_JOB_STATUSES = new Set(['queued', 'downloading', 'inspecting', 'processing', 'uploading']);
const PENDING_REQUEST_STATUSES = new Set(['pending', 'new']);
const ADMIN_USERS_LIMIT = 200;
const ADMIN_REQUESTS_LIMIT = 200;
const ADMIN_VIDEO_JOBS_LIMIT = 500;
const ADMIN_REQUEST_JOBS_LIMIT = 500;

async function requireAdmin() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return null;
  }

  return session;
}

async function getCardPaymentSummary(): Promise<CardPaymentSummary> {
  const payments = await listPaymentsForAdminByProvider('payfast', 200);
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const monthAmount = payments
    .filter((payment) => payment.status === 'completed')
    .filter((payment) => String(payment.createdAt || '').startsWith(monthKey))
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);

  return { monthAmount };
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

export async function GET() {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [controlCenterResult, cardSummaryResult, videoJobsResult, requestJobsResult] =
      await Promise.allSettled([
        getAdminControlCenterPayload(),
        getCardPaymentSummary(),
        readCachedVideoJobs(() => listVideoJobs(ADMIN_VIDEO_JOBS_LIMIT), 1000 * 60),
        listRequestFulfillmentJobsForAdmin(ADMIN_REQUEST_JOBS_LIMIT),
      ]);

    const missingMetrics: ExecutiveMissingMetric[] = [];

    const controlCenter =
      controlCenterResult.status === 'fulfilled' ? controlCenterResult.value : null;
    const cardSummary = cardSummaryResult.status === 'fulfilled' ? cardSummaryResult.value : null;
    const videoJobs = videoJobsResult.status === 'fulfilled' ? videoJobsResult.value : null;
    const requestJobs = requestJobsResult.status === 'fulfilled' ? requestJobsResult.value : null;

    if (!controlCenter) {
      addMissingMetrics(
        missingMetrics,
        [
          'usersTotal',
          'activeSubscribers',
          'activeSubscriptionValue',
          'mobileMoneyRevenueThisMonth',
          'movieCount',
          'seriesCount',
          'requestCount',
          'pendingRequests',
        ],
        controlCenterResult.status === 'rejected'
          ? controlCenterResult.reason instanceof Error
            ? controlCenterResult.reason.message
            : 'Failed to load admin control-center summary.'
          : 'Admin control-center summary was unavailable.'
      );
    }

    if (!cardSummary) {
      addMissingMetric(
        missingMetrics,
        'cardRevenueThisMonth',
        cardSummaryResult.status === 'rejected'
          ? cardSummaryResult.reason instanceof Error
            ? cardSummaryResult.reason.message
            : 'Failed to load card payment summary.'
          : 'Card payment summary was unavailable.'
      );
    }

    if (!videoJobs) {
      addMissingMetrics(
        missingMetrics,
        ['activeVideoJobs', 'failedVideoJobs'],
        videoJobsResult.status === 'rejected'
          ? videoJobsResult.reason instanceof Error
            ? videoJobsResult.reason.message
            : 'Failed to load video jobs.'
          : 'Video jobs were unavailable.'
      );
    }

    if (!requestJobs) {
      addMissingMetric(
        missingMetrics,
        'failedRequestJobs',
        requestJobsResult.status === 'rejected'
          ? requestJobsResult.reason instanceof Error
            ? requestJobsResult.reason.message
            : 'Failed to load request jobs.'
          : 'Request jobs were unavailable.'
      );
    }

    addMissingMetric(
      missingMetrics,
      'revenueThisMonth',
      'Existing APIs expose card revenue in ZAR and mobile money revenue in UGX, so a safe combined total requires currency conversion context.'
    );

    const movies = controlCenter?.movies || [];
    const requests = controlCenter?.requests || [];
    const usersMayBeTruncated = Boolean(controlCenter && controlCenter.users.length >= ADMIN_USERS_LIMIT);
    const requestsMayBeTruncated = Boolean(controlCenter && controlCenter.requests.length >= ADMIN_REQUESTS_LIMIT);
    const videoJobsMayBeTruncated = Boolean(videoJobs && videoJobs.length >= ADMIN_VIDEO_JOBS_LIMIT);
    const requestJobsMayBeTruncated = Boolean(requestJobs && requestJobs.length >= ADMIN_REQUEST_JOBS_LIMIT);

    if (usersMayBeTruncated) {
      addMissingMetrics(
        missingMetrics,
        ['usersTotal', 'activeSubscribers'],
        'The existing admin users API returns a capped list of 200 users, so a safe total cannot be guaranteed when the cap is reached.'
      );
    }

    if (requestsMayBeTruncated) {
      addMissingMetrics(
        missingMetrics,
        ['requestCount', 'pendingRequests'],
        'The existing admin requests API returns a capped list of 200 requests, so a safe total cannot be guaranteed when the cap is reached.'
      );
    }

    if (videoJobsMayBeTruncated) {
      addMissingMetrics(
        missingMetrics,
        ['activeVideoJobs', 'failedVideoJobs'],
        'The existing admin video jobs API returns a capped list of 500 jobs, so safe job totals cannot be guaranteed when the cap is reached.'
      );
    }

    if (requestJobsMayBeTruncated) {
      addMissingMetric(
        missingMetrics,
        'failedRequestJobs',
        'The existing admin request jobs API returns a capped list of 500 jobs, so safe failed-job totals cannot be guaranteed when the cap is reached.'
      );
    }

    const activeSubscribers =
      controlCenter && !usersMayBeTruncated
        ? controlCenter.users.filter((user) => user.subscription?.isActive === true).length
        : null;
    const activeVideoJobs =
      videoJobs && !videoJobsMayBeTruncated
        ? videoJobs.filter((job) => ACTIVE_VIDEO_JOB_STATUSES.has(String(job.status || ''))).length
        : null;
    const failedVideoJobs =
      videoJobs && !videoJobsMayBeTruncated
        ? videoJobs.filter((job) => job.status === 'failed').length
        : null;
    const failedRequestJobs =
      requestJobs && !requestJobsMayBeTruncated
        ? requestJobs.filter((job) => job.status === 'failed').length
        : null;
    const pendingRequests =
      controlCenter && !requestsMayBeTruncated
        ? controlCenter.requests.filter((request) => PENDING_REQUEST_STATUSES.has(String(request.status))).length
        : null;

    const summary: ExecutiveSummaryPayload = {
      usersTotal: controlCenter && !usersMayBeTruncated ? controlCenter.users.length : null,
      activeSubscribers,
      revenueThisMonth: null,
      activeSubscriptionValue: controlCenter?.revenue.activeSubscriptionRevenue ?? null,
      cardRevenueThisMonth: cardSummary?.monthAmount ?? null,
      mobileMoneyRevenueThisMonth: controlCenter?.revenue.monthRevenue ?? null,
      movieCount: controlCenter
        ? movies.filter((movie) => movie.contentType !== 'series').length
        : null,
      seriesCount: controlCenter
        ? movies.filter((movie) => movie.contentType === 'series').length
        : null,
      requestCount: controlCenter && !requestsMayBeTruncated ? requests.length : null,
      pendingRequests,
      failedRequestJobs,
      activeVideoJobs,
      failedVideoJobs,
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
