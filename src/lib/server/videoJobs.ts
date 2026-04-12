import fs from 'fs/promises';
import path from 'path';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import type { SourcePipeline, VideoAssetMetadata, VideoJobDocument, VideoJobStatus } from '@/types/videoJobs';
import { ensureVideoWorkspace, removeDirectorySafe } from './fsUtils';
import {
  VIDEO_JOB_LOCK_ID,
  VIDEO_MIN_FREE_DISK_BYTES,
  VIDEO_JOB_STALE_MS,
  VIDEO_JOB_TIMEOUT_MS,
  DIRECT_VIDEO_JOB_TIMEOUT_MS,
  VIDEO_OUTPUT_DIR,
  VIDEO_SOURCE_DIR,
} from './env';
import { transcodeSourceToHls } from './hlsProcessor';
import { downloadRemoteSource } from './downloadSource';
import { uploadDirectoryToR2 } from './r2';
import { getFreeDiskSpace } from './system';
import { prepareDirectMp4Source, uploadDirectMp4Asset } from './directVideoProcessor';
import { upsertMovieInCatalogCache } from './movieCatalogCache';
import {
  MOVIES_COLLECTION,
  VIDEO_JOBS_COLLECTION,
  VIDEO_JOB_RUNTIME_COLLECTION,
} from './firestoreNamespaces';

const CLAIMING_STALE_MS = 30 * 1000;
const IN_FLIGHT_STATUSES: VideoJobStatus[] = [
  'validating',
  'downloading',
  'transcoding',
  'packaging',
  'uploading_source',
  'uploading_hls',
];

function isoNow() {
  return new Date().toISOString();
}

function getRuntimeDoc() {
  return adminDb.collection(VIDEO_JOB_RUNTIME_COLLECTION).doc(VIDEO_JOB_LOCK_ID);
}

function getJobDoc(jobId: string) {
  return adminDb.collection(VIDEO_JOBS_COLLECTION).doc(jobId);
}

export async function listVideoJobs(limit = 50) {
  const snapshot = await adminDb
    .collection(VIDEO_JOBS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as VideoJobDocument) }));
}

export async function appendJobLog(jobId: string, message: string) {
  await getJobDoc(jobId).set(
    {
      updatedAt: isoNow(),
      logs: FieldValue.arrayUnion(`[${isoNow()}] ${message}`),
    },
    { merge: true }
  );
}

export async function updateJobState(
  jobId: string,
  state: Partial<VideoJobDocument> & { status?: VideoJobStatus; progress?: number }
) {
  await getJobDoc(jobId).set(
    {
      ...state,
      updatedAt: isoNow(),
    },
    { merge: true }
  );
}

export async function createVideoJob(
  job: Omit<VideoJobDocument, 'id' | 'queueOrder' | 'createdAt' | 'updatedAt' | 'status' | 'progress'>,
  options?: { id?: string }
) {
  await ensureVideoWorkspace();
  const jobRef = options?.id
    ? adminDb.collection(VIDEO_JOBS_COLLECTION).doc(options.id)
    : adminDb.collection(VIDEO_JOBS_COLLECTION).doc();
  const now = isoNow();

  await jobRef.set({
    ...job,
    queueOrder: Date.now(),
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    logs: [`[${now}] Job queued.`],
  });

  return jobRef.id;
}

export async function retryVideoJob(jobId: string) {
  await getJobDoc(jobId).set(
    {
      status: 'queued',
      progress: 0,
      errorMessage: '',
      updatedAt: isoNow(),
      retryCount: FieldValue.increment(1),
      logs: FieldValue.arrayUnion(`[${isoNow()}] Job retried.`),
    },
    { merge: true }
  );
}

export async function cancelVideoJob(jobId: string) {
  await getJobDoc(jobId).set(
    {
      status: 'cancelled',
      updatedAt: isoNow(),
      logs: FieldValue.arrayUnion(`[${isoNow()}] Job cancelled.`),
    },
    { merge: true }
  );
}

