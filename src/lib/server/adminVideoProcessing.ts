import type { Episode, MovieDocument, MoviePart } from '@/types/movie';
import type {
  SourcePipeline,
  SourceType,
  VideoJobStatus,
  VideoJobTarget,
  VideoRendition,
} from '@/types/videoJobs';
import { createVideoJob } from '@/lib/server/videoJobs';
import { adminDb } from '@/lib/firebaseAdmin';
import { upsertMovieInCatalogCache } from '@/lib/server/movieCatalogCache';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';

type DirectUploadAsset = {
  sourceType?: SourceType;
  sourcePipeline?: SourcePipeline;
  sourceFileName?: string;
  sourceUrl?: string;
  video_url?: string;
  jobStatus?: VideoJobStatus;
  processingProgress?: number;
  errorMessage?: string;
  playbackType?: 'mp4' | 'hls';
  masterPlaylistUrl?: string;
  availableRenditions?: VideoRendition[];
  processedAt?: string;
  updatedAt?: string;
};

type PendingNormalizationJob = {
  title: string;
  contentType: 'movie' | 'series';
  sourceFileName: string;
  sourceUrl: string;
  target: VideoJobTarget;
};

export type LegacyDirectUploadRepairCandidate = {
  movieId: string;
  title: string;
  contentType: 'movie' | 'series';
  repairableAssetCount: number;
  repairableRootCount: number;
  repairablePartCount: number;
  repairableEpisodeCount: number;
  updatedAt: string;
};

export type LegacyDirectUploadRepairCandidatesResult = {
  candidates: LegacyDirectUploadRepairCandidate[];
  scannedMovies: number;
  scanLimit: number;
};

function isoNow() {
  return new Date().toISOString();
}

function normalizeDirectUploadSourceType(value: DirectUploadAsset['sourceType']) {
  return value === 'upload' || value === 'direct_upload' ? 'direct_upload' : value;
}

function isInFlightJobStatus(status: DirectUploadAsset['jobStatus']) {
  return (
    status === 'queued' ||
    status === 'downloading' ||
    status === 'inspecting' ||
    status === 'processing' ||
    status === 'uploading'
  );
}

function getNormalizedSourceUrl(asset: DirectUploadAsset) {
  return String(asset.sourceUrl || asset.video_url || '').trim();
}

function getNormalizedSourceFileName(asset: DirectUploadAsset, fallback: string) {
  return String(asset.sourceFileName || '').trim() || fallback || 'video.mp4';
}

function shouldQueueDirectUploadNormalization(asset: DirectUploadAsset) {
  const sourceType = normalizeDirectUploadSourceType(asset.sourceType);
  const sourceUrl = getNormalizedSourceUrl(asset);
  const playbackUrl = String(asset.video_url || '').trim();

  if (sourceType !== 'direct_upload' || !sourceUrl) {
    return false;
  }

  if (isInFlightJobStatus(asset.jobStatus)) {
    return false;
  }

  return !playbackUrl || playbackUrl === sourceUrl;
}

function buildLegacyRepairCandidate(
  movie: MovieDocument,
  movieId: string
): LegacyDirectUploadRepairCandidate | null {
  const repairableRootCount =
    movie.contentType !== 'series' &&
    (!movie.parts || movie.parts.length === 0) &&
    shouldQueueDirectUploadNormalization(movie)
      ? 1
      : 0;
  const repairablePartCount = (movie.parts || []).filter((part) =>
    shouldQueueDirectUploadNormalization(part)
  ).length;
  const repairableEpisodeCount = (movie.seasons || []).reduce((total, season) => {
    return (
      total +
      (season.episodes || []).filter((episode) => shouldQueueDirectUploadNormalization(episode))
        .length
    );
  }, 0);
  const repairableAssetCount =
    repairableRootCount + repairablePartCount + repairableEpisodeCount;

  if (!repairableAssetCount) {
    return null;
  }

  return {
    movieId,
    title: String(movie.title || 'Untitled movie'),
    contentType: movie.contentType === 'series' ? 'series' : 'movie',
    repairableAssetCount,
    repairableRootCount,
    repairablePartCount,
    repairableEpisodeCount,
    updatedAt: String(movie.updatedAt || movie.createdAt || ''),
  };
}

