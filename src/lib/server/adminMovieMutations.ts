import { createPartId, normalizeEditableStringList } from '@/lib/server/adminControlCenter';
import type { Episode, Movie, MoviePart, Season } from '@/types/movie';

function nowIso() {
  return new Date().toISOString();
}

function normalizeSourceType(value: unknown) {
  return value === 'upload' || value === 'remote_link' || value === 'direct_upload'
    ? value
    : 'remote_link';
}

function normalizeSourcePipeline(value: unknown, sourceType: 'upload' | 'remote_link' | 'direct_upload') {
  if (value === 'direct_upload' || value === 'remote_mp4_ingest') {
    return value;
  }

  return sourceType === 'remote_link' ? 'remote_mp4_ingest' : 'direct_upload';
}

function normalizeAccessTier(value: unknown) {
  return value === 'free' ? 'free' : 'premium';
}

function buildReleaseDate(releaseDate: unknown, releaseYear: unknown) {
  if (typeof releaseDate === 'string' && releaseDate.trim()) {
    return releaseDate.trim();
  }

  if (typeof releaseYear === 'number' && Number.isFinite(releaseYear) && releaseYear > 1800) {
    return `${releaseYear}-01-01`;
  }

  return '';
}

function normalizeEpisodeInput(input: Record<string, unknown>, episodeIndex: number): Episode {
  const timestamp = nowIso();
  const sourceType = normalizeSourceType(input.sourceType);
  const videoUrl = String(input.video_url || input.sourceUrl || '').trim();
  const accessTier = normalizeAccessTier(input.accessTier);

  return {
    episodeNumber:
      typeof input.episodeNumber === 'number' && Number.isFinite(input.episodeNumber)
        ? input.episodeNumber
        : episodeIndex + 1,
    title: String(input.title || `Episode ${episodeIndex + 1}`),
    description: String(input.description || ''),
    overview: String(input.overview || input.description || ''),
    video_url: videoUrl,
    poster: String(input.poster || ''),
    thumbnail: String(input.thumbnail || ''),
    sourceType,
    sourcePipeline: normalizeSourcePipeline(input.sourcePipeline, sourceType),
    sourceFileName: String(input.sourceFileName || videoUrl.split('/').pop() || ''),
    sourceUrl: String(input.sourceUrl || videoUrl),
    jobStatus: videoUrl ? 'ready' : 'failed',
    processingProgress: videoUrl ? 100 : 0,
    errorMessage: '',
    playbackType: 'mp4',
    masterPlaylistUrl: '',
    availableRenditions: [],
    durationSeconds:
      typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)
        ? input.durationSeconds
        : 0,
    videoResolution:
      input.videoResolution &&
      typeof (input.videoResolution as Record<string, unknown>).width === 'number' &&
      typeof (input.videoResolution as Record<string, unknown>).height === 'number'
        ? {
            width: (input.videoResolution as Record<string, number>).width,
            height: (input.videoResolution as Record<string, number>).height,
          }
        : null,
    fileSizeBytes:
      typeof input.fileSizeBytes === 'number' && Number.isFinite(input.fileSizeBytes)
        ? input.fileSizeBytes
        : 0,
    processedAt: timestamp,
    createdAt: String(input.createdAt || timestamp),
    updatedAt: timestamp,
    accessTier,
    subscriptionRequired: accessTier !== 'free',
    isLocked: false,
  };
}

function normalizeSeasonInput(input: Record<string, unknown>, seasonIndex: number): Season {
  const episodes = Array.isArray(input.episodes)
    ? input.episodes
        .map((episode, episodeIndex) =>
          normalizeEpisodeInput(episode as Record<string, unknown>, episodeIndex)
        )
        .filter((episode) => Boolean(episode.video_url))
        .sort((left, right) => left.episodeNumber - right.episodeNumber)
    : [];

  return {
    seasonNumber:
      typeof input.seasonNumber === 'number' && Number.isFinite(input.seasonNumber)
        ? input.seasonNumber
        : seasonIndex + 1,
    title: String(input.title || `Season ${seasonIndex + 1}`),
    overview: String(input.overview || ''),
    poster: String(input.poster || ''),
    tmdb_id:
      typeof input.tmdb_id === 'number' && Number.isFinite(input.tmdb_id) ? input.tmdb_id : null,
    episodes,
  };
}