async function acquireWorkerLease() {
  const runtimeRef = getRuntimeDoc();

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runtimeRef);
    const now = Date.now();
    const data = snapshot.data() as { activeJobId?: string; heartbeatAt?: string } | undefined;
    const heartbeatAt = data?.heartbeatAt ? new Date(data.heartbeatAt).getTime() : 0;
    const activeJobId = data?.activeJobId || '';
    const staleWindow = activeJobId === '__claiming__' ? CLAIMING_STALE_MS : VIDEO_JOB_STALE_MS;

    if (activeJobId && now - heartbeatAt < staleWindow) {
      return false;
    }

    transaction.set(runtimeRef, { activeJobId: '__claiming__', heartbeatAt: isoNow() }, { merge: true });
    return true;
  });
}

async function releaseWorkerLease() {
  await getRuntimeDoc().set({ activeJobId: '', heartbeatAt: isoNow() }, { merge: true });
}

async function recoverStaleInFlightJobs() {
  const snapshot = await adminDb
    .collection(VIDEO_JOBS_COLLECTION)
    .where('status', 'in', IN_FLIGHT_STATUSES)
    .limit(25)
    .get();

  if (snapshot.empty) {
    return;
  }

  const now = Date.now();
  const staleDocs = snapshot.docs.filter((doc) => {
    const data = doc.data() as VideoJobDocument;
    const timeoutAt = data.timeoutAt ? new Date(data.timeoutAt).getTime() : 0;
    const updatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;

    if (timeoutAt && timeoutAt <= now) {
      return true;
    }

    return !updatedAt || now - updatedAt >= VIDEO_JOB_STALE_MS;
  });

  if (!staleDocs.length) {
    return;
  }

  const timestamp = isoNow();

  await Promise.all(
    staleDocs.map((doc) =>
      doc.ref.set(
        {
          status: 'queued',
          progress: 0,
          errorMessage: '',
          startedAt: '',
          timeoutAt: '',
          updatedAt: timestamp,
          logs: FieldValue.arrayUnion(`[${timestamp}] Worker recovered a stale in-flight job and re-queued it.`),
        },
        { merge: true }
      )
    )
  );
}

async function recoverOldestInFlightJob() {
  const snapshot = await adminDb
    .collection(VIDEO_JOBS_COLLECTION)
    .where('status', 'in', IN_FLIGHT_STATUSES)
    .limit(25)
    .get();

  if (snapshot.empty) {
    return false;
  }

  const oldest = snapshot.docs.sort((first, second) => {
    const firstData = first.data() as VideoJobDocument;
    const secondData = second.data() as VideoJobDocument;
    const firstStarted = firstData.startedAt ? new Date(firstData.startedAt).getTime() : 0;
    const secondStarted = secondData.startedAt ? new Date(secondData.startedAt).getTime() : 0;
    const firstUpdated = firstData.updatedAt ? new Date(firstData.updatedAt).getTime() : 0;
    const secondUpdated = secondData.updatedAt ? new Date(secondData.updatedAt).getTime() : 0;

    return (firstStarted || firstUpdated || 0) - (secondStarted || secondUpdated || 0);
  })[0];

  if (!oldest) {
    return false;
  }

  const timestamp = isoNow();

  await oldest.ref.set(
    {
      status: 'queued',
      progress: 0,
      errorMessage: '',
      updatedAt: timestamp,
      logs: FieldValue.arrayUnion(
        `[${timestamp}] Worker reclaimed an in-flight job that was left without active progress.`
      ),
    },
    { merge: true }
  );

  return true;
}

async function claimNextQueuedJob() {
  const leaseAcquired = await acquireWorkerLease();

  if (!leaseAcquired) {
    return null;
  }

  await recoverStaleInFlightJobs();

  const snapshot = await adminDb
    .collection(VIDEO_JOBS_COLLECTION)
    .where('status', '==', 'queued')
    .limit(25)
    .get();

  if (snapshot.empty) {
    const recovered = await recoverOldestInFlightJob();

    if (recovered) {
      await releaseWorkerLease();
      return claimNextQueuedJob();
    }

    await releaseWorkerLease();
    return null;
  }

  const nextJob = snapshot.docs.sort((first, second) => {
    const firstOrder = Number(first.data().queueOrder || 0);
    const secondOrder = Number(second.data().queueOrder || 0);
    return firstOrder - secondOrder;
  })[0];
  const now = isoNow();

  await Promise.all([
    nextJob.ref.set(
      {
        status: 'validating',
        progress: 5,
        startedAt: now,
        timeoutAt: new Date(Date.now() + VIDEO_JOB_TIMEOUT_MS).toISOString(),
        updatedAt: now,
        logs: FieldValue.arrayUnion(`[${now}] Job claimed by worker.`),
      },
      { merge: true }
    ),
    getRuntimeDoc().set(
      {
        activeJobId: nextJob.id,
        heartbeatAt: now,
      },
      { merge: true }
    ),
  ]);

  return {
    id: nextJob.id,
    ...(nextJob.data() as VideoJobDocument),
  };
}

