export type MultipartUploadPartDescriptor = {
  partNumber: number;
  uploadUrl: string;
};

export type MultipartUploadInitPayload = {
  key: string;
  uploadId: string;
  publicUrl: string;
  partSize: number;
  parts: MultipartUploadPartDescriptor[];
};

const PART_UPLOAD_REQUEST_TIMEOUT_MS = 1000 * 60 * 10;
const PART_UPLOAD_MAX_RETRIES = 3;
const PART_UPLOAD_CONCURRENCY = 5;
export const DIRECT_MULTIPART_PART_SIZE_BYTES = 25 * 1024 * 1024;

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

function uploadBlobToSignedUrl(
  blob: Blob,
  uploadUrl: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
) {
  return new Promise<{ etag?: string; uploadHost: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let uploadHost = 'unknown-storage-host';

    try {
      uploadHost = new URL(uploadUrl).host;
    } catch {
      uploadHost = 'invalid-upload-url';
    }

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

async function uploadMultipartPartWithRetry(options: {
  file: File;
  multipartUpload: MultipartUploadInitPayload;
  part: MultipartUploadPartDescriptor;
  onPartProgress: (partNumber: number, loadedBytes: number) => void;
  onDiagnostic?: (message: string) => void;
}) {
  const partIndex = options.part.partNumber - 1;
  const start = partIndex * options.multipartUpload.partSize;
  const end = Math.min(start + options.multipartUpload.partSize, options.file.size);
  const fileChunk = options.file.slice(start, end);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= PART_UPLOAD_MAX_RETRIES; attempt += 1) {
    options.onDiagnostic?.(
      `[PART ${options.part.partNumber}] Attempt ${attempt}/${PART_UPLOAD_MAX_RETRIES} uploading ${Math.ceil(
        fileChunk.size / (1024 * 1024)
      )} MB...`
    );

    try {
      const uploadedPart = await uploadBlobToSignedUrl(fileChunk, options.part.uploadUrl, (loadedBytes) => {
        options.onPartProgress(options.part.partNumber, loadedBytes);
      });

      if (!uploadedPart.etag) {
        throw new Error(
          `Upload part succeeded on ${uploadedPart.uploadHost}, but the ETag header was not exposed to the browser.`
        );
      }

      options.onPartProgress(options.part.partNumber, fileChunk.size);
      options.onDiagnostic?.(`[PART ${options.part.partNumber}] Completed successfully.`);

      return {
        partNumber: options.part.partNumber,
        etag: uploadedPart.etag,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown multipart upload error.');
      options.onDiagnostic?.(
        `[PART ${options.part.partNumber}] Attempt ${attempt} failed: ${lastError.message}`
      );

      if (attempt < PART_UPLOAD_MAX_RETRIES) {
        await wait(attempt * 1200);
      }
    }
  }

  throw new Error(
    `Multipart upload failed on part ${options.part.partNumber}/${options.multipartUpload.parts.length} after ${PART_UPLOAD_MAX_RETRIES} attempts. ${
      lastError?.message || 'Unknown storage upload error.'
    }`
  );
}

export async function uploadMultipartFileToAdmin(options: {
  file: File;
  stage?: 'final' | 'library' | 'staging';
  partSize?: number;
  onProgress?: (progressPercent: number) => void;
  onDiagnostic?: (message: string) => void;
}) {
  const uploadUrlResponse = await fetch('/api/admin/direct-videos/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: options.file.name,
      fileSize: options.file.size,
      contentType: options.file.type || 'video/mp4',
      stage: options.stage || 'final',
      partSize: options.partSize || DIRECT_MULTIPART_PART_SIZE_BYTES,
    }),
  });
  const uploadUrlPayload = await parseApiResponse(uploadUrlResponse);

  if (!uploadUrlResponse.ok) {
    throw new Error(
      uploadUrlPayload.payload.detail ||
        uploadUrlPayload.payload.error ||
        'Failed to prepare multipart upload.'
    );
  }

  const multipartUpload = uploadUrlPayload.payload as MultipartUploadInitPayload;

  if (!multipartUpload.uploadId || !multipartUpload.key || !multipartUpload.parts?.length) {
    throw new Error('Multipart upload setup is incomplete.');
  }

  options.onDiagnostic?.(
    `[INIT] Multipart session created with ${multipartUpload.parts.length} part(s) at ${Math.ceil(
      multipartUpload.partSize / (1024 * 1024)
    )} MB each.`
  );

  const uploadedParts: Array<{ partNumber: number; etag: string }> = [];
  const partLoadedBytes = new Map<number, number>();
  let nextPartIndex = 0;

  const updateAggregateProgress = () => {
    let totalUploaded = 0;

    for (const loaded of partLoadedBytes.values()) {
      totalUploaded += loaded;
    }

    const uploadProgress = options.file.size > 0 ? totalUploaded / options.file.size : 0;
    options.onProgress?.(Math.min(95, Math.round(uploadProgress * 100)));
  };

  const uploadWorker = async () => {
    while (nextPartIndex < multipartUpload.parts.length) {
      const currentIndex = nextPartIndex;
      nextPartIndex += 1;
      const part = multipartUpload.parts[currentIndex];

      const uploadedPart = await uploadMultipartPartWithRetry({
        file: options.file,
        multipartUpload,
        part,
        onPartProgress: (partNumber, loadedBytes) => {
          partLoadedBytes.set(partNumber, loadedBytes);
          updateAggregateProgress();
        },
        onDiagnostic: options.onDiagnostic,
      });

      uploadedParts.push(uploadedPart);
    }
  };

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(PART_UPLOAD_CONCURRENCY, multipartUpload.parts.length) },
        () => uploadWorker()
      )
    );

    options.onProgress?.(97);

    const finalizeResponse = await fetch('/api/admin/direct-videos/upload-url', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: multipartUpload.key,
        uploadId: multipartUpload.uploadId,
        parts: uploadedParts.sort((left, right) => left.partNumber - right.partNumber),
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

    options.onProgress?.(100);

    return {
      key: multipartUpload.key,
      publicUrl: String(finalizePayload.payload.publicUrl || multipartUpload.publicUrl || ''),
      fileSizeBytes: options.file.size,
      fileName: options.file.name,
    };
  } catch (error) {
    await fetch('/api/admin/direct-videos/upload-url', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: multipartUpload.key,
        uploadId: multipartUpload.uploadId,
      }),
    }).catch(() => undefined);

    throw error;
  }
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
    throw new Error(payload.payload.error || payload.payload.detail || 'Failed to prepare poster upload.');
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
