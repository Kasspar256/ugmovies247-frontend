'use client';

import { useEffect, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import type { DownloadMovieInput, DownloadRecord, DownloadStatus } from '@/types/downloads';

const OFFLINE_DIR = 'offline-videos';
const MANIFEST_PATH = `${OFFLINE_DIR}/manifest.json`;
const ACTIVE_DOWNLOADS_STORAGE_KEY = 'ugmovies247-active-offline-downloads-v1';

export type OfflineDownloadRecord = DownloadRecord & {
  downloadKey: string;
  storagePath: string;
  fileUri: string;
  playbackUrl: string;
  isOfflineFile: true;
  downloadedAtIso: string;
};

export type ActiveOfflineDownload = {
  downloadKey: string;
  input: DownloadMovieInput & { downloadKey: string };
  status: Exclude<DownloadStatus, 'completed'> | 'queued';
  downloadedBytes: number;
  totalBytes: number | null;
  error?: string;
  startedAtIso: string;
  updatedAtIso: string;
  tempStoragePath?: string;
  finalStoragePath?: string;
  cancelRequested?: boolean;
};

type OfflineManifest = {
  version: 1;
  records: OfflineDownloadRecord[];
};

type DownloadTicket = {
  downloadUrl: string;
  filename: string;
};

const activeDownloads = new Map<string, ActiveOfflineDownload>();
const downloadQueue: string[] = [];
const listeners = new Set<() => void>();
let activeNativeTransferKey: string | null = null;
let restoredInterruptedJobs = false;

function isNative() {
  return Capacitor.isNativePlatform();
}

function nowIso() {
  return new Date().toISOString();
}

function safeFilePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'video';
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

export function createOfflineDownloadKey(input: DownloadMovieInput) {
  const contentType = input.contentType || 'movie';
  const movieId = normalizeKeyPart(input.movieId);

  if (contentType === 'episode') {
    const seriesId = normalizeKeyPart(input.seriesId || input.movieId);
    const seasonNumber = input.seasonNumber || 1;
    const episodeNumber = input.episodeNumber || 1;
    const episodeIdentity = normalizeKeyPart(input.episodeId) || `url-${hashString(input.video_url || input.title)}`;

    return `episode:${seriesId}:s${seasonNumber}:e${episodeNumber}:${episodeIdentity}`;
  }

  if (contentType === 'part') {
    const partIndex = input.partIndex || 1;
    const partIdentity = `url-${hashString(input.video_url || input.title)}`;

    return `part:${movieId}:p${partIndex}:${partIdentity}`;
  }

  return `movie:${movieId}`;
}

function withDownloadKey(input: DownloadMovieInput): DownloadMovieInput & { downloadKey: string } {
  return {
    ...input,
    downloadKey: input.downloadKey || createOfflineDownloadKey(input),
  };
}

function isActiveStatus(status: ActiveOfflineDownload['status']) {
  return status === 'queued' || status === 'downloading';
}

function notifyDownloadListeners() {
  persistActiveDownloads();
  listeners.forEach((listener) => listener());
}

function persistActiveDownloads() {
  if (typeof window === 'undefined') return;

  const persisted = Array.from(activeDownloads.values()).filter((job) => job.status !== 'cancelled');

  try {
    window.localStorage.setItem(ACTIVE_DOWNLOADS_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Best-effort only; downloads still work without this recovery snapshot.
  }
}

function restoreInterruptedDownloads() {
  if (restoredInterruptedJobs || typeof window === 'undefined') return;

  restoredInterruptedJobs = true;

  try {
    const raw = window.localStorage.getItem(ACTIVE_DOWNLOADS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) return;

    parsed.forEach((job) => {
      if (!job?.downloadKey || activeDownloads.has(job.downloadKey)) return;

      if (job.status === 'queued' || job.status === 'downloading') {
        activeDownloads.set(job.downloadKey, {
          ...job,
          status: 'failed',
          error: 'Download was interrupted before it could finish. Tap retry.',
          updatedAtIso: nowIso(),
        });
      } else if (job.status === 'failed') {
        activeDownloads.set(job.downloadKey, job);
      }
    });
  } catch {
    // Ignore corrupted recovery data.
  }
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

async function requestDownloadTicket(movie: DownloadMovieInput) {
  const response = await fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

function matchesRecordKey(record: OfflineDownloadRecord, downloadKey: string) {
  if (record.downloadKey === downloadKey) return true;

  if (!record.downloadKey && downloadKey === `movie:${safeFilePart(record.movieId)}`) {
    return true;
  }

  return false;
}

async function deleteDataFile(path?: string) {
  if (!path) return;

  await Filesystem.deleteFile({
    directory: Directory.Data,
    path,
  }).catch(() => undefined);
}

async function processDownloadQueue() {
  if (activeNativeTransferKey) return;

  const nextKey = downloadQueue.shift();
  if (!nextKey) return;

  const job = activeDownloads.get(nextKey);

  if (!job || job.status === 'cancelled') {
    void processDownloadQueue();
    return;
  }

  activeNativeTransferKey = nextKey;
  void runNativeDownload(job).finally(() => {
    activeNativeTransferKey = null;
    void processDownloadQueue();
  });
}

async function runNativeDownload(job: ActiveOfflineDownload) {
  let progressListener: PluginListenerHandle | undefined;

  try {
    await ensureOfflineDirectory();

    job.status = 'downloading';
    job.updatedAtIso = nowIso();
    notifyDownloadListeners();

    console.info('[offline-downloads] start', {
      downloadKey: job.downloadKey,
      title: job.input.title,
      contentType: job.input.contentType || 'movie',
    });

    const ticket = await requestDownloadTicket(job.input);
    const baseName = safeFilePart(job.downloadKey);
    const tempStoragePath = `${OFFLINE_DIR}/${baseName}-${Date.now()}.part`;
    const finalStoragePath = `${OFFLINE_DIR}/${baseName}-${Date.now()}.mp4`;

    job.tempStoragePath = tempStoragePath;
    job.finalStoragePath = finalStoragePath;
    notifyDownloadListeners();

    const tempFileInfo = await Filesystem.getUri({
      directory: Directory.Data,
      path: tempStoragePath,
    });

    progressListener = await FileTransfer.addListener('progress', (progress) => {
      const currentJob = activeDownloads.get(job.downloadKey);

      if (!currentJob || currentJob.cancelRequested || activeNativeTransferKey !== job.downloadKey) {
        return;
      }

      currentJob.downloadedBytes = Number(progress.bytes || 0);
      currentJob.totalBytes = Number(progress.contentLength || 0) > 0 ? Number(progress.contentLength) : null;
      currentJob.updatedAtIso = nowIso();

      console.debug('[offline-downloads] progress', {
        downloadKey: currentJob.downloadKey,
        downloadedBytes: currentJob.downloadedBytes,
        totalBytes: currentJob.totalBytes,
      });

      notifyDownloadListeners();
    });

    await FileTransfer.downloadFile({
      url: ticket.downloadUrl,
      path: tempFileInfo.uri,
      progress: true,
    });

    await progressListener.remove();
    progressListener = undefined;

    const currentAfterTransfer = activeDownloads.get(job.downloadKey);

    if (job.cancelRequested || currentAfterTransfer?.status === 'cancelled') {
      await deleteDataFile(tempStoragePath);
      activeDownloads.delete(job.downloadKey);
      console.info('[offline-downloads] cancelled', { downloadKey: job.downloadKey });
      notifyDownloadListeners();
      return;
    }

    const tempStat = await Filesystem.stat({
      directory: Directory.Data,
      path: tempStoragePath,
    });

    const tempSize = Number(tempStat.size || 0);

    if (job.totalBytes && tempSize > 0 && tempSize + 1024 < job.totalBytes) {
      throw new Error('Downloaded file is incomplete. Please retry.');
    }

    await deleteDataFile(finalStoragePath);

    await Filesystem.rename({
      directory: Directory.Data,
      from: tempStoragePath,
      to: finalStoragePath,
    });

    const finalFileInfo = await Filesystem.getUri({
      directory: Directory.Data,
      path: finalStoragePath,
    });

    const downloadedAtIso = nowIso();
    const record: OfflineDownloadRecord = {
      ...job.input,
      id: `offline-${job.downloadKey}`,
      userId: 'local-device',
      downloadKey: job.downloadKey,
      status: 'completed',
      storagePath: finalStoragePath,
      fileUri: finalFileInfo.uri,
      playbackUrl: Capacitor.convertFileSrc(finalFileInfo.uri),
      isOfflineFile: true,
      downloadedAtIso,
      downloadedAt: {
        seconds: Math.floor(new Date(downloadedAtIso).getTime() / 1000),
      },
    };

    const manifest = await readManifest();
    await writeManifest({
      version: 1,
      records: [
        record,
        ...manifest.records.filter((item) => !matchesRecordKey(item, job.downloadKey)),
      ],
    });

    activeDownloads.delete(job.downloadKey);
    console.info('[offline-downloads] complete', { downloadKey: job.downloadKey, title: job.input.title });
    notifyDownloadListeners();
  } catch (error) {
    if (progressListener) {
      await progressListener.remove().catch(() => undefined);
    }

    await deleteDataFile(job.tempStoragePath);

    const currentAfterFailure = activeDownloads.get(job.downloadKey);

    if (job.cancelRequested || currentAfterFailure?.status === 'cancelled') {
      activeDownloads.delete(job.downloadKey);
      notifyDownloadListeners();
      return;
    }

    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Download failed. Please retry.';
    job.updatedAtIso = nowIso();

    console.error('[offline-downloads] failed', {
      downloadKey: job.downloadKey,
      title: job.input.title,
      error,
    });

    notifyDownloadListeners();
  }
}

export function supportsNativeOfflineDownloads() {
  return isNative();
}

export function subscribeOfflineDownloads(listener: () => void) {
  restoreInterruptedDownloads();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getActiveOfflineDownloads() {
  restoreInterruptedDownloads();

  return Array.from(activeDownloads.values()).filter((job) => job.status !== 'cancelled');
}

export function getActiveOfflineDownload(downloadKey: string) {
  restoreInterruptedDownloads();

  return activeDownloads.get(downloadKey) || null;
}

export function useOfflineDownloadSnapshot() {
  const [snapshot, setSnapshot] = useState(() => getActiveOfflineDownloads());

  useEffect(() => {
    const refresh = () => setSnapshot(getActiveOfflineDownloads());

    refresh();

    return subscribeOfflineDownloads(refresh);
  }, []);

  return snapshot;
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

      await Filesystem.stat({
        directory: Directory.Data,
        path: record.storagePath,
      });

      verified.push({
        ...record,
        downloadKey: record.downloadKey || `movie:${safeFilePart(record.movieId)}`,
        fileUri: uri.uri,
        playbackUrl: Capacitor.convertFileSrc(uri.uri),
        isOfflineFile: true,
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

  return records.find((record) => matchesRecordKey(record, downloadKey)) || null;
}

export async function startOfflineDownload(input: DownloadMovieInput) {
  if (!isNative()) {
    throw new Error('Offline video downloads are only available in the Android app.');
  }

  const downloadInput = withDownloadKey(input);
  const existing = await findOfflineDownload(downloadInput.downloadKey);

  if (existing) {
    return { alreadyExists: true, record: existing };
  }

  const currentJob = activeDownloads.get(downloadInput.downloadKey);

  if (currentJob && currentJob.status !== 'failed' && currentJob.status !== 'cancelled') {
    return { alreadyExists: false, job: currentJob };
  }

  if (currentJob?.status === 'failed') {
    await deleteDataFile(currentJob.tempStoragePath);
    activeDownloads.delete(downloadInput.downloadKey);
  }

  const startedAtIso = nowIso();
  const job: ActiveOfflineDownload = {
    downloadKey: downloadInput.downloadKey,
    input: downloadInput,
    status: 'queued',
    downloadedBytes: 0,
    totalBytes: null,
    startedAtIso,
    updatedAtIso: startedAtIso,
  };

  activeDownloads.set(downloadInput.downloadKey, job);
  downloadQueue.push(downloadInput.downloadKey);
  notifyDownloadListeners();

  void processDownloadQueue();

  return { alreadyExists: false, job };
}

export async function cancelOfflineDownload(downloadKey: string) {
  const job = activeDownloads.get(downloadKey);

  if (!job) {
    return { cancelled: false };
  }

  job.cancelRequested = true;
  job.status = 'cancelled';
  job.updatedAtIso = nowIso();

  const queueIndex = downloadQueue.indexOf(downloadKey);

  if (queueIndex >= 0) {
    downloadQueue.splice(queueIndex, 1);
    await deleteDataFile(job.tempStoragePath);
    activeDownloads.delete(downloadKey);
  }

  notifyDownloadListeners();

  return { cancelled: true };
}

export async function retryOfflineDownload(downloadKey: string) {
  const job = activeDownloads.get(downloadKey);

  if (!job) {
    return null;
  }

  const input = job.input;
  await deleteDataFile(job.tempStoragePath);
  activeDownloads.delete(downloadKey);
  notifyDownloadListeners();

  return startOfflineDownload(input);
}

export async function downloadMovieOffline(movie: DownloadMovieInput) {
  return startOfflineDownload(movie);
}

export async function removeOfflineDownload(identifier: string) {
  const manifest = await readManifest();
  const record = manifest.records.find(
    (item) => item.downloadKey === identifier || item.movieId === identifier
  );

  if (record) {
    await deleteDataFile(record.storagePath);
  }

  await writeManifest({
    version: 1,
    records: manifest.records.filter(
      (item) => item.downloadKey !== identifier && item.movieId !== identifier
    ),
  });

  return { removed: Boolean(record) };
}

export function formatDownloadBytes(bytes: number | null | undefined) {
  const value = Number(bytes || 0);

  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)}MB`;
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

  if (job.status === 'queued') {
    return 'Queued...';
  }

  if (job.status === 'failed') {
    return 'Download failed — Retry';
  }

  const percent = getDownloadPercent(job);

  if (percent === null) {
    return `Downloading ${formatDownloadBytes(job.downloadedBytes)}`;
  }

  return `Downloading ${percent}% (${formatDownloadBytes(job.downloadedBytes)} / ${formatDownloadBytes(job.totalBytes)})`;
}

export function isOfflineDownloadActive(job: ActiveOfflineDownload | null) {
  return Boolean(job && isActiveStatus(job.status));
}
