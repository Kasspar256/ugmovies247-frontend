import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  type CreateMultipartUploadCommandOutput,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs/promises';
import path from 'path';
import { getPublicR2BaseUrl } from './env';

const R2_REQUEST_TIMEOUT_MS = Number(process.env.R2_REQUEST_TIMEOUT_MS || 1000 * 60 * 2);
const R2_FORCE_PATH_STYLE = String(process.env.R2_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true';
export const R2_MULTIPART_PART_SIZE_BYTES = Number(
  process.env.R2_MULTIPART_PART_SIZE_BYTES || 10 * 1024 * 1024
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

export async function uploadFileToR2(options: {
  localPath: string;
  key: string;
  contentType?: string;
}) {
  const body = await fs.readFile(options.localPath);

  await sendR2Command(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: options.key,
      Body: body,
      ContentType: options.contentType || 'application/octet-stream',
    }),
    `put:${options.key}`
  );

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
