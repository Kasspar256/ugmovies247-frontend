import { NextResponse } from 'next/server';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { extractMovieData } from '@/lib/movieUtils';
import { upsertMovieInCatalogCache } from '@/lib/server/movieCatalogCache';
import { createMovieDocumentRef } from '@/lib/server/movieCollection';
import type { SourcePipeline } from '@/types/videoJobs';
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

function inferRemoteSourcePipeline(_remoteUrl: string): SourcePipeline {
  return 'remote_mp4_ingest';
}

async function validateRemoteVideoUrl(remoteUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(remoteUrl);
  } catch {
    throw new Error(`Invalid video URL: ${remoteUrl}`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Unsupported video URL protocol: ${remoteUrl}`);
  }

  const normalizedUrl = remoteUrl.toLowerCase();

  if (normalizedUrl.endsWith('.mkv') || normalizedUrl.includes('.mkv?')) {
    throw new Error('MKV links are no longer supported in the admin. Use an MP4 link instead.');
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
    throw new Error(`Video source is not reachable: ${remoteUrl}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('matroska')) {
    throw new Error('MKV links are no longer supported in the admin. Use an MP4 link instead.');
  }

  if (
    contentType &&
    !contentType.startsWith('video/') &&
    !contentType.includes('octet-stream') &&
    !normalizedUrl.endsWith('.mp4')
  ) {
    throw new Error(`Video URL does not appear to be a direct MP4 source: ${remoteUrl}`);
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
  const movieRef = await createMovieDocumentRef();
  const timestamp = isoNow();
  const moviePayload = {
    movieId: movieRef.id,
    ...normalizeDirectMetadata(options.metadata),
    sourceType: options.sourceType,
    sourcePipeline: options.sourcePipeline,
    sourceFileName: options.sourceFileName || '',
    sourceUrl: options.sourceUrl || options.playbackUrl,
    video_url: options.playbackUrl,
    processedAt: timestamp,
    updatedAt: timestamp,
  };

  await movieRef.set(moviePayload);
  await upsertMovieInCatalogCache({ id: movieRef.id, ...moviePayload });

  return movieRef.id;
}

async function createDirectSeriesDocument(options: {
  metadata: AdminMovieMetadata;
  seasons: SeriesSeasonInput[];
}) {
  const movieRef = await createMovieDocumentRef();
  const timestamp = isoNow();
  const normalizedSeasons: Season[] = options.seasons.map((season) => ({
    seasonNumber: season.seasonNumber,
    title: season.title || `Season ${season.seasonNumber}`,
    episodes: season.episodes.map((episode, episodeIndex) => ({
      episodeNumber: Number(episode.episodeNumber) || episodeIndex + 1,
      title: episode.title || `Episode ${episodeIndex + 1}`,
      description: episode.description || '',
      poster: episode.poster || '',
      thumbnail: episode.thumbnail || '',
      video_url: episode.video_url,
      sourceType: 'remote_link',
      sourcePipeline: inferRemoteSourcePipeline(episode.video_url),
      sourceUrl: episode.video_url,
      sourceFileName:
        episode.video_url.split('/').pop() ||
        `${movieRef.id}-s${season.seasonNumber}-e${episode.episodeNumber}.mp4`,
      playbackType: 'mp4',
      accessTier: 'premium',
      masterPlaylistUrl: '',
      availableRenditions: [],
      jobStatus: 'ready',
      processingProgress: 100,
      errorMessage: '',
      processedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  }));

  const moviePayload = {
    movieId: movieRef.id,
    ...normalizeDirectMetadata({ ...options.metadata, contentType: 'series' }),
    sourceType: 'remote_link',
    sourcePipeline: 'remote_mp4_ingest',
    video_url: '',
    sourceUrl: '',
    seasons: normalizedSeasons,
    processedAt: timestamp,
    updatedAt: timestamp,
  };

  await movieRef.set(moviePayload);
  await upsertMovieInCatalogCache({ id: movieRef.id, ...moviePayload });

  return movieRef.id;
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

    if (mode === 'existing_link') {
      const metadata = body.metadata || {};
      const playbackUrl = String(body.playbackUrl || '').trim();
      const extracted = extractMovieData(playbackUrl.split('/').pop() || playbackUrl);

      if (!playbackUrl) {
        return NextResponse.json({ error: 'Missing existing MP4 link.' }, { status: 400 });
      }

      await validateRemoteVideoUrl(playbackUrl);

      const movieId = await createDirectMovieDocument({
        metadata: {
          ...metadata,
          title: metadata.title || extracted.title || 'Untitled movie',
          originalTitle: metadata.originalTitle || extracted.title || 'Untitled movie',
          vj: metadata.vj || extracted.vj || 'Unknown',
          contentType: 'movie',
        },
        playbackUrl,
        sourceFileName: playbackUrl.split('/').pop() || '',
        sourceType: 'remote_link',
        sourcePipeline: 'remote_mp4_ingest',
        sourceUrl: playbackUrl,
      });

      return NextResponse.json({ success: true, movieId });
    }

    if (mode === 'series_links') {
      const metadata = body.metadata || {};
      const seasons: SeriesSeasonInput[] = Array.isArray(body.seasons) ? body.seasons : [];

      if (!seasons.length) {
        return NextResponse.json({ error: 'Add at least one episode link first.' }, { status: 400 });
      }

      for (const season of seasons) {
        for (const episode of season.episodes || []) {
          await validateRemoteVideoUrl(String(episode.video_url || '').trim());
        }
      }

      const movieId = await createDirectSeriesDocument({
        metadata,
        seasons,
      });

      return NextResponse.json({ success: true, movieId });
    }

    return NextResponse.json(
      { error: 'Unsupported direct video mode.' },
      { status: 400 }
    );
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
