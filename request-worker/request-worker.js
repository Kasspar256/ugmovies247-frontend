#!/usr/bin/env node

const fs = require('fs/promises');
const { createReadStream, createWriteStream } = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { randomUUID } = require('crypto');
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

async function updateJobOnlyProgress(db, job, patch) {
  const collections = getCollections();
  const timestamp = nowIso();
  const progress =
    typeof patch.progress === 'number'
      ? Math.max(0, Math.min(100, Math.round(patch.progress)))
      : undefined;
  const jobPatch = {
    ...patch,
    ...(progress !== undefined ? { progress } : {}),
    updatedAt: timestamp,
    workerHeartbeatAt: timestamp,
  };

  await db.collection(collections.jobs).doc(job.id).set(jobPatch, { merge: true });
  Object.assign(job, jobPatch);
}

function createJobOnlyProgressReporter(db, job) {
  let chain = Promise.resolve();

  const report = (patch) => {
    chain = chain
      .then(() => updateJobOnlyProgress(db, job, patch))
      .catch((error) => {
        console.warn('[request-worker] telegram progress update failed:', error.message || error);
      });
    return chain;
  };

  return {
    report,
    flush: () => chain,
  };
}

const SUPPORTED_TELEGRAM_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.webm', '.ts']);

function sanitizeFileName(value) {
  return path.basename(String(value || 'telegram-video').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_'));
}

function parseTelegramRefs(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (/^-?\d+$/.test(entry) ? Number(entry) : entry));
}

function getTelegramClientConfig() {
  const apiId = Number(process.env.REQUEST_TELEGRAM_API_ID || process.env.TELEGRAM_API_ID || 0);
  const apiHash = String(process.env.REQUEST_TELEGRAM_API_HASH || process.env.TELEGRAM_API_HASH || '').trim();
  const sessionString = String(
    process.env.REQUEST_TELEGRAM_SESSION_STRING || process.env.TELEGRAM_SESSION_STRING || ''
  ).trim();
  const intakeChats = parseTelegramRefs(
    process.env.REQUEST_TELEGRAM_INTAKE_CHAT_IDS ||
      process.env.REQUEST_TELEGRAM_GROUP_IDS ||
      process.env.TELEGRAM_INTAKE_CHAT_IDS ||
      ''
  );
  const allowedSenderIds = new Set(
    parseTelegramRefs(process.env.REQUEST_TELEGRAM_ALLOWED_SENDER_IDS || '')
      .map((entry) => String(entry))
  );

  return {
    apiId,
    apiHash,
    sessionString,
    intakeChats,
    allowedSenderIds,
  };
}

function hasAnyTelegramClientConfig(config) {
  return Boolean(config.apiId || config.apiHash || config.sessionString || config.intakeChats.length);
}

