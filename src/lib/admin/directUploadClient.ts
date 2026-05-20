export type MultipartUploadPartDescriptor = {
  partNumber: number;
  uploadUrl: string;
};

export type MultipartUploadedPart = {
  partNumber: number;
  etag: string;
};

export type MultipartUploadInitPayload = {
  key: string;
  uploadId: string;
  publicUrl: string;
  partSize: number;
  parts: MultipartUploadPartDescriptor[];
  uploadedParts?: MultipartUploadedPart[];
};

export type MultipartUploadStats = {
  progressPercent: number;
  uploadedBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  completedParts: number;
  totalParts: number;
  concurrency: number;
  partSizeBytes: number;
  resumed: boolean;
  networkProfile: string;
};

type UploadNetworkProfile = {
  label: string;
  partSize: number;
  concurrency: number;
};

type UploadCheckpoint = {
  version: 2;
  fingerprint: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  contentType: string;
  stage: 'final' | 'library' | 'staging';
  key: string;
  uploadId: string;
  publicUrl: string;
  partSize: number;
  partCount: number;
  uploadedParts: MultipartUploadedPart[];
  updatedAt: number;
};

const PART_UPLOAD_REQUEST_TIMEOUT_MS = 1000 * 60 * 10;
const RETRY_BACKOFF_DELAYS_MS = [1000, 3000, 5000, 10000, 10000];
const CHECKPOINT_STORAGE_KEY = 'ugmovies247.admin.multipart.checkpoints.v2';
const MAX_CHECKPOINT_AGE_MS = 1000 * 60 * 60 * 12;
export const MIN_DIRECT_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_DIRECT_MULTIPART_PART_SIZE_BYTES = 25 * 1024 * 1024;
export const DIRECT_MULTIPART_PART_SIZE_BYTES = 10 * 1024 * 1024;

export async function parseApiResponse(response: Response) {
  const rawText = await response.text();

  try {
    const payload = rawText ? JSON.parse(rawText) : {};
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      payload: {
        error: 'Server returned a non-JSON response.',
        detail: rawText.slice(0, 300),
      },
    };
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeUploadedParts(parts: MultipartUploadedPart[]) {
  const byPartNumber = new Map<number, string>();

  for (const part of parts) {
    if (Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag) {
      byPartNumber.set(part.partNumber, String(part.etag).trim());
    }
  }

  return [...byPartNumber.entries()]
    .map(([partNumber, etag]) => ({ partNumber, etag }))
    .sort((left, right) => left.partNumber - right.partNumber);
}

function readCheckpointStore() {
  if (!canUseStorage()) {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(CHECKPOINT_STORAGE_KEY);

    if (!rawValue) {
      return {};
    }

    return JSON.parse(rawValue) as Record<string, UploadCheckpoint>;
  } catch {
    return {};
  }
}

function writeCheckpointStore(store: Record<string, UploadCheckpoint>) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage failures so uploads can continue in-memory.
  }
}

function pruneCheckpointStore(store: Record<string, UploadCheckpoint>) {
  const nextStore: Record<string, UploadCheckpoint> = {};
  const now = Date.now();

  for (const [fingerprint, checkpoint] of Object.entries(store)) {
    if (now - checkpoint.updatedAt <= MAX_CHECKPOINT_AGE_MS) {
      nextStore[fingerprint] = checkpoint;
    }
  }

  return nextStore;
}

function getUploadFingerprint(file: File, stage: 'final' | 'library' | 'staging') {
  return [stage, file.name, file.size, file.lastModified].join('::');
}

function readUploadCheckpoint(
  file: File,
  stage: 'final' | 'library' | 'staging'
): UploadCheckpoint | null {
  const fingerprint = getUploadFingerprint(file, stage);
  const store = pruneCheckpointStore(readCheckpointStore());
  writeCheckpointStore(store);

  return store[fingerprint] || null;
}