function markAssetQueuedForNormalization<T extends DirectUploadAsset>(
  asset: T,
  timestamp: string,
  fallbackFileName: string
): T {
  const sourceUrl = getNormalizedSourceUrl(asset);
  const sourceFileName = getNormalizedSourceFileName(asset, fallbackFileName);

  return {
    ...asset,
    sourceType: 'direct_upload',
    sourcePipeline: 'direct_upload',
    sourceUrl,
    sourceFileName,
    video_url: '',
    jobStatus: 'queued',
    processingProgress: 0,
    errorMessage: '',
    playbackType: 'mp4',
    masterPlaylistUrl: '',
    availableRenditions: [],
    processedAt: '',
    updatedAt: timestamp,
  };
}

export function prepareMovieDocumentForDirectUploadProcessing(
  movie: MovieDocument,
  movieId: string
) {
  const timestamp = isoNow();
  const queuedJobs: PendingNormalizationJob[] = [];
  let nextMovie: MovieDocument = {
    ...movie,
  };

  if (
    movie.contentType !== 'series' &&
    (!movie.parts || movie.parts.length === 0) &&
    shouldQueueDirectUploadNormalization(nextMovie)
  ) {
    const sourceUrl = getNormalizedSourceUrl(nextMovie);
    const sourceFileName = getNormalizedSourceFileName(
      nextMovie,
      sourceUrl.split('/').pop() || `${movieId}.mp4`
    );

    nextMovie = markAssetQueuedForNormalization(nextMovie, timestamp, sourceFileName);
    queuedJobs.push({
      title: nextMovie.title || 'Untitled movie',
      contentType: 'movie',
      sourceFileName,
      sourceUrl,
      target: {
        kind: 'movie',
        movieId,
      },
    });
  }

  nextMovie.parts = (movie.parts || []).map((part, index): MoviePart => {
    if (!shouldQueueDirectUploadNormalization(part)) {
      return part;
    }

    const sourceUrl = getNormalizedSourceUrl(part);
    const sourceFileName = getNormalizedSourceFileName(
      part,
      sourceUrl.split('/').pop() || `${movieId}-part-${index + 1}.mp4`
    );
    const queuedPart = markAssetQueuedForNormalization(part, timestamp, sourceFileName);

    queuedJobs.push({
      title: `${nextMovie.title || 'Untitled movie'} - ${queuedPart.label || `Part ${index + 1}`}`,
      contentType: 'movie',
      sourceFileName,
      sourceUrl,
      target: {
        kind: 'part',
        movieId,
        partId: queuedPart.id,
      },
    });

    return queuedPart;
  });

  nextMovie.seasons = (movie.seasons || []).map((season) => ({
    ...season,
    episodes: (season.episodes || []).map((episode, episodeIndex): Episode => {
      if (!shouldQueueDirectUploadNormalization(episode)) {
        return episode;
      }

      const sourceUrl = getNormalizedSourceUrl(episode);
      const sourceFileName = getNormalizedSourceFileName(
        episode,
        sourceUrl.split('/').pop() ||
          `${movieId}-s${season.seasonNumber}-e${episode.episodeNumber || episodeIndex + 1}.mp4`
      );
      const queuedEpisode = markAssetQueuedForNormalization(episode, timestamp, sourceFileName);

      queuedJobs.push({
        title: `${nextMovie.title || 'Untitled series'} - S${season.seasonNumber}E${
          queuedEpisode.episodeNumber || episodeIndex + 1
        }`,
        contentType: 'series',
        sourceFileName,
        sourceUrl,
        target: {
          kind: 'episode',
          movieId,
          seasonNumber: season.seasonNumber,
          episodeNumber: queuedEpisode.episodeNumber || episodeIndex + 1,
        },
      });

      return queuedEpisode;
    }),
  }));

  return {
    movie: nextMovie,
    queuedJobs,
  };
}

