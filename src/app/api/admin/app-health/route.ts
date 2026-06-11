import { execFile } from 'child_process';
import { timingSafeEqual } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  MOVIES_COLLECTION,
  VIDEO_JOB_RUNTIME_COLLECTION,
  VIDEO_JOBS_COLLECTION,
} from '@/lib/server/firestoreNamespaces';
import { VIDEO_JOB_LOCK_ID, VIDEO_JOB_STALE_MS } from '@/lib/server/env';
import {
  REQUEST_PROCESSING_JOBS_COLLECTION,
  REQUEST_PROCESSOR_QUEUE,
} from '@/lib/server/movieRequests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CheckStatus = 'ok' | 'warning' | 'failed' | 'unavailable';

type HealthCheck = {
  status: CheckStatus;
  message: string;
  durationMs?: number;
  details?: Record<string, unknown>;
};

type Pm2ProcessSummary = {
  name: string;
  status: string;
  restarts: number;
  pid: number | null;
  uptimeSeconds: number | null;
  memoryBytes: number | null;
  cpuPercent: number | null;
};

const READ_ONLY_TOKEN_MIN_LENGTH = 32;
const ACTIVE_VIDEO_JOB_STATUSES = ['queued', 'downloading', 'inspecting', 'processing', 'uploading'];
const ACTIVE_REQUEST_JOB_STATUSES = ['queued', 'claimed', 'downloading', 'inspecting', 'processing', 'uploading'];
const RECENT_ERROR_LOG_BYTES = 64 * 1024;
const EXEC_TIMEOUT_MS = 5000;
const R2_HEALTH_TIMEOUT_MS = 5000;
const REQUEST_WORKER_STALE_MS = 30 * 60 * 1000;

const execFileAsync = promisify(execFile);

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

