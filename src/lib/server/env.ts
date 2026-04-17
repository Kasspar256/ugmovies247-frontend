import path from 'path';

function isProductionLikeEnvironment() {
  const appEnv = (process.env.NEXT_PUBLIC_APP_ENV || '').toLowerCase();
  return process.env.NODE_ENV === 'production' || appEnv === 'production';
}

export const VIDEO_WORKSPACE_ROOT =
  process.env.VIDEO_WORKSPACE_ROOT || path.join(process.cwd(), '.video-workspace');
export const VIDEO_SOURCE_DIR = path.join(VIDEO_WORKSPACE_ROOT, 'sources');
export const VIDEO_OUTPUT_DIR = path.join(VIDEO_WORKSPACE_ROOT, 'outputs');
export const VIDEO_JOB_LOCK_ID = 'default';
export const VIDEO_JOB_STALE_MS = Number(process.env.VIDEO_JOB_STALE_MS || 1000 * 60 * 20);
export const VIDEO_JOB_TIMEOUT_MS = Number(process.env.VIDEO_JOB_TIMEOUT_MS || 1000 * 60 * 90);
export const DIRECT_VIDEO_JOB_TIMEOUT_MS = Number(
  process.env.DIRECT_VIDEO_JOB_TIMEOUT_MS || 1000 * 60 * 60 * 4
);
export const VIDEO_MIN_FREE_DISK_BYTES = Number(
  process.env.VIDEO_MIN_FREE_DISK_BYTES || 8 * 1024 * 1024 * 1024
);
export const VIDEO_WORKER_POLL_MS = Number(process.env.VIDEO_WORKER_POLL_MS || 5000);
export const SUBSCRIPTION_WORKER_POLL_MS = Number(
  process.env.SUBSCRIPTION_WORKER_POLL_MS || 1000 * 60
);
export const SUBSCRIPTION_WORKER_BATCH_SIZE = Number(
  process.env.SUBSCRIPTION_WORKER_BATCH_SIZE || 5
);
export const SUBSCRIPTION_RENEWAL_LEASE_MS = Number(
  process.env.SUBSCRIPTION_RENEWAL_LEASE_MS || 1000 * 60 * 5
);
export const SUBSCRIPTION_RENEWAL_RETRY_MS = Number(
  process.env.SUBSCRIPTION_RENEWAL_RETRY_MS || 1000 * 60 * 60 * 12
);
export const SUBSCRIPTION_RECONCILE_AFTER_MS = Number(
  process.env.SUBSCRIPTION_RECONCILE_AFTER_MS || 1000 * 60 * 5
);
export const SUBSCRIPTION_RECONCILE_GIVE_UP_MS = Number(
  process.env.SUBSCRIPTION_RECONCILE_GIVE_UP_MS || 1000 * 60 * 60 * 24
);

export function getPublicR2BaseUrl() {
  const explicitBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim();

  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/$/, '');
  }

  if (isProductionLikeEnvironment()) {
    throw new Error('Missing R2_PUBLIC_BASE_URL for the active production environment.');
  }

  return 'https://pub-0ab2e65a5d0f4bc9833f4bcb73be1d95.r2.dev';
}