function saveUploadCheckpoint(checkpoint: UploadCheckpoint) {
  const store = pruneCheckpointStore(readCheckpointStore());
  store[checkpoint.fingerprint] = checkpoint;
  writeCheckpointStore(store);
}

function clearUploadCheckpoint(fingerprint: string) {
  const store = readCheckpointStore();

  if (!store[fingerprint]) {
    return;
  }

  delete store[fingerprint];
  writeCheckpointStore(store);
}

function getPartByteLength(fileSize: number, partSize: number, partNumber: number) {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(start + partSize, fileSize);
  return Math.max(0, end - start);
}

function waitForOnline() {
  if (typeof window === 'undefined' || navigator.onLine !== false) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const handleOnline = () => {
      window.removeEventListener('online', handleOnline);
      resolve();
    };

    window.addEventListener('online', handleOnline, { once: true });
  });
}

function getAdaptiveUploadProfile(
  file: File,
  preferredPartSize?: number,
  preferredConcurrency?: number
): UploadNetworkProfile {
  if (preferredPartSize && preferredPartSize > 0) {
    return {
      label: 'manual',
      partSize: preferredPartSize,
      concurrency: Math.max(1, Math.min(5, preferredConcurrency || 3)),
    };
  }

  const connection =
    typeof navigator !== 'undefined'
      ? ((navigator as Navigator & {
          connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
        }).connection || null)
      : null;
  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  const downlink = Number(connection?.downlink || 0);
  const saveData = Boolean(connection?.saveData);
  const fileSizeMb = file.size / (1024 * 1024);

  if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') {
    return { label: 'slow-network', partSize: 5 * 1024 * 1024, concurrency: 1 };
  }

  if (effectiveType === '3g' || (downlink > 0 && downlink < 2.5)) {
    return { label: 'weak-network', partSize: 8 * 1024 * 1024, concurrency: 2 };
  }

  if ((downlink > 0 && downlink < 6) || fileSizeMb > 1500) {
    return { label: 'balanced', partSize: 10 * 1024 * 1024, concurrency: 3 };
  }

  if (downlink > 18 && fileSizeMb < 900) {
    return { label: 'fast-network', partSize: 20 * 1024 * 1024, concurrency: 4 };
  }

  return { label: 'default', partSize: 15 * 1024 * 1024, concurrency: 3 };
}

function formatDiagnosticHost(uploadUrl: string) {
  try {
    return new URL(uploadUrl).host;
  } catch {
    return 'invalid-upload-url';
  }
}

function uploadBlobToSignedUrl(
  blob: Blob,
  uploadUrl: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
) {
  return new Promise<{ etag?: string; uploadHost: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const uploadHost = formatDiagnosticHost(uploadUrl);

    xhr.open('PUT', uploadUrl);
    xhr.timeout = PART_UPLOAD_REQUEST_TIMEOUT_MS;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress?.(event.loaded, event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          etag: xhr.getResponseHeader('ETag')?.trim() || undefined,
          uploadHost,
        });
        return;
      }

      reject(new Error(`Source upload failed with status ${xhr.status} from ${uploadHost}.`));
    };

    xhr.onerror = () => {
      reject(
        new Error(
          xhr.status > 0
            ? `Source upload failed with status ${xhr.status} from ${uploadHost}.`
            : `Source upload failed before the next step while contacting ${uploadHost}.`
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          `Source upload timed out after ${Math.round(
            PART_UPLOAD_REQUEST_TIMEOUT_MS / 1000
          )} seconds while contacting ${uploadHost}.`
        )
      );
    };

    xhr.onabort = () => reject(new Error('Source upload was aborted before completion.'));
    xhr.send(blob);
  });
}