function nowIso() {
  return new Date().toISOString();
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
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function runCheck(label: string, check: () => Promise<HealthCheck>): Promise<HealthCheck> {
  const startedAt = Date.now();

  try {
    const result = await check();
    return {
      ...result,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : `${label} failed.`,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function checkFirestoreRead(): Promise<HealthCheck> {
  const snapshot = await adminDb.collection(MOVIES_COLLECTION).limit(1).get();

  return {
    status: 'ok',
    message: 'Firestore read succeeded.',
    details: {
      collection: MOVIES_COLLECTION,
      sampleSize: snapshot.size,
    },
  };
}

async function checkR2Storage(): Promise<HealthCheck> {
  const endpoint = process.env.R2_ENDPOINT_URL?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return {
      status: 'unavailable',
      message: 'R2 health check is unavailable because one or more R2 environment variables are missing.',
      details: {
        endpointConfigured: Boolean(endpoint),
        bucketConfigured: Boolean(bucket),
        accessKeyConfigured: Boolean(accessKeyId),
        secretKeyConfigured: Boolean(secretAccessKey),
      },
    };
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: String(process.env.R2_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const response = await withTimeout(
    client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1,
      })
    ),
    R2_HEALTH_TIMEOUT_MS,
    'R2 list check'
  );

  return {
    status: 'ok',
    message: 'R2 read/list check succeeded.',
    details: {
      bucket,
      objectSampleCount: response.Contents?.length || 0,
      truncated: Boolean(response.IsTruncated),
    },
  };
}

async function getDiskUsage(): Promise<HealthCheck> {
  try {
    const { stdout } = await execFileAsync('df', ['-kP', '/'], {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 1024 * 128,
    });
    const lines = stdout.trim().split(/\r?\n/);
    const dataLine = lines[1] || '';
    const parts = dataLine.split(/\s+/);
    const sizeKb = Number(parts[1] || 0);
    const usedKb = Number(parts[2] || 0);
    const availableKb = Number(parts[3] || 0);
    const usedPercent = Number(String(parts[4] || '').replace('%', ''));

    if (!Number.isFinite(sizeKb) || !Number.isFinite(usedPercent)) {
      throw new Error('Could not parse df output.');
    }

    return {
      status: usedPercent >= 95 ? 'failed' : usedPercent >= 85 ? 'warning' : 'ok',
      message: `Root disk usage is ${usedPercent}%.`,
      details: {
        filesystem: parts[0] || '',
        mountedOn: parts[5] || '/',
        sizeBytes: sizeKb * 1024,
        usedBytes: usedKb * 1024,
        availableBytes: availableKb * 1024,
        usedPercent,
      },
    };
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'Disk usage check unavailable.',
    };
  }
}

function getMemoryUsage(): HealthCheck {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = totalBytes ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

  return {
    status: usedPercent >= 95 ? 'failed' : usedPercent >= 85 ? 'warning' : 'ok',
    message: `Memory usage is ${usedPercent}%.`,
    details: {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent,
    },
  };
}

function getCpuLoad(): HealthCheck {
  const loadAverage = os.loadavg();
  const cpuCount = os.cpus().length || 1;
  const oneMinuteLoadPerCpu = loadAverage[0] / cpuCount;

  return {
    status: oneMinuteLoadPerCpu >= 2 ? 'failed' : oneMinuteLoadPerCpu >= 1 ? 'warning' : 'ok',
    message: `1-minute load average is ${loadAverage[0].toFixed(2)} across ${cpuCount} CPU(s).`,
    details: {
      cpuCount,
      loadAverage1m: loadAverage[0],
      loadAverage5m: loadAverage[1],
      loadAverage15m: loadAverage[2],
      oneMinuteLoadPerCpu,
    },
  };
}

function getUptime(): HealthCheck {
  return {
    status: 'ok',
    message: 'Uptime read succeeded.',
    details: {
      systemUptimeSeconds: Math.round(os.uptime()),
      processUptimeSeconds: Math.round(process.uptime()),
    },
  };
}

async function readPm2Processes() {
  const { stdout } = await execFileAsync('pm2', ['jlist'], {
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 2,
  });
  const parsed = JSON.parse(stdout || '[]') as Array<Record<string, unknown>>;

  return parsed.map((processInfo): Pm2ProcessSummary => {
    const pm2Env = (processInfo.pm2_env || {}) as Record<string, unknown>;
    const monitor = (processInfo.monit || {}) as Record<string, unknown>;
    const startedAt = Number(pm2Env.pm_uptime || 0);

    return {
      name: String(processInfo.name || ''),
      status: String(pm2Env.status || 'unknown'),
      restarts: Number(pm2Env.restart_time || 0),
      pid: Number.isFinite(Number(processInfo.pid)) ? Number(processInfo.pid) : null,
      uptimeSeconds: startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : null,
      memoryBytes: Number.isFinite(Number(monitor.memory)) ? Number(monitor.memory) : null,
      cpuPercent: Number.isFinite(Number(monitor.cpu)) ? Number(monitor.cpu) : null,
    };
  });
}

async function checkPm2Status(): Promise<HealthCheck> {
  try {
    const processes = await readPm2Processes();
    const expectedNames = [
      'ugmovies247-web',
      'ugmovies247-worker',
      'ugmovies247-subscription-worker',
    ];
    const missing = expectedNames.filter((name) => !processes.some((processInfo) => processInfo.name === name));
    const offline = processes.filter(
      (processInfo) => expectedNames.includes(processInfo.name) && processInfo.status !== 'online'
    );

    return {
      status: missing.length || offline.length ? 'warning' : 'ok',
      message: missing.length || offline.length ? 'One or more expected PM2 processes are missing/offline.' : 'Expected PM2 processes are online.',
      details: {
        processes,
        missing,
        offline,
      },
    };
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'PM2 status unavailable.',
    };
  }
}

async function checkVideoWorker(pm2Check: HealthCheck): Promise<HealthCheck> {
  const runtimeSnapshot = await adminDb
    .collection(VIDEO_JOB_RUNTIME_COLLECTION)
    .doc(VIDEO_JOB_LOCK_ID)
    .get();
  const runtime = runtimeSnapshot.data() || {};
  const heartbeatAt = toMillis(runtime.heartbeatAt);
  const activeJobId = String(runtime.activeJobId || '');
  const heartbeatAgeMs = heartbeatAt ? Date.now() - heartbeatAt : null;
  const [activeJobs, failedJobs] = await Promise.all([
    readFirestoreCount(
      adminDb.collection(VIDEO_JOBS_COLLECTION).where('status', 'in', ACTIVE_VIDEO_JOB_STATUSES)
    ),
    readFirestoreCount(adminDb.collection(VIDEO_JOBS_COLLECTION).where('status', '==', 'failed')),
  ]);
  const pm2Processes = (pm2Check.details?.processes || []) as Pm2ProcessSummary[];
  const pm2Worker = pm2Processes.find((processInfo) => processInfo.name === 'ugmovies247-worker');
  const pm2Online = pm2Worker?.status === 'online';
  const heartbeatFresh = typeof heartbeatAgeMs === 'number' && heartbeatAgeMs <= VIDEO_JOB_STALE_MS;
  const idle = activeJobs === 0 && (!activeJobId || activeJobId === '__claiming__');

  return {
    status: pm2Online || heartbeatFresh || idle ? 'ok' : 'warning',
    message:
      pm2Online || heartbeatFresh
        ? 'Video worker appears available.'
        : idle
          ? 'Video worker has no active jobs; heartbeat may be idle.'
          : 'Video worker heartbeat appears stale or PM2 worker is not online.',
    details: {
      pm2Status: pm2Worker?.status || null,
      pm2Restarts: pm2Worker?.restarts ?? null,
      runtimeCollection: VIDEO_JOB_RUNTIME_COLLECTION,
      activeJobId,
      heartbeatAt: toIsoOrNull(heartbeatAt),
      heartbeatAgeMs,
      staleAfterMs: VIDEO_JOB_STALE_MS,
      activeJobs,
      failedJobs,
    },
  };
}

