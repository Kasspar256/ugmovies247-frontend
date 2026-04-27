'use client';

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import type { DownloadMovieInput, DownloadRecord } from '@/types/downloads';

const OFFLINE_DIR = 'offline-videos';
const MANIFEST_PATH = `${OFFLINE_DIR}/manifest.json`;

export type OfflineDownloadRecord = DownloadRecord & {
  storagePath: string;
  fileUri: string;
  playbackUrl: string;
  isOfflineFile: true;
  downloadedAtIso: string;
};

type OfflineManifest = {
  version: 1;
  records: OfflineDownloadRecord[];
};

type DownloadTicket = {
  downloadUrl: string;
  filename: string;
};

function isNative() {
  return Capacitor.isNativePlatform();
}

function safeFilePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'video';
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

      await Filesystem.stat({
        directory: Directory.Data,
        path: record.storagePath,
      });

      verified.push({
        ...record,
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

export async function downloadMovieOffline(movie: DownloadMovieInput) {
  if (!isNative()) {
    throw new Error('Offline video downloads are only available in the Android app.');
  }

  await ensureOfflineDirectory();

  const existing = (await listOfflineDownloads()).find((record) => record.movieId === movie.movieId);

  if (existing) {
    return { alreadyExists: true, record: existing };
  }

  const ticket = await requestDownloadTicket(movie);
  const storagePath = `${OFFLINE_DIR}/${safeFilePart(movie.movieId)}-${Date.now()}.mp4`;
  const fileInfo = await Filesystem.getUri({
    directory: Directory.Data,
    path: storagePath,
  });

  await FileTransfer.downloadFile({
    url: ticket.downloadUrl,
    path: fileInfo.uri,
    progress: true,
  });

  const downloadedAtIso = new Date().toISOString();
  const record: OfflineDownloadRecord = {
    id: `offline-${movie.movieId}`,
    userId: 'local-device',
    movieId: movie.movieId,
    title: movie.title,
    poster: movie.poster,
    video_url: '',
    status: 'completed',
    storagePath,
    fileUri: fileInfo.uri,
    playbackUrl: Capacitor.convertFileSrc(fileInfo.uri),
    isOfflineFile: true,
    downloadedAtIso,
    downloadedAt: {
      seconds: Math.floor(new Date(downloadedAtIso).getTime() / 1000),
    },
  };

  const manifest = await readManifest();
  await writeManifest({
    version: 1,
    records: [record, ...manifest.records.filter((item) => item.movieId !== movie.movieId)],
  });

  return { alreadyExists: false, record };
}

export async function removeOfflineDownload(movieId: string) {
  const manifest = await readManifest();
  const record = manifest.records.find((item) => item.movieId === movieId);

  if (record) {
    await Filesystem.deleteFile({
      directory: Directory.Data,
      path: record.storagePath,
    }).catch(() => undefined);
  }

  await writeManifest({
    version: 1,
    records: manifest.records.filter((item) => item.movieId !== movieId),
  });

  return { removed: Boolean(record) };
}
