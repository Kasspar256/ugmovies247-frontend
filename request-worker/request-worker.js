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

const ACTIVE_TELEGRAM_JOB_STATUSES = new Set(['claimed', 'queued', 'downloading', 'processing', 'uploading']);
const TERMINAL_TELEGRAM_JOB_STATUSES = new Set(['uploaded', 'failed', 'cancelled', 'deleted']);
const SUPPORTED_TELEGRAM_COMMANDS = new Set([
  'help',
  'link',
  'raw',
  'rawlink',
  'compress',
  'queue',
  'jobs',
  'status',
  'cancel',
  'retry',
  'delete',
  'storage',
]);
const TELEGRAM_PENDING_ACTIONS = new Map();
const ACTIVE_TELEGRAM_JOBS = new Map();
const TELEGRAM_PROCESS_QUEUE = [];
let activeTelegramProcessors = 0;

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

function formatBytes(bytes) {
  const value = Number(bytes || 0);

  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
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

function getTelegramConcurrencyLimit() {
  const value = Number(
    process.env.REQUEST_TELEGRAM_CONCURRENCY ||
      process.env.TELEGRAM_WORKER_CONCURRENCY ||
      1
  );

  if (!Number.isFinite(value) || value <= 1) {
    return 1;
  }

  return Math.min(2, Math.floor(value));
}

function getPublicLinkRetentionHours() {
  const value = Number(
    process.env.REQUEST_PUBLIC_LINK_RETENTION_HOURS ||
      process.env.LINK_EXPIRY_HOURS ||
      24
  );

  if (!Number.isFinite(value) || value <= 0) {
    return 24;
  }

  return value;
}

function getPublicLinkExpiryIso() {
  return new Date(Date.now() + getPublicLinkRetentionHours() * 60 * 60 * 1000).toISOString();
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

function inspectMediaStreams(inputPath) {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      inputPath,
    ]);
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('close', () => {
      try {
        const parsed = JSON.parse(output || '{}');
        const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
        const video = streams.find((stream) => stream.codec_type === 'video') || null;
        const audio = streams.find((stream) => stream.codec_type === 'audio') || null;
        resolve({
          videoCodec: String(video?.codec_name || '').toLowerCase(),
          audioCodec: String(audio?.codec_name || '').toLowerCase(),
        });
      } catch {
        resolve({ videoCodec: '', audioCodec: '' });
      }
    });
    child.on('error', () => resolve({ videoCodec: '', audioCodec: '' }));
  });
}

function getCompressionSettings(profile) {
  const normalized = String(profile || '').trim().toLowerCase();

  if (normalized === 'strong') {
    return { preset: 'veryfast', crf: '27' };
  }

  if (normalized === 'medium') {
    return { preset: 'veryfast', crf: '24' };
  }

  return {
    preset: process.env.FFMPEG_PRESET || 'veryfast',
    crf: process.env.FFMPEG_CRF || '21',
  };
}