export async function queuePreparedDirectUploadJobs(jobs: PendingNormalizationJob[]) {
  await Promise.all(
    jobs.map((job) =>
      createVideoJob({
        jobType: 'direct_mp4_upload',
        sourcePipeline: 'direct_upload',
        title: job.title,
        contentType: job.contentType,
        sourceType: 'direct_upload',
        sourceFileName: job.sourceFileName,
        sourceUrl: job.sourceUrl,
        target: job.target,
      })
    )
  );
}

export async function listLegacyDirectUploadRepairCandidates(options?: {
  limit?: number;
  scanLimit?: number;
}): Promise<LegacyDirectUploadRepairCandidatesResult> {
  const limit = Math.max(1, Math.min(250, Number(options?.limit || 50)));
  const scanLimit = Math.max(limit, Math.min(250, Number(options?.scanLimit || 100)));
  const snapshot = await adminDb
    .collection(MOVIES_COLLECTION)
    .orderBy('updatedAt', 'desc')
    .limit(scanLimit)
    .get();
  const candidates: LegacyDirectUploadRepairCandidate[] = [];

  for (const doc of snapshot.docs) {
    if (candidates.length >= limit) {
      break;
    }

    const candidate = buildLegacyRepairCandidate(doc.data() as MovieDocument, doc.id);

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return {
    candidates: candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    scannedMovies: snapshot.docs.length,
    scanLimit,
  };
}

export async function queueLegacyDirectUploadRepairs(options?: {
  movieLimit?: number;
  movieIds?: string[];
  scanLimit?: number;
}) {
  const movieLimit = Math.max(1, Math.min(250, Number(options?.movieLimit || 25)));
  const scanLimit = Math.max(movieLimit, Math.min(250, Number(options?.scanLimit || 100)));
  const requestedMovieIds = Array.from(
    new Set(
      (options?.movieIds || [])
        .map((movieId) => String(movieId || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 250);
  const docs = requestedMovieIds.length
    ? await Promise.all(
        requestedMovieIds.map((movieId) =>
          adminDb.collection(MOVIES_COLLECTION).doc(movieId).get()
        )
      )
    : (
        await adminDb
          .collection(MOVIES_COLLECTION)
          .orderBy('updatedAt', 'desc')
          .limit(scanLimit)
          .get()
      ).docs;
  const affectedMovieIds: string[] = [];
  let scannedMovies = 0;
  let updatedMovies = 0;
  let queuedJobs = 0;

  for (const doc of docs) {
    if (updatedMovies >= movieLimit) {
      break;
    }

    scannedMovies += 1;

    if (!doc.exists) {
      continue;
    }

    const movie = doc.data() as MovieDocument;
    const candidate = buildLegacyRepairCandidate(movie, doc.id);

    if (!candidate) {
      continue;
    }

    const preparedMovie = prepareMovieDocumentForDirectUploadProcessing(movie, doc.id);

    if (!preparedMovie.queuedJobs.length) {
      continue;
    }

    await doc.ref.set(preparedMovie.movie, { merge: false });
    await upsertMovieInCatalogCache({
      id: doc.id,
      ...preparedMovie.movie,
    });
    await queuePreparedDirectUploadJobs(preparedMovie.queuedJobs);

    updatedMovies += 1;
    queuedJobs += preparedMovie.queuedJobs.length;
    affectedMovieIds.push(doc.id);
  }

  return {
    scannedMovies,
    updatedMovies,
    queuedJobs,
    affectedMovieIds,
  };
}
