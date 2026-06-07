#!/usr/bin/env node

const DEFAULT_ENDPOINT = 'https://ugmovies247.com/api/admin/company-health';

const endpoint = process.env.RON_COMPANY_HEALTH_URL || DEFAULT_ENDPOINT;
const readOnlyToken =
  process.env.RON_EXECUTIVE_SUMMARY_TOKEN ||
  process.env.EXECUTIVE_SUMMARY_READ_TOKEN ||
  process.env.UGMOVIES_EXECUTIVE_SUMMARY_READ_TOKEN ||
  '';

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unavailable';
  }

  return new Intl.NumberFormat('en-US').format(value);
}

function formatMoney(value, currency) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unavailable';
  }

  return currency ? `${currency} ${formatNumber(value)}` : formatNumber(value);
}

function formatList(items, fallback) {
  if (!Array.isArray(items) || items.length === 0) {
    return `- ${fallback}`;
  }

  return items.map((item) => `- ${String(item)}`).join('\n');
}

function formatMissingMetrics(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '- None reported';
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return `- ${String(item)}`;
      }

      return `- ${item.metric || 'unknown'}: ${item.reason || 'No reason provided.'}`;
    })
    .join('\n');
}

function formatFailureReasons(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '- None reported';
  }

  return items
    .map((item) => `- ${item.reason || 'unknown'}: ${formatNumber(item.count)}`)
    .join('\n');
}

function printAuthHelp() {
  console.error('UGMOVIES247 Company Health');
  console.error('');
  console.error('Could not authenticate to the production company-health endpoint.');
  console.error('');
  console.error('Required read-only auth:');
  console.error('- Set RON_EXECUTIVE_SUMMARY_TOKEN to the same read-only token used for executive reporting.');
  console.error('- The token is sent as Authorization: Bearer and is only used against read-only endpoints.');
  console.error('');
  console.error('Example:');
  console.error("RON_EXECUTIVE_SUMMARY_TOKEN='your-read-only-token' node ~/kasspar-tools/ron-company-health.js");
}

function printBriefing(payload) {
  const executive = payload.executiveSummary || {};
  const failures = payload.videoJobFailures || {};
  const combinedRevenue =
    typeof executive.revenueThisMonth === 'number'
      ? formatMoney(executive.revenueThisMonth)
      : 'Unavailable: card and mobile money use different currencies';

  console.log('UGMOVIES247 COMPANY HEALTH');
  console.log('=========================');
  console.log(`Timestamp: ${payload.timestamp || new Date().toISOString()}`);
  console.log('');
  console.log('Executive Snapshot');
  console.log(`- Users total: ${formatNumber(executive.usersTotal)}`);
  console.log(`- Active subscribers: ${formatNumber(executive.activeSubscribers)}`);
  console.log(`- Active subscription value: ${formatMoney(executive.activeSubscriptionValue, executive.activeSubscriptionValueCurrency || 'UGX')}`);
  console.log(`- Mobile money this month: ${formatMoney(executive.mobileMoneyRevenueThisMonth, executive.mobileMoneyCurrency || 'UGX')}`);
  console.log(`- Card revenue this month: ${formatMoney(executive.cardRevenueThisMonth, executive.cardCurrency || 'ZAR')}`);
  console.log(`- Combined revenue this month: ${combinedRevenue}`);
  console.log(`- Movies: ${formatNumber(executive.movieCount)}`);
  console.log(`- Series: ${formatNumber(executive.seriesCount)}`);
  console.log(`- Requests: ${formatNumber(executive.requestCount)}`);
  console.log(`- Pending requests: ${formatNumber(executive.pendingRequests)}`);
  console.log('');
  console.log('Video Job Failures');
  console.log(`- Total failed jobs: ${formatNumber(failures.totalFailedJobs)}`);
  console.log(`- Failures last 24h: ${formatNumber(failures.failuresInLast24h)}`);
  console.log(`- Failures last 7d: ${formatNumber(failures.failuresInLast7d)}`);
  console.log(`- Failures last 30d: ${formatNumber(failures.failuresInLast30d)}`);
  console.log(`- Latest failed job: ${failures.latestFailedJobTimestamp || 'Unavailable'}`);
  console.log(`- Oldest failed job: ${failures.oldestFailedJobTimestamp || 'Unavailable'}`);
  console.log('');
  console.log('Top Video Failure Reasons');
  console.log(formatFailureReasons(failures.topFailureReasons));
  console.log('');
  console.log('Top Warnings');
  console.log(formatList(payload.topWarnings, 'None reported'));
  console.log('');
  console.log('Missing Metrics');
  console.log(formatMissingMetrics(payload.missingMetrics));
}

async function main() {
  if (typeof fetch !== 'function') {
    console.error('Node.js 18+ is required because this script uses the built-in fetch API.');
    process.exitCode = 1;
    return;
  }

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'ugmovies247-ron-company-health/1.0',
  };

  if (readOnlyToken.trim()) {
    headers.Authorization = `Bearer ${readOnlyToken.trim()}`;
  }

  const response = await fetch(endpoint, {
    method: 'GET',
    headers,
    redirect: 'manual',
  });
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (response.status === 401 || response.status === 403) {
    printAuthHelp();
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    console.error(`Company health request failed with HTTP ${response.status}.`);
    console.error(payload?.error || text.slice(0, 800));
    process.exitCode = 1;
    return;
  }

  if (!payload || typeof payload !== 'object') {
    console.error('Company health endpoint returned an invalid JSON payload.');
    process.exitCode = 1;
    return;
  }

  printBriefing(payload);
}

main().catch((error) => {
  console.error('Failed to fetch UGMOVIES247 company health.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