function runFfmpeg(inputPath, outputPath, durationSeconds, onProgress, options = {}) {
  const preset = process.env.FFMPEG_PRESET || 'veryfast';
  const crf = process.env.FFMPEG_CRF || '21';

  return inspectMediaStreams(inputPath).then((inspection) => new Promise((resolve, reject) => {
    const compressionSettings = options.forceTranscode
      ? getCompressionSettings(options.compressionProfile)
      : { preset, crf };
    const canCopyVideo = inspection.videoCodec === 'h264';
    const canCopyAudio = inspection.audioCodec === 'aac';
    const strategy = options.forceTranscode
      ? `compress-${options.compressionProfile || 'smart'}`
      : canCopyVideo
      ? canCopyAudio
        ? 'remux'
        : 'copy-video-transcode-audio'
      : 'transcode';
    const args =
      strategy === 'remux'
        ? [
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
            '-c',
            'copy',
            '-movflags',
            '+faststart',
            outputPath,
          ]
        : strategy === 'copy-video-transcode-audio'
          ? [
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
              'copy',
              '-movflags',
              '+faststart',
              '-c:a',
              'aac',
              '-ac',
              '2',
              '-b:a',
              '160k',
              outputPath,
            ]
          : [
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
              compressionSettings.preset,
              '-crf',
              compressionSettings.crf,
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

    console.log(
      `[ffmpeg-plan] ${strategy} video=${inspection.videoCodec || 'unknown'} audio=${inspection.audioCodec || 'none'}`
    );
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (options.control) {
      options.control.ffmpegChild = child;
    }
    let estimatedProgress = 34;
    const timer = setInterval(() => {
      if (options.control?.cancelRequested) {
        child.kill('SIGTERM');
        return;
      }

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
      if (options.control) {
        options.control.ffmpegChild = null;
      }

      if (options.control?.cancelRequested) {
        reject(new Error('Cancelled by operator.'));
        return;
      }

      if (code === 0) {
        onProgress?.(70);
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code}`));
    });
  }));
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

function getTelegramOutputMode() {
  const mode = String(
    process.env.REQUEST_TELEGRAM_OUTPUT_MODE ||
      process.env.REQUEST_WORKER_OUTPUT_MODE ||
      'r2'
  ).trim().toLowerCase();

  return mode === 'local' || mode === 'vps' ? 'local' : 'r2';
}

function getRequestPublicFilesDir() {
  return String(
    process.env.REQUEST_PUBLIC_FILES_DIR ||
      process.env.PUBLIC_FILES_DIR ||
      '/var/lib/ugmovies-request-worker/public/files'
  ).trim();
}

function getRequestPublicBaseUrl() {
  return String(
    process.env.REQUEST_PUBLIC_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      ''
  ).replace(/\/$/, '');
}

async function publishToLocalPublicFiles(filePath) {
  const publicDir = String(
    getRequestPublicFilesDir()
  ).trim();
  const publicBaseUrl = getRequestPublicBaseUrl();

  if (!publicBaseUrl) {
    throw new Error('REQUEST_PUBLIC_BASE_URL is required when REQUEST_TELEGRAM_OUTPUT_MODE=local.');
  }

  await fs.mkdir(publicDir, { recursive: true });
  await fs.chmod(path.dirname(path.dirname(publicDir)), 0o755).catch(() => undefined);
  await fs.chmod(path.dirname(publicDir), 0o755).catch(() => undefined);
  await fs.chmod(publicDir, 0o755).catch(() => undefined);
  const publicFileName = `${randomUUID().replace(/-/g, '')}.mp4`;
  const publicPath = path.join(publicDir, publicFileName);

  await fs.rename(filePath, publicPath);
  await fs.chmod(publicPath, 0o644).catch(() => undefined);

  return {
    publicUrl: `${publicBaseUrl}/${encodeURIComponent(publicFileName)}`,
    publicPath,
  };
}

async function publishTelegramOutput(s3, r2Key, outputPath, onProgress) {
  if (getTelegramOutputMode() === 'local') {
    onProgress?.(0, 1);
    const { publicUrl, publicPath } = await publishToLocalPublicFiles(outputPath);
    onProgress?.(1, 1);
    return {
      publicVideoUrl: publicUrl,
      publicFilePath: publicPath,
      outputMode: 'local',
    };
  }

  const publicVideoUrl = await uploadToR2(s3, r2Key, outputPath, onProgress);
  return {
    publicVideoUrl,
    outputMode: 'r2',
  };
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

async function editTelegramClientMessage(client, chatRef, messageId, text) {
  if (!client || !chatRef || !messageId || !text) {
    return false;
  }

  try {
    await client.editMessage(chatRef, {
      message: messageId,
      text: clampTelegramText(text),
      noWebpage: true,
    });
    return true;
  } catch (error) {
    const message = String(error?.message || error || '');

    if (message.includes('MESSAGE_NOT_MODIFIED')) {
      return true;
    }

    console.warn('[request-worker] telegram client edit failed:', error.message || error);
    return false;
  }
}

async function updateTelegramStatusMessage(
  client,
  chatRef,
  statusMessage,
  originalMessageId,
  text,
  options = {}
) {
  if (statusMessage?.id) {
    const edited = await editTelegramClientMessage(client, chatRef, statusMessage.id, text);

    if (edited) {
      return statusMessage;
    }
  }

  if (options.fallback === false) {
    return statusMessage;
  }

  return sendTelegramClientMessage(client, chatRef, text, originalMessageId);
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

async function createTelegramJob(db, message, media, title, pendingAction = null) {
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
    telegramAction: pendingAction?.action || 'link',
    compressionProfile: pendingAction?.profile || '',
    processorQueue: 'request-telegram-worker',
    errorMessage: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    queuedAt: timestamp,
  };

  await ref.set(job, { merge: true });
  return job;
}

function getTelegramPendingKey(chatId, senderId) {
  return `${chatId}:${senderId || 'unknown'}`;
}

function clearExpiredTelegramPendingActions() {
  const now = Date.now();

  for (const [key, action] of TELEGRAM_PENDING_ACTIONS.entries()) {
    if (Number(action.expiresAtMs || 0) <= now) {
      TELEGRAM_PENDING_ACTIONS.delete(key);
    }
  }
}

function setTelegramPendingAction(chatId, senderId, action, profile = '') {
  clearExpiredTelegramPendingActions();
  TELEGRAM_PENDING_ACTIONS.set(getTelegramPendingKey(chatId, senderId), {
    action,
    profile,
    expiresAtMs: Date.now() + 15 * 60 * 1000,
  });
}

function consumeTelegramPendingAction(chatId, senderId) {
  clearExpiredTelegramPendingActions();
  const key = getTelegramPendingKey(chatId, senderId);
  const action = TELEGRAM_PENDING_ACTIONS.get(key) || null;

  if (action) {
    TELEGRAM_PENDING_ACTIONS.delete(key);
  }

  return action;
}

function clearTelegramPendingAction(chatId, senderId) {
  clearExpiredTelegramPendingActions();
  return TELEGRAM_PENDING_ACTIONS.delete(getTelegramPendingKey(chatId, senderId));
}

function normalizeCompressionProfile(value) {
  const profile = String(value || 'smart').trim().toLowerCase();

  if (!profile || profile === 'smart') {
    return 'smart';
  }

  if (profile === 'medium' || profile === 'strong') {
    return profile;
  }

  throw new Error('Compression profile must be smart, medium, or strong.');
}

function getTelegramReplyMessageId(message) {
  const direct = message?.replyToMsgId || message?.replyTo?.replyToMsgId || message?.replyTo?.replyToTopId;

  return direct ? normalizeTelegramId(direct) : '';
}

async function queryFirstJob(db, query) {
  const snapshot = await query.limit(1).get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return { id: doc.id, ...(doc.data() || {}) };
}

async function resolveTelegramJob(db, message, commandArgs) {
  const collections = getCollections();
  const chatId = normalizeTelegramId(message.chatId);
  const explicitJobId = String(commandArgs || '').trim().replace(/^`|`$/g, '');

  if (explicitJobId && explicitJobId.toLowerCase() !== 'ready') {
    const doc = await db.collection(collections.jobs).doc(explicitJobId).get();

    if (doc.exists) {
      return { id: doc.id, ...(doc.data() || {}) };
    }
  }

  const replyMessageId = getTelegramReplyMessageId(message);

  if (!replyMessageId) {
    return null;
  }

  const byStatusMessage = await queryFirstJob(
    db,
    db
      .collection(collections.jobs)
      .where('telegramChatId', '==', chatId)
      .where('telegramStatusMessageId', '==', replyMessageId)
  );

  if (byStatusMessage) {
    return byStatusMessage;
  }

  return queryFirstJob(
    db,
    db
      .collection(collections.jobs)
      .where('telegramChatId', '==', chatId)
      .where('telegramMessageId', '==', replyMessageId)
  );
}

function formatTelegramJobListItem(job) {
  const title = job.title || job.sourceFileName || 'Untitled';
  const progress = Math.round(Number(job.progress || 0));
  return `- ${job.id} | ${job.status || 'unknown'} | ${progress}% | ${title}`;
}

function getLocalPublicPathFromUrl(publicUrl) {
  const baseUrl = getRequestPublicBaseUrl();

  if (!publicUrl || !baseUrl || !String(publicUrl).startsWith(`${baseUrl}/`)) {
    return '';
  }

  const fileName = decodeURIComponent(String(publicUrl).slice(baseUrl.length + 1));

  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    return '';
  }

  return path.join(getRequestPublicFilesDir(), fileName);
}

async function deleteLocalPublicFileForJob(job) {
  const publicPath = job.publicFilePath || getLocalPublicPathFromUrl(job.publicVideoUrl || job.sourceUrl || '');

  if (!publicPath) {
    return 0;
  }

  const stats = await fs.stat(publicPath).catch(() => null);
  await fs.rm(publicPath, { force: true }).catch(() => undefined);
  return stats?.size || 0;
}

async function getDirectorySize(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  let total = 0;

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      const stats = await fs.stat(entryPath).catch(() => null);
      total += stats?.size || 0;
    }
  }

  return total;
}

async function getStorageSummary() {
  const publicDir = getRequestPublicFilesDir();
  await fs.mkdir(publicDir, { recursive: true });
  const [statFs, readyBytes] = await Promise.all([
    fs.statfs(publicDir).catch(() => null),
    getDirectorySize(publicDir),
  ]);

  if (!statFs) {
    return {
      freeBytes: 0,
      totalBytes: 0,
      usedBytes: 0,
      readyBytes,
    };
  }

  const totalBytes = Number(statFs.blocks || 0) * Number(statFs.bsize || 0);
  const freeBytes = Number(statFs.bfree || 0) * Number(statFs.bsize || 0);

  return {
    freeBytes,
    totalBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
    readyBytes,
  };
}

async function cleanupOrphanPublicFiles() {
  const publicDir = getRequestPublicFilesDir();
  const retentionMs = getPublicLinkRetentionHours() * 60 * 60 * 1000;
  const entries = await fs.readdir(publicDir, { withFileTypes: true }).catch(() => []);
  let deletedCount = 0;
  let deletedBytes = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.mp4')) {
      continue;
    }

    const filePath = path.join(publicDir, entry.name);
    const stats = await fs.stat(filePath).catch(() => null);

    if (!stats || Date.now() - stats.mtimeMs < retentionMs) {
      continue;
    }

    await fs.rm(filePath, { force: true }).catch(() => undefined);
    deletedCount += 1;
    deletedBytes += stats.size || 0;
  }

  return { deletedCount, deletedBytes };
}

async function cleanupExpiredTelegramLinks(db) {
  if (getTelegramOutputMode() !== 'local') {
    return;
  }

  const collections = getCollections();
  const now = nowIso();
  const snapshot = await db
    .collection(collections.jobs)
    .where('processorQueue', '==', 'request-telegram-worker')
    .limit(200)
    .get();
  let deletedCount = 0;
  let deletedBytes = 0;

  for (const doc of snapshot.docs) {
    const job = { id: doc.id, ...(doc.data() || {}) };

    if (job.status !== 'uploaded' || !job.expiresAt || String(job.expiresAt) > now) {
      continue;
    }

    deletedBytes += await deleteLocalPublicFileForJob(job);
    await doc.ref.set({
      status: 'expired',
      currentStage: 'Temporary VPS link expired and was deleted',
      publicVideoUrl: '',
      directMp4Url: '',
      sourceUrl: '',
      publicFilePath: '',
      expiredAt: now,
      updatedAt: now,
    }, { merge: true });
    deletedCount += 1;
  }

  const orphanResult = await cleanupOrphanPublicFiles();
  deletedCount += orphanResult.deletedCount;
  deletedBytes += orphanResult.deletedBytes;

  if (deletedCount > 0) {
    console.log(`[request-worker] cleanup deleted ${deletedCount} temporary file(s), freed ${formatBytes(deletedBytes)}`);
  }
}

async function handleTelegramCommand(db, s3, client, message, allowedSenderIds) {
  const text = String(message?.message || '').trim();

  if (!text.startsWith('/')) {
    return false;
  }

  const [rawCommand, ...args] = text.split(/\s+/);
  const command = rawCommand.slice(1).split('@')[0].toLowerCase();
  const collections = getCollections();
  const chatId = normalizeTelegramId(message.chatId);
  const senderId = normalizeTelegramId(message.senderId);

  if (!SUPPORTED_TELEGRAM_COMMANDS.has(command)) {
    await sendTelegramClientMessage(
      client,
      message.chatId,
      'Unknown request worker command. Use /help to see the available operator commands.',
      message.id
    );
    return true;
  }

  if (command === 'help') {
    await sendTelegramClientMessage(
      client,
      message.chatId,
      [
        'Request worker commands:',
        '/help - show available commands',
        '/link - clear one-time compression/raw mode and use the normal link flow',
        '/rawlink - publish the next source as-is without ffprobe or ffmpeg conversion',
        '/compress [smart|medium|strong] - apply one-time compression to the next file only',
        '/queue or /jobs - list active and recent jobs in this chat',
        '/status <job_id> - show one job status',
        '/cancel <job_id> - cancel an active request-worker job',
        '/retry <job_id> - retry a failed job from the original Telegram message',
        '/delete - delete a ready/cancelled job when replying to its status message',
        '/delete <job_id> - delete one ready/cancelled job from VPS storage',
        '/delete ready - delete all ready temporary links in this chat',
        '/storage - show free VPS storage and ready-link usage',
        '',
        'Tip: reply to a worker status message with /status, /cancel, /retry, or /delete instead of typing the job id.',
      ].join('\n'),
      message.id
    );
    return true;
  }

  if (command === 'link') {
    const cleared = clearTelegramPendingAction(chatId, senderId);
    await sendTelegramClientMessage(
      client,
      message.chatId,
      cleared
        ? 'Normal link mode enabled for the next request file.'
        : 'Normal link mode is already the default. Forward the request file whenever you are ready.',
      message.id
    );
    return true;
  }

  if (command === 'raw' || command === 'rawlink') {
    setTelegramPendingAction(chatId, senderId, 'rawlink');
    await sendTelegramClientMessage(
      client,
      message.chatId,
      'Raw link mode enabled for the next video only. I will publish the source file without FFmpeg conversion.',
      message.id
    );
    return true;
  }

  if (command === 'compress') {
    try {
      const profile = normalizeCompressionProfile(args.join(' '));
      setTelegramPendingAction(chatId, senderId, 'compress', profile);
      await sendTelegramClientMessage(
        client,
        message.chatId,
        `Compression mode enabled for the next video only using the ${profile} profile.`,
        message.id
      );
    } catch (error) {
      await sendTelegramClientMessage(client, message.chatId, error.message || String(error), message.id);
    }
    return true;
  }

  if (command === 'queue' || command === 'jobs') {
    const snapshot = await db
      .collection(collections.jobs)
      .where('telegramChatId', '==', chatId)
      .limit(10)
      .get();
    const jobs = snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, 10);
    const activeJobs = jobs.filter((job) => ACTIVE_TELEGRAM_JOB_STATUSES.has(String(job.status || '')));
    const recentJobs = jobs.filter((job) => !ACTIVE_TELEGRAM_JOB_STATUSES.has(String(job.status || ''))).slice(0, 5);
    const lines = ['Current request intake queue:', '', 'Active:'];

    if (activeJobs.length) {
      lines.push(...activeJobs.slice(0, 5).map(formatTelegramJobListItem));
    } else {
      lines.push('none');
    }

    if (recentJobs.length) {
      lines.push('', 'Recent:', ...recentJobs.map(formatTelegramJobListItem));
    }

    lines.push(
      '',
      `Local worker slots: ${activeTelegramProcessors}/${getTelegramConcurrencyLimit()} active`,
      `Waiting in memory: ${TELEGRAM_PROCESS_QUEUE.length}`
    );

    await sendTelegramClientMessage(
      client,
      message.chatId,
      jobs.length ? lines.join('\n') : 'No request worker jobs found for this group yet.',
      message.id
    );
    return true;
  }

  if (command === 'status') {
    const job = await resolveTelegramJob(db, message, args.join(' '));

    if (!job) {
      await sendTelegramClientMessage(
        client,
        message.chatId,
        'I could not find that job. Reply to a worker status message with /status, or use /status <job_id>.',
        message.id
      );
      return true;
    }

    await sendTelegramClientMessage(
      client,
      message.chatId,
      [
        `Job ${job.id}`,
        `Title: ${job.title || job.sourceFileName || 'Untitled'}`,
        `Status: ${job.status || 'unknown'}`,
        `Progress: ${Math.round(Number(job.progress || 0))}%`,
        `Stage: ${job.currentStage || '-'}`,
        job.telegramAction && job.telegramAction !== 'link' ? `Mode: ${job.telegramAction}${job.compressionProfile ? ` (${job.compressionProfile})` : ''}` : '',
        job.publicVideoUrl ? `Link: ${job.publicVideoUrl}` : '',
        job.errorMessage ? `Error: ${job.errorMessage}` : '',
      ].filter(Boolean).join('\n'),
      message.id
    );
    return true;
  }

  if (command === 'cancel') {
    const job = await resolveTelegramJob(db, message, args.join(' '));

    if (!job) {
      await sendTelegramClientMessage(
        client,
        message.chatId,
        'I could not find that job. Reply to a worker status message with /cancel, or use /cancel <job_id>.',
        message.id
      );
      return true;
    }

    if (!ACTIVE_TELEGRAM_JOB_STATUSES.has(String(job.status || ''))) {
      await sendTelegramClientMessage(
        client,
        message.chatId,
        `Job ${job.id} is ${job.status || 'unknown'} and cannot be cancelled right now.`,
        message.id
      );
      return true;
    }

    const control = ACTIVE_TELEGRAM_JOBS.get(job.id);

    if (control) {
      control.cancelRequested = true;
      control.ffmpegChild?.kill('SIGTERM');
    }

    await db.collection(collections.jobs).doc(job.id).set({
      status: 'cancelled',
      currentStage: 'Cancelled by operator',
      errorMessage: 'Cancelled by operator.',
      updatedAt: nowIso(),
    }, { merge: true });
    await sendTelegramClientMessage(client, message.chatId, `Cancelled job ${job.id}.`, message.id);
    return true;
  }

  if (command === 'retry') {
    const job = await resolveTelegramJob(db, message, args.join(' '));

    if (!job) {
      await sendTelegramClientMessage(
        client,
        message.chatId,
        'I could not find that job. Reply to a worker status message with /retry, or use /retry <job_id>.',
        message.id
      );
      return true;
    }

    if (ACTIVE_TELEGRAM_JOB_STATUSES.has(String(job.status || ''))) {
      await sendTelegramClientMessage(client, message.chatId, `Job ${job.id} is already active.`, message.id);
      return true;
    }

    if (String(job.status || '') === 'uploaded') {
      await sendTelegramClientMessage(client, message.chatId, 'That job already finished successfully. Forward the source again only if you need a new link.', message.id);
      return true;
    }

    const sourceMessageId = Number(job.telegramMessageId || 0);

    if (!sourceMessageId) {
      await sendTelegramClientMessage(client, message.chatId, 'That job has no original Telegram message attached, so I cannot retry it automatically.', message.id);
      return true;
    }

    await deleteLocalPublicFileForJob(job);
    await db.collection(collections.jobs).doc(job.id).delete();
    const sourceMessage = await client.getMessages(message.chatId, { ids: sourceMessageId });

    if (!sourceMessage) {
      await sendTelegramClientMessage(client, message.chatId, 'I could not reload the original Telegram source message. Please forward the file again.', message.id);
      return true;
    }

    await sendTelegramClientMessage(client, message.chatId, `Re-queued job ${job.id} from the original Telegram message.`, message.id);
    void enqueueTelegramClientMedia(db, s3, client, sourceMessage, allowedSenderIds).catch((error) => {
      console.error('[request-worker] telegram retry failed:', error.message || error);
    });
    return true;
  }

  if (command === 'delete') {
    const requested = args.join(' ').trim().toLowerCase();

    if (requested === 'ready' || requested === 'all-ready' || requested === 'ready all') {
      const snapshot = await db
        .collection(collections.jobs)
        .where('telegramChatId', '==', chatId)
        .where('status', '==', 'uploaded')
        .limit(50)
        .get();
      let deletedCount = 0;
      let deletedBytes = 0;

      for (const doc of snapshot.docs) {
        const job = { id: doc.id, ...(doc.data() || {}) };
        deletedBytes += await deleteLocalPublicFileForJob(job);
        await doc.ref.set({
          status: 'deleted',
          currentStage: 'Deleted from VPS storage',
          publicVideoUrl: '',
          sourceUrl: '',
          directMp4Url: '',
          publicFilePath: '',
          updatedAt: nowIso(),
        }, { merge: true });
        deletedCount += 1;
      }

      await sendTelegramClientMessage(
        client,
        message.chatId,
        `Deleted ready temporary links from VPS storage.\nJobs: ${deletedCount}\nApprox freed: ${formatBytes(deletedBytes)}`,
        message.id
      );
      return true;
    }

    const job = await resolveTelegramJob(db, message, args.join(' '));

    if (!job) {
      await sendTelegramClientMessage(
        client,
        message.chatId,
        'I could not find that job. Reply to a worker status message with /delete, use /delete <job_id>, or use /delete ready.',
        message.id
      );
      return true;
    }

    if (ACTIVE_TELEGRAM_JOB_STATUSES.has(String(job.status || ''))) {
      await sendTelegramClientMessage(client, message.chatId, `Job ${job.id} is active. Use /cancel first, then /delete after it stops.`, message.id);
      return true;
    }

    if (String(job.status || '') === 'failed') {
      await sendTelegramClientMessage(client, message.chatId, `Job ${job.id} is failed but retryable. Use /retry if you want to run it again.`, message.id);
      return true;
    }

    const deletedBytes = await deleteLocalPublicFileForJob(job);
    await db.collection(collections.jobs).doc(job.id).set({
      status: 'deleted',
      currentStage: 'Deleted from VPS storage',
      publicVideoUrl: '',
      sourceUrl: '',
      directMp4Url: '',
      publicFilePath: '',
      updatedAt: nowIso(),
    }, { merge: true });
    await sendTelegramClientMessage(client, message.chatId, `Deleted job ${job.id} from VPS storage. Approx freed: ${formatBytes(deletedBytes)}.`, message.id);
    return true;
  }

  if (command === 'storage') {
    const [summary, jobsSnapshot] = await Promise.all([
      getStorageSummary(),
      db.collection(collections.jobs).where('telegramChatId', '==', chatId).limit(100).get(),
    ]);
    const counts = {};

    for (const doc of jobsSnapshot.docs) {
      const status = String((doc.data() || {}).status || 'unknown');
      counts[status] = (counts[status] || 0) + 1;
    }

    const usedPercent = summary.totalBytes > 0 ? Math.round((summary.usedBytes / summary.totalBytes) * 100) : 0;
    await sendTelegramClientMessage(
      client,
      message.chatId,
      [
        'VPS storage:',
        `Free: ${formatBytes(summary.freeBytes)} of ${formatBytes(summary.totalBytes)}`,
        `Used: ${formatBytes(summary.usedBytes)} (${usedPercent}%)`,
        '',
        'Request worker jobs:',
        `Ready links: ${counts.uploaded || 0} using about ${formatBytes(summary.readyBytes)}`,
        `Active: ${Array.from(ACTIVE_TELEGRAM_JOB_STATUSES).reduce((sum, status) => sum + (counts[status] || 0), 0)}`,
        `Failed: ${counts.failed || 0}`,
        `Deleted: ${counts.deleted || 0}`,
      ].join('\n'),
      message.id
    );
    return true;
  }

  return true;
}

function drainTelegramProcessQueue() {
  const limit = getTelegramConcurrencyLimit();

  while (activeTelegramProcessors < limit && TELEGRAM_PROCESS_QUEUE.length > 0) {
    const item = TELEGRAM_PROCESS_QUEUE.shift();
    activeTelegramProcessors += 1;

    void processTelegramClientMedia(
      item.db,
      item.s3,
      item.client,
      item.message,
      item.allowedSenderIds
    )
      .catch((error) => {
        console.error('[request-worker] telegram queued media failed:', error.message || error);
      })
      .finally(() => {
        activeTelegramProcessors = Math.max(0, activeTelegramProcessors - 1);
        drainTelegramProcessQueue();
      });
  }
}

async function enqueueTelegramClientMedia(db, s3, client, message, allowedSenderIds) {
  const chatRef = message.chatId;
  const senderId = normalizeTelegramId(message.senderId);

  if (allowedSenderIds.size && !allowedSenderIds.has(senderId)) {
    console.warn(`[request-worker] ignored telegram upload from unauthorized sender ${senderId}`);
    return;
  }

  const media = extractTelegramClientMedia(message);

  if (!media) {
    return;
  }

  const waitingAhead = activeTelegramProcessors + TELEGRAM_PROCESS_QUEUE.length;

  if (waitingAhead > 0) {
    await sendTelegramClientMessage(
      client,
      chatRef,
      [
        `Queued "${getTelegramClientTitle(message, media)}".`,
        `Position: ${waitingAhead + 1}`,
        `Worker slots: ${activeTelegramProcessors}/${getTelegramConcurrencyLimit()} active`,
        'I will process this file when the previous request file finishes.',
      ].join('\n'),
      message.id
    );
  }

  TELEGRAM_PROCESS_QUEUE.push({
    db,
    s3,
    client,
    message,
    allowedSenderIds,
  });
  drainTelegramProcessQueue();
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
  console.log(
    `[request-worker] accepted Telegram media message ${normalizeTelegramId(message.id)} from ${senderId || 'unknown'} in ${chatId}: ${media.fileName}`
  );
  const pendingAction = consumeTelegramPendingAction(chatId, senderId);
  const job = await createTelegramJob(db, message, media, title, pendingAction);

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
  const outputMode = getTelegramOutputMode();
  const control = {
    cancelRequested: false,
    ffmpegChild: null,
  };
  ACTIVE_TELEGRAM_JOBS.set(job.id, control);

  await fs.mkdir(workDir, { recursive: true });
  let statusMessage = await sendTelegramClientMessage(
    client,
    chatRef,
    [
      `Queued request worker job ${job.id}.`,
      '',
      `Source: ${title}`,
      'Stage: Downloading from Telegram...',
    ].join('\n'),
    message.id
  );
  if (statusMessage?.id) {
    await progress.report({
      telegramStatusMessageId: normalizeTelegramId(statusMessage.id),
      replyChatId: normalizeTelegramId(statusMessage.chatId || chatRef),
    });
    await progress.flush();
  }

  try {
    await progress.report({
      status: 'downloading',
      progress: 5,
      currentStage: 'Downloading forwarded Telegram file via MTProto',
    });
    statusMessage = await updateTelegramStatusMessage(
      client,
      chatRef,
      statusMessage,
      message.id,
      [
        `Job ${job.id}`,
        `Source: ${title}`,
        'Stage: Downloading from Telegram...',
      ].join('\n')
    );
    await downloadTelegramClientMedia(client, message, sourcePath, (downloadedBytes, totalBytes) => {
      if (control.cancelRequested) {
        throw new Error('Cancelled by operator.');
      }

      const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 22 : 0;
      void progress.report({
        status: 'downloading',
        progress: 5 + percent,
        currentStage: 'Downloading forwarded Telegram file via MTProto',
      });
    });
    await progress.flush();

    if (control.cancelRequested) {
      throw new Error('Cancelled by operator.');
    }

    const rawPassthrough = job.telegramAction === 'rawlink';
    const forceCompression = job.telegramAction === 'compress';
    let outputForPublish = outputPath;

    if (rawPassthrough) {
      outputForPublish = sourcePath;
      await progress.report({
        status: 'processing',
        progress: 70,
        currentStage: 'Raw source ready for publishing',
      });
      statusMessage = await updateTelegramStatusMessage(
        client,
        chatRef,
        statusMessage,
        message.id,
        [
          `Job ${job.id}`,
          `Source: ${title}`,
          'Stage: Raw link mode, publishing source directly...',
        ].join('\n')
      );
    } else {
      await progress.report({
        status: 'processing',
        progress: 30,
        currentStage: forceCompression ? 'Processing via FFmpeg compression' : 'Processing via FFmpeg',
      });
      statusMessage = await updateTelegramStatusMessage(
        client,
        chatRef,
        statusMessage,
        message.id,
        [
          `Job ${job.id}`,
          `Source: ${title}`,
          forceCompression
            ? `Stage: Processing via FFmpeg compression (${job.compressionProfile || 'smart'})...`
            : 'Stage: Processing via FFmpeg...',
          forceCompression ? 'Manual compression mode is enabled for this file.' : 'Smart copy/remux mode is enabled where possible.',
        ].join('\n')
      );
      const durationSeconds = await runProbeDuration(sourcePath);
      let lastTelegramProgressAt = 0;
      let lastTelegramProgressValue = 0;
      await runFfmpeg(sourcePath, outputPath, durationSeconds, (percent) => {
        void progress.report({
          status: 'processing',
          progress: percent,
          currentStage: forceCompression ? 'Processing via FFmpeg compression' : 'Processing via FFmpeg',
        });

        const now = Date.now();
        if (
          now - lastTelegramProgressAt > 60000 ||
          Math.abs(percent - lastTelegramProgressValue) >= 10
        ) {
          lastTelegramProgressAt = now;
          lastTelegramProgressValue = percent;
          void updateTelegramStatusMessage(
            client,
            chatRef,
            statusMessage,
            message.id,
            [
              `Job ${job.id}`,
              `Source: ${title}`,
              `Stage: Processing via FFmpeg... ${Math.round(percent)}%`,
            ].join('\n'),
            { fallback: false }
          ).then((nextStatusMessage) => {
            statusMessage = nextStatusMessage || statusMessage;
          });
        }
      }, {
        control,
        forceTranscode: forceCompression,
        compressionProfile: job.compressionProfile || 'smart',
      });
      await progress.flush();
    }

    await progress.report({
      status: 'uploading',
      progress: 72,
      currentStage:
        outputMode === 'local'
          ? 'Publishing processed MP4 to VPS public files'
          : 'Uploading processed MP4 to Cloudflare R2',
    });
    statusMessage = await updateTelegramStatusMessage(
      client,
      chatRef,
      statusMessage,
      message.id,
      [
        `Job ${job.id}`,
        `Source: ${title}`,
        outputMode === 'local'
          ? 'Stage: Publishing temporary VPS link...'
          : 'Stage: Uploading processed MP4 to R2...',
      ].join('\n')
    );
    const { publicVideoUrl, publicFilePath } = await publishTelegramOutput(s3, r2Key, outputForPublish, (uploadedBytes, totalBytes) => {
      const percent = totalBytes > 0 ? (uploadedBytes / totalBytes) * 23 : 0;
      void progress.report({
        status: 'uploading',
        progress: 72 + percent,
        currentStage:
          outputMode === 'local'
            ? 'Publishing processed MP4 to VPS public files'
            : 'Uploading processed MP4 to Cloudflare R2',
      });
    });
    await progress.flush();

    await removeLocalWorkspace(workDir);
    const expiresAt = getPublicLinkExpiryIso();
    await progress.report({
      status: 'uploaded',
      progress: 100,
      currentStage: 'Telegram worker link ready',
      publicVideoUrl,
      directMp4Url: publicVideoUrl,
      sourceUrl: publicVideoUrl,
      publicFilePath: publicFilePath || '',
      outputMode,
      expiresAt,
      completedAt: nowIso(),
    });

    await updateTelegramStatusMessage(
      client,
      chatRef,
      statusMessage,
      message.id,
      [
        `Request worker finished "${title}".`,
        '',
        outputMode === 'local' ? 'Temporary VPS source link:' : 'Final MP4 link:',
        publicVideoUrl,
        '',
        `Auto-delete: ${outputMode === 'local' ? `${getPublicLinkRetentionHours()} hours` : 'handled by storage policy'}`,
      ].join('\n')
    );
    console.log(`[request-worker] telegram upload ready ${title}: ${publicVideoUrl}`);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error || 'Unknown Telegram worker error');
    const wasCancelled = messageText.toLowerCase().includes('cancelled by operator') || control.cancelRequested;
    await progress.report({
      status: wasCancelled ? 'cancelled' : 'failed',
      progress: 100,
      currentStage: wasCancelled ? 'Cancelled by operator' : 'Telegram worker failed',
      errorMessage: messageText,
    });
    await sendTelegramClientMessage(
      client,
      chatRef,
      wasCancelled
        ? `Request worker cancelled "${title}".`
        : `Request worker failed "${title}": ${messageText}`,
      message.id
    );

    if (!wasCancelled) {
      throw error;
    }
  } finally {
    ACTIVE_TELEGRAM_JOBS.delete(job.id);
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

      if (String(message.message || '').trim().startsWith('/')) {
        void handleTelegramCommand(db, s3, client, message, config.allowedSenderIds).catch((error) => {
          console.error('[request-worker] telegram command failed:', error.message || error);
        });
        return;
      }

      void enqueueTelegramClientMedia(db, s3, client, message, config.allowedSenderIds).catch((error) => {
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
  await cleanupExpiredTelegramLinks(db).catch((error) => {
    console.warn('[request-worker] startup cleanup failed:', error.message || error);
  });
  setInterval(() => {
    void cleanupExpiredTelegramLinks(db).catch((error) => {
      console.warn('[request-worker] scheduled cleanup failed:', error.message || error);
    });
  }, 60 * 60 * 1000);
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
