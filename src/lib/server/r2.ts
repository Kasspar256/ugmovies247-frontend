import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs/promises';
import path from 'path';
import { getPublicR2BaseUrl } from './env';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export function getR2PublicUrl(key: string) {
  return `${getPublicR2BaseUrl()}/${key.replace(/^\/+/, '')}`;
}

export async function createPresignedR2Upload(options: {
  key: string;
  contentType?: string;
}) {
  const resolvedContentType = options.contentType || 'application/octet-stream';
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: options.key,
    ContentType: resolvedContentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 * 15 });

  return {
    key: options.key,
    contentType: resolvedContentType,
    uploadUrl,
    publicUrl: getR2PublicUrl(options.key),
  };
}

export async function deleteR2Object(key: string) {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    })
  );
}

export async function uploadFileToR2(options: {
  localPath: string;
  key: string;
  contentType?: string;
}) {
  const body = await fs.readFile(options.localPath);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: options.key,
      Body: body,
      ContentType: options.contentType || 'application/octet-stream',
    })
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

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
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