async function requestMultipartUploadSession(options: {
  file: File;
  stage: 'final' | 'library' | 'staging';
  partSize: number;
  partCount: number;
  checkpoint?: UploadCheckpoint | null;
}) {
  const response = await fetch('/api/admin/direct-videos/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      options.checkpoint
        ? {
            fileName: options.file.name,
            fileSize: options.file.size,
            contentType: options.file.type || 'video/mp4',
            stage: options.stage,
            partSize: options.checkpoint.partSize,
            partCount: options.checkpoint.partCount,
            key: options.checkpoint.key,
            uploadId: options.checkpoint.uploadId,
          }
        : {
            fileName: options.file.name,
            fileSize: options.file.size,
            contentType: options.file.type || 'video/mp4',
            stage: options.stage,
            partSize: options.partSize,
          }
    ),
  });
  const payload = await parseApiResponse(response);

  if (!response.ok) {
    throw new Error(
      payload.payload.detail || payload.payload.error || 'Failed to prepare multipart upload.'
    );
  }

  return payload.payload as MultipartUploadInitPayload;
}

export async function uploadMultipartFileToAdmin(options: {
  file: File;
  stage?: 'final' | 'library' | 'staging';
  partSize?: number;
  concurrency?: number;
  onProgress?: (progressPercent: number) => void;
  onStats?: (stats: MultipartUploadStats) => void;
  onDiagnostic?: (message: string) => void;
}) {
  const stage = options.stage || 'final';
  const fingerprint = getUploadFingerprint(options.file, stage);
  const uploadProfile = getAdaptiveUploadProfile(
    options.file,
    options.partSize,
    options.concurrency
  );
  const partSize = uploadProfile.partSize;
  const partCount = Math.max(1, Math.ceil(options.file.size / partSize));
  const checkpoint = readUploadCheckpoint(options.file, stage);
  let resumed = false;
  let session: MultipartUploadInitPayload;

  try {
    session = await requestMultipartUploadSession({
      file: options.file,
      stage,
      partSize,
      partCount,
      checkpoint,
    });
    resumed = Boolean(checkpoint);
  } catch (error) {
    if (!checkpoint) {
      throw error;
    }

    clearUploadCheckpoint(fingerprint);
    options.onDiagnostic?.('Saved upload session expired. Starting a fresh upload session.');
    session = await requestMultipartUploadSession({
      file: options.file,
      stage,
      partSize,
      partCount,
    });
    resumed = false;
  }

  if (!session.uploadId || !session.key || !session.parts?.length) {
    throw new Error('Multipart upload setup is incomplete.');
  }

  const mergedUploadedParts = normalizeUploadedParts([
    ...(checkpoint?.uploadedParts || []),
    ...(session.uploadedParts || []),
  ]);
  const persistedCheckpoint: UploadCheckpoint = {
    version: 2,
    fingerprint,
    fileName: options.file.name,
    fileSize: options.file.size,
    lastModified: options.file.lastModified,
    contentType: options.file.type || 'video/mp4',
    stage,
    key: session.key,
    uploadId: session.uploadId,
    publicUrl: session.publicUrl,
    partSize: session.partSize,
    partCount: session.parts.length,
    uploadedParts: mergedUploadedParts,
    updatedAt: Date.now(),
  };

  saveUploadCheckpoint(persistedCheckpoint);

  options.onDiagnostic?.(
    resumed
      ? `[RESUME] Restored upload with ${mergedUploadedParts.length}/${session.parts.length} part(s) already finished.`
      : `[INIT] Multipart session created with ${session.parts.length} part(s) at ${Math.ceil(
          session.partSize / (1024 * 1024)
        )} MB each.`
  );

  const uploadedPartsMap = new Map<number, string>(
    mergedUploadedParts.map((part) => [part.partNumber, part.etag])
  );
  const partLoadedBytes = new Map<number, number>();

  for (const uploadedPart of mergedUploadedParts) {
    partLoadedBytes.set(
      uploadedPart.partNumber,
      getPartByteLength(options.file.size, session.partSize, uploadedPart.partNumber)
    );
  }

  const progressSamples: Array<{ at: number; uploadedBytes: number }> = [];
  let currentConcurrency = Math.max(1, Math.min(5, options.concurrency || uploadProfile.concurrency));

  const emitStats = () => {
    let uploadedBytes = 0;

    for (const loadedBytes of partLoadedBytes.values()) {
      uploadedBytes += loadedBytes;
    }

    const now = Date.now();
    progressSamples.push({ at: now, uploadedBytes });

    while (progressSamples.length > 12 || now - progressSamples[0].at > 12000) {
      progressSamples.shift();
    }

    const firstSample = progressSamples[0];
    const lastSample = progressSamples[progressSamples.length - 1];
    const elapsedMs =
      firstSample && lastSample && lastSample.at > firstSample.at
        ? lastSample.at - firstSample.at
        : 0;
    const speedBytesPerSecond =
      elapsedMs > 0 ? ((lastSample.uploadedBytes - firstSample.uploadedBytes) * 1000) / elapsedMs : 0;
    const remainingBytes = Math.max(0, options.file.size - uploadedBytes);
    const etaSeconds =
      speedBytesPerSecond > 0 ? Math.max(0, Math.round(remainingBytes / speedBytesPerSecond)) : null;
    const progressPercent =
      options.file.size > 0 ? Math.min(100, Math.round((uploadedBytes / options.file.size) * 100)) : 0;

    options.onProgress?.(progressPercent);
    options.onStats?.({
      progressPercent,
      uploadedBytes,
      totalBytes: options.file.size,
      speedBytesPerSecond,
      etaSeconds,
      completedParts: uploadedPartsMap.size,
      totalParts: session.parts.length,
      concurrency: currentConcurrency,
      partSizeBytes: session.partSize,
      resumed,
      networkProfile: uploadProfile.label,
    });
  };

  emitStats();

  const pendingParts = session.parts.filter((part) => !uploadedPartsMap.has(part.partNumber));

  const uploadSinglePart = async (part: MultipartUploadPartDescriptor) => {
    const start = (part.partNumber - 1) * session.partSize;
    const end = Math.min(start + session.partSize, options.file.size);
    const fileChunk = options.file.slice(start, end);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= RETRY_BACKOFF_DELAYS_MS.length; attempt += 1) {
      if (navigator.onLine === false) {
        options.onDiagnostic?.('[NETWORK] Connection lost. Waiting for network before resuming...');
        await waitForOnline();
      }

      try {
        const uploadedPart = await uploadBlobToSignedUrl(fileChunk, part.uploadUrl, (loadedBytes) => {
          partLoadedBytes.set(part.partNumber, loadedBytes);
          emitStats();
        });

        if (!uploadedPart.etag) {
          throw new Error(
            `Upload part succeeded on ${uploadedPart.uploadHost}, but the ETag header was not exposed to the browser.`
          );
        }

        uploadedPartsMap.set(part.partNumber, uploadedPart.etag);
        partLoadedBytes.set(part.partNumber, fileChunk.size);
        persistedCheckpoint.uploadedParts = normalizeUploadedParts(
          [...uploadedPartsMap.entries()].map(([partNumber, etag]) => ({ partNumber, etag }))
        );
        persistedCheckpoint.updatedAt = Date.now();
        saveUploadCheckpoint(persistedCheckpoint);
        emitStats();
        options.onDiagnostic?.(
          `[UPLOADED] Part ${part.partNumber}/${session.parts.length} saved successfully.`
        );
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown multipart upload error.');
        partLoadedBytes.set(part.partNumber, 0);
        emitStats();

        if (attempt >= 2 && currentConcurrency > 1) {
          currentConcurrency -= 1;
          options.onDiagnostic?.(
            `[ADAPT] Network looks unstable. Reducing parallel uploads to ${currentConcurrency}.`
          );
        }

        if (attempt < RETRY_BACKOFF_DELAYS_MS.length) {
          const retryDelay = RETRY_BACKOFF_DELAYS_MS[attempt - 1];
          options.onDiagnostic?.(
            `[RETRY] Part ${part.partNumber}/${session.parts.length} failed. Retrying in ${Math.round(
              retryDelay / 1000
            )}s.`
          );
          await wait(retryDelay);
          continue;
        }
      }
    }

    throw new Error(
      `Multipart upload failed on part ${part.partNumber}/${session.parts.length} after ${RETRY_BACKOFF_DELAYS_MS.length} attempts. ${
        lastError?.message || 'Unknown storage upload error.'
      }`
    );
  };

  try {
    const runningTasks = new Set<Promise<void>>();
    let nextIndex = 0;
    let queueError: Error | null = null;

    const launchNextTask = () => {
      if (nextIndex >= pendingParts.length) {
        return false;
      }

      const nextPart = pendingParts[nextIndex];
      nextIndex += 1;

      const task = uploadSinglePart(nextPart).finally(() => {
        runningTasks.delete(task);
      });

      runningTasks.add(task);
      return true;
    };

    while (nextIndex < pendingParts.length || runningTasks.size > 0) {
      while (nextIndex < pendingParts.length && runningTasks.size < currentConcurrency) {
        launchNextTask();
      }

      if (!runningTasks.size) {
        break;
      }

      try {
        await Promise.race(runningTasks);
      } catch (error) {
        queueError = error instanceof Error ? error : new Error('Multipart upload failed.');
      }

      if (queueError) {
        await Promise.allSettled([...runningTasks]);
        throw queueError;
      }
    }

    options.onDiagnostic?.('[FINALIZE] Completing multipart upload...');

    const finalizeResponse = await fetch('/api/admin/direct-videos/upload-url', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: session.key,
        uploadId: session.uploadId,
        parts: normalizeUploadedParts(
          [...uploadedPartsMap.entries()].map(([partNumber, etag]) => ({ partNumber, etag }))
        ),
      }),
    });
    const finalizePayload = await parseApiResponse(finalizeResponse);

    if (!finalizeResponse.ok) {
      throw new Error(
        finalizePayload.payload.detail ||
          finalizePayload.payload.error ||
          'Failed to finalize multipart upload.'
      );
    }

    clearUploadCheckpoint(fingerprint);
    emitStats();

    return {
      key: session.key,
      publicUrl: String(finalizePayload.payload.publicUrl || session.publicUrl || ''),
      fileSizeBytes: options.file.size,
      fileName: options.file.name,
    };
  } catch (error) {
    persistedCheckpoint.updatedAt = Date.now();
    saveUploadCheckpoint(persistedCheckpoint);
    options.onDiagnostic?.(
      '[PAUSED] Upload checkpoint saved. Re-select the same file to continue from completed parts if needed.'
    );
    throw error;
  }
}

