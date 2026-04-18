import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  type CreateMultipartUploadCommandOutput,
  DeleteObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { getPublicR2BaseUrl } from './env';

const R2_REQUEST_TIMEOUT_MS = Number(process.env.R2_REQUEST_TIMEOUT_MS || 1000 * 60 * 2);
const R2_DOWNLOAD_TIMEOUT_MS = Number(process.env.R2_DOWNLOAD_TIMEOUT_MS || 1000 * 60 * 60 * 4);
const R2_FORCE_PATH_STYLE = String(process.env.R2_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true';
const R2_MULTIPART_UPLOAD_RETRY_DELAYS_MS = [1000, 3000, 5000, 10000];
export const R2_MULTIPART_PART_SIZE_BYTES = Number(
  process.env.R2_MULTIPART_PART_SIZE_BYTES || 10 * 1024 * 1024
);
const R2_MULTIPART_UPLOAD_THRESHOLD_BYTES = Number(
  process.env.R2_MULTIPART_UPLOAD_THRESHOLD_BYTES || 64 * 1024 * 1024
);
export const R2_PRESIGNED_UPLOAD_EXPIRES_SECONDS = Number(
  process.env.R2_PRESIGNED_UPLOAD_EXPIRES_SECONDS || 60 * 60 * 4
);
const rawR2EndpointUrl = (process.env.R2_ENDPOINT_URL || '').trim();

function getValidatedR2EndpointUrl() {
  if (!rawR2EndpointUrl) {
    throw new Error('Missing R2_ENDPOINT_URL.');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawR2EndpointUrl);
  } catch {
    throw new Error('R2_ENDPOINT_URL is not a valid URL.');
  }

  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, '');

  if (normalizedPath && normalizedPath !== '') {
    throw new Error(
      'R2_ENDPOINT_URL must be the account-level R2 endpoint only, without the bucket name path. Example: https://<account-id>.r2.cloudflarestorage.com'
    );
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

const s3Client = new S3Client({
  region: 'auto',
  endpoint: getValidatedR2EndpointUrl(),
  forcePathStyle: R2_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

async function sendR2Command<TOutput>(command: unknown, label: string): Promise<TOutput> {
  const abortController = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => abortController.abort(), R2_REQUEST_TIMEOUT_MS);

  console.log('[r2] starting request', {
    label,
    bucket: process.env.R2_BUCKET_NAME,
    endpoint: process.env.R2_ENDPOINT_URL,
    timeoutMs: R2_REQUEST_TIMEOUT_MS,
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await s3Client.send(command as any, { abortSignal: abortController.signal }) as TOutput;
  } catch (error) {
    console.error('[r2] request failed', {
      label,
      bucket: process.env.R2_BUCKET_NAME,
      endpoint: process.env.R2_ENDPOINT_URL,
      timeoutMs: R2_REQUEST_TIMEOUT_MS,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
    console.log('[r2] request finished', {
      label,
      durationMs: Date.now() - startedAt,
    });
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getR2PublicUrl(key: string) {
  return `${getPublicR2BaseUrl()}/${key.replace(/^\/+/, '')}`;
}

export function getR2ObjectKeyFromPublicUrl(url: string) {
  if (!url) {
    return '';
  }

  const normalizedUrl = url.trim();

  if (!normalizedUrl) {
    return '';
  }

  const knownBases = [process.env.R2_PUBLIC_BASE_URL?.trim()]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\/$/, ''));

  try {
    knownBases.push(getPublicR2BaseUrl().replace(/\/$/, ''));
  } catch {
    // Ignore missing public base URL here so delete flows can still fall back to host-based parsing.
  }

  for (const baseUrl of knownBases) {
    if (normalizedUrl === baseUrl) {
      return '';
    }

    if (normalizedUrl.startsWith(`${baseUrl}/`)) {
      return normalizedUrl.slice(baseUrl.length + 1).replace(/^\/+/, '');
    }
  }

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (parsedUrl.hostname.endsWith('.r2.dev')) {
      return parsedUrl.pathname.replace(/^\/+/, '');
    }
  } catch {
    return '';
  }

  return '';
}

export async function createPresignedR2Upload(options: {
  key: string;
  contentType?: string;
}) {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: options.key,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: R2_PRESIGNED_UPLOAD_EXPIRES_SECONDS,
  });

  return {
    key: options.key,
    contentType: options.contentType || 'application/octet-stream',
    uploadUrl,
    publicUrl: getR2PublicUrl(options.key),
  };
}

export async function createMultipartR2Upload(options: {
  key: string;
  partCount: number;
  partSize?: number;
  contentType?: string;
}) {
  if (!Number.isInteger(options.partCount) || options.partCount <= 0) {
    throw new Error('Multipart upload requires at least one part.');
  }

  const createResponse = await sendR2Command<CreateMultipartUploadCommandOutput>(
    new CreateMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: options.key,
      ContentType: options.contentType || 'application/octet-stream',
    }),
    `multipart:create:${options.key}`
  );

  const uploadId = createResponse.UploadId;

  if (!uploadId) {
    throw new Error('R2 did not return a multipart upload ID.');
  }

  const parts = await Promise.all(
    Array.from({ length: options.partCount }, async (_, index) => {
      const partNumber = index + 1;
      const uploadUrl = await getSignedUrl(
        s3Client,
        new UploadPartCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: options.key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: R2_PRESIGNED_UPLOAD_EXPIRES_SECONDS }
      );

      return {
        partNumber,
        uploadUrl,
      };
    })
  );

  return {
    key: options.key,
    uploadId,
    publicUrl: getR2PublicUrl(options.key),
    partSize: options.partSize || R2_MULTIPART_PART_SIZE_BYTES,
    parts,
  };
}

