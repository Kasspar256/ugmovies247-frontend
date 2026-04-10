import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { extractMovieData } from '@/lib/movieUtils';
import { listVideoJobs, createVideoJob } from '@/lib/server/videoJobs';
import { ensureParentDir } from '@/lib/server/fsUtils';
import { VIDEO_SOURCE_DIR } from '@/lib/server/env';

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
  sourceType?: 'upload' | 'remote_link' | 'direct_upload';
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

  const response = await fetch(remoteUrl, { method: 'HEAD' }).catch(() => null);

  if (!response || !response.ok) {
    throw new Error(`Remote source is not reachable: ${remoteUrl}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType && !contentType.startsWith('video/') && !contentType.includes('octet-stream')) {
    throw new Error(`Remote URL does not appear to be a direct video source: ${remoteUrl}`);
  }
}

function normalizeMetadata(input?: AdminMovieMetadata) {
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
      status: input?.status || 'draft',
      is_trending_tiktok: Boolean(input?.isTrendingTikTok),
      contentType: input?.contentType === 'series' ? 'series' : 'movie',
      accessTier: 'premium',
      sourceType: 'upload',
      sourcePipeline: 'hls_pipeline',
    jobStatus: 'queued',
    processingProgress: 0,
    playbackType: 'hls',
    masterPlaylistUrl: '',
    availableRenditions: [],
    errorMessage: '',
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
}

async function createMovieDocument(metadata: AdminMovieMetadata) {
  const movieRef = adminDb.collection('movies').doc();
  const movieDoc = normalizeMetadata(metadata);
  await movieRef.set({
    movieId: movieRef.id,
    video_url: '',
    ...movieDoc,
  });

  return movieRef.id;
}

async function queueLocalMovieFile(file: File, metadata: AdminMovieMetadata) {
  try {
    const extracted = extractMovieData(file.name);
    const movieId = await createMovieDocument({
      ...metadata,
      title: metadata.title || extracted.title || file.name,
      originalTitle: metadata.originalTitle || extracted.title || file.name,
      vj: metadata.vj || extracted.vj || 'Unknown',
      sourceType: 'upload',
      contentType: 'movie',
    });

    const jobId = randomUUID();
    const sourceDirectory = path.join(VIDEO_SOURCE_DIR, jobId);
    const sourceFileName = file.name.replace(/\s+/g, '_');
    const localSourcePath = path.join(sourceDirectory, sourceFileName);
    await ensureParentDir(localSourcePath);
    await fs.writeFile(localSourcePath, Buffer.from(await file.arrayBuffer()));

    await adminDb.collection('movies').doc(movieId).set(
        {
          sourceType: 'upload',
          sourcePipeline: 'hls_pipeline',
          sourceFileName,
          updatedAt: isoNow(),
        },
      { merge: true }
    );

    await createVideoJob(
      {
        jobType: 'hls_transcode',
        sourcePipeline: 'hls_pipeline',
        title: metadata.title || extracted.title || file.name,
        contentType: 'movie',
        sourceType: 'upload',
        sourceFileName,
        localSourcePath,
        target: { kind: 'movie', movieId },
      },
      { id: jobId }
    );

    return { movieId, jobId };
  } catch (error) {
    console.error('[video-jobs] local upload queue failed', {
      fileName: file.name,
      fileSize: file.size,
      error,
    });

    throw error;
  }
}

async function queueRemoteMovieLink(remoteUrl: string, metadata: AdminMovieMetadata) {
  await validateRemoteVideoUrl(remoteUrl);
  const extracted = extractMovieData(remoteUrl.split('/').pop() || remoteUrl);
  const movieId = await createMovieDocument({
    ...metadata,
    title: metadata.title || extracted.title || 'Untitled movie',
    originalTitle: metadata.originalTitle || extracted.title || 'Untitled movie',
    vj: metadata.vj || extracted.vj || 'Unknown',
    sourceType: 'remote_link',
    contentType: 'movie',
  });

  await adminDb.collection('movies').doc(movieId).set(
      {
        sourceType: 'remote_link',
        sourcePipeline: 'hls_pipeline',
        sourceUrl: remoteUrl,
        updatedAt: isoNow(),
      },
    { merge: true }
  );

  const jobId = await createVideoJob({
    jobType: 'hls_transcode',
    sourcePipeline: 'hls_pipeline',
    title: metadata.title || extracted.title || 'Untitled movie',
    contentType: 'movie',
    sourceType: 'remote_link',
    sourceUrl: remoteUrl,
    sourceFileName: remoteUrl.split('/').pop() || `${movieId}.mp4`,
    target: { kind: 'movie', movieId },
  });

  return { movieId, jobId };
}

async function queueSeriesFromRemoteLinks(
  metadata: AdminMovieMetadata,
  seasons: SeriesSeasonInput[]
) {
  for (const season of seasons) {
    for (const episode of season.episodes) {
      await validateRemoteVideoUrl(episode.video_url);
    }
  }

  const movieRef = adminDb.collection('movies').doc();
  const now = isoNow();
  const normalizedSeasons = seasons.map((season) => ({
    seasonNumber: season.seasonNumber,
    title: season.title || `Season ${season.seasonNumber}`,
    episodes: season.episodes.map((episode) => ({
        ...episode,
        sourceType: 'remote_link',
        sourcePipeline: 'hls_pipeline',
        sourceUrl: episode.video_url,
      sourceFileName: episode.video_url.split('/').pop() || `${movieRef.id}-s${season.seasonNumber}-e${episode.episodeNumber}.mp4`,
      video_url: '',
      playbackType: 'hls',
      masterPlaylistUrl: '',
      availableRenditions: [],
      jobStatus: 'queued',
      processingProgress: 0,
      errorMessage: '',
      createdAt: now,
      updatedAt: now,
    })),
  }));

  await movieRef.set({
    movieId: movieRef.id,
    ...normalizeMetadata({ ...metadata, contentType: 'series' }),
    sourceType: 'remote_link',
    sourcePipeline: 'hls_pipeline',
    video_url: '',
    seasons: normalizedSeasons,
  });

  const jobs = [];

  for (const season of seasons) {
    for (const episode of season.episodes) {
      const jobId = await createVideoJob({
        jobType: 'hls_transcode',
        sourcePipeline: 'hls_pipeline',
        title: `${metadata.title || 'Series'} - ${episode.title}`,
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

      jobs.push(jobId);
    }
  }

  return { movieId: movieRef.id, jobIds: jobs };
}

export async function GET() {
  try {
    const session = await getCurrentAuthSession();

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        {
          error: 'Failed to load video jobs.',
          detail: adminSetupError,
        },
        { status: 500 }
      );
    }

    const jobs = await listVideoJobs(100);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('[video-jobs] list failed', error);
    return NextResponse.json(
      {
        error: 'Failed to load video jobs.',
        detail: error instanceof Error ? error.message : 'Unknown video jobs error.',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getCurrentAuthSession();

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        {
          error: 'Video queue backend is not configured yet.',
          detail: adminSetupError,
        },
        { status: 500 }
      );
    }

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const payload = JSON.parse(String(formData.get('payload') || '{}')) as {
        metadata?: AdminMovieMetadata;
      };
      const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0);

      if (!files.length) {
        return NextResponse.json({ error: 'No files were uploaded.' }, { status: 400 });
      }

      const results = [];

      for (const file of files) {
        results.push(await queueLocalMovieFile(file, payload.metadata || {}));
      }

      return NextResponse.json({ queued: results.length, results });
    }

    const body = await req.json();

    if (body.mode === 'series_remote') {
      const result = await queueSeriesFromRemoteLinks(body.metadata || {}, body.seasons || []);
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
      results.push(await queueRemoteMovieLink(remoteUrl.trim(), body.metadata || {}));
    }

    return NextResponse.json({ queued: results.length, results });
  } catch (error) {
    console.error('[video-jobs] enqueue failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue video jobs.' },
      { status: 500 }
    );
  }
}