async function touchWorkerHeartbeat(jobId: string) {
  await getRuntimeDoc().set({ activeJobId: jobId, heartbeatAt: isoNow() }, { merge: true });
}

function getJobWorkspace(jobId: string) {
  return {
    sourceDirectory: path.join(VIDEO_SOURCE_DIR, jobId),
    outputDirectory: path.join(VIDEO_OUTPUT_DIR, jobId),
  };
}

function buildR2Prefix(job: VideoJobDocument) {
  if (job.target.kind === 'movie') {
    return `movies/${job.target.movieId}/hls`;
  }

  return `series/${job.target.movieId}/season-${job.target.seasonNumber}/episode-${job.target.episodeNumber}/hls`;
}

async function patchMovieAsset(target: VideoJobDocument['target'], asset: VideoAssetMetadata) {
  const movieRef = adminDb.collection(MOVIES_COLLECTION).doc(target.movieId);
  const movieSnapshot = await movieRef.get();
  const shouldRefreshCatalogCache =
    asset.jobStatus === 'ready' || Boolean(asset.video_url || asset.masterPlaylistUrl);

  if (!movieSnapshot.exists) {
    throw new Error(`Movie ${target.movieId} no longer exists.`);
  }

  if (target.kind === 'movie') {
    await movieRef.set(asset, { merge: true });

    if (shouldRefreshCatalogCache) {
      await upsertMovieInCatalogCache({
        id: target.movieId,
        ...(movieSnapshot.data() || {}),
        ...asset,
      });
    }

    return;
  }

  const movieData = movieSnapshot.data() as { seasons?: Array<Record<string, unknown>> };
  const seasons = Array.isArray(movieData.seasons) ? movieData.seasons : [];
  const cacheUpdatedAt = isoNow();

  const updatedSeasons = seasons.map((season) => {
    if (Number(season.seasonNumber) !== target.seasonNumber) {
      return season;
    }

    const episodes = Array.isArray(season.episodes) ? season.episodes : [];

    return {
      ...season,
      episodes: episodes.map((episode) =>
        Number((episode as Record<string, unknown>).episodeNumber) === target.episodeNumber
          ? {
              ...episode,
              ...asset,
              updatedAt: isoNow(),
            }
          : episode
      ),
    };
  });

  await movieRef.set({ seasons: updatedSeasons, updatedAt: cacheUpdatedAt }, { merge: true });

  if (shouldRefreshCatalogCache) {
    await upsertMovieInCatalogCache({
      id: target.movieId,
      ...movieData,
      seasons: updatedSeasons,
      updatedAt: cacheUpdatedAt,
    });
  }
}

function inferSourcePipeline(job: VideoJobDocument): SourcePipeline {
  if (job.sourcePipeline) {
    return job.sourcePipeline;
  }

  if (job.jobType === 'remote_mkv_to_mp4') {
    return 'remote_mkv_to_mp4';
  }

  if (job.jobType === 'direct_mp4_upload') {
    return job.sourceType === 'remote_link' ? 'remote_mp4_ingest' : 'direct_upload';
  }

  return 'hls_pipeline';
}