function normalizeMoviePartInput(input: Record<string, unknown>, partIndex: number): MoviePart {
  const timestamp = nowIso();
  const sourceType = normalizeSourceType(input.sourceType);
  const videoUrl = String(input.video_url || input.sourceUrl || '').trim();
  const accessTier = normalizeAccessTier(input.accessTier);

  return {
    id: String(input.id || createPartId()),
    label: String(input.label || `Part ${String.fromCharCode(65 + partIndex)}`),
    order:
      typeof input.order === 'number' && Number.isFinite(input.order)
        ? input.order
        : partIndex + 1,
    title: String(input.title || ''),
    description: String(input.description || ''),
    video_url: videoUrl,
    poster: String(input.poster || ''),
    thumbnail: String(input.thumbnail || ''),
    sourceType,
    sourcePipeline: normalizeSourcePipeline(input.sourcePipeline, sourceType),
    sourceFileName: String(input.sourceFileName || videoUrl.split('/').pop() || ''),
    sourceUrl: String(input.sourceUrl || videoUrl),
    jobStatus: videoUrl ? 'ready' : 'failed',
    processingProgress: videoUrl ? 100 : 0,
    errorMessage: '',
    playbackType: 'mp4',
    masterPlaylistUrl: '',
    availableRenditions: [],
    durationSeconds:
      typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)
        ? input.durationSeconds
        : 0,
    videoResolution:
      input.videoResolution &&
      typeof (input.videoResolution as Record<string, unknown>).width === 'number' &&
      typeof (input.videoResolution as Record<string, unknown>).height === 'number'
        ? {
            width: (input.videoResolution as Record<string, number>).width,
            height: (input.videoResolution as Record<string, number>).height,
          }
        : null,
    fileSizeBytes:
      typeof input.fileSizeBytes === 'number' && Number.isFinite(input.fileSizeBytes)
        ? input.fileSizeBytes
        : 0,
    processedAt: timestamp,
    createdAt: String(input.createdAt || timestamp),
    updatedAt: timestamp,
    accessTier,
    subscriptionRequired: accessTier !== 'free',
    isLocked: false,
  };
}

