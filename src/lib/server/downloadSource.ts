import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { pipeline } from 'stream/promises';
import { ensureParentDir } from './fsUtils';

const REMOTE_DOWNLOAD_TIMEOUT_MS = Number(
  process.env.REMOTE_DOWNLOAD_TIMEOUT_MS || 1000 * 60 * 60 * 4
);
const REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS = Number(
  process.env.REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS || 1000 * 60 * 10
);
const REMOTE_DOWNLOAD_MAX_REDIRECTS = Number(process.env.REMOTE_DOWNLOAD_MAX_REDIRECTS || 5);

function getHttpModule(url: URL) {
  return url.protocol === 'https:' ? https : http;
}

function isRedirect(statusCode?: number) {
  return Boolean(statusCode && [301, 302, 303, 307, 308].includes(statusCode));
}

async function downloadToFile(remoteUrl: string, targetPath: string, redirectCount = 0): Promise<void> {
  if (redirectCount > REMOTE_DOWNLOAD_MAX_REDIRECTS) {
    throw new Error(`Too many redirects while downloading remote source: ${remoteUrl}`);
  }

  const parsedUrl = new URL(remoteUrl);
  const httpModule = getHttpModule(parsedUrl);

  await new Promise<void>((resolve, reject) => {
    const request = httpModule.get(parsedUrl, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;

      if (isRedirect(statusCode) && location) {
        response.resume();

        const redirectUrl = new URL(location, parsedUrl).toString();
        downloadToFile(redirectUrl, targetPath, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Failed to download remote source: ${statusCode} ${response.statusMessage || ''}`.trim()));
        return;
      }

      const writeStream = createWriteStream(targetPath);
      const overallTimeout = setTimeout(() => {
        request.destroy(new Error(`Remote source download exceeded ${REMOTE_DOWNLOAD_TIMEOUT_MS} ms.`));
      }, REMOTE_DOWNLOAD_TIMEOUT_MS);

      response.setTimeout(REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS, () => {
        response.destroy(
          new Error(
            `Remote source download stalled for more than ${REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS} ms.`
          )
        );
      });

      pipeline(response, writeStream)
        .then(() => {
          clearTimeout(overallTimeout);
          resolve();
        })
        .catch((error) => {
          clearTimeout(overallTimeout);
          reject(error);
        });
    });

    request.setTimeout(REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS, () => {
      request.destroy(
        new Error(`Remote source request stalled for more than ${REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS} ms.`)
      );
    });

    request.on('error', reject);
  });
}

export async function downloadRemoteSource(remoteUrl: string, targetPath: string) {
  await ensureParentDir(targetPath);
  await downloadToFile(remoteUrl, targetPath);

  const stats = await fs.stat(targetPath);

  return {
    path: targetPath,
    fileSizeBytes: stats.size,
    sourceFileName: path.basename(targetPath),
  };
}
