import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { extractMovieData } from '@/lib/movieUtils';
import { createVideoJob } from '@/lib/server/videoJobs';
import { ensureParentDir } from '@/lib/server/fsUtils';
import { VIDEO_SOURCE_DIR } from '@/lib/server/env';
import { uploadFileToR2 } from '@/lib/server/r2';
import type { SourcePipeline, VideoJobType } from '@/types/videoJobs';
import type { Season } from '@/types/movie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AdminMovieMetadata = {
  title?: string;
  originalTitle?: string;
  description?: string;
  poster?: string;
  genres?: string[];
  category?: string[];
  vj?: string;
  releaseDate?: string;
  country?: string;
  tmdbId?: number | null;
  status?: string;
  isTrendingTikTok?: boolean;
  contentType?: 'movie' | 'series';
};

type SeriesEpisodeInput = {
  episodeNumber: number;
  title: string;
  description?: string;
  video_url: string;
  poster?: string;
  thumbnail?: string;
};

type SeriesSeasonInput = {
  seasonNumber: number;
  title?: string;
  episodes: SeriesEpisodeInput[];
};

function isoNow() {
  return new Date().toISOString();
}

function inferPipelineFromUrl(remoteUrl: string): { sourcePipeline: SourcePipeline; jobType: VideoJobType } {
  const lowerUrl = remoteUrl.toLowerCase();

  if (lowerUrl.endsWith('.mkv') || lowerUrl.includes('.mkv?')) {
    return {
      sourcePipeline: 'remote_mkv_to_mp4',
      jobType: 'remote_mkv_to_mp4',
    };
  }

  return {
    sourcePipeline: 'remote_mp4_ingest',
    jobType: 'direct_mp4_upload',
  };
}

