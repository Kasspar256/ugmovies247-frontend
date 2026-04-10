export type Episode = {
  episodeNumber: number;
  title: string;
  description?: string;
  video_url: string;
  poster?: string;
  thumbnail?: string;
  sourceType?: 'upload' | 'remote_link' | 'direct_upload';
  sourcePipeline?: 'hls_pipeline' | 'direct_upload' | 'remote_mkv_to_mp4' | 'remote_mp4_ingest';
  sourceFileName?: string;
  sourceUrl?: string;
  jobStatus?: 'queued' | 'validating' | 'downloading' | 'uploading_source' | 'transcoding' | 'packaging' | 'uploading_hls' | 'ready' | 'failed' | 'cancelled';
  processingProgress?: number;
  errorMessage?: string;
  playbackType?: 'mp4' | 'hls';
  masterPlaylistUrl?: string;
  availableRenditions?: {
    name: '360p' | '480p' | '720p' | '1080p';
    width: number;
    height: number;
    bitrateKbps: number;
    playlistUrl?: string;
  }[];
  durationSeconds?: number;
  videoResolution?: {
    width: number;
    height: number;
  } | null;
  fileSizeBytes?: number;
  processedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  accessTier?: 'free' | 'premium';
  subscriptionRequired?: boolean;
  isLocked?: boolean;
};

export type Season = {
  seasonNumber: number;
  title?: string;
  episodes: Episode[];
};

export type Movie = {
  id: string;
  movieId?: string;
  contentType?: 'movie' | 'series';
  sourceType?: 'upload' | 'remote_link' | 'direct_upload';
  sourcePipeline?: 'hls_pipeline' | 'direct_upload' | 'remote_mkv_to_mp4' | 'remote_mp4_ingest';
  sourceFileName?: string;
  sourceUrl?: string;
  jobStatus?: 'queued' | 'validating' | 'downloading' | 'uploading_source' | 'transcoding' | 'packaging' | 'uploading_hls' | 'ready' | 'failed' | 'cancelled';
  processingProgress?: number;
  errorMessage?: string;
  playbackType?: 'mp4' | 'hls';
  masterPlaylistUrl?: string;
  availableRenditions?: {
    name: '360p' | '480p' | '720p' | '1080p';
    width: number;
    height: number;
    bitrateKbps: number;
    playlistUrl?: string;
  }[];
  durationSeconds?: number;
  videoResolution?: {
    width: number;
    height: number;
  } | null;
  fileSizeBytes?: number;
  processedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  accessTier?: 'free' | 'premium';
  subscriptionRequired?: boolean;
  isLocked?: boolean;
  title: string;
  original_title?: string;
  name?: string;
  description?: string;
  poster: string;
  genres: string[];
  category?: string[];
  vj?: string;
  video_url?: string;
  release_date?: string;
  date_added?: string;
  country?: string;
  tmdb_id?: number | null;
  file_name?: string;
  status?: string;
  is_trending_tiktok?: boolean;
  seasons?: Season[];
};

export type MovieDocument = Omit<Movie, 'id'>;

