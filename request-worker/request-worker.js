#!/usr/bin/env node

const fs = require('fs/promises');
const { createReadStream, createWriteStream } = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const admin = require('firebase-admin');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

function loadEnvFile(filePath) {
  return fs.readFile(filePath, 'utf8')
    .then((content) => {
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line || line.startsWith('#')) {
          continue;
        }

        const separator = line.indexOf('=');

        if (separator === -1) {
          continue;
        }

        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    })
    .catch(() => undefined);
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }

  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value) {
  return String(value || 'movie')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'movie';
}

function getCollections() {
  return {
    jobs: process.env.REQUEST_PROCESSING_JOBS_COLLECTION || 'request_processing_jobs',
    requests: process.env.MOVIE_REQUESTS_COLLECTION || 'movie_requests',
    movies: process.env.MOVIES_COLLECTION || 'movies__production',
  };
}

async function removeLocalWorkspace(workDir) {
  if (!workDir) {
    return;
  }

  await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
}

function downloadFile(url, destination, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while downloading source file.'));
      return;
    }

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const request = client.get(parsedUrl, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        const redirectedUrl = new URL(response.headers.location, parsedUrl).toString();
        downloadFile(redirectedUrl, destination, onProgress, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Source server responded with ${response.statusCode}`));
        return;
      }

      const totalBytes = Number(response.headers['content-length'] || 0);
      let downloadedBytes = 0;
      let lastEmitAt = 0;
      const file = createWriteStream(destination);

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();

        if (totalBytes > 0 && now - lastEmitAt > 2000) {
          lastEmitAt = now;
          onProgress?.(downloadedBytes, totalBytes);
        }
      });

      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });

    request.setTimeout(1000 * 60 * 30, () => {
      request.destroy(new Error('Source download timed out.'));
    });
    request.on('error', reject);
  });
}

function runProbeDuration(inputPath) {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ]);
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('close', () => {
      const durationSeconds = Number(output.trim());
      resolve(Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0);
    });
    child.on('error', () => resolve(0));
  });
}

function runFfmpeg(inputPath, outputPath, durationSeconds, onProgress) {
  const preset = process.env.FFMPEG_PRESET || 'veryfast';
  const crf = process.env.FFMPEG_CRF || '21';
  const args = [
    '-progress',
    'pipe:1',
    '-nostats',
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-sn',
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    crf,
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '160k',
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let estimatedProgress = 34;
    const timer = setInterval(() => {
      estimatedProgress = Math.min(66, estimatedProgress + 2);
      onProgress?.(estimatedProgress);
    }, 5000);

    child.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const [key, value] = line.split('=');

        if (key === 'out_time_ms' && durationSeconds > 0) {
          const outTimeSeconds = Number(value) / 1000000;
          const percent = Math.min(1, Math.max(0, outTimeSeconds / durationSeconds));
          onProgress?.(30 + Math.round(percent * 40));
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();

      if (text) {
        console.log(`[ffmpeg] ${text.slice(0, 400)}`);
      }
    });

    child.on('error', (error) => {
      clearInterval(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearInterval(timer);

      if (code === 0) {
        onProgress?.(70);
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

function buildPublicUrl(key) {
  const baseUrl = requireEnv('R2_PUBLIC_BASE_URL').replace(/\/$/, '');
  return `${baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function uploadToR2(s3, key, filePath, onProgress) {
  const stats = await fs.stat(filePath);
  const stream = createReadStream(filePath);
  let uploadedBytes = 0;
  let lastEmitAt = 0;

  stream.on('data', (chunk) => {
    uploadedBytes += chunk.length;
    const now = Date.now();

    if (now - lastEmitAt > 2000) {
      lastEmitAt = now;
      onProgress?.(uploadedBytes, stats.size);
    }
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: key,
      Body: stream,
      ContentType: 'video/mp4',
    })
  );

  onProgress?.(stats.size, stats.size);
  return buildPublicUrl(key);
}

async function deleteStagedSourceIfSafe(s3, job) {
  const sourceStorageKey = String(job.sourceStorageKey || '').trim();

  if (!sourceStorageKey) {
    return false;
  }

  if (!sourceStorageKey.startsWith('direct-source-staging/')) {
    console.warn(
      `[request-worker] refusing to delete non-staging source key ${sourceStorageKey}`
    );
    return false;
  }

  await s3.send(
    new DeleteObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: sourceStorageKey,
    })
  );

  return true;
}

