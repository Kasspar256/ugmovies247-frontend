export type Episode = {
  episodeNumber: number;
  title: string;
  description?: string;
  overview?: string;
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

export type MoviePart = {
  id: string;
  label: string;
  order: number;
  title?: string;
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
  overview?: string;
  poster?: string;
  tmdb_id?: number | null;
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
  overview?: string;
  description?: string;
  language?: string;
  releaseYear?: number | null;
  tags?: string[];
  cast?: string[];
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
  parts?: MoviePart[];
  seasons?: Season[];
};

export type MovieDocument = Omit<Movie, 'id'>;

function normalizeSourceType(value: unknown): Episode['sourceType'] {
  return value === 'upload' || value === 'remote_link' || value === 'direct_upload'
    ? value
    : undefined;
}

function normalizeSourcePipeline(value: unknown): Episode['sourcePipeline'] {
  return value === 'hls_pipeline' ||
    value === 'direct_upload' ||
    value === 'remote_mkv_to_mp4' ||
    value === 'remote_mp4_ingest'
    ? value
    : undefined;
}

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

  const parts = Array.isArray(data.parts)
    ? data.parts
        .map((part, partIndex): MoviePart => {
          const rawPart = part as Record<string, unknown>;
          const id =
            typeof rawPart.id === 'string' && rawPart.id.trim()
              ? rawPart.id.trim()
              : `part-${partIndex + 1}`;

          return {
            id,
            label:
              typeof rawPart.label === 'string' && rawPart.label.trim()
                ? rawPart.label.trim()
                : `Part ${String.fromCharCode(65 + partIndex)}`,
            order:
              typeof rawPart.order === 'number'
                ? rawPart.order
                : partIndex + 1,
            title: typeof rawPart.title === 'string' ? rawPart.title : '',
            description: typeof rawPart.description === 'string' ? rawPart.description : '',
            video_url: typeof rawPart.video_url === 'string' ? rawPart.video_url : '',
            poster: typeof rawPart.poster === 'string' ? rawPart.poster : '',
            thumbnail: typeof rawPart.thumbnail === 'string' ? rawPart.thumbnail : '',
            sourceType: normalizeSourceType(rawPart.sourceType),
            sourcePipeline: normalizeSourcePipeline(rawPart.sourcePipeline),
            sourceFileName: typeof rawPart.sourceFileName === 'string' ? rawPart.sourceFileName : '',
            sourceUrl: typeof rawPart.sourceUrl === 'string' ? rawPart.sourceUrl : '',
            jobStatus:
              typeof rawPart.jobStatus === 'string'
                ? (rawPart.jobStatus as MoviePart['jobStatus'])
                : undefined,
            processingProgress:
              typeof rawPart.processingProgress === 'number' ? rawPart.processingProgress : 0,
            errorMessage: typeof rawPart.errorMessage === 'string' ? rawPart.errorMessage : '',
            playbackType:
              rawPart.playbackType === 'hls' || rawPart.playbackType === 'mp4'
                ? rawPart.playbackType
                : 'mp4',
            masterPlaylistUrl: typeof rawPart.masterPlaylistUrl === 'string' ? rawPart.masterPlaylistUrl : '',
            availableRenditions: normalizeRenditions(rawPart.availableRenditions) as MoviePart['availableRenditions'],
            durationSeconds:
              typeof rawPart.durationSeconds === 'number' ? rawPart.durationSeconds : 0,
            videoResolution:
              rawPart.videoResolution &&
              typeof (rawPart.videoResolution as Record<string, unknown>).width === 'number' &&
              typeof (rawPart.videoResolution as Record<string, unknown>).height === 'number'
                ? {
                    width: (rawPart.videoResolution as Record<string, number>).width,
                    height: (rawPart.videoResolution as Record<string, number>).height,
                  }
                : null,
            fileSizeBytes: typeof rawPart.fileSizeBytes === 'number' ? rawPart.fileSizeBytes : 0,
            processedAt: typeof rawPart.processedAt === 'string' ? rawPart.processedAt : '',
            createdAt: typeof rawPart.createdAt === 'string' ? rawPart.createdAt : '',
            updatedAt: typeof rawPart.updatedAt === 'string' ? rawPart.updatedAt : '',
            accessTier: rawPart.accessTier === 'free' ? 'free' : 'premium',
            subscriptionRequired: rawPart.subscriptionRequired !== false,
            isLocked: Boolean(rawPart.isLocked),
          };
        })
        .sort((left, right) => left.order - right.order)
    : [];

  const seasons = Array.isArray(data.seasons)
    ? data.seasons.map((season, seasonIndex): Season => {
        const rawSeason = season as Record<string, unknown>;
        const episodes = Array.isArray(rawSeason.episodes)
          ? rawSeason.episodes.map((episode, episodeIndex): Episode => {
              const rawEpisode = episode as Record<string, unknown>;

              return {
                episodeNumber:
                  typeof rawEpisode.episodeNumber === 'number'
                    ? rawEpisode.episodeNumber
                    : episodeIndex + 1,
                title: String(rawEpisode.title || `Episode ${episodeIndex + 1}`),
                description: typeof rawEpisode.description === 'string' ? rawEpisode.description : '',
                overview: typeof rawEpisode.overview === 'string' ? rawEpisode.overview : '',
                video_url: typeof rawEpisode.video_url === 'string' ? rawEpisode.video_url : '',
                poster: typeof rawEpisode.poster === 'string' ? rawEpisode.poster : '',
                thumbnail: typeof rawEpisode.thumbnail === 'string' ? rawEpisode.thumbnail : '',
                sourceType: normalizeSourceType(rawEpisode.sourceType),
                sourcePipeline: normalizeSourcePipeline(rawEpisode.sourcePipeline),
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
          overview: typeof rawSeason.overview === 'string' ? rawSeason.overview : '',
          poster: typeof rawSeason.poster === 'string' ? rawSeason.poster : '',
          tmdb_id: typeof rawSeason.tmdb_id === 'number' ? rawSeason.tmdb_id : null,
          episodes,
        };
      })
    : [];

  return {
    id,
    movieId: typeof data.movieId === 'string' ? data.movieId : id,
    contentType: data.contentType === 'series' ? 'series' : 'movie',
    sourceType: normalizeSourceType(data.sourceType),
    sourcePipeline: normalizeSourcePipeline(data.sourcePipeline),
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
    overview: typeof data.overview === 'string' ? data.overview : '',
    description: typeof data.description === 'string' ? data.description : '',
    language: typeof data.language === 'string' ? data.language : '',
    releaseYear: typeof data.releaseYear === 'number' ? data.releaseYear : null,
    tags: Array.isArray(data.tags)
      ? data.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    cast: Array.isArray(data.cast)
      ? data.cast.filter((castMember): castMember is string => typeof castMember === 'string')
      : [],
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
    parts,
    seasons,
  };
}