export function normalizeMovie(id: string, data: Record<string, unknown>): Movie {
  const normalizeRenditions = (value: unknown) =>
    Array.isArray(value)
      ? value
          .map((rendition) => {
            const rawRendition = rendition as Record<string, unknown>;

            if (
              (rawRendition.name !== '360p' &&
                rawRendition.name !== '480p' &&
                rawRendition.name !== '720p' &&
                rawRendition.name !== '1080p') ||
              typeof rawRendition.width !== 'number' ||
              typeof rawRendition.height !== 'number' ||
              typeof rawRendition.bitrateKbps !== 'number'
            ) {
              return null;
            }

            return {
              name: rawRendition.name,
              width: rawRendition.width,
              height: rawRendition.height,
              bitrateKbps: rawRendition.bitrateKbps,
              playlistUrl: typeof rawRendition.playlistUrl === 'string' ? rawRendition.playlistUrl : '',
            };
          })
          .filter(Boolean)
      : [];

  const seasons = Array.isArray(data.seasons)
    ? data.seasons.map((season, seasonIndex) => {
        const rawSeason = season as Record<string, unknown>;
        const episodes = Array.isArray(rawSeason.episodes)
          ? rawSeason.episodes.map((episode, episodeIndex) => {
              const rawEpisode = episode as Record<string, unknown>;

              return {
                episodeNumber:
                  typeof rawEpisode.episodeNumber === 'number'
                    ? rawEpisode.episodeNumber
                    : episodeIndex + 1,
                title: String(rawEpisode.title || `Episode ${episodeIndex + 1}`),
                description: typeof rawEpisode.description === 'string' ? rawEpisode.description : '',
                video_url: typeof rawEpisode.video_url === 'string' ? rawEpisode.video_url : '',
                poster: typeof rawEpisode.poster === 'string' ? rawEpisode.poster : '',
                thumbnail: typeof rawEpisode.thumbnail === 'string' ? rawEpisode.thumbnail : '',
                sourceType:
                  rawEpisode.sourceType === 'upload' || rawEpisode.sourceType === 'remote_link' || rawEpisode.sourceType === 'direct_upload'
                    ? rawEpisode.sourceType
                    : undefined,
                sourcePipeline:
                  rawEpisode.sourcePipeline === 'hls_pipeline' ||
                  rawEpisode.sourcePipeline === 'direct_upload' ||
                  rawEpisode.sourcePipeline === 'remote_mkv_to_mp4' ||
                  rawEpisode.sourcePipeline === 'remote_mp4_ingest'
                    ? rawEpisode.sourcePipeline
                    : undefined,
                sourceFileName: typeof rawEpisode.sourceFileName === 'string' ? rawEpisode.sourceFileName : '',
                sourceUrl: typeof rawEpisode.sourceUrl === 'string' ? rawEpisode.sourceUrl : '',
                jobStatus:
                  typeof rawEpisode.jobStatus === 'string'
                    ? (rawEpisode.jobStatus as Episode['jobStatus'])
                    : undefined,
                processingProgress:
                  typeof rawEpisode.processingProgress === 'number' ? rawEpisode.processingProgress : 0,
                errorMessage: typeof rawEpisode.errorMessage === 'string' ? rawEpisode.errorMessage : '',
                playbackType:
                  rawEpisode.playbackType === 'hls' || rawEpisode.playbackType === 'mp4'
                    ? rawEpisode.playbackType
                    : 'mp4',
                masterPlaylistUrl:
                  typeof rawEpisode.masterPlaylistUrl === 'string' ? rawEpisode.masterPlaylistUrl : '',
                availableRenditions: normalizeRenditions(rawEpisode.availableRenditions) as Episode['availableRenditions'],
                durationSeconds:
                  typeof rawEpisode.durationSeconds === 'number' ? rawEpisode.durationSeconds : 0,
                videoResolution:
                  rawEpisode.videoResolution &&
                  typeof (rawEpisode.videoResolution as Record<string, unknown>).width === 'number' &&
                  typeof (rawEpisode.videoResolution as Record<string, unknown>).height === 'number'
                    ? {
                        width: (rawEpisode.videoResolution as Record<string, number>).width,
                        height: (rawEpisode.videoResolution as Record<string, number>).height,
                      }
                    : null,
                fileSizeBytes:
                  typeof rawEpisode.fileSizeBytes === 'number' ? rawEpisode.fileSizeBytes : 0,
                processedAt: typeof rawEpisode.processedAt === 'string' ? rawEpisode.processedAt : '',
                createdAt: typeof rawEpisode.createdAt === 'string' ? rawEpisode.createdAt : '',
                updatedAt: typeof rawEpisode.updatedAt === 'string' ? rawEpisode.updatedAt : '',
                accessTier: rawEpisode.accessTier === 'free' ? 'free' : 'premium',
                subscriptionRequired: rawEpisode.subscriptionRequired !== false,
                isLocked: Boolean(rawEpisode.isLocked),
              };
            })
          : [];

        return {
          seasonNumber:
            typeof rawSeason.seasonNumber === 'number' ? rawSeason.seasonNumber : seasonIndex + 1,
          title: typeof rawSeason.title === 'string' ? rawSeason.title : '',
          episodes,
        };
      })
    : [];

  return {
    id,
    movieId: typeof data.movieId === 'string' ? data.movieId : id,
    contentType: data.contentType === 'series' ? 'series' : 'movie',
    sourceType:
      data.sourceType === 'upload' || data.sourceType === 'remote_link' || data.sourceType === 'direct_upload'
        ? data.sourceType
        : undefined,
    sourcePipeline:
      data.sourcePipeline === 'hls_pipeline' ||
      data.sourcePipeline === 'direct_upload' ||
      data.sourcePipeline === 'remote_mkv_to_mp4' ||
      data.sourcePipeline === 'remote_mp4_ingest'
        ? data.sourcePipeline
        : undefined,
    sourceFileName: typeof data.sourceFileName === 'string' ? data.sourceFileName : '',
    sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : '',
    jobStatus: typeof data.jobStatus === 'string' ? (data.jobStatus as Movie['jobStatus']) : undefined,
    processingProgress: typeof data.processingProgress === 'number' ? data.processingProgress : 0,
    errorMessage: typeof data.errorMessage === 'string' ? data.errorMessage : '',
    playbackType: data.playbackType === 'hls' || data.playbackType === 'mp4' ? data.playbackType : 'mp4',
    masterPlaylistUrl: typeof data.masterPlaylistUrl === 'string' ? data.masterPlaylistUrl : '',
    availableRenditions: normalizeRenditions(data.availableRenditions) as Movie['availableRenditions'],
    durationSeconds: typeof data.durationSeconds === 'number' ? data.durationSeconds : 0,
    videoResolution:
      data.videoResolution &&
      typeof (data.videoResolution as Record<string, unknown>).width === 'number' &&
      typeof (data.videoResolution as Record<string, unknown>).height === 'number'
        ? {
            width: (data.videoResolution as Record<string, number>).width,
            height: (data.videoResolution as Record<string, number>).height,
          }
        : null,
    fileSizeBytes: typeof data.fileSizeBytes === 'number' ? data.fileSizeBytes : 0,
    processedAt: typeof data.processedAt === 'string' ? data.processedAt : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    accessTier: data.accessTier === 'free' ? 'free' : 'premium',
    subscriptionRequired: data.subscriptionRequired !== false,
    isLocked: Boolean(data.isLocked),
    title: String(data.title || data.name || 'Untitled movie'),
    original_title: typeof data.original_title === 'string' ? data.original_title : '',
    name: typeof data.name === 'string' ? data.name : '',
    description: typeof data.description === 'string' ? data.description : '',
    poster: typeof data.poster === 'string' ? data.poster : '',
    genres: Array.isArray(data.genres)
      ? data.genres.filter((genre): genre is string => typeof genre === 'string')
      : [],
    category: Array.isArray(data.category)
      ? data.category.filter((entry): entry is string => typeof entry === 'string')
      : [],
    vj: typeof data.vj === 'string' ? data.vj : '',
    video_url: typeof data.video_url === 'string' ? data.video_url : '',
    release_date: typeof data.release_date === 'string' ? data.release_date : '',
    date_added: typeof data.date_added === 'string' ? data.date_added : '',
    country: typeof data.country === 'string' ? data.country : '',
    tmdb_id: typeof data.tmdb_id === 'number' ? data.tmdb_id : null,
    file_name: typeof data.file_name === 'string' ? data.file_name : '',
    status: typeof data.status === 'string' ? data.status : '',
    is_trending_tiktok: Boolean(data.is_trending_tiktok),
    seasons,
  };
}