export async function listMultipartR2UploadParts(options: {
  key: string;
  uploadId: string;
}) {
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let nextPartNumberMarker: string | undefined;

  while (true) {
    const response = await sendR2Command<{
      IsTruncated?: boolean;
      NextPartNumberMarker?: string;
      Parts?: Array<{ PartNumber?: number; ETag?: string }>;
    }>(
      new ListPartsCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: options.key,
        UploadId: options.uploadId,
        PartNumberMarker: nextPartNumberMarker,
      }),
      `multipart:list:${options.key}`
    );

    for (const part of response.Parts || []) {
      const partNumber = Number(part.PartNumber);

      if (Number.isFinite(partNumber) && part.ETag) {
        parts.push({
          partNumber,
          etag: String(part.ETag).trim(),
        });
      }
    }

    if (!response.IsTruncated || !response.NextPartNumberMarker) {
      break;
    }

    nextPartNumberMarker = response.NextPartNumberMarker;
  }

  return parts.sort((left, right) => left.partNumber - right.partNumber);
}

export async function getMultipartR2UploadPartUrls(options: {
  key: string;
  uploadId: string;
  partNumbers: number[];
}) {
  return Promise.all(
    options.partNumbers.map(async (partNumber) => ({
      partNumber,
      uploadUrl: await getSignedUrl(
        s3Client,
        new UploadPartCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: options.key,
          UploadId: options.uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: R2_PRESIGNED_UPLOAD_EXPIRES_SECONDS }
      ),
    }))
  );
}

export async function completeMultipartR2Upload(options: {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}) {
  if (!options.uploadId) {
    throw new Error('Missing multipart upload ID.');
  }

  if (!options.parts.length) {
    throw new Error('Missing multipart upload parts.');
  }

  await sendR2Command(
    new CompleteMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: options.key,
      UploadId: options.uploadId,
      MultipartUpload: {
        Parts: [...options.parts]
          .sort((left, right) => left.partNumber - right.partNumber)
          .map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
      },
    }),
    `multipart:complete:${options.key}`
  );

  return {
    key: options.key,
    publicUrl: getR2PublicUrl(options.key),
  };
}

