import fs from 'fs/promises';
import path from 'path';
import {
  ffprobeMedia,
  convertVideoToMp4,
  copyVideoToMp4WithAacAudio,
  rewriteMp4ForStreaming,
} from './ffmpeg';
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

function isSafariCompatibleMp4(probe: Awaited<ReturnType<typeof ffprobeMedia>>) {
  const videoStream = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const normalizedFormats = String(probe.format?.format_name || '')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const pixelFormat = String(videoStream?.pix_fmt || '').toLowerCase();
  const audioCodec = String(audioStream?.codec_name || '').toLowerCase();
  const audioProfile = String(audioStream?.profile || '').toLowerCase();
  const audioChannels = Number(audioStream?.channels || 0);
  const videoCodec = String(videoStream?.codec_name || '').toLowerCase();
  const hasAudioStream = Boolean(audioStream);
  const isMp4Container =
    normalizedFormats.includes('mp4') ||
    normalizedFormats.includes('mov') ||
    normalizedFormats.includes('m4a');
  const isVideoCodecSupported = videoCodec === 'h264';
  const isAudioCodecSupported =
    !hasAudioStream ||
    (audioCodec === 'aac' && (!audioProfile || audioProfile.includes('lc')));
  const isAudioChannelLayoutSupported = !hasAudioStream || !audioChannels || audioChannels <= 2;
  const isPixelFormatSupported =
    !pixelFormat || pixelFormat === 'yuv420p' || pixelFormat === 'yuvj420p';

  return (
    isMp4Container &&
    isVideoCodecSupported &&
    isAudioCodecSupported &&
    isAudioChannelLayoutSupported &&
    isPixelFormatSupported
  );
}

type DirectVideoCompatibilityInfo = {
  codecName?: string;
  audioCodecName?: string;
  audioProfile?: string;
  audioChannels?: number;
  pixelFormat?: string;
  isSafariCompatibleMp4?: boolean;
};

function isH264VideoCopySafe(info: DirectVideoCompatibilityInfo) {
  const videoCodec = String(info.codecName || '').toLowerCase();
  const pixelFormat = String(info.pixelFormat || '').toLowerCase();

  return (
    videoCodec === 'h264' &&
    (!pixelFormat || pixelFormat === 'yuv420p' || pixelFormat === 'yuvj420p')
  );
}

function isAudioCopySafe(info: DirectVideoCompatibilityInfo) {
  const audioCodec = String(info.audioCodecName || '').toLowerCase();
  const audioProfile = String(info.audioProfile || '').toLowerCase();
  const audioChannels = Number(info.audioChannels || 0);

  return (
    !audioCodec ||
    (audioCodec === 'aac' && (!audioProfile || audioProfile.includes('lc')) && audioChannels <= 2)
  );
}

export function getDirectMp4PreparationStrategy(info: DirectVideoCompatibilityInfo) {
  if (info.isSafariCompatibleMp4 || (isH264VideoCopySafe(info) && isAudioCopySafe(info))) {
    return {
      mode: 'remux' as const,
      jobLogMessage: 'Applying fast MP4 remux without re-encoding the video stream.',
    };
  }

  if (isH264VideoCopySafe(info)) {
    return {
      mode: 'copy_video_transcode_audio' as const,
      jobLogMessage:
        'Keeping the H264 video stream intact and only normalizing audio/container for faster publishing.',
    };
  }

  return {
    mode: 'full_transcode' as const,
    jobLogMessage: 'Processing the MP4 for wider browser and mobile compatibility.',
  };
}

export async function inspectDirectVideoSource(sourcePath: string) {
  const probe = await ffprobeMedia(sourcePath);
  const videoStream = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = probe.streams?.find((stream) => stream.codec_type === 'audio');

  return {
    durationSeconds: Number(probe.format?.duration || 0),
    fileSizeBytes: Number(probe.format?.size || 0),
    videoResolution:
      videoStream?.width && videoStream?.height
        ? { width: videoStream.width, height: videoStream.height }
        : null,
    formatName: probe.format?.format_name || '',
    codecName: videoStream?.codec_name || '',
    audioCodecName: audioStream?.codec_name || '',
    audioProfile: audioStream?.profile || '',
    audioChannels: Number(audioStream?.channels || 0),
    pixelFormat: videoStream?.pix_fmt || '',
    isSafariCompatibleMp4: isSafariCompatibleMp4(probe),
  };
}

export async function prepareDirectMp4Source(options: {
  sourcePath: string;
  outputDirectory: string;
  timeoutMs: number;
  onProgress?: (progressPercent: number) => void | Promise<void>;
}) {
  const sourceExtension = path.extname(options.sourcePath).toLowerCase();
  const outputPath = path.join(
    options.outputDirectory,
    `${sanitizePathPart(path.basename(options.sourcePath, sourceExtension) || 'video')}.mp4`
  );
  const sourceInfo = await inspectDirectVideoSource(options.sourcePath);
  const strategy = getDirectMp4PreparationStrategy(sourceInfo);

  await fs.mkdir(options.outputDirectory, { recursive: true });

  if (strategy.mode === 'remux') {
    await rewriteMp4ForStreaming(options.sourcePath, outputPath, options.timeoutMs, {
      durationSeconds: sourceInfo.durationSeconds,
      onProgress: options.onProgress,
    });
  } else if (strategy.mode === 'copy_video_transcode_audio') {
    await copyVideoToMp4WithAacAudio(options.sourcePath, outputPath, options.timeoutMs, {
      durationSeconds: sourceInfo.durationSeconds,
      onProgress: options.onProgress,
    });
  } else {
    await convertVideoToMp4(options.sourcePath, outputPath, options.timeoutMs, {
      durationSeconds: sourceInfo.durationSeconds,
      onProgress: options.onProgress,
    });
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
    | { kind: 'part'; movieId: string; partId: string }
    | { kind: 'episode'; movieId: string; seasonNumber: number; episodeNumber: number };
  onProgress?: (progress: {
    uploadedBytes: number;
    totalBytes: number;
    progressPercent: number;
    uploadedParts?: number;
    totalParts?: number;
  }) => Promise<void> | void;
}) {
  const basePrefix =
    options.target.kind === 'movie'
      ? `movies/${options.target.movieId}/direct`
      : options.target.kind === 'part'
        ? `movies/${options.target.movieId}/parts/${options.target.partId}/direct`
      : `series/${options.target.movieId}/season-${options.target.seasonNumber}/episode-${options.target.episodeNumber}/direct`;
  const key = `${basePrefix}/video.mp4`;

  return uploadFileToR2({
    localPath: options.localMp4Path,
    key,
    contentType: getContentTypeForFile(options.localMp4Path),
    onProgress: options.onProgress,
  });
}

export { isoNow };