async function updateProgress(db, job, patch) {
  const collections = getCollections();
  const timestamp = nowIso();
  const nextStatus = patch.status || job.status;
  const progress =
    typeof patch.progress === 'number'
      ? Math.max(0, Math.min(100, Math.round(patch.progress)))
      : undefined;
  const currentStage = patch.currentStage || job.currentStage || '';
  const jobPatch = {
    ...patch,
    ...(progress !== undefined ? { progress } : {}),
    updatedAt: timestamp,
    workerHeartbeatAt: timestamp,
  };
  const requestPatch = {
    workerStatus: nextStatus,
    currentStage,
    updatedAt: timestamp,
    workerHeartbeatAt: timestamp,
    ...(progress !== undefined ? { progress } : {}),
    ...(patch.errorMessage ? { workerError: patch.errorMessage } : {}),
  };
  const moviePatch = {
    jobStatus: nextStatus === 'uploaded' ? 'ready' : nextStatus,
    currentStage,
    updatedAt: timestamp,
    ...(progress !== undefined ? { processingProgress: progress } : {}),
    ...(patch.errorMessage ? { errorMessage: patch.errorMessage } : {}),
  };

  await Promise.all([
    db.collection(collections.jobs).doc(job.id).set(jobPatch, { merge: true }),
    db.collection(collections.requests).doc(job.requestId).set(requestPatch, { merge: true }),
    db.collection(collections.movies).doc(job.movieId).set(moviePatch, { merge: true }),
  ]);

  Object.assign(job, jobPatch);
}

function createProgressReporter(db, job) {
  let chain = Promise.resolve();

  const report = (patch) => {
    chain = chain
      .then(() => updateProgress(db, job, patch))
      .catch((error) => {
        console.warn('[request-worker] progress update failed:', error.message || error);
      });
    return chain;
  };

  return {
    report,
    flush: () => chain,
  };
}

async function claimJob(db, doc) {
  const collections = getCollections();
  const workerId = process.env.WORKER_ID || require('os').hostname();

  return db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(doc.ref);
    const data = fresh.data() || {};

    if (
      data.status !== 'queued' ||
      data.processorQueue !== 'request-vps' ||
      data.workerId
    ) {
      return null;
    }

    const timestamp = nowIso();
    const patch = {
      status: 'claimed',
      workerId,
      progress: 1,
      currentStage: 'Claimed by request VPS',
      startedAt: timestamp,
      updatedAt: timestamp,
      workerHeartbeatAt: timestamp,
      errorMessage: '',
    };

    transaction.set(doc.ref, patch, { merge: true });
    transaction.set(
      db.collection(collections.requests).doc(String(data.requestId)),
      {
        workerStatus: 'claimed',
        progress: 1,
        currentStage: 'Claimed by request VPS',
        updatedAt: timestamp,
        workerHeartbeatAt: timestamp,
        workerError: '',
      },
      { merge: true }
    );

    return {
      id: fresh.id,
      ...data,
      ...patch,
    };
  });
}

function getMoviePatchForReady(job, publicVideoUrl, timestamp) {
  return {
    video_url: publicVideoUrl,
    sourceUrl: job.sourceUrl || '',
    sourceFileName: job.sourceFileName || '',
    sourceFileSizeBytes: Number(job.sourceFileSizeBytes || 0) || null,
    sourceStorageKey: job.sourceStorageKey || '',
    sourceStorageProvider: job.sourceStorageProvider || '',
    sourceType: 'direct_url',
    sourcePipeline: 'request_vps_import',
    jobStatus: 'ready',
    currentStage: 'Live and ready to watch',
    processingProgress: 100,
    errorMessage: '',
    playbackType: 'mp4',
    status: 'live',
    processedAt: timestamp,
    updatedAt: timestamp,
  };
}