export async function abortMultipartR2Upload(options: {
  key: string;
  uploadId: string;
}) {
  if (!options.uploadId) {
    return;
  }

  await sendR2Command(
    new AbortMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: options.key,
      UploadId: options.uploadId,
    }),
    `multipart:abort:${options.key}`
  );
}

export async function deleteR2Object(key: string) {
  await sendR2Command(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }),
    `delete:${key}`
  );
}

export async function downloadR2ObjectToFile(options: {
  key: string;
  targetPath: string;
}) {
  const abortController = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => abortController.abort(), R2_DOWNLOAD_TIMEOUT_MS);

  console.log('[r2] starting object download', {
    key: options.key,
    bucket: process.env.R2_BUCKET_NAME,
    endpoint: process.env.R2_ENDPOINT_URL,
    timeoutMs: R2_DOWNLOAD_TIMEOUT_MS,
  });

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: options.key,
      }),
      { abortSignal: abortController.signal }
    );

    if (!response.Body) {
      throw new Error(`R2 returned an empty body for ${options.key}.`);
    }

    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(options.targetPath));
  } catch (error) {
    console.error('[r2] object download failed', {
      key: options.key,
      bucket: process.env.R2_BUCKET_NAME,
      endpoint: process.env.R2_ENDPOINT_URL,
      timeoutMs: R2_DOWNLOAD_TIMEOUT_MS,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
    console.log('[r2] object download finished', {
      key: options.key,
      durationMs: Date.now() - startedAt,
    });
  }
}

export async function uploadFileToR2(options: {
  localPath: string;
  key: string;
  contentType?: string;
  onProgress?: (progress: {
    uploadedBytes: number;
    totalBytes: number;
    progressPercent: number;
    uploadedParts?: number;
    totalParts?: number;
  }) => Promise<void> | void;
}) {
  const stats = await fs.stat(options.localPath);
  const contentType = options.contentType || 'application/octet-stream';

  if (stats.size > R2_MULTIPART_UPLOAD_THRESHOLD_BYTES) {
    const uploadId = await sendR2Command<CreateMultipartUploadCommandOutput>(
      new CreateMultipartUploadCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: options.key,
        ContentType: contentType,
      }),
      `multipart:create:${options.key}`
    );
    const openedFile = await fs.open(options.localPath, 'r');
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const partSize = Math.max(5 * 1024 * 1024, R2_MULTIPART_PART_SIZE_BYTES);

    try {
      if (!uploadId.UploadId) {
        throw new Error('R2 did not return a multipart upload ID.');
      }

      const totalParts = Math.ceil(stats.size / partSize);
      let uploadedBytes = 0;

      for (let index = 0; index < totalParts; index += 1) {
        const partNumber = index + 1;
        const offset = index * partSize;
        const expectedLength = Math.min(partSize, stats.size - offset);
        const buffer = Buffer.allocUnsafe(expectedLength);
        const { bytesRead } = await openedFile.read(buffer, 0, expectedLength, offset);

        if (bytesRead !== expectedLength) {
          throw new Error(
            `Failed to read multipart upload part ${partNumber}. Expected ${expectedLength} bytes, got ${bytesRead}.`
          );
        }

        let response: { ETag?: string } | null = null;
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= R2_MULTIPART_UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
          try {
            response = await sendR2Command<{ ETag?: string }>(
              new UploadPartCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: options.key,
                UploadId: uploadId.UploadId,
                PartNumber: partNumber,
                Body: buffer,
                ContentLength: expectedLength,
              }),
              `multipart:upload:${options.key}:part-${partNumber}:attempt-${attempt + 1}`
            );
            break;
          } catch (error) {
            lastError = error;

            if (attempt >= R2_MULTIPART_UPLOAD_RETRY_DELAYS_MS.length) {
              break;
            }

            const retryDelay = R2_MULTIPART_UPLOAD_RETRY_DELAYS_MS[attempt];

            console.warn('[r2] multipart upload part retry scheduled', {
              key: options.key,
              partNumber,
              attempt: attempt + 1,
              retryInMs: retryDelay,
              error: error instanceof Error ? error.message : String(error || ''),
            });

            await wait(retryDelay);
          }
        }

        if (!response) {
          throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Multipart upload failed.'));
        }

        if (!response.ETag) {
          throw new Error(`R2 did not return an ETag for multipart upload part ${partNumber}.`);
        }

        parts.push({
          partNumber,
          etag: String(response.ETag).trim(),
        });

        uploadedBytes += expectedLength;
        void Promise.resolve(
          options.onProgress?.({
            uploadedBytes,
            totalBytes: stats.size,
            progressPercent: Math.max(
              0,
              Math.min(100, Math.round((uploadedBytes / stats.size) * 100))
            ),
            uploadedParts: partNumber,
            totalParts,
          })
        ).catch((error) => {
          console.warn('[r2] upload progress callback failed', {
            key: options.key,
            partNumber,
            error: error instanceof Error ? error.message : String(error || ''),
          });
        });
      }

      await completeMultipartR2Upload({
        key: options.key,
        uploadId: uploadId.UploadId,
        parts,
      });
    } catch (error) {
      await abortMultipartR2Upload({
        key: options.key,
        uploadId: uploadId.UploadId || '',
      }).catch(() => undefined);
      throw error;
    } finally {
      await openedFile.close();
    }

    return {
      key: options.key,
      publicUrl: getR2PublicUrl(options.key),
    };
  }

  const body = await fs.readFile(options.localPath);

  await sendR2Command(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: options.key,
      Body: body,
      ContentType: contentType,
    }),
    `put:${options.key}`
  );

  void Promise.resolve(
    options.onProgress?.({
      uploadedBytes: stats.size,
      totalBytes: stats.size,
      progressPercent: 100,
      uploadedParts: 1,
      totalParts: 1,
    })
  ).catch((error) => {
    console.warn('[r2] upload progress callback failed', {
      key: options.key,
      partNumber: 1,
      error: error instanceof Error ? error.message : String(error || ''),
    });
  });

  return {
    key: options.key,
    publicUrl: getR2PublicUrl(options.key),
  };
}

