import fs from 'fs/promises';
import path from 'path';
import { VIDEO_OUTPUT_DIR, VIDEO_SOURCE_DIR, VIDEO_WORKSPACE_ROOT } from './env';

export async function ensureVideoWorkspace() {
  await Promise.all([
    fs.mkdir(VIDEO_WORKSPACE_ROOT, { recursive: true }),
    fs.mkdir(VIDEO_SOURCE_DIR, { recursive: true }),
    fs.mkdir(VIDEO_OUTPUT_DIR, { recursive: true }),
  ]);
}

export async function removeDirectorySafe(targetPath?: string) {
  if (!targetPath) {
    return;
  }

  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch (error) {
    console.error('[video-fs] cleanup failed', { targetPath, error });
  }
}

export async function ensureParentDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
