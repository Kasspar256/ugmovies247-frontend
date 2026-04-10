# HLS Pipeline Setup

## New environment variables

Add these to your environment before running the HLS pipeline:

- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_BASE_URL`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FFMPEG_PATH`
- `FFPROBE_PATH`
- `VIDEO_WORKSPACE_ROOT`
- `VIDEO_MIN_FREE_DISK_BYTES`
- `VIDEO_JOB_STALE_MS`
- `VIDEO_JOB_TIMEOUT_MS`
- `VIDEO_WORKER_POLL_MS`

## Required packages

Install the new dependencies:

```bash
npm install
```

## Worker process

Run the dedicated sequential worker in a separate process:

```bash
npm run video-worker
```

This worker:

- processes exactly one job at a time
- polls Firestore-backed queue state
- downloads remote sources when needed
- runs FFprobe + FFmpeg
- uploads HLS outputs to R2
- updates Firestore job/movie metadata
- cleans temporary workspace files

## Temp storage

The server uses local temporary workspace storage only during processing:

- `${VIDEO_WORKSPACE_ROOT}/sources`
- `${VIDEO_WORKSPACE_ROOT}/outputs`

Nothing should remain there permanently after success, and failed jobs attempt cleanup automatically.

## Firestore collections

The HLS queue uses:

- `video_jobs`
- `video_job_runtime`

Movie documents are updated with:

- `playbackType`
- `masterPlaylistUrl`
- `jobStatus`
- `processingProgress`
- `errorMessage`
- `availableRenditions`
- `durationSeconds`
- `videoResolution`
- `fileSizeBytes`
- `processedAt`
- `createdAt`
- `updatedAt`

## Operational notes

- Existing MP4 titles still fall back safely until they are reprocessed.
- New queue submissions should be ingested through `/api/admin/video-jobs`.
- Production should rely on the dedicated worker process instead of request-triggered processing.
