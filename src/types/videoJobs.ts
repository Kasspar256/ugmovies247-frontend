export type PlaybackType = 'mp4' | 'hls';
export type SourcePipeline =
  | 'hls_pipeline'
  | 'direct_upload'
  | 'direct_url_import'
  | 'remote_mkv_to_mp4'
  | 'remote_mp4_ingest';

export type VideoJobStatus =
  | 'queued'
  | 'downloading'
  | 'inspecting'
  | 'processing'
  | 'uploading'
  | 'ready'
  | 'failed';

export type SourceType = 'upload' | 'remote_link' | 'direct_upload' | 'direct_url';
export type VideoJobType =
  | 'hls_transcode'
  | 'direct_mp4_upload'
  | 'direct_url_import'
  | 'remote_mkv_to_mp4';

export type VideoRendition = {
  name: '360p' | '480p' | '720p' | '1080p';
  width: number;
  height: number;
  bitrateKbps: number;
  playlistUrl?: string;
};

export type VideoAssetMetadata = {
  sourceType?: SourceType;
  sourcePipeline?: SourcePipeline;
  sourceFileName?: string;
  sourceUrl?: string;
  video_url?: string;
  jobStatus?: VideoJobStatus;
  processingProgress?: number;
  errorMessage?: string;
  playbackType?: PlaybackType;
  masterPlaylistUrl?: string;
  availableRenditions?: VideoRendition[];
  durationSeconds?: number;
  videoResolution?: {
    width: number;
    height: number;
  } | null;
  fileSizeBytes?: number;
  processedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type VideoJobTarget =
  | {
      kind: 'movie';
      movieId: string;
    }
  | {
      kind: 'part';
      movieId: string;
      partId: string;
    }
  | {
      kind: 'episode';
      movieId: string;
      seasonNumber: number;
      episodeNumber: number;
    };

export type VideoJobDocument = {
  id?: string;
  jobType?: VideoJobType;
  sourcePipeline?: SourcePipeline;
  title: string;
  contentType: 'movie' | 'series';
  sourceType: SourceType;
  sourceFileName?: string;
  sourceUrl?: string;
  localSourcePath?: string;
  queueOrder: number;
  status: VideoJobStatus;
  progress: number;
  errorMessage?: string;
  logs?: string[];
  target: VideoJobTarget;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  processedAt?: string;
  retryCount?: number;
  timeoutAt?: string;
  workerHeartbeatAt?: string;
  output?: {
    playbackType?: PlaybackType;
    masterPlaylistUrl?: string;
    availableRenditions?: VideoRendition[];
    durationSeconds?: number;
    resolution?: {
      width: number;
      height: number;
    } | null;
    fileSizeBytes?: number;
    r2ObjectKey?: string;
    playbackUrl?: string;
  };
};