async function validateRemoteVideoUrl(remoteUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(remoteUrl);
  } catch {
    throw new Error(`Invalid remote URL: ${remoteUrl}`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Unsupported remote URL protocol: ${remoteUrl}`);
  }

  let response = await fetch(remoteUrl, { method: 'HEAD' }).catch(() => null);

  if (!response || !response.ok) {
    response = await fetch(remoteUrl, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-0',
      },
    }).catch(() => null);
  }

  if (!response || !response.ok) {
    throw new Error(`Remote source is not reachable: ${remoteUrl}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const normalizedUrl = remoteUrl.toLowerCase();

  if (
    contentType &&
    !contentType.startsWith('video/') &&
    !contentType.includes('octet-stream') &&
    !contentType.includes('matroska') &&
    !normalizedUrl.endsWith('.mkv') &&
    !normalizedUrl.endsWith('.mp4')
  ) {
    throw new Error(`Remote URL does not appear to be a direct video source: ${remoteUrl}`);
  }
}

function normalizeDirectMetadata(input?: AdminMovieMetadata) {
  return {
    title: input?.title || 'Untitled movie',
    original_title: input?.originalTitle || input?.title || 'Untitled movie',
    description: input?.description || '',
    poster: input?.poster || '',
    genres: input?.genres || [],
    category: input?.category || [],
    vj: input?.vj || 'Unknown',
    release_date: input?.releaseDate || '',
    date_added: isoNow(),
    country: input?.country || 'Unknown',
    tmdb_id: typeof input?.tmdbId === 'number' ? input.tmdbId : null,
    status: input?.status || 'published',
    is_trending_tiktok: Boolean(input?.isTrendingTikTok),
    contentType: input?.contentType === 'series' ? 'series' : 'movie',
    accessTier: 'premium',
    sourceType: 'direct_upload',
    sourcePipeline: 'direct_upload',
    jobStatus: 'ready',
    processingProgress: 100,
    playbackType: 'mp4',
    masterPlaylistUrl: '',
    availableRenditions: [],
    errorMessage: '',
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
}

async function createDirectMovieDocument(options: {
  metadata: AdminMovieMetadata;
  playbackUrl: string;
  sourceFileName?: string;
  sourceType: 'direct_upload' | 'remote_link';
  sourcePipeline: SourcePipeline;
  sourceUrl?: string;
}) {
  const movieRef = adminDb.collection('movies').doc();
  const timestamp = isoNow();

  await movieRef.set({
    movieId: movieRef.id,
    ...normalizeDirectMetadata(options.metadata),
    sourceType: options.sourceType,
    sourcePipeline: options.sourcePipeline,
    sourceFileName: options.sourceFileName || '',
    sourceUrl: options.sourceUrl || options.playbackUrl,
    video_url: options.playbackUrl,
    processedAt: timestamp,
    updatedAt: timestamp,
  });

  return movieRef.id;
}

async function createQueuedDirectMovieDocument(options: {
  metadata: AdminMovieMetadata;
  remoteUrl: string;
}) {
  const extracted = extractMovieData(options.remoteUrl.split('/').pop() || options.remoteUrl);
  const inferred = inferPipelineFromUrl(options.remoteUrl);
  const movieRef = adminDb.collection('movies').doc();
  const timestamp = isoNow();

  await movieRef.set({
    movieId: movieRef.id,
    ...normalizeDirectMetadata({
      ...options.metadata,
      title: options.metadata.title || extracted.title || 'Untitled movie',
      originalTitle: options.metadata.originalTitle || extracted.title || 'Untitled movie',
      vj: options.metadata.vj || extracted.vj || 'Unknown',
      contentType: 'movie',
    }),
    sourceType: 'remote_link',
    sourcePipeline: inferred.sourcePipeline,
    sourceUrl: options.remoteUrl,
    sourceFileName: options.remoteUrl.split('/').pop() || `${movieRef.id}.mp4`,
    video_url: '',
    jobStatus: 'queued',
    processingProgress: 0,
    processedAt: '',
    updatedAt: timestamp,
  });

  const jobId = await createVideoJob({
    jobType: inferred.jobType,
    sourcePipeline: inferred.sourcePipeline,
    title: options.metadata.title || extracted.title || 'Untitled movie',
    contentType: 'movie',
    sourceType: 'remote_link',
    sourceUrl: options.remoteUrl,
    sourceFileName: options.remoteUrl.split('/').pop() || `${movieRef.id}.mp4`,
    target: { kind: 'movie', movieId: movieRef.id },
  });

  return { movieId: movieRef.id, jobId };
}

async function createQueuedStagedDirectMovie(options: {
  metadata: AdminMovieMetadata;
  stagedUrl: string;
  sourceFileName?: string;
}) {
  const extracted = extractMovieData(options.sourceFileName || options.stagedUrl);
  const movieRef = adminDb.collection('movies').doc();
  const timestamp = isoNow();

  await movieRef.set({
    movieId: movieRef.id,
    ...normalizeDirectMetadata({
      ...options.metadata,
      title: options.metadata.title || extracted.title || 'Untitled movie',
      originalTitle: options.metadata.originalTitle || extracted.title || 'Untitled movie',
      vj: options.metadata.vj || extracted.vj || 'Unknown',
      contentType: 'movie',
    }),
    sourceType: 'direct_upload',
    sourcePipeline: 'direct_upload',
    sourceUrl: options.stagedUrl,
    sourceFileName: options.sourceFileName || options.stagedUrl.split('/').pop() || `${movieRef.id}.mkv`,
    video_url: '',
    jobStatus: 'queued',
    processingProgress: 0,
    processedAt: '',
    updatedAt: timestamp,
  });

  const jobId = await createVideoJob({
    jobType: 'remote_mkv_to_mp4',
    sourcePipeline: 'direct_upload',
    title: options.metadata.title || extracted.title || 'Untitled movie',
    contentType: 'movie',
    sourceType: 'direct_upload',
    sourceUrl: options.stagedUrl,
    sourceFileName: options.sourceFileName || options.stagedUrl.split('/').pop() || `${movieRef.id}.mkv`,
    target: { kind: 'movie', movieId: movieRef.id },
  });

  return { movieId: movieRef.id, jobId };
}

async function createQueuedDirectSeries(options: {
  metadata: AdminMovieMetadata;
  seasons: SeriesSeasonInput[];
}) {
  for (const season of options.seasons) {
    for (const episode of season.episodes) {
      await validateRemoteVideoUrl(episode.video_url);
    }
  }

  const movieRef = adminDb.collection('movies').doc();
  const timestamp = isoNow();
  const normalizedSeasons: Season[] = options.seasons.map((season) => ({
    seasonNumber: season.seasonNumber,
    title: season.title || `Season ${season.seasonNumber}`,
    episodes: season.episodes.map((episode) => {
      const inferred = inferPipelineFromUrl(episode.video_url);

      return {
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        description: episode.description || '',
        poster: episode.poster || '',
        thumbnail: episode.thumbnail || '',
        video_url: '',
        sourceType: 'remote_link',
        sourcePipeline: inferred.sourcePipeline,
        sourceUrl: episode.video_url,
        sourceFileName:
          episode.video_url.split('/').pop() ||
          `${movieRef.id}-s${season.seasonNumber}-e${episode.episodeNumber}.mp4`,
        playbackType: 'mp4',
        accessTier: 'premium',
        masterPlaylistUrl: '',
        availableRenditions: [],
        jobStatus: 'queued',
        processingProgress: 0,
        errorMessage: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }),
  }));

  await movieRef.set({
    movieId: movieRef.id,
    ...normalizeDirectMetadata({ ...options.metadata, contentType: 'series' }),
    sourceType: 'remote_link',
    sourcePipeline: 'remote_mp4_ingest',
    video_url: '',
    jobStatus: 'queued',
    processingProgress: 0,
    seasons: normalizedSeasons,
    updatedAt: timestamp,
  });

  const jobIds: string[] = [];

  for (const season of options.seasons) {
    for (const episode of season.episodes) {
      const inferred = inferPipelineFromUrl(episode.video_url);
      const jobId = await createVideoJob({
        jobType: inferred.jobType,
        sourcePipeline: inferred.sourcePipeline,
        title: `${options.metadata.title || 'Series'} - ${episode.title}`,
        contentType: 'series',
        sourceType: 'remote_link',
        sourceUrl: episode.video_url,
        sourceFileName:
          episode.video_url.split('/').pop() ||
          `${movieRef.id}-s${season.seasonNumber}-e${episode.episodeNumber}.mp4`,
        target: {
          kind: 'episode',
          movieId: movieRef.id,
          seasonNumber: season.seasonNumber,
          episodeNumber: episode.episodeNumber,
        },
      });

      jobIds.push(jobId);
    }
  }

  return { movieId: movieRef.id, jobIds };
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentAuthSession();

    if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        {
          error: 'Direct upload backend is not configured yet.',
          detail: adminSetupError,
        },
        { status: 500 }
      );
    }

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const mode = String(formData.get('mode') || '');
      const metadata = JSON.parse(String(formData.get('metadata') || '{}')) as AdminMovieMetadata;
      const file = formData.get('file');

      if (!(file instanceof File) || file.size <= 0) {
        return NextResponse.json({ error: 'No upload file was provided.' }, { status: 400 });
      }

      const lowerName = file.name.toLowerCase();
      const isMkv = lowerName.endsWith('.mkv');
      const extracted = extractMovieData(file.name);

      if (mode !== 'local_upload') {
        return NextResponse.json({ error: 'Unsupported multipart direct upload mode.' }, { status: 400 });
      }

      if (isMkv) {
        const movieRef = adminDb.collection('movies').doc();
        const timestamp = isoNow();
        const jobId = randomUUID();
        const sourceDirectory = path.join(VIDEO_SOURCE_DIR, jobId);
        const sourceFileName = file.name.replace(/\s+/g, '_');
        const localSourcePath = path.join(sourceDirectory, sourceFileName);

        await ensureParentDir(localSourcePath);
        await fs.writeFile(localSourcePath, Buffer.from(await file.arrayBuffer()));

        await movieRef.set({
          movieId: movieRef.id,
          ...normalizeDirectMetadata({
            ...metadata,
            title: metadata.title || extracted.title || 'Untitled movie',
            originalTitle: metadata.originalTitle || extracted.title || 'Untitled movie',
            vj: metadata.vj || extracted.vj || 'Unknown',
            contentType: 'movie',
          }),
          sourceType: 'direct_upload',
          sourcePipeline: 'direct_upload',
          sourceFileName,
          sourceUrl: '',
          video_url: '',
          jobStatus: 'queued',
          processingProgress: 0,
          processedAt: '',
          updatedAt: timestamp,
        });

        await createVideoJob(
          {
            jobType: 'remote_mkv_to_mp4',
            sourcePipeline: 'direct_upload',
            title: metadata.title || extracted.title || file.name,
            contentType: 'movie',
            sourceType: 'direct_upload',
            sourceFileName,
            localSourcePath,
            target: { kind: 'movie', movieId: movieRef.id },
          },
          { id: jobId }
        );

        return NextResponse.json({ queued: 1, result: { movieId: movieRef.id, jobId } });
      }

      const movieRef = adminDb.collection('movies').doc();
      const safeFileName = file.name.replace(/\s+/g, '_');
      const tempDirectory = path.join(VIDEO_SOURCE_DIR, `direct-${movieRef.id}`);
      const localPath = path.join(tempDirectory, safeFileName);

      await ensureParentDir(localPath);
      await fs.writeFile(localPath, Buffer.from(await file.arrayBuffer()));

      try {
        const upload = await uploadFileToR2({
          localPath,
          key: `movies/${movieRef.id}/direct/video.mp4`,
          contentType: file.type || 'video/mp4',
        });

        const timestamp = isoNow();
        await movieRef.set({
          movieId: movieRef.id,
          ...normalizeDirectMetadata({
            ...metadata,
            title: metadata.title || extracted.title || 'Untitled movie',
            originalTitle: metadata.originalTitle || extracted.title || 'Untitled movie',
            vj: metadata.vj || extracted.vj || 'Unknown',
            contentType: 'movie',
          }),
          sourceType: 'direct_upload',
          sourcePipeline: 'direct_upload',
          sourceFileName: safeFileName,
          sourceUrl: upload.publicUrl,
          video_url: upload.publicUrl,
          processedAt: timestamp,
          updatedAt: timestamp,
        });

        return NextResponse.json({ success: true, movieId: movieRef.id });
      } finally {
        await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    const body = await request.json();
    const mode = String(body.mode || '');

    if (mode === 'local_upload') {
      const metadata = body.metadata || {};
      const playbackUrl = String(body.playbackUrl || '');
      const sourceFileName = String(body.sourceFileName || '');
      const sourceUrl = String(body.sourceUrl || '');

      if (!playbackUrl) {
        return NextResponse.json({ error: 'Missing direct playback URL.' }, { status: 400 });
      }

      const movieId = await createDirectMovieDocument({
        metadata,
        playbackUrl,
        sourceFileName,
        sourceType: 'direct_upload',
        sourcePipeline: 'direct_upload',
        sourceUrl,
      });

      return NextResponse.json({ success: true, movieId });
    }

    if (mode === 'staged_local_conversion') {
      const metadata = body.metadata || {};
      const stagedUrl = String(body.stagedUrl || '');
      const sourceFileName = String(body.sourceFileName || '');

      if (!stagedUrl) {
        return NextResponse.json({ error: 'Missing staged source URL.' }, { status: 400 });
      }

      const result = await createQueuedStagedDirectMovie({
        metadata,
        stagedUrl,
        sourceFileName,
      });

      return NextResponse.json({ queued: 1, result });
    }

    if (mode === 'series_remote') {
      const result = await createQueuedDirectSeries({
        metadata: body.metadata || {},
        seasons: Array.isArray(body.seasons) ? body.seasons : [],
      });

      return NextResponse.json({ queued: result.jobIds.length, result });
    }

    const remoteLinks: string[] = Array.isArray(body.remoteLinks)
      ? body.remoteLinks.filter((entry: string) => typeof entry === 'string' && entry.trim())
      : [];

    if (!remoteLinks.length) {
      return NextResponse.json({ error: 'No remote links provided.' }, { status: 400 });
    }

    const results = [];

    for (const remoteUrl of remoteLinks) {
      await validateRemoteVideoUrl(remoteUrl.trim());
      results.push(
        await createQueuedDirectMovieDocument({
          metadata: body.metadata || {},
          remoteUrl: remoteUrl.trim(),
        })
      );
    }

    return NextResponse.json({ queued: results.length, results });
  } catch (error) {
    console.error('[direct-videos] request failed', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to process direct video request.',
      },
      { status: 500 }
    );
  }
}