function normalizeTelegramId(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

function getTelegramClientFileName(message) {
  const fileName =
    message?.file?.name ||
    message?.media?.document?.attributes?.find((attribute) => typeof attribute.fileName === 'string')?.fileName ||
    '';

  if (fileName) {
    return sanitizeFileName(fileName);
  }

  const extension = path.extname(String(message?.file?.mimeType || '').replace('/', '.')) || '.bin';
  return sanitizeFileName(`telegram_${message?.id || Date.now()}${extension}`);
}

function extractTelegramClientMedia(message) {
  if (!message?.media || !message?.file) {
    return null;
  }

  const fileName = getTelegramClientFileName(message);
  const mimeType = String(message.file.mimeType || message.media?.document?.mimeType || '').toLowerCase();
  const extension = path.extname(fileName).toLowerCase();

  if (!mimeType.startsWith('video/') && !SUPPORTED_TELEGRAM_EXTENSIONS.has(extension)) {
    return null;
  }

  return {
    kind: 'mtproto_media',
    fileName,
    fileSizeBytes: Number(message.file.size || message.media?.document?.size || 0) || null,
    mimeType,
  };
}

function getTelegramClientTitle(message, media) {
  const caption = String(message?.message || '').trim();
  const firstCaptionLine = caption.split(/\r?\n/).map((line) => line.trim()).find(Boolean);

  return firstCaptionLine || media.fileName.replace(/\.[^.]+$/, '') || 'Telegram request video';
}

function clampTelegramText(text) {
  const value = String(text || '');
  const maxLength = 3900;

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 80)}\n\n[Message shortened. Check worker logs for full details.]`;
}

async function sendTelegramClientMessage(client, chatRef, text, replyTo) {
  if (!client || !chatRef || !text) {
    return null;
  }

  try {
    return await client.sendMessage(chatRef, {
      message: clampTelegramText(text),
      replyTo,
      noWebpage: true,
    });
  } catch (error) {
    if (!replyTo) {
      console.warn('[request-worker] telegram client send failed:', error.message || error);
      return null;
    }

    try {
      return await client.sendMessage(chatRef, {
        message: clampTelegramText(text),
        noWebpage: true,
      });
    } catch (retryError) {
      console.warn('[request-worker] telegram client send failed:', retryError.message || retryError);
      return null;
    }
  }
}

async function downloadTelegramClientMedia(client, message, destination, onProgress) {
  let lastEmitAt = 0;
  const progressCallback = (downloadedRaw, totalRaw) => {
    const downloaded = Number(downloadedRaw || 0);
    const total = Number(totalRaw || 0);
    const now = Date.now();

    if (total > 0 && now - lastEmitAt > 2000) {
      lastEmitAt = now;
      onProgress?.(downloaded, total);
    }
  };

  try {
    await client.downloadMedia(message, {
      outputFile: destination,
      progressCallback,
    });
  } catch (error) {
    if (!message.media) {
      throw error;
    }

    await client.downloadMedia(message.media, {
      outputFile: destination,
      progressCallback,
    });
  }

  const stats = await fs.stat(destination).catch(() => null);

  if (!stats || stats.size <= 0) {
    throw new Error('Telegram MTProto download completed without creating a source file.');
  }
}

async function createTelegramJob(db, message, media, title) {
  const collections = getCollections();
  const timestamp = nowIso();
  const chatId = normalizeTelegramId(message.chatId);
  const messageId = normalizeTelegramId(message.id);
  const jobId = `telegram-${chatId.replace(/[^a-zA-Z0-9_-]/g, '')}-${messageId || randomUUID().slice(0, 10)}`;
  const ref = db.collection(collections.jobs).doc(jobId);
  const existing = await ref.get();

  if (existing.exists) {
    return null;
  }

  const job = {
    id: jobId,
    requestId: '',
    movieId: '',
    title,
    userEmail: '',
    contentType: 'movie',
    status: 'claimed',
    progress: 1,
    currentStage: 'Telegram file received',
    sourceUrl: '',
    sourceFileName: media.fileName,
    sourceFileSizeBytes: media.fileSizeBytes,
    sourceType: 'telegram_mtproto_file',
    telegramClient: 'mtproto',
    telegramChatId: chatId,
    telegramMessageId: messageId,
    telegramSenderId: normalizeTelegramId(message.senderId),
    telegramMimeType: media.mimeType,
    processorQueue: 'request-telegram-worker',
    errorMessage: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    queuedAt: timestamp,
  };

  await ref.set(job, { merge: true });
  return job;
}

async function processTelegramClientMedia(db, s3, client, message, allowedSenderIds) {
  const chatRef = message.chatId;
  const chatId = normalizeTelegramId(chatRef);
  const senderId = normalizeTelegramId(message.senderId);

  if (allowedSenderIds.size && !allowedSenderIds.has(senderId)) {
    console.warn(`[request-worker] ignored telegram upload from unauthorized sender ${senderId}`);
    return;
  }

  const media = extractTelegramClientMedia(message);

  if (!media) {
    return;
  }

  const title = getTelegramClientTitle(message, media);
  const job = await createTelegramJob(db, message, media, title);

  if (!job) {
    await sendTelegramClientMessage(client, chatRef, 'That Telegram message is already tracked by the request worker.', message.id);
    return;
  }

  const progress = createJobOnlyProgressReporter(db, job);
  const workDir = path.join(requireEnv('WORK_DIR'), job.id);
  const sourcePath = path.join(workDir, media.fileName || 'telegram-source.bin');
  const outputPath = path.join(workDir, `${slugify(title)}.mp4`);
  const keyPrefix = (process.env.R2_KEY_PREFIX || 'requested').replace(/^\/+|\/+$/g, '');
  const r2Key = `${keyPrefix}/telegram/${job.id}/video.mp4`;

  await fs.mkdir(workDir, { recursive: true });
  await sendTelegramClientMessage(
    client,
    chatRef,
    `Received "${title}". Processing has started on the request VPS.`,
    message.id
  );

  try {
    await progress.report({
      status: 'downloading',
      progress: 5,
      currentStage: 'Downloading forwarded Telegram file via MTProto',
    });
    await downloadTelegramClientMedia(client, message, sourcePath, (downloadedBytes, totalBytes) => {
      const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 22 : 0;
      void progress.report({
        status: 'downloading',
        progress: 5 + percent,
        currentStage: 'Downloading forwarded Telegram file via MTProto',
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
      const percent = totalBytes > 0 ? (uploadedBytes / totalBytes) * 23 : 0;
      void progress.report({
        status: 'uploading',
        progress: 72 + percent,
        currentStage: 'Uploading processed MP4 to Cloudflare R2',
      });
    });
    await progress.flush();

    await removeLocalWorkspace(workDir);
    await progress.report({
      status: 'uploaded',
      progress: 100,
      currentStage: 'Telegram worker link ready',
      publicVideoUrl,
      directMp4Url: publicVideoUrl,
      sourceUrl: publicVideoUrl,
      completedAt: nowIso(),
    });

    await sendTelegramClientMessage(
      client,
      chatRef,
      [
        `Request worker finished "${title}".`,
        '',
        'Paste this link into the admin request panel:',
        publicVideoUrl,
      ].join('\n'),
      message.id
    );
    console.log(`[request-worker] telegram upload ready ${title}: ${publicVideoUrl}`);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error || 'Unknown Telegram worker error');
    await progress.report({
      status: 'failed',
      progress: 100,
      currentStage: 'Telegram worker failed',
      errorMessage: messageText,
    });
    await sendTelegramClientMessage(client, chatRef, `Request worker failed "${title}": ${messageText}`, message.id);
    throw error;
  } finally {
    await removeLocalWorkspace(workDir);
  }
}

async function startTelegramClientWorker(db, s3) {
  const config = getTelegramClientConfig();

  if (!hasAnyTelegramClientConfig(config)) {
    console.log('[request-worker] Telegram MTProto client is not configured; legacy queue watcher only');
    return null;
  }

  if (!Number.isInteger(config.apiId) || config.apiId <= 0) {
    throw new Error('REQUEST_TELEGRAM_API_ID must be configured for the MTProto request worker.');
  }

  if (!config.apiHash) {
    throw new Error('REQUEST_TELEGRAM_API_HASH must be configured for the MTProto request worker.');
  }

  if (!config.sessionString) {
    throw new Error('REQUEST_TELEGRAM_SESSION_STRING must be configured. Generate a dedicated request Telegram user session; do not use a bot token.');
  }

  if (!config.intakeChats.length) {
    throw new Error('REQUEST_TELEGRAM_INTAKE_CHAT_IDS must contain the dedicated request Telegram group ID.');
  }

  const { TelegramClient } = require('telegram');
  const { NewMessage } = require('telegram/events');
  const { StringSession } = require('telegram/sessions');
  const client = new TelegramClient(
    new StringSession(config.sessionString),
    config.apiId,
    config.apiHash,
    {
      connectionRetries: 5,
    }
  );

  await client.connect();

  if (!(await client.isUserAuthorized())) {
    throw new Error('Telegram MTProto session is not authorized. Create a valid string session for the dedicated request account.');
  }

  const me = await client.getMe();

  client.addEventHandler(
    (event) => {
      const message = event.message;

      if (!message) {
        return;
      }

      if (normalizeTelegramId(message.senderId) === normalizeTelegramId(me.id)) {
        return;
      }

      void processTelegramClientMedia(db, s3, client, message, config.allowedSenderIds).catch((error) => {
        console.error('[request-worker] telegram client message failed:', error.message || error);
      });
    },
    new NewMessage({ chats: config.intakeChats })
  );

  console.log(
    `[request-worker] Telegram MTProto client connected as ${me.username || me.firstName || me.id}; watching ${config.intakeChats.join(', ')}`
  );

  return client;
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
  await startTelegramClientWorker(db, s3);
  console.log('[request-worker] started request MTProto Telegram worker and legacy queue watcher');

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