async function checkRequestWorker(): Promise<HealthCheck> {
  const snapshot = await adminDb
    .collection(REQUEST_PROCESSING_JOBS_COLLECTION)
    .where('processorQueue', '==', REQUEST_PROCESSOR_QUEUE)
    .limit(50)
    .get();
  let latestHeartbeat = 0;
  let activeJobs = 0;
  let failedJobs = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const status = String(data.status || '');

    if (ACTIVE_REQUEST_JOB_STATUSES.includes(status)) {
      activeJobs += 1;
    }

    if (status === 'failed') {
      failedJobs += 1;
    }

    latestHeartbeat = Math.max(
      latestHeartbeat,
      toMillis(data.workerHeartbeatAt),
      toMillis(data.updatedAt)
    );
  }

  const heartbeatAgeMs = latestHeartbeat ? Date.now() - latestHeartbeat : null;
  const freshHeartbeat = typeof heartbeatAgeMs === 'number' && heartbeatAgeMs <= REQUEST_WORKER_STALE_MS;

  return {
    status: freshHeartbeat || activeJobs === 0 ? 'ok' : 'warning',
    message: freshHeartbeat
      ? 'Request worker has recent queue activity.'
      : activeJobs === 0
        ? 'Request worker has no active request-vps jobs; direct systemd status is unavailable from the app server.'
        : 'Request worker has active jobs but no fresh heartbeat in the sampled queue.',
    details: {
      collection: REQUEST_PROCESSING_JOBS_COLLECTION,
      processorQueue: REQUEST_PROCESSOR_QUEUE,
      sampledJobs: snapshot.size,
      activeJobs,
      failedJobsInSample: failedJobs,
      latestHeartbeatAt: toIsoOrNull(latestHeartbeat),
      heartbeatAgeMs,
      staleAfterMs: REQUEST_WORKER_STALE_MS,
      directSystemdStatus: 'unavailable: request worker runs on a separate VPS and cannot be checked safely from this app endpoint.',
    },
  };
}

async function checkPaymentWebhooks(): Promise<HealthCheck> {
  const routes = [
    {
      name: 'pawapay',
      path: '/api/webhooks/pawapay',
      file: path.join(process.cwd(), 'src/app/api/webhooks/pawapay/route.ts'),
    },
    {
      name: 'payfast',
      path: '/api/webhooks/payfast',
      file: path.join(process.cwd(), 'src/app/api/webhooks/payfast/route.ts'),
    },
  ];
  const routeResults = [];

  for (const route of routes) {
    const exists = await fs
      .access(route.file)
      .then(() => true)
      .catch(() => false);

    routeResults.push({
      name: route.name,
      path: route.path,
      configured: exists,
      safeLiveCheck: false,
      reason: 'Webhook routes are POST handlers and live probing could create webhook log records.',
    });
  }

  const missing = routeResults.filter((route) => !route.configured);

  return {
    status: missing.length ? 'warning' : 'ok',
    message: missing.length ? 'One or more payment webhook route files were not found.' : 'Payment webhook routes are configured; live POST checks are intentionally skipped.',
    details: {
      routes: routeResults,
    },
  };
}