async function writeSeriesEpisodeReady(db, job, publicVideoUrl, timestamp) {
  const collections = getCollections();
  const ref = db.collection(collections.movies).doc(String(job.movieId));
  const snapshot = await ref.get();
  const data = snapshot.data() || {};
  const shell = job.movieShell && typeof job.movieShell === 'object' ? job.movieShell : {};
  const seasonNumber = Math.max(1, Number(job.seasonNumber || 1));
  const episodeNumber = Math.max(1, Number(job.episodeNumber || 1));
  const seasons = Array.isArray(data.seasons)
    ? data.seasons.map((season) => ({ ...season }))
    : Array.isArray(shell.seasons)
      ? shell.seasons.map((season) => ({ ...season }))
      : [];
  let season = seasons.find((entry) => Number(entry.seasonNumber) === seasonNumber);

  if (!season) {
    season = {
      seasonNumber,
      title: `Season ${seasonNumber}`,
      poster: data.poster || shell.poster || '',
      overview: data.overview || shell.overview || '',
      episodes: [],
    };
    seasons.push(season);
  }

  season.episodes = Array.isArray(season.episodes)
    ? season.episodes.map((episode) => ({ ...episode }))
    : [];

  let episode = season.episodes.find((entry) => Number(entry.episodeNumber) === episodeNumber);

  if (!episode) {
    episode = {
      episodeNumber,
      title: String(job.episodeTitle || `${job.title} Episode ${episodeNumber}`),
      description: data.description || shell.description || '',
      overview: data.overview || shell.overview || '',
      poster: data.poster || shell.poster || '',
      video_url: '',
    };
    season.episodes.push(episode);
  }

  Object.assign(episode, getMoviePatchForReady(job, publicVideoUrl, timestamp), {
    episodeNumber,
    title: episode.title || String(job.episodeTitle || `${job.title} Episode ${episodeNumber}`),
  });

  await ref.set(
    {
      ...shell,
      id: job.movieId,
      movieId: job.movieId,
      contentType: 'series',
      video_url: '',
      seasons,
      jobStatus: 'ready',
      currentStage: 'Live and ready to watch',
      processingProgress: 100,
      errorMessage: '',
      status: 'live',
      updatedAt: timestamp,
      processedAt: timestamp,
    },
    { merge: true }
  );
}

async function writeMovieReady(db, job, publicVideoUrl) {
  const collections = getCollections();
  const timestamp = nowIso();

  if (job.contentType === 'series') {
    await writeSeriesEpisodeReady(db, job, publicVideoUrl, timestamp);
    return timestamp;
  }

  const shell = job.movieShell && typeof job.movieShell === 'object' ? job.movieShell : {};
  await db.collection(collections.movies).doc(String(job.movieId)).set(
    {
      ...shell,
      id: job.movieId,
      movieId: job.movieId,
      contentType: 'movie',
      ...getMoviePatchForReady(job, publicVideoUrl, timestamp),
    },
    { merge: true }
  );

  return timestamp;
}

async function notifyMainAppCompletion(job) {
  const baseUrl = String(process.env.APP_INTERNAL_BASE_URL || process.env.PUBLIC_APP_BASE_URL || '').replace(/\/$/, '');
  const secret = String(process.env.REQUEST_WORKER_SECRET || '').trim();

  if (!baseUrl || !secret) {
    console.warn('[request-worker] REQUEST_WORKER_SECRET/APP_INTERNAL_BASE_URL missing; completion email cannot be sent by main app.');
    return false;
  }

  const response = await fetch(`${baseUrl}/api/internal/request-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-worker-secret': secret,
    },
    body: JSON.stringify({
      requestId: job.requestId,
      movieId: job.movieId,
      jobId: job.id,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Main app completion hook failed: ${detail || response.status}`);
  }

  return true;
}

async function markRequestUploadedWithoutEmail(db, job, completedAt) {
  const collections = getCollections();
  await db.collection(collections.requests).doc(job.requestId).set(
    {
      status: 'uploaded',
      movieId: job.movieId,
      uploadedAt: completedAt,
      updatedAt: completedAt,
      workerStatus: 'done',
      workerError: '',
      progress: 100,
      currentStage: 'Live and ready to watch',
    },
    { merge: true }
  );
}