async function resolveLocalSource(job: VideoJobDocument) {
  const { sourceDirectory } = getJobWorkspace(job.id!);
  await fs.mkdir(sourceDirectory, { recursive: true });

  if (job.sourceUrl && (job.sourceType === 'remote_link' || job.sourceType === 'direct_upload')) {
    await updateJobState(job.id!, { status: 'downloading', progress: 12 });
    await appendJobLog(job.id!, 'Downloading remote source.');
    const sourceFileName = job.sourceFileName || `${job.id}.mp4`;
    const targetPath = path.join(sourceDirectory, sourceFileName);
    return downloadRemoteSource(job.sourceUrl || '', targetPath);
  }

  if (!job.localSourcePath) {
    throw new Error('Uploaded source file path is missing.');
  }

  const stats = await fs.stat(job.localSourcePath);
  return {
    path: job.localSourcePath,
    fileSizeBytes: stats.size,
    sourceFileName: job.sourceFileName || path.basename(job.localSourcePath),
  };
}

export async function processNextVideoJob() {
  const job = await claimNextQueuedJob();

  if (!job) {
    console.log('[video-worker] no queued job claimed');
    return { processed: false };
  }

  console.log('[video-worker] claimed job', {
    jobId: job.id,
    title: job.title,
    sourceType: job.sourceType,
    target: job.target,
  });

  const workspace = getJobWorkspace(job.id!);
  let localSourcePath = '';

  try {
    const freeDiskSpace = await getFreeDiskSpace(process.cwd());

    if (freeDiskSpace < VIDEO_MIN_FREE_DISK_BYTES) {
      throw new Error('Not enough disk space available to start processing this job.');
    }

    await touchWorkerHeartbeat(job.id!);
    const source = await resolveLocalSource(job);
    localSourcePath = source.path;
    console.log('[video-worker] source ready', {
      jobId: job.id,
      localSourcePath,
      fileSizeBytes: source.fileSizeBytes,
    });

    await patchMovieAsset(job.target, {
      sourceType: job.sourceType,
      sourcePipeline: inferSourcePipeline(job),
      sourceFileName: source.sourceFileName,
      sourceUrl: job.sourceUrl || '',
      fileSizeBytes: source.fileSizeBytes,
      jobStatus: job.jobType === 'hls_transcode' || !job.jobType ? 'transcoding' : 'downloading',
      processingProgress: 20,
      updatedAt: isoNow(),
    });

    if ((job.jobType || 'hls_transcode') === 'hls_transcode') {
      await updateJobState(job.id!, { status: 'transcoding', progress: 25 });
      await appendJobLog(job.id!, 'Starting HLS transcoding.');
      await touchWorkerHeartbeat(job.id!);
      console.log('[video-worker] transcoding started', { jobId: job.id });

      const transcoded = await transcodeSourceToHls(localSourcePath, workspace.outputDirectory, VIDEO_JOB_TIMEOUT_MS);
      console.log('[video-worker] transcoding finished', {
        jobId: job.id,
        renditions: transcoded.availableRenditions.map((rendition) => rendition.name),
      });

      await updateJobState(job.id!, { status: 'uploading_hls', progress: 78 });
      await appendJobLog(job.id!, 'Uploading HLS assets to R2.');
      await touchWorkerHeartbeat(job.id!);
      console.log('[video-worker] uploading HLS to R2', { jobId: job.id });

      const uploadedFiles = await uploadDirectoryToR2(workspace.outputDirectory, buildR2Prefix(job), {
        concurrency: 6,
        onProgress: async ({ uploaded, total, key }) => {
          const progress = Math.min(98, 78 + Math.round((uploaded / Math.max(total, 1)) * 20));

          await Promise.all([
            updateJobState(job.id!, { status: 'uploading_hls', progress }),
            patchMovieAsset(job.target, {
              jobStatus: 'uploading_hls',
              processingProgress: progress,
              updatedAt: isoNow(),
            }),
            touchWorkerHeartbeat(job.id!),
          ]);

          if (uploaded === 1 || uploaded === total || uploaded % 25 === 0) {
            console.log('[video-worker] upload progress', {
              jobId: job.id,
              uploaded,
              total,
              latestKey: key,
            });
          }
        },
      });
      const masterPlaylistUrl =
        uploadedFiles.find((file) => file.key.endsWith('master.m3u8'))?.publicUrl || '';

      const renditions = transcoded.availableRenditions.map((rendition) => ({
        ...rendition,
        playlistUrl:
          uploadedFiles.find((file) => file.key.endsWith(`${rendition.name}/index.m3u8`))?.publicUrl || '',
      }));

      const assetMetadata: VideoAssetMetadata = {
        sourceType: job.sourceType,
        sourcePipeline: 'hls_pipeline',
        sourceFileName: source.sourceFileName,
        sourceUrl: job.sourceUrl || '',
        jobStatus: 'ready',
        processingProgress: 100,
        playbackType: 'hls',
        masterPlaylistUrl,
        availableRenditions: renditions,
        durationSeconds: transcoded.durationSeconds,
        videoResolution: transcoded.videoResolution,
        fileSizeBytes: source.fileSizeBytes,
        processedAt: isoNow(),
        updatedAt: isoNow(),
      };

      await patchMovieAsset(job.target, assetMetadata);
      await updateJobState(job.id!, {
        status: 'ready',
        progress: 100,
        processedAt: isoNow(),
        output: {
          playbackType: 'hls',
          masterPlaylistUrl,
          availableRenditions: renditions,
          durationSeconds: transcoded.durationSeconds,
          resolution: transcoded.videoResolution,
          fileSizeBytes: source.fileSizeBytes,
        },
      });
      await appendJobLog(job.id!, 'Job completed successfully.');
      console.log('[video-worker] job completed', { jobId: job.id, masterPlaylistUrl });
    } else {
      const directPipeline = inferSourcePipeline(job);

      await updateJobState(job.id!, { status: 'packaging', progress: 40 });
      await appendJobLog(
        job.id!,
        directPipeline === 'remote_mkv_to_mp4'
          ? 'Converting source to MP4.'
          : 'Preparing direct MP4 asset.'
      );
      await touchWorkerHeartbeat(job.id!);

      const directPrepared = await prepareDirectMp4Source({
        sourcePath: localSourcePath,
        outputDirectory: workspace.outputDirectory,
        timeoutMs: DIRECT_VIDEO_JOB_TIMEOUT_MS,
      });

      await updateJobState(job.id!, { status: 'uploading_source', progress: 78 });
      await appendJobLog(job.id!, 'Uploading direct MP4 asset to R2.');
      await touchWorkerHeartbeat(job.id!);

      const uploadedMp4 = await uploadDirectMp4Asset({
        localMp4Path: directPrepared.outputPath,
        target: job.target,
      });

      const assetMetadata: VideoAssetMetadata = {
        sourceType: job.sourceType,
        sourcePipeline: directPipeline,
        sourceFileName: path.basename(directPrepared.outputPath),
        sourceUrl: job.sourceUrl || '',
        video_url: uploadedMp4.publicUrl,
        jobStatus: 'ready',
        processingProgress: 100,
        playbackType: 'mp4',
        masterPlaylistUrl: '',
        availableRenditions: [],
        durationSeconds: directPrepared.durationSeconds,
        videoResolution: directPrepared.videoResolution,
        fileSizeBytes: directPrepared.fileSizeBytes,
        processedAt: isoNow(),
        updatedAt: isoNow(),
      };

      await patchMovieAsset(job.target, assetMetadata);

      await updateJobState(job.id!, {
        status: 'ready',
        progress: 100,
        processedAt: isoNow(),
        output: {
          playbackType: 'mp4',
          durationSeconds: directPrepared.durationSeconds,
          resolution: directPrepared.videoResolution,
          fileSizeBytes: directPrepared.fileSizeBytes,
        },
      });
      await appendJobLog(job.id!, 'Direct MP4 job completed successfully.');
      console.log('[video-worker] direct job completed', {
        jobId: job.id,
        playbackUrl: uploadedMp4.publicUrl,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown processing error.';
    console.error('[video-worker] job failed', { jobId: job.id, message, error });
    await updateJobState(job.id!, { status: 'failed', progress: 0, errorMessage: message });
    await patchMovieAsset(job.target, {
      jobStatus: 'failed',
      processingProgress: 0,
      errorMessage: message,
      updatedAt: isoNow(),
    }).catch(() => undefined);
    await appendJobLog(job.id!, `Job failed: ${message}`);
  } finally {
    await removeDirectorySafe(workspace.outputDirectory);
    await removeDirectorySafe(workspace.sourceDirectory);

    await releaseWorkerLease();
  }

  return { processed: true, jobId: job.id };
}
