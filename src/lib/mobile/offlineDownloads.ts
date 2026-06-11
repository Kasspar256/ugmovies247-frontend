'use client';

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import { getHydratedClientDeviceHeaders } from '@/lib/auth/deviceIdentity';
import type { DownloadMovieInput, DownloadRecord } from '@/types/downloads';

const OFFLINE_DIR = 'offline-videos';
const MANIFEST_PATH = `${OFFLINE_DIR}/manifest.json`;
const ACTIVE_DOWNLOADS_STORAGE_KEY = 'ugmovies247-active-offline-downloads-v1';

export type OfflineDownloadRecord = DownloadRecord & {
  downloadKey?: string;
  storagePath: string;
  fileUri: string;
  playbackUrl: string;
  isOfflineFile: true;
  downloadedAtIso: string;
  fileSizeBytes?: number | null;
};

export type ActiveOfflineDownload = DownloadMovieInput & {
  id: string;
  userId: string;
  downloadKey: string;
  runId: string;
  status: 'downloading' | 'failed';
  downloadedBytes: number;
  totalBytes: number | null;
  startedAtIso: string;
  updatedAtIso: string;
  error?: string;
  tempStoragePath?: string;
  storagePath?: string;
};

type OfflineManifest = {
  version: 1;
  records: OfflineDownloadRecord[];
};

type DownloadTicket = {
  downloadUrl: string;
  filename: string;
};

type DownloadListener = () => void;
type NativeDownloadProgress = {
  type?: string;
  source?: string;
  url?: string;
  bytes?: number;
  contentLength?: number;
  lengthComputable?: boolean;
};
type NativeDownloadListener = { remove: () => Promise<void> | void };
type NativeDownloadPlugin = {
  addListener?: (
    eventName: 'progress',
    listener: (progress: NativeDownloadProgress) => void
  ) => Promise<NativeDownloadListener>;
  downloadFile?: (options: Record<string, unknown>) => Promise<unknown>;
};

const activeDownloads = new Map<string, ActiveOfflineDownload>();
const cancelledDownloadRunIds = new Set<string>();
const downloadListeners = new Set<DownloadListener>();
let restoredActiveDownloads = false;

// The Capacitor FileTransfer promise is owned by the live WebView. This manager keeps
// downloads alive across route changes; after a full app kill we recover the job as failed
// because the plugin does not expose a resumable background transfer handle here.

function isNative() {
  return Capacitor.isNativePlatform();
}

function nowIso() {
  return new Date().toISOString();
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const data = record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : {};
    const candidates = [
      record.message,
      record.errorMessage,
      record.error,
      record.code,
      data.message,
      data.errorMessage,
      data.error,
      data.code,
    ];

    for (const candidate of candidates) {
      const message = String(candidate || '').trim();

      if (message) {
        return message;
      }
    }
  }

  return String(error || 'Download failed.');
}

function isAndroidStoragePermissionError(error: unknown) {
  const message = getErrorMessage(error);

  return (
    /androidmanifest\.xml/i.test(message) ||
    /read_external_storage/i.test(message) ||
    /write_external_storage/i.test(message) ||
    /missing\s+the\s+following\s+permissions/i.test(message)
  );
}

function isRecoverableNativeTransferError(error: unknown) {
  const message = getErrorMessage(error);

  return (
    isAndroidStoragePermissionError(error) ||
    /file\s*transfer/i.test(message) ||
    /plugin.*(?:not\s+implemented|unavailable|not\s+available|missing|not\s+found)/i.test(message) ||
    /(?:not\s+implemented|unimplemented)/i.test(message) ||
    /native-file-transfer-unavailable/i.test(message) ||
    /no\s+plugin\s+found/i.test(message)
  );
}

function getUserFacingDownloadError(error: unknown) {
  const message = getErrorMessage(error);

  if (message === 'Download cancelled.') {
    return message;
  }

  if (isAndroidStoragePermissionError(error)) {
    return 'Offline downloads need an app update before saving on this Android device. You can still stream this title for now.';
  }

  if (isRecoverableNativeTransferError(error)) {
    return 'Offline downloads could not start on this app install. Please update the app once, then retry this download.';
  }

  return message || 'Download failed. Please check your connection and try again.';
}

function safeFilePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'video';
}

function isHttpUrl(value?: string | null) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isLikelyHlsUrl(value?: string | null) {
  const normalizedValue = String(value || '').trim();

  return Boolean(
    normalizedValue &&
      (/\.m3u8(?:[?#]|$)/i.test(normalizedValue) ||
        /(?:^|[?&])format=hls(?:&|$)/i.test(normalizedValue))
  );
}

function hashString(value: string) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return Math.abs(hash >>> 0).toString(36);
}

function normalizeKeyPart(value: unknown) {
  const normalized = String(value || '').trim();

  return normalized ? safeFilePart(normalized) : '';
}

function createDownloadRunId(downloadKey: string) {
  return `${downloadKey}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function getStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function persistActiveDownloads() {
  const storage = getStorage();

  if (!storage) return;

  try {
    const records = Array.from(activeDownloads.values());

    if (!records.length) {
      storage.removeItem(ACTIVE_DOWNLOADS_STORAGE_KEY);
      return;
    }

    storage.setItem(ACTIVE_DOWNLOADS_STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn('[offline-downloads] active download persistence failed', error);
  }
}

function restoreInterruptedActiveDownloads() {
  if (restoredActiveDownloads) return;

  restoredActiveDownloads = true;

  const storage = getStorage();

  if (!storage) return;

  try {
    const parsed = JSON.parse(storage.getItem(ACTIVE_DOWNLOADS_STORAGE_KEY) || '[]') as ActiveOfflineDownload[];

    parsed.forEach((job) => {
      if (!job?.downloadKey) return;

      activeDownloads.set(job.downloadKey, {
        ...job,
        status: 'failed',
        error:
          job.status === 'downloading'
            ? 'Download was interrupted before it finished. Tap Retry to start it again.'
            : getUserFacingDownloadError(job.error || 'Download failed.'),
        updatedAtIso: nowIso(),
      });
    });
  } catch (error) {
    console.warn('[offline-downloads] active download restore failed', error);
  }
}

function notifyDownloadListeners() {
  persistActiveDownloads();
  downloadListeners.forEach((listener) => listener());
}

export function subscribeOfflineDownloads(listener: DownloadListener) {
  restoreInterruptedActiveDownloads();
  downloadListeners.add(listener);

  return () => {
    downloadListeners.delete(listener);
  };
}

export function getActiveOfflineDownload(downloadKey: string) {
  restoreInterruptedActiveDownloads();

  return activeDownloads.get(downloadKey) || null;
}

export function getActiveOfflineDownloads() {
  restoreInterruptedActiveDownloads();

  return Array.from(activeDownloads.values()).sort((left, right) =>
    right.updatedAtIso.localeCompare(left.updatedAtIso)
  );
}

export async function cancelOfflineDownload(downloadKey: string) {
  restoreInterruptedActiveDownloads();

  const job = activeDownloads.get(downloadKey);

  if (!job) {
    return { cancelled: false };
  }

  console.info('[offline-downloads] cancel requested', {
    downloadKey,
    title: job.title,
    runId: job.runId,
  });

  cancelledDownloadRunIds.add(job.runId);
  activeDownloads.delete(downloadKey);
  notifyDownloadListeners();

  await deleteDataFile(job.tempStoragePath || '').catch(() => undefined);

  return { cancelled: true };
}

export async function retryOfflineDownload(downloadKey: string) {
  restoreInterruptedActiveDownloads();

  const job = activeDownloads.get(downloadKey);

  if (!job) {
    throw new Error('That download is no longer available to retry.');
  }

  if (job.status === 'downloading') {
    throw new Error('That download is already running.');
  }

  activeDownloads.delete(downloadKey);
  notifyDownloadListeners();

  return downloadMovieOffline(job);
}

export function formatDownloadBytes(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return '0B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 || size >= 10 ? 0 : 2;

  return `${size.toFixed(precision)}${units[unitIndex]}`;
}

export function getDownloadPercent(job: Pick<ActiveOfflineDownload, 'downloadedBytes' | 'totalBytes'>) {
  if (!job.totalBytes) return null;

  return Math.max(0, Math.min(100, Math.floor((job.downloadedBytes / job.totalBytes) * 100)));
}

export function getDownloadRemainingBytes(job: Pick<ActiveOfflineDownload, 'downloadedBytes' | 'totalBytes'>) {
  if (!job.totalBytes) return null;

  return Math.max(0, job.totalBytes - job.downloadedBytes);
}

export function formatDownloadProgressLabel(job: ActiveOfflineDownload | null) {
  if (!job) return '';

  if (job.status === 'failed') {
    return 'Download failed - Retry';
  }

  const percent = getDownloadPercent(job);
  const downloadedLabel = formatDownloadBytes(job.downloadedBytes);

  if (percent === null) {
    return `Downloading ${downloadedLabel}`;
  }

  return `Downloading ${percent}% (${downloadedLabel} / ${formatDownloadBytes(job.totalBytes)})`;
}

export function isOfflineDownloadActive(job: ActiveOfflineDownload | null) {
  return Boolean(job && job.status === 'downloading');
}

export function createOfflineDownloadKey(input: DownloadMovieInput) {
  const contentType = input.contentType || 'movie';
  const movieId = normalizeKeyPart(input.movieId);

  if (contentType === 'episode') {
    const seriesId = normalizeKeyPart(input.seriesId || input.movieId);
    const seasonNumber = input.seasonNumber || 1;
    const episodeNumber = input.episodeNumber || 1;
    const episodeIdentity =
      normalizeKeyPart(input.episodeId) || `url-${hashString(input.video_url || input.title)}`;

    return `episode:${seriesId}:s${seasonNumber}:e${episodeNumber}:${episodeIdentity}`;
  }

  if (contentType === 'part') {
    const partIndex = input.partIndex || 1;
    const partIdentity = `url-${hashString(input.video_url || input.title)}`;

    return `part:${movieId}:p${partIndex}:${partIdentity}`;
  }

  return `movie:${movieId}`;
}

export function withOfflineDownloadKey(input: DownloadMovieInput): DownloadMovieInput & { downloadKey: string } {
  return {
    ...input,
    downloadKey: input.downloadKey || createOfflineDownloadKey(input),
  };
}

function getRecordDownloadKey(record: OfflineDownloadRecord) {
  return record.downloadKey || createOfflineDownloadKey(record);
}

function isSameOfflineDownload(record: OfflineDownloadRecord, downloadKey: string) {
  return getRecordDownloadKey(record) === downloadKey;
}

async function ensureOfflineDirectory() {
  await Filesystem.mkdir({
    directory: Directory.Data,
    path: OFFLINE_DIR,
    recursive: true,
  }).catch(() => undefined);
}

async function readManifest(): Promise<OfflineManifest> {
  if (!isNative()) {
    return { version: 1, records: [] };
  }

  await ensureOfflineDirectory();

  try {
    const file = await Filesystem.readFile({
      directory: Directory.Data,
      path: MANIFEST_PATH,
      encoding: Encoding.UTF8,
    });

    const raw = typeof file.data === 'string' ? file.data : '';
    const parsed = JSON.parse(raw) as Partial<OfflineManifest>;

    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return { version: 1, records: [] };
  }
}

async function writeManifest(manifest: OfflineManifest) {
  await ensureOfflineDirectory();

  await Filesystem.writeFile({
    directory: Directory.Data,
    path: MANIFEST_PATH,
    data: JSON.stringify(manifest, null, 2),
    encoding: Encoding.UTF8,
  });
}

async function deleteDataFile(storagePath: string) {
  if (!storagePath) return;

  await Filesystem.deleteFile({
    directory: Directory.Data,
    path: storagePath,
  }).catch(() => undefined);
}

async function moveDataFile(from: string, to: string) {
  await deleteDataFile(to);

  await Filesystem.rename({
    directory: Directory.Data,
    from,
    to,
  });
}

async function requestDownloadTicket(movie: DownloadMovieInput) {
  const deviceHeaders = await getHydratedClientDeviceHeaders();
  const response = await fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...deviceHeaders },
    credentials: 'include',
    body: JSON.stringify({
      movieId: movie.movieId,
      title: movie.title,
      sourceUrl: movie.video_url,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as DownloadTicket & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Offline download could not be started.');
  }

  return payload;
}

function updateActiveDownload(downloadKey: string, updater: (job: ActiveOfflineDownload) => ActiveOfflineDownload) {
  const existing = activeDownloads.get(downloadKey);

  if (!existing) return;

  activeDownloads.set(downloadKey, updater(existing));
  notifyDownloadListeners();
}

async function addNativeDownloadProgressListener(downloadKey: string, candidateDownloadUrls: string[]) {
  const plugin = FileTransfer as unknown as NativeDownloadPlugin;

  if (typeof plugin.addListener !== 'function') {
    return undefined;
  }

  try {
    return await plugin.addListener('progress', (progress) => {
      if (progress.type && progress.type !== 'download') return;

      const progressSource = String(progress.source || progress.url || '');

      if (progressSource && !candidateDownloadUrls.includes(progressSource)) return;

      if (!progressSource) {
        const activeDownloadCount = Array.from(activeDownloads.values()).filter(
          (activeJob) => activeJob.status === 'downloading'
        ).length;

        if (activeDownloadCount > 1) return;
      }

      updateActiveDownload(downloadKey, (latestJob) => ({
        ...latestJob,
        downloadedBytes: Math.max(latestJob.downloadedBytes, Number(progress.bytes) || 0),
        totalBytes: progress.lengthComputable
          ? Number(progress.contentLength) || latestJob.totalBytes
          : latestJob.totalBytes,
        updatedAtIso: nowIso(),
      }));
    });
  } catch (error) {
    console.warn('[offline-downloads] native progress listener unavailable', {
      downloadKey,
      error,
    });
    return undefined;
  }
}

async function downloadToPrivateDataFile(options: {
  url: string;
  fileUri: string;
  storagePath: string;
  downloadKey: string;
  title: string;
}) {
  const headers = {
    Accept: 'video/mp4,application/octet-stream,*/*',
  };
  const fileTransfer = FileTransfer as unknown as NativeDownloadPlugin;
  let fileTransferError: unknown = null;

  if (typeof fileTransfer.downloadFile === 'function') {
    try {
      await fileTransfer.downloadFile({
        url: options.url,
        path: options.fileUri,
        progress: true,
        headers,
      });
      return 'file-transfer';
    } catch (error) {
      fileTransferError = error;

      if (!isRecoverableNativeTransferError(error)) {
        throw error;
      }

      console.warn('[offline-downloads] file transfer unavailable; retrying with filesystem downloader', {
        downloadKey: options.downloadKey,
        title: options.title,
        error,
      });
    }
  } else {
    fileTransferError = new Error('native-file-transfer-unavailable');
  }

  const filesystemDownloader = Filesystem as unknown as NativeDownloadPlugin;

  if (typeof filesystemDownloader.downloadFile !== 'function') {
    throw fileTransferError || new Error('native-file-transfer-unavailable');
  }

  await filesystemDownloader.downloadFile({
    url: options.url,
    directory: Directory.Data,
    path: options.storagePath,
    progress: true,
    recursive: true,
    headers,
  });

  return 'filesystem';
}

export function supportsNativeOfflineDownloads() {
  return isNative();
}

export async function listOfflineDownloads() {
  const manifest = await readManifest();
  const verified: OfflineDownloadRecord[] = [];

  for (const record of manifest.records) {
    try {
      const uri = await Filesystem.getUri({
        directory: Directory.Data,
        path: record.storagePath,
      });

      const stat = await Filesystem.stat({
        directory: Directory.Data,
        path: record.storagePath,
      });

      verified.push({
        ...record,
        downloadKey: getRecordDownloadKey(record),
        fileUri: uri.uri,
        playbackUrl: Capacitor.convertFileSrc(uri.uri),
        isOfflineFile: true,
        fileSizeBytes: Number(stat.size) || record.fileSizeBytes || null,
      });
    } catch {
      // Drop records whose underlying file has been removed by the OS or user.
    }
  }

  if (verified.length !== manifest.records.length) {
    await writeManifest({ version: 1, records: verified });
  }

  return verified;
}

export async function findOfflineDownload(downloadKey: string) {
  const records = await listOfflineDownloads();

  return records.find((record) => isSameOfflineDownload(record, downloadKey)) || null;
}

export async function downloadMovieOffline(movie: DownloadMovieInput) {
  if (!isNative()) {
    throw new Error('Offline video downloads are only available in the Android app.');
  }

  restoreInterruptedActiveDownloads();
  await ensureOfflineDirectory();

  const downloadInput = withOfflineDownloadKey(movie);

  if (isLikelyHlsUrl(downloadInput.video_url)) {
    throw new Error('Offline downloads need the original MP4 file. This title can stream online, but it cannot be saved to this device yet.');
  }

  const existing = await findOfflineDownload(downloadInput.downloadKey);

  if (existing) {
    return { alreadyExists: true, record: existing };
  }

  const currentJob = activeDownloads.get(downloadInput.downloadKey);

  if (currentJob?.status === 'downloading') {
    throw new Error('This download is already in progress.');
  }

  if (currentJob?.status === 'failed') {
    activeDownloads.delete(downloadInput.downloadKey);
    notifyDownloadListeners();
  }

  const startedAtIso = nowIso();
  const runId = createDownloadRunId(downloadInput.downloadKey);
  const finalStoragePath = `${OFFLINE_DIR}/${safeFilePart(downloadInput.downloadKey)}-${Date.now()}.mp4`;
  const tempStoragePath = `${finalStoragePath}.tmp`;
  const job: ActiveOfflineDownload = {
    ...downloadInput,
    id: `active-${downloadInput.downloadKey}`,
    userId: 'local-device',
    runId,
    status: 'downloading',
    downloadedBytes: 0,
    totalBytes: null,
    startedAtIso,
    updatedAtIso: startedAtIso,
    tempStoragePath,
    storagePath: finalStoragePath,
  };

  activeDownloads.set(downloadInput.downloadKey, job);
  notifyDownloadListeners();

  let progressListener: NativeDownloadListener | undefined;

  console.info('[offline-downloads] download started', {
    downloadKey: downloadInput.downloadKey,
    title: downloadInput.title,
    contentType: downloadInput.contentType || 'movie',
    seasonNumber: downloadInput.seasonNumber,
    episodeNumber: downloadInput.episodeNumber,
  });

  try {
    let ticket: DownloadTicket | null = null;
    let ticketError: unknown = null;

    try {
      ticket = await requestDownloadTicket(downloadInput);
    } catch (error) {
      if (/unauthorized|subscription required/i.test(getErrorMessage(error))) {
        throw error;
      }

      ticketError = error;
      console.warn('[offline-downloads] protected ticket unavailable; trying direct source', {
        downloadKey: downloadInput.downloadKey,
        title: downloadInput.title,
        error,
      });
    }

    const candidateDownloadUrls = Array.from(
      new Set(
        [ticket?.downloadUrl, downloadInput.video_url]
          .map((candidate) => String(candidate || '').trim())
          .filter((candidate) => isHttpUrl(candidate) && !isLikelyHlsUrl(candidate))
      )
    );

    if (!candidateDownloadUrls.length) {
      throw (
        ticketError ||
        new Error('No downloadable MP4 source was found for offline playback.')
      );
    }

    const fileInfo = await Filesystem.getUri({
      directory: Directory.Data,
      path: tempStoragePath,
    });

    progressListener = await addNativeDownloadProgressListener(
      downloadInput.downloadKey,
      candidateDownloadUrls
    );

    let transferError: unknown = null;
    let downloaded = false;

    for (const transferUrl of candidateDownloadUrls) {
      await deleteDataFile(tempStoragePath).catch(() => undefined);

      try {
        const method = await downloadToPrivateDataFile({
          url: transferUrl,
          fileUri: fileInfo.uri,
          storagePath: tempStoragePath,
          downloadKey: downloadInput.downloadKey,
          title: downloadInput.title,
        });
        console.info('[offline-downloads] file transfer completed', {
          downloadKey: downloadInput.downloadKey,
          title: downloadInput.title,
          method,
        });
        downloaded = true;
        break;
      } catch (error) {
        transferError = error;
        console.warn('[offline-downloads] file transfer attempt failed', {
          downloadKey: downloadInput.downloadKey,
          title: downloadInput.title,
          url: transferUrl,
          error,
        });
      }
    }

    if (!downloaded) {
      throw transferError || ticketError || new Error('The offline file transfer failed.');
    }

    if (cancelledDownloadRunIds.has(runId)) {
      await deleteDataFile(tempStoragePath);
      console.info('[offline-downloads] download cancelled', {
        downloadKey: downloadInput.downloadKey,
        title: downloadInput.title,
      });
      throw new Error('Download cancelled.');
    }

    const stat = await Filesystem.stat({
      directory: Directory.Data,
      path: tempStoragePath,
    });
    const fileSizeBytes = Number(stat.size) || 0;
    const latestJob = activeDownloads.get(downloadInput.downloadKey) || job;

    if (fileSizeBytes <= 0) {
      throw new Error('The downloaded file was empty.');
    }

    if (latestJob.totalBytes && fileSizeBytes < latestJob.totalBytes) {
      throw new Error('The downloaded file was incomplete.');
    }

    await moveDataFile(tempStoragePath, finalStoragePath);

    const finalUri = await Filesystem.getUri({
      directory: Directory.Data,
      path: finalStoragePath,
    });
    const downloadedAtIso = nowIso();
    const record: OfflineDownloadRecord = {
      ...downloadInput,
      id: `offline-${downloadInput.downloadKey}`,
      userId: 'local-device',
      video_url: '',
      status: 'completed',
      storagePath: finalStoragePath,
      fileUri: finalUri.uri,
      playbackUrl: Capacitor.convertFileSrc(finalUri.uri),
      isOfflineFile: true,
      downloadedAtIso,
      fileSizeBytes,
      downloadedAt: {
        seconds: Math.floor(new Date(downloadedAtIso).getTime() / 1000),
      },
    };

    const manifest = await readManifest();
    await writeManifest({
      version: 1,
      records: [
        record,
        ...manifest.records.filter((item) => !isSameOfflineDownload(item, downloadInput.downloadKey)),
      ],
    });

    activeDownloads.delete(downloadInput.downloadKey);
    notifyDownloadListeners();

    console.info('[offline-downloads] download completed', {
      downloadKey: downloadInput.downloadKey,
      title: downloadInput.title,
      fileSizeBytes,
    });

    return { alreadyExists: false, record };
  } catch (error) {
    await deleteDataFile(tempStoragePath);

    if (cancelledDownloadRunIds.delete(runId) || getErrorMessage(error) === 'Download cancelled.') {
      activeDownloads.delete(downloadInput.downloadKey);
      notifyDownloadListeners();
      throw new Error('Download cancelled.');
    }

    const userFacingError = getUserFacingDownloadError(error);
    const failedJob = activeDownloads.get(downloadInput.downloadKey) || job;
    activeDownloads.set(downloadInput.downloadKey, {
      ...failedJob,
      status: 'failed',
      error: userFacingError,
      updatedAtIso: nowIso(),
    });
    notifyDownloadListeners();

    console.warn('[offline-downloads] download failed', {
      downloadKey: downloadInput.downloadKey,
      title: downloadInput.title,
      error,
    });

    throw new Error(userFacingError);
  } finally {
    if (progressListener) {
      await Promise.resolve(progressListener.remove()).catch(() => undefined);
    }
  }
}

export async function removeOfflineDownload(identifier: string) {
  const manifest = await readManifest();
  const record = manifest.records.find(
    (item) => item.movieId === identifier || getRecordDownloadKey(item) === identifier
  );

  if (record) {
    await deleteDataFile(record.storagePath);
  }

  await writeManifest({
    version: 1,
    records: manifest.records.filter(
      (item) => item.movieId !== identifier && getRecordDownloadKey(item) !== identifier
    ),
  });

  return { removed: Boolean(record) };
}