async function processJob(db, s3, job) {
  const title = String(job.title || 'Requested Movie').trim();
  const sourceUrl = String(job.sourceUrl || '').trim();
  const progress = createProgressReporter(db, job);

  if (!sourceUrl) {
    throw new Error('Request processing job has no sourceUrl.');
  }

  const workDir = path.join(requireEnv('WORK_DIR'), job.id);
  const sourcePath = path.join(workDir, 'source.bin');
  const outputPath = path.join(workDir, `${slugify(title)}.mp4`);
  const keyPrefix = (process.env.R2_KEY_PREFIX || 'requested').replace(/^\/+|\/+$/g, '');
  const r2Key = `${keyPrefix}/${job.movieId}/video.mp4`;

  await fs.mkdir(workDir, { recursive: true });

  try {
    await progress.report({
      status: 'downloading',
      progress: 5,
      currentStage: 'Downloading source file',
    });
    await downloadFile(sourceUrl, sourcePath, (downloadedBytes, totalBytes) => {
      const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 20 : 0;
      void progress.report({
        status: 'downloading',
        progress: 5 + percent,
        currentStage: 'Downloading source file',
      });
    });
    await progress.flush();

    await progress.report({
      status: 'processing',
      progress: 30,
      currentStage: 'Processing via FFmpeg',
    });
    const durationSeconds = await runProbeDuration(sourcePath);
    await runFfmpeg(sourcePath, outputPath, durationSeconds, (percent) => {
      void progress.report({
        status: 'processing',
        progress: percent,
        currentStage: 'Processing via FFmpeg',
      });
    });
    await progress.flush();

    await progress.report({
      status: 'uploading',
      progress: 72,
      currentStage: 'Uploading processed MP4 to Cloudflare R2',
    });
    const publicVideoUrl = await uploadToR2(s3, r2Key, outputPath, (uploadedBytes, totalBytes) => {
      const percent = totalBytes > 0 ? (uploadedBytes / totalBytes) * 20 : 0;
      void progress.report({
        status: 'uploading',
        progress: 72 + percent,
        currentStage: 'Uploading processed MP4 to Cloudflare R2',
      });
    });
    await progress.flush();

    // Mandatory 100GB VPS protection: delete raw/intermediate local files immediately after R2 success.
    await removeLocalWorkspace(workDir);

    try {
      const deletedStagedSource = await deleteStagedSourceIfSafe(s3, job);

      if (deletedStagedSource) {
        await progress.report({
          currentStage: 'Cleaned staged source after successful upload',
        });
      }
    } catch (error) {
      console.warn('[request-worker] staged source cleanup failed:', error.message || error);
    }

    const completedAt = await writeMovieReady(db, job, publicVideoUrl);
    await progress.report({
      status: 'uploaded',
      progress: 100,
      currentStage: 'Live and ready to watch',
      completedAt,
      publicVideoUrl,
    });

    try {
      const notified = await notifyMainAppCompletion(job);

      if (!notified) {
        await markRequestUploadedWithoutEmail(db, job, completedAt);
      }
    } catch (error) {
      console.warn('[request-worker] main app completion hook failed:', error.message || error);
      await markRequestUploadedWithoutEmail(db, job, completedAt);
    }

    console.log(`[request-worker] uploaded ${title} as ${job.movieId}`);
  } finally {
    await removeLocalWorkspace(workDir);
  }
}

async function pollOnce(db, s3) {
  const collections = getCollections();
  const snapshot = await db
    .collection(collections.jobs)
    .where('status', '==', 'queued')
    .limit(3)
    .get();

  for (const doc of snapshot.docs) {
    const job = await claimJob(db, doc);

    if (!job) {
      continue;
    }

    try {
      await processJob(db, s3, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Unknown worker error');
      console.error(`[request-worker] job ${job.id} failed:`, message);
      await updateProgress(db, job, {
        status: 'failed',
        currentStage: 'Failed',
        errorMessage: message,
      });
    }
  }
}

async function main() {
  await loadEnvFile('/etc/ugmovies-request-worker.env');
  await loadEnvFile(path.join(process.cwd(), '.env'));

  requireEnv('FIREBASE_PROJECT_ID');
  requireEnv('FIREBASE_CLIENT_EMAIL');
  requireEnv('FIREBASE_PRIVATE_KEY');
  requireEnv('R2_ENDPOINT');
  requireEnv('R2_ACCESS_KEY_ID');
  requireEnv('R2_SECRET_ACCESS_KEY');
  requireEnv('R2_BUCKET');
  requireEnv('R2_PUBLIC_BASE_URL');
  requireEnv('WORK_DIR');

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: requireEnv('FIREBASE_PROJECT_ID'),
      clientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
    projectId: requireEnv('FIREBASE_PROJECT_ID'),
  });

  const s3 = new S3Client({
    region: 'auto',
    endpoint: requireEnv('R2_ENDPOINT'),
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
    forcePathStyle: true,
  });
  const db = admin.firestore();
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 15000);

  await fs.mkdir(requireEnv('WORK_DIR'), { recursive: true });
  console.log('[request-worker] started unified request processing worker');

  for (;;) {
    try {
      await pollOnce(db, s3);
    } catch (error) {
      console.error('[request-worker] poll failed:', error.message || error);
    }

    await sleep(Number.isFinite(pollIntervalMs) ? pollIntervalMs : 15000);
  }
}

main().catch((error) => {
  console.error('[request-worker] fatal startup error:', error.message || error);
  process.exit(1);
});