export function isMp4TrailerFile(file: File | null | undefined) {
  if (!file) {
    return false;
  }

  return file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
}

export async function uploadTrailerVideoToAdmin(
  file: File,
  options?: {
    onStats?: (stats: MultipartUploadStats) => void;
    onDiagnostic?: (message: string) => void;
  }
) {
  if (!isMp4TrailerFile(file)) {
    throw new Error('Trailer uploads must be MP4 video files.');
  }

  return uploadMultipartFileToAdmin({
    file,
    stage: 'library',
    onProgress: () => undefined,
    onStats: options?.onStats,
    onDiagnostic: options?.onDiagnostic,
  });
}

export async function uploadPosterToAdmin(file: File) {
  const response = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type || 'image/jpeg',
    }),
  });
  const payload = await parseApiResponse(response);

  if (!response.ok) {
    throw new Error(
      payload.payload.error || payload.payload.detail || 'Failed to prepare poster upload.'
    );
  }

  const signedUrl = String(payload.payload.signedUrl || '');
  const publicUrl = String(payload.payload.publicUrl || '');

  if (!signedUrl || !publicUrl) {
    throw new Error('Poster upload response was incomplete.');
  }

  await uploadBlobToSignedUrl(file, signedUrl);
  return {
    publicUrl,
  };
}
