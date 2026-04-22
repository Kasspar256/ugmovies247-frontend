import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { extractMovieData } from '@/lib/movieUtils';
import { upsertMovieInCatalogCache } from '@/lib/server/movieCatalogCache';
import {
  prepareMovieDocumentForDirectUploadProcessing,
  queuePreparedDirectUploadJobs,
} from '@/lib/server/adminVideoProcessing';
import { validateDirectMp4ImportSource } from '@/lib/server/downloadSource';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import { createVideoJob } from '@/lib/server/videoJobs';
import type { MovieDocument, Season } from '@/types/movie';

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

function normalizeImportedSourceFileName(fileName: string, fallback: string) {
  const normalized = String(fileName || '').trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.toLowerCase().endsWith('.mp4') ? normalized : `${normalized}.mp4`;
}

function normalizeDirectMetadata(input?: AdminMovieMetadata): MovieDocument {
  const categories = input?.category || [];
  const isTrendingTikTok =
    Boolean(input?.isTrendingTikTok) ||
    categories.some((category) => category.toLowerCase() === 'trending on tiktok');

  return {
    title: input?.title || 'Untitled movie',
    original_title: input?.originalTitle || input?.title || 'Untitled movie',
    description: input?.description || '',
    poster: input?.poster || '',
    genres: input?.genres || [],
    category: categories,
    vj: input?.vj || 'Unknown',
    release_date: input?.releaseDate || '',
    date_added: isoNow(),
    country: input?.country || 'Unknown',
    tmdb_id: typeof input?.tmdbId === 'number' ? input.tmdbId : null,
    status: input?.status || 'published',
    is_trending_tiktok: isTrendingTikTok,
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

async function queueDirectMovieImport(options: {
  metadata: AdminMovieMetadata;
  sourceUrl: string;
  sourceFileName: string;
  fileSizeBytes?: number | null;
}) {
  const movieRef = adminDb.collection(MOVIES_COLLECTION).doc();
  const timestamp = isoNow();
  const moviePayload = {
    movieId: movieRef.id,
    ...normalizeDirectMetadata(options.metadata),
    sourceType: 'direct_url' as const,
    sourcePipeline: 'direct_url_import' as const,
    sourceFileName: options.sourceFileName,
    sourceUrl: options.sourceUrl,
    video_url: '',
    processedAt: '',
    fileSizeBytes: Number(options.fileSizeBytes || 0),
    jobStatus: 'queued' as const,
    processingProgress: 0,
    errorMessage: '',
    updatedAt: timestamp,
  };

  await movieRef.set(moviePayload);
  await upsertMovieInCatalogCache({ id: movieRef.id, ...moviePayload });

  const jobId = await createVideoJob({
    jobType: 'direct_url_import',
    sourcePipeline: 'direct_url_import',
    title: moviePayload.title,
    contentType: 'movie',
    sourceType: 'direct_url',
    sourceFileName: options.sourceFileName,
    sourceUrl: options.sourceUrl,
    target: {
      kind: 'movie',
      movieId: movieRef.id,
    },
  });

  return {
    movieId: movieRef.id,
    jobId,
  };
}

async function createDirectSeriesDocument(options: {
  metadata: AdminMovieMetadata;
  seasons: SeriesSeasonInput[];
}) {
  const movieRef = adminDb.collection(MOVIES_COLLECTION).doc();
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
      sourceType: 'direct_upload',
      sourcePipeline: 'direct_upload',
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
      processedAt: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  }));

  const rawMoviePayload: MovieDocument = {
    movieId: movieRef.id,
    ...normalizeDirectMetadata({ ...options.metadata, contentType: 'series' }),
    sourceType: 'direct_upload',
    sourcePipeline: 'direct_upload',
    video_url: '',
    sourceUrl: '',
    seasons: normalizedSeasons,
    processedAt: '',
    updatedAt: timestamp,
  };
  const preparedMovie = prepareMovieDocumentForDirectUploadProcessing(
    rawMoviePayload,
    movieRef.id
  );

  await movieRef.set(preparedMovie.movie);
  await upsertMovieInCatalogCache({ id: movieRef.id, ...preparedMovie.movie });
  await queuePreparedDirectUploadJobs(preparedMovie.queuedJobs);

  return {
    movieId: movieRef.id,
    queuedNormalizationCount: preparedMovie.queuedJobs.length,
  };
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

      const movieRef = adminDb.collection(MOVIES_COLLECTION).doc();
      const timestamp = isoNow();
      const rawMoviePayload = {
        movieId: movieRef.id,
        ...normalizeDirectMetadata(metadata),
        sourceType: 'direct_upload' as const,
        sourcePipeline: 'direct_upload' as const,
        sourceFileName: sourceFileName || playbackUrl.split('/').pop() || '',
        sourceUrl: sourceUrl || playbackUrl,
        video_url: playbackUrl,
        processedAt: timestamp,
        updatedAt: timestamp,
      };
      const preparedMovie = prepareMovieDocumentForDirectUploadProcessing(
        rawMoviePayload,
        movieRef.id
      );

      await movieRef.set(preparedMovie.movie);
      await upsertMovieInCatalogCache({ id: movieRef.id, ...preparedMovie.movie });
      await queuePreparedDirectUploadJobs(preparedMovie.queuedJobs);

      return NextResponse.json({
        success: true,
        movieId: movieRef.id,
        queuedNormalizationCount: preparedMovie.queuedJobs.length,
      });
    }

    if (mode === 'import_link' || mode === 'existing_link') {
      const metadata = body.metadata || {};
      const sourceUrl = String(body.playbackUrl || body.sourceUrl || '').trim();

      if (!sourceUrl) {
        return NextResponse.json({ error: 'Missing direct MP4 source link.' }, { status: 400 });
      }

      const validation = await validateDirectMp4ImportSource(sourceUrl);
      const extracted = extractMovieData(validation.sourceFileName || sourceUrl);
      const queuedImport = await queueDirectMovieImport({
        metadata: {
          ...metadata,
          title: metadata.title || extracted.title || 'Untitled movie',
          originalTitle: metadata.originalTitle || extracted.title || 'Untitled movie',
          vj: metadata.vj || extracted.vj || 'Unknown',
          contentType: 'movie',
        },
        sourceUrl: validation.finalUrl,
        sourceFileName: normalizeImportedSourceFileName(
          validation.sourceFileName,
          `${Date.now()}.mp4`
        ),
        fileSizeBytes: validation.contentLength,
      });

      return NextResponse.json({
        success: true,
        movieId: queuedImport.movieId,
        jobId: queuedImport.jobId,
        queuedNormalizationCount: 1,
        status: 'queued',
        warningMessage: validation.warningMessage || '',
      });
    }

    if (mode === 'series_links') {
      const metadata = body.metadata || {};
      const seasons: SeriesSeasonInput[] = Array.isArray(body.seasons) ? body.seasons : [];
      const warningMessages = new Set<string>();

      if (!seasons.length) {
        return NextResponse.json({ error: 'Add at least one episode link first.' }, { status: 400 });
      }

      const validatedSeasons: SeriesSeasonInput[] = [];

      for (const season of seasons) {
        const validatedEpisodes: SeriesEpisodeInput[] = [];

        for (const episode of season.episodes || []) {
          const validation = await validateDirectMp4ImportSource(
            String(episode.video_url || '').trim()
          );

          if (validation.warningMessage) {
            warningMessages.add(validation.warningMessage);
          }

          validatedEpisodes.push({
            ...episode,
            video_url: validation.finalUrl,
          });
        }

        validatedSeasons.push({
          ...season,
          episodes: validatedEpisodes,
        });
      }

      const result = await createDirectSeriesDocument({
        metadata,
        seasons: validatedSeasons,
      });

      return NextResponse.json({
        success: true,
        movieId: result.movieId,
        queuedNormalizationCount: result.queuedNormalizationCount,
        status: 'queued',
        warningMessage: Array.from(warningMessages).join(' '),
      });
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
