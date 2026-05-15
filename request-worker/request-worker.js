#!/usr/bin/env node

const fs = require('fs/promises');
const { createWriteStream, createReadStream } = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const admin = require('firebase-admin');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

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

async function safeDelete(filePath) {
  if (!filePath) {
    return;
  }

  await fs.rm(filePath, { force: true }).catch(() => undefined);
}

function downloadFile(url, destination, redirectCount = 0) {
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
        downloadFile(redirectedUrl, destination, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Source server responded with ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });

    request.setTimeout(1000 * 60 * 20, () => {
      request.destroy(new Error('Source download timed out.'));
    });
    request.on('error', reject);
  });
}

function runFfmpeg(inputPath, outputPath) {
  const preset = process.env.FFMPEG_PRESET || 'veryfast';
  const crf = process.env.FFMPEG_CRF || '21';
  const args = [
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
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
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

async function uploadToR2(s3, key, filePath) {
  await s3.send(
    new PutObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: key,
      Body: createReadStream(filePath),
      ContentType: 'video/mp4',
    })
  );

  return buildPublicUrl(key);
}

async function sendReadyPush(db, request, movieId) {
  let token = String(request.fcmToken || '').trim();

  if (!token && request.userId) {
    const userSnapshot = await db.collection('users').doc(String(request.userId)).get().catch(() => null);
    token = String(userSnapshot?.data()?.fcmToken || '').trim();
  }

  if (!token) {
    return;
  }

  const baseUrl = (process.env.PUBLIC_APP_BASE_URL || 'https://ugmovies247.com').replace(/\/$/, '');
  const route = `/movie/${encodeURIComponent(movieId)}?fresh=1&fromRequest=1`;

  await admin.messaging().send({
    token,
    notification: {
      title: 'Your movie request is ready!',
      body: `${request.movieTitle || request.title || 'Your movie'} is now available.`,
    },
    data: {
      type: 'movie_request_ready',
      requestId: request.id || '',
      movieId,
      route,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'movie_requests',
        sound: 'default',
      },
    },
    webpush: {
      fcmOptions: {
        link: `${baseUrl}${route}`,
      },
    },
  }).catch((error) => {
    console.warn('[request-worker] ready push failed:', error.message || error);
  });
}

async function claimRequest(db, doc) {
  const ref = doc.ref;

  return db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(ref);
    const data = fresh.data() || {};

    if (
      data.status !== 'processing' ||
      data.processorQueue !== 'request-vps' ||
      data.workerStatus === 'running'
    ) {
      return null;
    }

    transaction.set(
      ref,
      {
        workerStatus: 'running',
        workerStartedAt: nowIso(),
        workerHeartbeatAt: nowIso(),
        workerError: '',
      },
      { merge: true }
    );

    return {
      id: fresh.id,
      ...data,
    };
  });
}

async function processRequest(db, s3, request) {
  const title = String(request.movieTitle || request.title || 'Requested Movie').trim();
  const sourceUrl = String(request.sourceUrl || request.rawFileUrl || '').trim();

  if (!sourceUrl) {
    throw new Error('Request has no sourceUrl/rawFileUrl for the worker to download.');
  }

  const movieId = String(request.movieId || request.id).trim();
  const workDir = path.join(requireEnv('WORK_DIR'), request.id);
  const sourcePath = path.join(workDir, 'source');
  const outputPath = path.join(workDir, `${slugify(title)}.mp4`);
  const keyPrefix = (process.env.R2_KEY_PREFIX || 'requested').replace(/^\/+|\/+$/g, '');
  const r2Key = `${keyPrefix}/${movieId}/video.mp4`;

  await fs.mkdir(workDir, { recursive: true });

  try {
    await db.collection(requireEnv('MOVIE_REQUESTS_COLLECTION')).doc(request.id).set(
      {
        workerStatus: 'downloading',
        workerHeartbeatAt: nowIso(),
        updatedAt: nowIso(),
      },
      { merge: true }
    );
    await downloadFile(sourceUrl, sourcePath);

    await db.collection(requireEnv('MOVIE_REQUESTS_COLLECTION')).doc(request.id).set(
      {
        workerStatus: 'processing',
        workerHeartbeatAt: nowIso(),
        updatedAt: nowIso(),
      },
      { merge: true }
    );
    await runFfmpeg(sourcePath, outputPath);

    await db.collection(requireEnv('MOVIE_REQUESTS_COLLECTION')).doc(request.id).set(
      {
        workerStatus: 'uploading',
        workerHeartbeatAt: nowIso(),
        updatedAt: nowIso(),
      },
      { merge: true }
    );
    const publicVideoUrl = await uploadToR2(s3, r2Key, outputPath);

    // Critical for the 75GB request VPS: delete local video files immediately after upload succeeds.
    await safeDelete(sourcePath);
    await safeDelete(outputPath);

    const timestamp = nowIso();
    await db.collection(requireEnv('MOVIES_COLLECTION')).doc(movieId).set(
      {
        id: movieId,
        movieId,
        title,
        original_title: title,
        contentType: 'movie',
        description: String(request.notes || ''),
        overview: String(request.notes || ''),
        poster: String(request.poster || ''),
        genres: [],
        category: ['Latest Movies on Ugmovies247'],
        vj: String(request.preferredVj || 'Unknown'),
        video_url: publicVideoUrl,
        sourceUrl,
        sourceType: 'direct_url',
        sourcePipeline: 'request_vps_import',
        sourceFileName: String(request.sourceFileName || ''),
        jobStatus: 'ready',
        playbackType: 'mp4',
        accessTier: 'premium',
        subscriptionRequired: true,
        date_added: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        processedAt: timestamp,
        requestId: request.id,
      },
      { merge: true }
    );

    await db.collection(requireEnv('MOVIE_REQUESTS_COLLECTION')).doc(request.id).set(
      {
        status: 'uploaded',
        movieId,
        uploadedAt: timestamp,
        updatedAt: timestamp,
        workerStatus: 'done',
        workerError: '',
        notificationPayload: {
          type: 'movie_request_ready',
          movieId,
          route: `/movie/${movieId}?fresh=1&fromRequest=1`,
        },
      },
      { merge: true }
    );

    await sendReadyPush(db, { ...request, id: request.id }, movieId);
    console.log(`[request-worker] uploaded ${title} as movie ${movieId}`);
  } finally {
    await safeDelete(sourcePath);
    await safeDelete(outputPath);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function pollOnce(db, s3) {
  const snapshot = await db
    .collection(requireEnv('MOVIE_REQUESTS_COLLECTION'))
    .where('status', '==', 'processing')
    .limit(5)
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};

    if (data.processorQueue !== 'request-vps') {
      continue;
    }

    const request = await claimRequest(db, doc);

    if (!request) {
      continue;
    }

    try {
      await processRequest(db, s3, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Unknown worker error');
      console.error(`[request-worker] request ${request.id} failed:`, message);
      await db.collection(requireEnv('MOVIE_REQUESTS_COLLECTION')).doc(request.id).set(
        {
          workerStatus: 'failed',
          workerError: message,
          updatedAt: nowIso(),
        },
        { merge: true }
      );
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
  console.log('[request-worker] started isolated movie request worker');

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
