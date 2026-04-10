import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { ensureParentDir } from './fsUtils';

export async function downloadRemoteSource(remoteUrl: string, targetPath: string) {
  const response = await fetch(remoteUrl);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download remote source: ${response.status} ${response.statusText}`);
  }

  await ensureParentDir(targetPath);

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(targetPath));

  const stats = await fs.stat(targetPath);

  return {
    path: targetPath,
    fileSizeBytes: stats.size,
    sourceFileName: path.basename(targetPath),
  };
}
