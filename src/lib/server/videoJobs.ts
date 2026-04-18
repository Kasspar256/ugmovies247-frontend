import fs from 'fs/promises';
import path from 'path';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import type {
  SourcePipeline,
  VideoAssetMetadata,
  VideoJobDocument,
  VideoJobStatus,
} from '@/types/videoJobs';
import { ensureVideoWorkspace, removeDirectorySafe } from './fsUtils';
import {
  DIRECT_URL_IMPORT_MAX_FILE_SIZE_BYTES,
  DIRECT_VIDEO_JOB_TIMEOUT_MS,
  VIDEO_JOB_AUTO_RETRY_LIMIT,
  VIDEO_JOB_LOCK_ID,
  VIDEO_JOB_RETRY_BASE_DELAY_MS,
  VIDEO_JOB_STALE_MS,
  VIDEO_JOB_TIMEOUT_MS,
  VIDEO_MIN_FREE_DISK_BYTES,
  VIDEO_OUTPUT_DIR,
  VIDEO_REQUIRED_FREE_SPACE_MULTIPLIER,
  VIDEO_SOURCE_DIR,
} from './env';
import {
  downloadRemoteSource,
  isSupportedInputMp4Format,
  type RemoteDownloadProgress,
} from './downloadSource';
import { getFreeDiskSpace } from './system';
import {
  inspectDirectVideoSource,
  prepareDirectMp4Source,
  uploadDirectMp4Asset,
} from './directVideoProcessor';
import { upsertMovieInCatalogCache } from './movieCatalogCache';
import {
  MOVIES_COLLECTION,
  VIDEO_JOBS_COLLECTION,
  VIDEO_JOB_RUNTIME_COLLECTION,
} from './firestoreNamespaces';

const CLAIMING_STALE_MS = 30 * 1000;
const IN_FLIGHT_STATUSES: VideoJobStatus[] = [
  'downloading',
  'inspecting',
  'processing',
  'uploading',
];
const TERMINAL_JOB_STATUSES: VideoJobStatus[] = ['ready', 'failed'];
const ADMIN_CANCELLED_MESSAGE = 'Cancelled by admin.';

function isoNow() {
  return new Date().toISOString();
}

function getRuntimeDoc() {
  return adminDb.collection(VIDEO_JOB_RUNTIME_COLLECTION).doc(VIDEO_JOB_LOCK_ID);
}

function getJobDoc(jobId: string) {
  return adminDb.collection(VIDEO_JOBS_COLLECTION).doc(jobId);
}

function getRetryDelayMs(currentRetryCount: number) {
  return VIDEO_JOB_RETRY_BASE_DELAY_MS * Math.max(1, 2 ** currentRetryCount);
}

function isTransientJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');

  return /timed out|timeout|stalled|temporar|temporarily|econnreset|etimedout|eai_again|fetch failed|socket hang up|503|502|504|429|connection reset|network/i.test(
    message
  );
}

function isCancellationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /cancelled by admin/i.test(message);
}

function getJobWorkspace(jobId: string) {
  return {
    sourceDirectory: path.join(VIDEO_SOURCE_DIR, jobId),
    outputDirectory: path.join(VIDEO_OUTPUT_DIR, jobId),
  };
}

async function readJob(jobId: string) {
  const snapshot = await getJobDoc(jobId).get();

  if (!snapshot.exists) {
    throw new Error(`Video job ${jobId} no longer exists.`);
  }

  return {
    id: snapshot.id,
    ...(snapshot.data() as VideoJobDocument),
  };
}

async function throwIfJobWasCancelled(jobId: string) {
  const job = await readJob(jobId);

  if (job.status === 'failed' && job.errorMessage === ADMIN_CANCELLED_MESSAGE) {
    throw new Error(ADMIN_CANCELLED_MESSAGE);
  }
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
      workerHeartbeatAt: isoNow(),
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
      workerHeartbeatAt: isoNow(),
    },
    { merge: true }
  );
}

export async function createVideoJob(
  job: Omit<
    VideoJobDocument,
    'id' | 'queueOrder' | 'createdAt' | 'updatedAt' | 'status' | 'progress'
  >,
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
    downloadedBytes: 0,
    downloadTotalBytes: 0,
    downloadProgressPercent: null,
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    workerHeartbeatAt: '',
    logs: [`[${now}] Job queued.`],
  });

  return jobRef.id;
}

