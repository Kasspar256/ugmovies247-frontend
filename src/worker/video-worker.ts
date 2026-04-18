import path from 'path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

function isQuotaLikeWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /resource_exhausted|quota exceeded|ramp up limit|some resource has been exhausted/i.test(
    message
  );
}

async function loop() {
  const [
    { processNextVideoJob },
    {
      VIDEO_WORKER_POLL_MS,
      VIDEO_WORKER_QUOTA_BACKOFF_BASE_MS,
      VIDEO_WORKER_QUOTA_BACKOFF_MAX_MS,
    },
  ] = await Promise.all([
    import('@/lib/server/videoJobs'),
    import('@/lib/server/env'),
  ]);
  let consecutiveQuotaErrors = 0;

  while (true) {
    let nextDelayMs = VIDEO_WORKER_POLL_MS;

    try {
      await processNextVideoJob();
      consecutiveQuotaErrors = 0;
    } catch (error) {
      console.error('[video-worker] loop error', error);

      if (isQuotaLikeWorkerError(error)) {
        consecutiveQuotaErrors += 1;
        nextDelayMs = Math.min(
          VIDEO_WORKER_QUOTA_BACKOFF_MAX_MS,
          VIDEO_WORKER_QUOTA_BACKOFF_BASE_MS * 2 ** Math.max(0, consecutiveQuotaErrors - 1)
        );
        console.warn(
          `[video-worker] Firestore returned a quota-like error. Backing off for ${Math.round(
            nextDelayMs / 1000
          )}s before retrying.`
        );
      } else {
        consecutiveQuotaErrors = 0;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, nextDelayMs));
  }
}

loop().catch((error) => {
  console.error('[video-worker] fatal error', error);
  process.exit(1);
});
