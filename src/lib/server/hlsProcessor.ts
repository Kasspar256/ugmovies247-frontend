import fs from 'fs/promises';
import path from 'path';
import { ffprobeMedia, runFfmpeg } from './ffmpeg';

const PRESET_RENDITIONS = [
  { name: '360p' as const, height: 360, width: 640, bitrateKbps: 800 },
  { name: '480p' as const, height: 480, width: 854, bitrateKbps: 1400 },
  { name: '720p' as const, height: 720, width: 1280, bitrateKbps: 2800 },
  { name: '1080p' as const, height: 1080, width: 1920, bitrateKbps: 5000 },
];

function toEven(value: number) {
  const normalized = Math.max(2, Math.floor(value));
  return normalized % 2 === 0 ? normalized : normalized - 1;
}

function resolveRenditionDimensions(
  sourceWidth: number,
  sourceHeight: number,
  rendition: { name: '360p' | '480p' | '720p' | '1080p'; height: number; width: number; bitrateKbps: number }
) {
  const sourceAspectRatio = sourceWidth / sourceHeight;
  const scaledHeight = Math.min(rendition.height, sourceHeight);
  const scaledWidth = scaledHeight * sourceAspectRatio;

  return {
    ...rendition,
    width: toEven(Math.min(scaledWidth, sourceWidth)),
    height: toEven(scaledHeight),
  };
}

export async function inspectSourceMedia(sourcePath: string) {
  const probe = await ffprobeMedia(sourcePath);
  const videoStream = probe.streams?.find((stream) => stream.codec_type === 'video');

  if (!videoStream?.width || !videoStream?.height) {
    throw new Error('Source file does not contain a readable video stream.');
  }

  return {
    durationSeconds: Number(probe.format?.duration || 0),
    fileSizeBytes: Number(probe.format?.size || 0),
    videoResolution: {
      width: videoStream.width,
      height: videoStream.height,
    },
    codecName: videoStream.codec_name || '',
    formatName: probe.format?.format_name || '',
    availableRenditions: PRESET_RENDITIONS.filter(
      (rendition) => rendition.height <= videoStream.height
    ),
  };
}

function getHlsSegmentPattern(renditionName: string) {
  return path.join(renditionName, 'segment_%03d.ts');
}

async function generateVariantPlaylist(
  sourcePath: string,
  outputDirectory: string,
  rendition: { name: '360p' | '480p' | '720p' | '1080p'; height: number; width: number; bitrateKbps: number },
  timeoutMs: number
) {
  const renditionDirectory = path.join(outputDirectory, rendition.name);
  await fs.mkdir(renditionDirectory, { recursive: true });

  const playlistPath = path.join(renditionDirectory, 'index.m3u8');

  await runFfmpeg(
    [
      '-y',
      '-i',
      sourcePath,
      '-vf',
      `scale=${rendition.width}:${rendition.height}`,
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-b:a',
      '128k',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-profile:v',
      'main',
      '-crf',
      '21',
      '-maxrate',
      `${rendition.bitrateKbps}k`,
      '-bufsize',
      `${rendition.bitrateKbps * 2}k`,
      '-g',
      '48',
      '-keyint_min',
      '48',
      '-sc_threshold',
      '0',
      '-f',
      'hls',
      '-hls_time',
      '6',
      '-hls_playlist_type',
      'vod',
      '-hls_flags',
      'independent_segments',
      '-hls_segment_filename',
      path.join(renditionDirectory, 'segment_%03d.ts'),
      playlistPath,
    ],
    timeoutMs
  );

  return playlistPath;
}

async function writeMasterPlaylist(
  outputDirectory: string,
  renditions: { name: '360p' | '480p' | '720p' | '1080p'; height: number; width: number; bitrateKbps: number }[]
) {
  const masterPlaylistPath = path.join(outputDirectory, 'master.m3u8');
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

  renditions.forEach((rendition) => {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bitrateKbps * 1000},RESOLUTION=${rendition.width}x${rendition.height}`,
      `${rendition.name}/index.m3u8`
    );
  });

  await fs.writeFile(masterPlaylistPath, lines.join('\n'));

  return masterPlaylistPath;
}

export async function transcodeSourceToHls(
  sourcePath: string,
  outputDirectory: string,
  timeoutMs: number
) {
  const mediaInfo = await inspectSourceMedia(sourcePath);
  const baseRenditions = mediaInfo.availableRenditions.length
    ? mediaInfo.availableRenditions
    : [PRESET_RENDITIONS[0]];
  const renditions = baseRenditions.map((rendition) =>
    resolveRenditionDimensions(
      mediaInfo.videoResolution.width,
      mediaInfo.videoResolution.height,
      rendition
    )
  );

  await fs.mkdir(outputDirectory, { recursive: true });

  for (const rendition of renditions) {
    await generateVariantPlaylist(sourcePath, outputDirectory, rendition, timeoutMs);
  }

  const masterPlaylistPath = await writeMasterPlaylist(outputDirectory, renditions);

  return {
    ...mediaInfo,
    masterPlaylistPath,
    availableRenditions: renditions,
  };
}