function redactLogLine(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/(token|secret|key|password|authorization)["':=\s]+[A-Za-z0-9._~+/-]+/gi, '$1=[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .slice(0, 300);
}

async function getPm2RawProcessesForLogs() {
  const { stdout } = await execFileAsync('pm2', ['jlist'], {
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 2,
  });

  return JSON.parse(stdout || '[]') as Array<Record<string, unknown>>;
}

async function checkRecentServerErrors(): Promise<HealthCheck> {
  try {
    const processes = await getPm2RawProcessesForLogs();
    const webProcess = processes.find((processInfo) => String(processInfo.name || '') === 'ugmovies247-web');
    const pm2Env = (webProcess?.pm2_env || {}) as Record<string, unknown>;
    const errorLogPath = String(pm2Env.pm_err_log_path || '');

    if (!errorLogPath) {
      return {
        status: 'unavailable',
        message: 'PM2 web error log path is unavailable.',
      };
    }

    const stat = await fs.stat(errorLogPath);
    const modifiedAgeMs = Date.now() - stat.mtimeMs;

    if (modifiedAgeMs > 24 * 60 * 60 * 1000) {
      return {
        status: 'ok',
        message: 'Web error log has not changed in the last 24 hours.',
        details: {
          logSizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          modifiedAgeMs,
          recentErrorLineCount: 0,
          recentErrorSnippets: [],
        },
      };
    }

    const file = await fs.open(errorLogPath, 'r');

    try {
      const length = Math.min(RECENT_ERROR_LOG_BYTES, stat.size);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, Math.max(0, stat.size - length));
      const lines = buffer
        .toString('utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const recentLines = lines.slice(-10).map(redactLogLine);

      return {
        status: recentLines.length ? 'warning' : 'ok',
        message: recentLines.length ? `${recentLines.length} recent web error log line(s) found.` : 'No recent web error log lines found in sampled log tail.',
        details: {
          sampledBytes: length,
          logSizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          modifiedAgeMs,
          recentErrorLineCount: recentLines.length,
          recentErrorSnippets: recentLines,
        },
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'Recent server error check unavailable.',
    };
  }
}

function collectWarnings(checks: Record<string, HealthCheck>) {
  const warnings: string[] = [];
  const missingChecks: Array<{ check: string; reason: string }> = [];

  for (const [name, check] of Object.entries(checks)) {
    if (check.status === 'failed' || check.status === 'warning') {
      warnings.push(`${name}: ${check.message}`);
    }

    if (check.status === 'unavailable') {
      missingChecks.push({ check: name, reason: check.message });
    }
  }

  return { warnings, missingChecks };
}

function deriveAppStatus(checks: Record<string, HealthCheck>) {
  if (
    checks.databaseConnection?.status === 'failed' ||
    checks.firestoreRead?.status === 'failed'
  ) {
    return 'down';
  }

  if (Object.values(checks).some((check) => check.status === 'failed' || check.status === 'warning')) {
    return 'degraded';
  }

  return 'healthy';
}

export async function GET(request: Request) {
  const startedAt = Date.now();

  try {
    if (!(await requireReadAccess(request))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const apiResponse: HealthCheck = {
      status: 'ok',
      message: 'app-health endpoint responded.',
    };
    const databaseConnection = await runCheck('database connection', async () => {
      await adminDb.listCollections();
      return {
        status: 'ok',
        message: 'Firebase Admin database connection is available.',
      };
    });
    const [
      firestoreRead,
      r2Storage,
      diskUsage,
      pm2Status,
      paymentWebhookRoutes,
      recentServerErrors,
    ] = await Promise.all([
      runCheck('firestore read', checkFirestoreRead),
      runCheck('R2 storage', checkR2Storage),
      runCheck('disk usage', getDiskUsage),
      runCheck('PM2 status', checkPm2Status),
      runCheck('payment webhooks', checkPaymentWebhooks),
      runCheck('recent server errors', checkRecentServerErrors),
    ]);
    const [videoWorkerStatus, requestWorkerStatus] = await Promise.all([
      runCheck('video worker status', () => checkVideoWorker(pm2Status)),
      runCheck('request worker status', checkRequestWorker),
    ]);
    const checks: Record<string, HealthCheck> = {
      apiResponse,
      databaseConnection,
      firestoreRead,
      r2Storage,
      paymentWebhookRoutes,
      videoWorkerStatus,
      requestWorkerStatus,
      diskUsage,
      memoryUsage: getMemoryUsage(),
      cpuLoad: getCpuLoad(),
      uptime: getUptime(),
      pm2Status,
      recentServerErrors,
    };
    checks.apiResponse.durationMs = Date.now() - startedAt;

    const { warnings, missingChecks } = collectWarnings(checks);

    return NextResponse.json({
      appStatus: deriveAppStatus(checks),
      checks,
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
      },
      warnings,
      missingChecks,
      timestamp: nowIso(),
    });
  } catch (error) {
    console.error('[app-health] failed', error);

    return NextResponse.json(
      {
        appStatus: 'down',
        error: error instanceof Error ? error.message : 'Failed to load app health.',
        timestamp: nowIso(),
      },
      { status: 500 }
    );
  }
}
