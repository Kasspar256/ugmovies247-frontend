#!/usr/bin/env node

const DEFAULT_ENDPOINT = 'https://ugmovies247.com/api/admin/executive-summary';

const endpoint = process.env.RON_EXECUTIVE_SUMMARY_URL || DEFAULT_ENDPOINT;
const readOnlyToken =
  process.env.RON_EXECUTIVE_SUMMARY_TOKEN ||
  process.env.EXECUTIVE_SUMMARY_READ_TOKEN ||
  process.env.UGMOVIES_EXECUTIVE_SUMMARY_READ_TOKEN ||
  '';
const cookieHeader =
  process.env.RON_EXECUTIVE_SUMMARY_COOKIE ||
  process.env.UGMOVIES_EXECUTIVE_SUMMARY_COOKIE ||
  process.env.UGMOVIES_ADMIN_COOKIE ||
  '';

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatMoney(value, currency) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
  return currency ? `${currency} ${formatNumber(value)}` : formatNumber(value);
}

function formatList(items, fallback) {
  if (!Array.isArray(items) || items.length === 0) return `- ${fallback}`;
  return items.map((item) => `- ${String(item)}`).join('\n');
}

function formatMissingMetrics(items) {
  if (!Array.isArray(items) || items.length === 0) return '- None reported';
  return items.map((item) => {
    if (!item || typeof item !== 'object') return `- ${String(item)}`;
    return `- ${item.metric || 'unknown'}: ${item.reason || 'No reason provided.'}`;
  }).join('\n');
}

function printAuthHelp() {
  console.error('UGMOVIES247 Executive Summary\n');
  console.error('Could not authenticate to the production admin endpoint.\n');
  console.error('Current codebase authentication:');
  console.error('- /api/admin/executive-summary accepts a dedicated read-only bearer token.');
  console.error('- The token must be configured on the server as EXECUTIVE_SUMMARY_READ_TOKEN.\n');
  console.error('Safe read-only method:');
  console.error('- Run this script with RON_EXECUTIVE_SUMMARY_TOKEN set to the same token value.');
  console.error('- The token is only used against the executive-summary GET endpoint.\n');
  console.error('Example:');
  console.error("RON_EXECUTIVE_SUMMARY_TOKEN='your-read-only-token' node scripts/ron-executive-summary.js");
}

function printReport(summary) {
  const combinedRevenue =
    typeof summary.revenueThisMonth === 'number'
      ? formatMoney(summary.revenueThisMonth)
      : 'Unavailable: card and mobile money use different currencies';

  console.log('UGMOVIES247 EXECUTIVE SUMMARY');
  console.log('============================');
  console.log(`Timestamp: ${summary.timestamp || new Date().toISOString()}\n`);
  console.log('Audience');
  console.log(`- Users total: ${formatNumber(summary.usersTotal)}`);
  console.log(`- Active subscribers: ${formatNumber(summary.activeSubscribers)}`);
  console.log(`- Active subscription value: ${formatMoney(summary.activeSubscriptionValue, summary.activeSubscriptionValueCurrency || 'UGX')}\n`);
  console.log('Revenue This Month');
  console.log(`- Mobile money: ${formatMoney(summary.mobileMoneyRevenueThisMonth, summary.mobileMoneyCurrency || 'UGX')}`);
  console.log(`- Card revenue: ${formatMoney(summary.cardRevenueThisMonth, summary.cardCurrency || 'ZAR')}`);
  console.log(`- Combined revenue: ${combinedRevenue}\n`);
  console.log('Content');
  console.log(`- Movies: ${formatNumber(summary.movieCount)}`);
  console.log(`- Series: ${formatNumber(summary.seriesCount)}\n`);
  console.log('Requests');
  console.log(`- Requests: ${formatNumber(summary.requestCount)}`);
  console.log(`- Pending requests: ${formatNumber(summary.pendingRequests)}`);
  console.log(`- Failed request jobs: ${formatNumber(summary.failedRequestJobs)}\n`);
  console.log('Operations');
  console.log(`- Active video jobs: ${formatNumber(summary.activeVideoJobs)}`);
  console.log(`- Failed video jobs: ${formatNumber(summary.failedVideoJobs)}\n`);
  console.log('Warnings');
  console.log(formatList(summary.topOperationalWarnings, 'None reported'));
  console.log('\nMissing Metrics');
  console.log(formatMissingMetrics(summary.missingMetrics));
}

async function main() {
  if (typeof fetch !== 'function') {
    console.error('Node.js 18+ is required because this script uses the built-in fetch API.');
    process.exitCode = 1;
    return;
  }

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'ugmovies247-ron-executive-summary/1.0',
  };

  if (readOnlyToken.trim()) {
    headers.Authorization = `Bearer ${readOnlyToken.trim()}`;
  } else if (cookieHeader.trim()) {
    headers.Cookie = cookieHeader.trim();
  }

  const response = await fetch(endpoint, { method: 'GET', headers, redirect: 'manual' });
  const text = await response.text();

  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {}

  if (response.status === 401 || response.status === 403) {
    printAuthHelp();
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    console.error(`Executive summary request failed with HTTP ${response.status}.`);
    console.error(payload?.error || text.slice(0, 800));
    process.exitCode = 1;
    return;
  }

  if (!payload || typeof payload !== 'object') {
    console.error('Executive summary endpoint returned an invalid JSON payload.');
    process.exitCode = 1;
    return;
  }

  printReport(payload);
}

main().catch((error) => {
  console.error('Failed to fetch UGMOVIES247 executive summary.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
