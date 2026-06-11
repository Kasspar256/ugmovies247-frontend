#!/usr/bin/env node

const https = require('https');

const DEFAULT_ENDPOINT = 'https://ugmovies247.com/api/admin/app-health';

const endpoint = process.env.RON_APP_HEALTH_URL || DEFAULT_ENDPOINT;
const readOnlyToken =
  process.env.RON_EXECUTIVE_SUMMARY_TOKEN ||
  process.env.EXECUTIVE_SUMMARY_READ_TOKEN ||
  process.env.UGMOVIES_EXECUTIVE_SUMMARY_READ_TOKEN ||
  '';
const asJson = process.argv.includes('--json');

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unavailable';
  }

  return new Intl.NumberFormat('en-US').format(value);
}

function formatBytes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unavailable';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let next = value;

  while (Math.abs(next) >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }

  return `${next.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function statusLabel(status) {
  if (status === 'ok') return 'OK';
  if (status === 'warning') return 'WARNING';
  if (status === 'failed') return 'FAILED';
  if (status === 'unavailable') return 'UNAVAILABLE';
  return String(status || 'UNKNOWN').toUpperCase();
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'ugmovies247-ron-app-health/1.0',
    };

    if (readOnlyToken.trim()) {
      headers.Authorization = `Bearer ${readOnlyToken.trim()}`;
    }

    const req = https.request(url, { method: 'GET', headers, timeout: 30000 }, (res) => {
      let body = '';

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        let payload = null;

        try {
          payload = body ? JSON.parse(body) : null;
        } catch {
          payload = null;
        }

        resolve({
          statusCode: res.statusCode || 0,
          body,
          payload,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out after 30 seconds.'));
    });
    req.on('error', reject);
    req.end();
  });
}

function getCheck(payload, key) {
  return payload?.checks?.[key] || null;
}

function printCheck(title, check) {
  if (!check) {
    console.log(`- ${title}: UNAVAILABLE - check missing from response`);
    return;
  }

  const duration = typeof check.durationMs === 'number' ? ` (${check.durationMs}ms)` : '';
  console.log(`- ${title}: ${statusLabel(check.status)} - ${check.message || 'No message'}${duration}`);
}

function printPm2(check) {
  const processes = Array.isArray(check?.details?.processes) ? check.details.processes : [];

  if (!processes.length) {
    console.log('- PM2 processes: Unavailable');
    return;
  }

  console.log('- PM2 processes:');
  for (const processInfo of processes) {
    console.log(
      `  - ${processInfo.name}: ${processInfo.status}, restarts ${formatNumber(processInfo.restarts)}, memory ${formatBytes(processInfo.memoryBytes)}, cpu ${formatNumber(processInfo.cpuPercent)}%`
    );
  }
}

function printList(items, fallback) {
  if (!Array.isArray(items) || items.length === 0) {
    console.log(`- ${fallback}`);
    return;
  }

  for (const item of items) {
    if (typeof item === 'string') {
      console.log(`- ${item}`);
    } else if (item && typeof item === 'object') {
      console.log(`- ${item.check || item.name || 'item'}: ${item.reason || item.message || JSON.stringify(item)}`);
    } else {
      console.log(`- ${String(item)}`);
    }
  }
}

function printReport(payload) {
  const disk = getCheck(payload, 'diskUsage');
  const memory = getCheck(payload, 'memoryUsage');
  const cpu = getCheck(payload, 'cpuLoad');
  const uptime = getCheck(payload, 'uptime');
  const videoWorker = getCheck(payload, 'videoWorkerStatus');
  const requestWorker = getCheck(payload, 'requestWorkerStatus');

  console.log('UGMOVIES247 APP HEALTH');
  console.log('======================');
  console.log(`Timestamp: ${payload.timestamp || new Date().toISOString()}`);
  console.log(`App status: ${String(payload.appStatus || 'unknown').toUpperCase()}`);
  console.log('');

  console.log('Core Checks');
  printCheck('API response', getCheck(payload, 'apiResponse'));
  printCheck('Database connection', getCheck(payload, 'databaseConnection'));
  printCheck('Firestore read', getCheck(payload, 'firestoreRead'));
  printCheck('R2/storage', getCheck(payload, 'r2Storage'));
  printCheck('Payment webhooks', getCheck(payload, 'paymentWebhookRoutes'));
  printCheck('Recent server errors', getCheck(payload, 'recentServerErrors'));
  console.log('');

  console.log('Workers');
  printCheck('Video worker', videoWorker);
  console.log(`  - Active video jobs: ${formatNumber(videoWorker?.details?.activeJobs)}`);
  console.log(`  - Failed video jobs: ${formatNumber(videoWorker?.details?.failedJobs)}`);
  console.log(`  - Video heartbeat: ${videoWorker?.details?.heartbeatAt || 'Unavailable'}`);
  printCheck('Request worker', requestWorker);
  console.log(`  - Active request jobs: ${formatNumber(requestWorker?.details?.activeJobs)}`);
  console.log(`  - Request heartbeat: ${requestWorker?.details?.latestHeartbeatAt || 'Unavailable'}`);
  console.log('');

  console.log('Server Resources');
  printCheck('Disk usage', disk);
  console.log(`  - Used: ${formatBytes(disk?.details?.usedBytes)} / ${formatBytes(disk?.details?.sizeBytes)} (${disk?.details?.usedPercent ?? 'Unavailable'}%)`);
  printCheck('Memory usage', memory);
  console.log(`  - Used: ${formatBytes(memory?.details?.usedBytes)} / ${formatBytes(memory?.details?.totalBytes)} (${memory?.details?.usedPercent ?? 'Unavailable'}%)`);
  printCheck('CPU/load', cpu);
  console.log(`  - Load avg: ${cpu?.details?.loadAverage1m ?? 'Unavailable'} / ${cpu?.details?.loadAverage5m ?? 'Unavailable'} / ${cpu?.details?.loadAverage15m ?? 'Unavailable'}`);
  printCheck('Uptime', uptime);
  console.log(`  - System uptime: ${formatNumber(uptime?.details?.systemUptimeSeconds)}s`);
  console.log(`  - Web process uptime: ${formatNumber(uptime?.details?.processUptimeSeconds)}s`);
  console.log('');

  console.log('PM2');
  printCheck('PM2 status', getCheck(payload, 'pm2Status'));
  printPm2(getCheck(payload, 'pm2Status'));
  console.log('');

  console.log('Warnings');
  printList(payload.warnings, 'No warnings reported');
  console.log('');

  console.log('Missing / Unavailable Checks');
  printList(payload.missingChecks, 'No missing checks reported');
}

function printAuthHelp() {
  console.error('UGMOVIES247 App Health');
  console.error('');
  console.error('Could not authenticate to the read-only app-health endpoint.');
  console.error('');
  console.error('Required read-only auth:');
  console.error('- Set RON_EXECUTIVE_SUMMARY_TOKEN to the same read-only token used for Ron company-health.');
  console.error('- The token is sent as Authorization: Bearer to a GET-only endpoint.');
  console.error('');
  console.error('Example:');
  console.error("source ~/.kasspar/ugmovies-readonly.env && node ~/kasspar-tools/ron-app-health.js");
}

async function main() {
  if (!readOnlyToken.trim()) {
    printAuthHelp();
    process.exitCode = 1;
    return;
  }

  const response = await requestJson(endpoint);

  if (response.statusCode === 401 || response.statusCode === 403) {
    printAuthHelp();
    process.exitCode = 1;
    return;
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    console.error(`App health request failed with HTTP ${response.statusCode}.`);
    console.error(response.payload?.error || response.body.slice(0, 800));
    process.exitCode = 1;
    return;
  }

  if (!response.payload || typeof response.payload !== 'object') {
    console.error('App health endpoint returned invalid JSON.');
    process.exitCode = 1;
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(response.payload, null, 2));
    return;
  }

  printReport(response.payload);
}

main().catch((error) => {
  console.error('Failed to fetch UGMOVIES247 app health.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
