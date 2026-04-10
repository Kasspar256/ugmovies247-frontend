import fs from 'fs/promises';
import path from 'path';
import { ffprobeMedia, convertVideoToMp4 } from './ffmpeg';
import { uploadFileToR2 } from './r2';

function isoNow() {
  return new Date().toISOString();
}

function sanitizePathPart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function getContentTypeForFile(filePath: string) {
  if (filePath.toLowerCase().endsWith('.mp4')) {
    return 'video/mp4';
  }

  return 'application/octet-stream';
}

export async function inspectDirectVideoSource(sourcePath: string) {
  const probe = await ffprobeMedia(sourcePath);
  const videoStream = probe.streams?.find((stream) => stream.codec_type === 'video');

  return {
    durationSeconds: Number(probe.format?.duration || 0),
    fileSizeBytes: Number(probe.format?.size || 0),
    videoResolution:
      videoStream?.width && videoStream?.height
        ? { width: videoStream.width, height: videoStream.height }
        : null,
    formatName: probe.format?.format_name || '',
    codecName: videoStream?.codec_name || '',
  };
}

export async function prepareDirectMp4Source(options: {
  sourcePath: string;
  outputDirectory: string;
  timeoutMs: number;
}) {
  const sourceExtension = path.extname(options.sourcePath).toLowerCase();
  const outputPath = path.join(
    options.outputDirectory,
    `${sanitizePathPart(path.basename(options.sourcePath, sourceExtension) || 'video')}.mp4`
  );

  await fs.mkdir(options.outputDirectory, { recursive: true });

  if (sourceExtension === '.mp4') {
    await fs.copyFile(options.sourcePath, outputPath);
  } else {
    await convertVideoToMp4(options.sourcePath, outputPath, options.timeoutMs);
  }

  const mediaInfo = await inspectDirectVideoSource(outputPath);

  return {
    outputPath,
    ...mediaInfo,
  };
}

export async function uploadDirectMp4Asset(options: {
  localMp4Path: string;
  target:
    | { kind: 'movie'; movieId: string }
    | { kind: 'episode'; movieId: string; seasonNumber: number; episodeNumber: number };
}) {
  const basePrefix =
    options.target.kind === 'movie'
      ? `movies/${options.target.movieId}/direct`
      : `series/${options.target.movieId}/season-${options.target.seasonNumber}/episode-${options.target.episodeNumber}/direct`;
  const key = `${basePrefix}/video.mp4`;

  return uploadFileToR2({
    localPath: options.localMp4Path,
    key,
    contentType: getContentTypeForFile(options.localMp4Path),
  });
}

export { isoNow };