async function collectFiles(currentDirectory: string): Promise<string[]> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

export async function uploadDirectoryToR2(
  localDirectory: string,
  remotePrefix: string,
  options?: {
    concurrency?: number;
    onProgress?: (progress: { uploaded: number; total: number; key: string }) => Promise<void> | void;
  }
) {
  const filePaths = await collectFiles(localDirectory);
  const uploadedFiles: { key: string; publicUrl: string }[] = [];
  const concurrency = Math.max(1, options?.concurrency || 6);
  let nextIndex = 0;
  let uploadedCount = 0;

  async function uploadSingle(fullPath: string) {
    const relativePath = path.relative(localDirectory, fullPath).replace(/\\/g, '/');
    const key = `${remotePrefix.replace(/\/$/, '')}/${relativePath}`;
    const body = await fs.readFile(fullPath);
    const contentType = fullPath.endsWith('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : fullPath.endsWith('.ts')
        ? 'video/mp2t'
        : 'application/octet-stream';

    await sendR2Command(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
      `put:${key}`
    );

    uploadedFiles.push({
      key,
      publicUrl: getR2PublicUrl(key),
    });

    uploadedCount += 1;
    await options?.onProgress?.({
      uploaded: uploadedCount,
      total: filePaths.length,
      key,
    });
  }

  async function worker() {
    while (nextIndex < filePaths.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const fullPath = filePaths[currentIndex];

      if (!fullPath) {
        return;
      }

      await uploadSingle(fullPath);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, filePaths.length || 1) }, () => worker()));

  return uploadedFiles;
}