export async function retryVideoJob(jobId: string) {
  await getJobDoc(jobId).set(
    {
      status: 'queued',
      progress: 0,
      downloadedBytes: 0,
      downloadTotalBytes: 0,
      downloadProgressPercent: null,
      queueOrder: Date.now(),
      errorMessage: '',
      startedAt: '',
      timeoutAt: '',
      workerHeartbeatAt: '',
      updatedAt: isoNow(),
      retryCount: FieldValue.increment(1),
      logs: FieldValue.arrayUnion(`[${isoNow()}] Job retried manually.`),
    },
    { merge: true }
  );
}

export async function cancelVideoJob(jobId: string) {
  await getJobDoc(jobId).set(
    {
      status: 'failed',
      progress: 0,
      downloadedBytes: 0,
      downloadTotalBytes: 0,
      downloadProgressPercent: null,
      errorMessage: ADMIN_CANCELLED_MESSAGE,
      timeoutAt: '',
      updatedAt: isoNow(),
      workerHeartbeatAt: '',
      logs: FieldValue.arrayUnion(`[${isoNow()}] Cancel requested by admin.`),
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

    if (activeJobId) {
      if (activeJobId !== '__claiming__') {
        const activeJobSnapshot = await transaction.get(getJobDoc(activeJobId));
        const activeJobStatus = activeJobSnapshot.exists
          ? ((activeJobSnapshot.data()?.status as VideoJobStatus | undefined) || undefined)
          : undefined;
        const activeJobIsTerminal =
          !activeJobSnapshot.exists ||
          (activeJobStatus ? TERMINAL_JOB_STATUSES.includes(activeJobStatus) : false);
        const activeJobNotInFlight =
          Boolean(activeJobStatus) && !IN_FLIGHT_STATUSES.includes(activeJobStatus);

        if (!activeJobIsTerminal && !activeJobNotInFlight && now - heartbeatAt < staleWindow) {
          return false;
        }
      } else if (now - heartbeatAt < staleWindow) {
        return false;
      }
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
    const heartbeatAt = data.workerHeartbeatAt ? new Date(data.workerHeartbeatAt).getTime() : 0;
    const updatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;

    if (timeoutAt && timeoutAt <= now) {
      return true;
    }

    const lastTouch = Math.max(heartbeatAt || 0, updatedAt || 0);
    return !lastTouch || now - lastTouch >= VIDEO_JOB_STALE_MS;
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
          workerHeartbeatAt: '',
          updatedAt: timestamp,
          queueOrder: Date.now(),
          logs: FieldValue.arrayUnion(
            `[${timestamp}] Worker recovered a stale in-flight job and re-queued it.`
          ),
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
      startedAt: '',
      timeoutAt: '',
      workerHeartbeatAt: '',
      queueOrder: Date.now(),
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

  const availableJobs = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as VideoJobDocument) }))
    .filter((job) => Number(job.queueOrder || 0) <= Date.now())
    .sort((first, second) => Number(first.queueOrder || 0) - Number(second.queueOrder || 0));

  if (!availableJobs.length) {
    const recovered = await recoverOldestInFlightJob();

    if (recovered) {
      await releaseWorkerLease();
      return claimNextQueuedJob();
    }

    await releaseWorkerLease();
    return null;
  }

  const nextJob = availableJobs[0];
  const now = isoNow();

  await Promise.all([
    getJobDoc(nextJob.id!).set(
      {
        status: 'downloading',
        progress: 8,
        startedAt: now,
        timeoutAt: new Date(Date.now() + VIDEO_JOB_TIMEOUT_MS).toISOString(),
        updatedAt: now,
        workerHeartbeatAt: now,
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

  return nextJob;
}

async function touchWorkerHeartbeat(jobId: string) {
  const now = isoNow();

  await Promise.all([
    getRuntimeDoc().set({ activeJobId: jobId, heartbeatAt: now }, { merge: true }),
    getJobDoc(jobId).set({ workerHeartbeatAt: now, updatedAt: now }, { merge: true }),
  ]);
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

  if (target.kind === 'part') {
    const movieData = movieSnapshot.data() as { parts?: Array<Record<string, unknown>> };
    const parts = Array.isArray(movieData.parts) ? movieData.parts : [];
    const cacheUpdatedAt = isoNow();

    const updatedParts = parts.map((part) =>
      String(part.id || '') === target.partId
        ? {
            ...part,
            ...asset,
            updatedAt: cacheUpdatedAt,
          }
        : part
    );
    const primaryPart = updatedParts[0] as Record<string, unknown> | undefined;

    await movieRef.set(
      {
        parts: updatedParts,
        video_url: String(primaryPart?.video_url || ''),
        sourceUrl: String(primaryPart?.sourceUrl || primaryPart?.video_url || ''),
        sourceFileName: String(primaryPart?.sourceFileName || ''),
        updatedAt: cacheUpdatedAt,
      },
      { merge: true }
    );

    if (shouldRefreshCatalogCache) {
      await upsertMovieInCatalogCache({
        id: target.movieId,
        ...movieData,
        parts: updatedParts,
        video_url: String(primaryPart?.video_url || ''),
        sourceUrl: String(primaryPart?.sourceUrl || primaryPart?.video_url || ''),
        sourceFileName: String(primaryPart?.sourceFileName || ''),
        updatedAt: cacheUpdatedAt,
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
    return job.sourcePipeline === 'hls_pipeline'
      ? job.sourceType === 'direct_url'
        ? 'direct_url_import'
        : job.sourceType === 'remote_link'
          ? 'remote_mp4_ingest'
          : 'direct_upload'
      : job.sourcePipeline;
  }

  if (job.jobType === 'remote_mkv_to_mp4') {
    return 'remote_mkv_to_mp4';
  }

  if (job.jobType === 'direct_url_import') {
    return 'direct_url_import';
  }

  if (job.jobType === 'direct_mp4_upload') {
    return job.sourceType === 'direct_url'
      ? 'direct_url_import'
      : job.sourceType === 'remote_link'
        ? 'remote_mp4_ingest'
        : 'direct_upload';
  }

  return job.sourceType === 'direct_url'
    ? 'direct_url_import'
    : job.sourceType === 'remote_link'
      ? 'remote_mp4_ingest'
      : 'direct_upload';
}

async function updateLinkedAssetStage(
  job: VideoJobDocument,
  status: VideoJobStatus,
  progress: number,
  metadata?: Partial<VideoAssetMetadata>
) {
  const assetMetadata: VideoAssetMetadata = {
    sourceType: job.sourceType,
    sourcePipeline: inferSourcePipeline(job),
    sourceFileName: job.sourceFileName || '',
    sourceUrl: job.sourceUrl || '',
    jobStatus: status,
    processingProgress: progress,
    errorMessage: status === 'failed' ? metadata?.errorMessage || '' : '',
    updatedAt: isoNow(),
    ...metadata,
  };

  await patchMovieAsset(job.target, assetMetadata);
}

async function resolveLocalSource(
  job: VideoJobDocument,
  options?: { onProgress?: (progress: RemoteDownloadProgress) => void | Promise<void> }
) {
  const { sourceDirectory } = getJobWorkspace(job.id!);
  await fs.mkdir(sourceDirectory, { recursive: true });

  if (
    job.sourceUrl &&
    (job.sourceType === 'remote_link' ||
      job.sourceType === 'direct_upload' ||
      job.sourceType === 'direct_url')
  ) {
    await appendJobLog(job.id!, 'Downloading source file to the VPS workspace.');
    const sourceFileName = job.sourceFileName || `${job.id}.mp4`;
    const targetPath = path.join(sourceDirectory, sourceFileName);

    return downloadRemoteSource(job.sourceUrl || '', targetPath, {
      maxFileSizeBytes:
        job.sourceType === 'direct_url' ? DIRECT_URL_IMPORT_MAX_FILE_SIZE_BYTES : undefined,
      onProgress: options?.onProgress,
    });
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

async function ensureDiskSafetyBeforeProcessing(sourceFileSizeBytes: number) {
  const freeDiskSpace = await getFreeDiskSpace(process.cwd());
  const requiredBytes =
    VIDEO_MIN_FREE_DISK_BYTES +
    Math.ceil(sourceFileSizeBytes * Math.max(1, VIDEO_REQUIRED_FREE_SPACE_MULTIPLIER));

  if (freeDiskSpace < requiredBytes) {
    throw new Error(
      'Not enough free disk space is available to safely process this movie right now.'
    );
  }
}

async function inspectImportedMp4(localSourcePath: string) {
  let inspection;

  try {
    inspection = await inspectDirectVideoSource(localSourcePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown media inspection failure.';
    throw new Error(
      `The downloaded file could not be parsed as a valid MP4 on the VPS. ${message}`
    );
  }

  if (!isSupportedInputMp4Format(inspection.formatName || '')) {
    throw new Error(
      `The downloaded source was not a usable MP4 container. Detected format: ${inspection.formatName || 'unknown'}. Only direct MP4 links are supported right now.`
    );
  }

  return inspection;
}

async function scheduleJobRetry(job: VideoJobDocument, message: string) {
  const currentRetryCount = Number(job.retryCount || 0);

  if (currentRetryCount >= VIDEO_JOB_AUTO_RETRY_LIMIT) {
    return false;
  }

  const nextRetryCount = currentRetryCount + 1;
  const delayMs = getRetryDelayMs(currentRetryCount);
  const retryAt = Date.now() + delayMs;
  const timestamp = isoNow();
  const retryMessage = `Transient failure. Retry ${nextRetryCount}/${VIDEO_JOB_AUTO_RETRY_LIMIT} scheduled in ${Math.round(
    delayMs / 1000
  )} seconds.`;

  await getJobDoc(job.id!).set(
    {
      status: 'queued',
      progress: 0,
      queueOrder: retryAt,
      retryCount: nextRetryCount,
      errorMessage: retryMessage,
      timeoutAt: '',
      workerHeartbeatAt: '',
      updatedAt: timestamp,
      logs: FieldValue.arrayUnion(`[${timestamp}] ${retryMessage} Original error: ${message}`),
    },
    { merge: true }
  );
  await updateLinkedAssetStage(job, 'queued', 0, {
    errorMessage: retryMessage,
    video_url: '',
    processedAt: '',
  }).catch(() => undefined);

  return true;
}

export async function processNextVideoJob() {
  const job = await claimNextQueuedJob();

  if (!job) {
    return { processed: false };
  }

  const workspace = getJobWorkspace(job.id!);

  try {
    await touchWorkerHeartbeat(job.id!);
    await updateJobState(job.id!, {
      status: 'downloading',
      progress: 10,
      downloadedBytes: 0,
      downloadTotalBytes: 0,
      downloadProgressPercent: null,
    });
    await updateLinkedAssetStage(job, 'downloading', 10, {
      video_url: '',
      processedAt: '',
      errorMessage: '',
    });

    let lastDownloadProgress = 10;
    let lastDownloadUpdateAt = 0;
    const handleDownloadProgress = async (progress: RemoteDownloadProgress) => {
      const now = Date.now();
      const nextProgress =
        typeof progress.progressPercent === 'number'
          ? Math.max(10, Math.min(34, 10 + Math.round(progress.progressPercent * 0.24)))
          : lastDownloadProgress;
      const shouldWrite =
        nextProgress > lastDownloadProgress ||
        now - lastDownloadUpdateAt >= 5000 ||
        progress.progressPercent === 100;

      if (!shouldWrite) {
        return;
      }

      lastDownloadProgress = Math.max(lastDownloadProgress, nextProgress);
      lastDownloadUpdateAt = now;

      await updateJobState(job.id!, {
        status: 'downloading',
        progress: lastDownloadProgress,
        downloadedBytes: progress.downloadedBytes,
        downloadTotalBytes: progress.totalBytes || 0,
        downloadProgressPercent:
          typeof progress.progressPercent === 'number' ? progress.progressPercent : null,
      });
    };

    const source = await resolveLocalSource(job, {
      onProgress: handleDownloadProgress,
    });
    await throwIfJobWasCancelled(job.id!);
    await touchWorkerHeartbeat(job.id!);
    await appendJobLog(
      job.id!,
      `Source download completed (${Math.round(source.fileSizeBytes / (1024 * 1024))} MB).`
    );

    await ensureDiskSafetyBeforeProcessing(source.fileSizeBytes);
    await updateJobState(job.id!, {
      status: 'inspecting',
      progress: 35,
      downloadedBytes: source.fileSizeBytes,
      downloadTotalBytes: source.fileSizeBytes,
      downloadProgressPercent: 100,
    });
    await updateLinkedAssetStage(job, 'inspecting', 35, {
      sourceFileName: source.sourceFileName,
      fileSizeBytes: source.fileSizeBytes,
      errorMessage: '',
    });
    await appendJobLog(job.id!, 'Inspecting the downloaded MP4 source.');

    const sourceInspection = await inspectImportedMp4(source.path);
    await throwIfJobWasCancelled(job.id!);
    await touchWorkerHeartbeat(job.id!);
    await appendJobLog(
      job.id!,
      `Detected source format ${sourceInspection.formatName || 'unknown'} with video codec ${sourceInspection.codecName || 'unknown'}${sourceInspection.audioCodecName ? ` and audio codec ${sourceInspection.audioCodecName}` : ''}.`
    );

    await updateJobState(job.id!, { status: 'processing', progress: 60 });
    await updateLinkedAssetStage(job, 'processing', 60, {
      sourceFileName: source.sourceFileName,
      fileSizeBytes: sourceInspection.fileSizeBytes || source.fileSizeBytes,
      durationSeconds: sourceInspection.durationSeconds,
      videoResolution: sourceInspection.videoResolution,
      errorMessage: '',
    });
    await appendJobLog(
      job.id!,
      sourceInspection.isSafariCompatibleMp4
        ? 'Applying light MP4 normalization for streaming playback.'
        : 'Processing the MP4 for wider browser and mobile compatibility.'
    );

    const preparedMp4 = await prepareDirectMp4Source({
      sourcePath: source.path,
      outputDirectory: workspace.outputDirectory,
      timeoutMs: DIRECT_VIDEO_JOB_TIMEOUT_MS,
    });
    await throwIfJobWasCancelled(job.id!);
    await touchWorkerHeartbeat(job.id!);

    await updateJobState(job.id!, { status: 'uploading', progress: 85 });
    await updateLinkedAssetStage(job, 'uploading', 85, {
      sourceFileName: path.basename(preparedMp4.outputPath),
      fileSizeBytes: preparedMp4.fileSizeBytes,
      durationSeconds: preparedMp4.durationSeconds,
      videoResolution: preparedMp4.videoResolution,
      errorMessage: '',
    });
    await appendJobLog(job.id!, 'Uploading the final MP4 to Cloudflare R2.');

    const uploadedMp4 = await uploadDirectMp4Asset({
      localMp4Path: preparedMp4.outputPath,
      target: job.target,
    });
    await throwIfJobWasCancelled(job.id!);

    const assetMetadata: VideoAssetMetadata = {
      sourceType: job.sourceType,
      sourcePipeline: inferSourcePipeline(job),
      sourceFileName: path.basename(preparedMp4.outputPath),
      sourceUrl: job.sourceUrl || '',
      video_url: uploadedMp4.publicUrl,
      jobStatus: 'ready',
      processingProgress: 100,
      playbackType: 'mp4',
      masterPlaylistUrl: '',
      availableRenditions: [],
      durationSeconds: preparedMp4.durationSeconds,
      videoResolution: preparedMp4.videoResolution,
      fileSizeBytes: preparedMp4.fileSizeBytes,
      processedAt: isoNow(),
      updatedAt: isoNow(),
      errorMessage: '',
    };

    await patchMovieAsset(job.target, assetMetadata);
    await updateJobState(job.id!, {
      status: 'ready',
      progress: 100,
      errorMessage: '',
      processedAt: isoNow(),
      timeoutAt: '',
      output: {
        playbackType: 'mp4',
        durationSeconds: preparedMp4.durationSeconds,
        resolution: preparedMp4.videoResolution,
        fileSizeBytes: preparedMp4.fileSizeBytes,
        r2ObjectKey: uploadedMp4.key,
        playbackUrl: uploadedMp4.publicUrl,
      },
    });
    await appendJobLog(job.id!, 'Movie import completed and is ready for playback from R2.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown processing error.';

    if (!isCancellationError(error) && isTransientJobError(error) && (await scheduleJobRetry(job, message))) {
      return { processed: true, jobId: job.id, retried: true };
    }

    await updateJobState(job.id!, {
      status: 'failed',
      progress: 0,
      errorMessage: message,
      timeoutAt: '',
    });
    await updateLinkedAssetStage(job, 'failed', 0, {
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