export function buildEditableMovieDocument(
  input: Record<string, unknown>,
  existingMovie?: Partial<Movie>
): Omit<Movie, 'id'> {
  const timestamp = nowIso();
  const contentType = input.contentType === 'series' ? 'series' : 'movie';
  const releaseYear =
    typeof input.releaseYear === 'number' && Number.isFinite(input.releaseYear)
      ? input.releaseYear
      : existingMovie?.releaseYear || null;
  const releaseDate = buildReleaseDate(input.release_date, releaseYear);
  const accessTier = normalizeAccessTier(input.accessTier ?? existingMovie?.accessTier);
  const parts = Array.isArray(input.parts)
    ? input.parts
        .map((part, partIndex) => normalizeMoviePartInput(part as Record<string, unknown>, partIndex))
        .filter((part) => Boolean(part.video_url))
        .sort((left, right) => left.order - right.order)
    : existingMovie?.parts || [];
  const seasons = Array.isArray(input.seasons)
    ? input.seasons
        .map((season, seasonIndex) => normalizeSeasonInput(season as Record<string, unknown>, seasonIndex))
        .filter((season) => season.episodes.length > 0)
        .sort((left, right) => left.seasonNumber - right.seasonNumber)
    : existingMovie?.seasons || [];
  const primaryVideoUrl =
    String(input.video_url || '').trim() ||
    parts[0]?.video_url ||
    existingMovie?.video_url ||
    '';
  const sourceType = normalizeSourceType(input.sourceType ?? existingMovie?.sourceType);
  const sourcePipeline = normalizeSourcePipeline(input.sourcePipeline, sourceType);
  const normalizedCategories = normalizeEditableStringList(input.category ?? existingMovie?.category);
  const isTrendingTikTok =
    Boolean(input.is_trending_tiktok ?? existingMovie?.is_trending_tiktok) ||
    normalizedCategories.some((entry) => entry.toLowerCase() === 'trending on tiktok');

  return {
    movieId: String(existingMovie?.movieId || ''),
    contentType,
    sourceType,
    sourcePipeline,
    sourceFileName:
      String(input.sourceFileName || '').trim() ||
      parts[0]?.sourceFileName ||
      existingMovie?.sourceFileName ||
      primaryVideoUrl.split('/').pop() ||
      '',
    sourceUrl:
      String(input.sourceUrl || '').trim() ||
      parts[0]?.sourceUrl ||
      existingMovie?.sourceUrl ||
      primaryVideoUrl,
    jobStatus: primaryVideoUrl || parts.length || seasons.length ? 'ready' : 'failed',
    processingProgress: primaryVideoUrl || parts.length || seasons.length ? 100 : 0,
    errorMessage: '',
    playbackType: 'mp4',
    masterPlaylistUrl: '',
    availableRenditions: [],
    durationSeconds:
      typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)
        ? input.durationSeconds
        : existingMovie?.durationSeconds || 0,
    videoResolution:
      input.videoResolution &&
      typeof (input.videoResolution as Record<string, unknown>).width === 'number' &&
      typeof (input.videoResolution as Record<string, unknown>).height === 'number'
        ? {
            width: (input.videoResolution as Record<string, number>).width,
            height: (input.videoResolution as Record<string, number>).height,
          }
        : existingMovie?.videoResolution || null,
    fileSizeBytes:
      typeof input.fileSizeBytes === 'number' && Number.isFinite(input.fileSizeBytes)
        ? input.fileSizeBytes
        : existingMovie?.fileSizeBytes || 0,
    processedAt: timestamp,
    createdAt: existingMovie?.createdAt || timestamp,
    updatedAt: timestamp,
    accessTier,
    subscriptionRequired: accessTier !== 'free',
    isLocked: false,
    title: String(input.title || existingMovie?.title || 'Untitled movie'),
    original_title: String(input.original_title || input.title || existingMovie?.original_title || existingMovie?.title || 'Untitled movie'),
    name: String(input.name || input.title || existingMovie?.name || existingMovie?.title || 'Untitled movie'),
    overview: String(input.overview || input.description || existingMovie?.overview || existingMovie?.description || ''),
    description: String(input.description || existingMovie?.description || existingMovie?.overview || ''),
    language: String(input.language || existingMovie?.language || ''),
    releaseYear,
    tags: normalizeEditableStringList(input.tags ?? existingMovie?.tags),
    cast: normalizeEditableStringList(input.cast ?? existingMovie?.cast),
    poster: String(input.poster || existingMovie?.poster || ''),
    genres: normalizeEditableStringList(input.genres ?? existingMovie?.genres),
    category: normalizedCategories,
    vj: String(input.vj || existingMovie?.vj || 'Unknown'),
    video_url: contentType === 'movie' ? primaryVideoUrl : '',
    release_date: releaseDate,
    date_added: String(existingMovie?.date_added || timestamp),
    country: String(input.country || existingMovie?.country || 'Unknown'),
    tmdb_id:
      typeof input.tmdb_id === 'number'
        ? input.tmdb_id
        : typeof existingMovie?.tmdb_id === 'number'
          ? existingMovie.tmdb_id
          : null,
    file_name: String(input.file_name || existingMovie?.file_name || ''),
    status: String(input.status || existingMovie?.status || 'published'),
    is_trending_tiktok: isTrendingTikTok,
    parts,
    seasons,
  };
}
