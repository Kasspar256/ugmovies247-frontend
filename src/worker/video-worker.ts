import path from 'path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function loop() {
  const [{ processNextVideoJob }, { VIDEO_WORKER_POLL_MS }] = await Promise.all([
    import('@/lib/server/videoJobs'),
    import('@/lib/server/env'),
  ]);

  while (true) {
    try {
      await processNextVideoJob();
    } catch (error) {
      console.error('[video-worker] loop error', error);
    }

    await new Promise((resolve) => setTimeout(resolve, VIDEO_WORKER_POLL_MS));
  }
}

loop().catch((error) => {
  console.error('[video-worker] fatal error', error);
  process.exit(1);
});
