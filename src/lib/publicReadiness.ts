type PublicAsset = Record<string, unknown>;

type PublicReadinessOptions = {
  allowLockedPlaceholder?: boolean;
};

const READY_JOB_STATUS = 'ready';
const UNREADY_JOB_STATUSES = new Set([
  'queued',
  'downloading',
  'inspecting',
  'processing',
  'uploading',
  'failed',
]);

function getJobStatus(asset: PublicAsset) {
  const jobStatus = typeof asset.jobStatus === 'string' ? asset.jobStatus.trim().toLowerCase() : '';

  if (jobStatus) {
    return jobStatus;
  }

  const legacyStatus = typeof asset.status === 'string' ? asset.status.trim().toLowerCase() : '';

  if (legacyStatus === READY_JOB_STATUS || UNREADY_JOB_STATUSES.has(legacyStatus)) {
    return legacyStatus;
  }

  return '';
}

function hasPublicPlayableUrl(asset: PublicAsset, options: PublicReadinessOptions) {
  if (options.allowLockedPlaceholder && asset.isLocked === true && asset.subscriptionRequired === true) {
    return true;
  }

  if (
    String(asset.video_url || '').trim() ||
    String(asset.sourceUrl || '').trim() ||
    String(asset.masterPlaylistUrl || '').trim()
  ) {
    return true;
  }

  const renditions = Array.isArray(asset.availableRenditions) ? asset.availableRenditions : [];
  return renditions.some((rendition) =>
    Boolean(String((rendition as PublicAsset).playlistUrl || '').trim())
  );
}

export function isPublicPlaybackAssetReady(asset: PublicAsset, options: PublicReadinessOptions = {}) {
  const jobStatus = getJobStatus(asset);

  if (UNREADY_JOB_STATUSES.has(jobStatus)) {
    return false;
  }

  if (jobStatus && jobStatus !== READY_JOB_STATUS) {
    return false;
  }

  return hasPublicPlayableUrl(asset, options);
}

function hasExplicitUnreadyStatus(asset: PublicAsset) {
  const jobStatus = getJobStatus(asset);
  return Boolean(jobStatus && jobStatus !== READY_JOB_STATUS);
}

export function isPublicMovieReady(movie: PublicAsset, options: PublicReadinessOptions = {}) {
  if (hasExplicitUnreadyStatus(movie)) {
    return false;
  }

  const seasons = Array.isArray(movie.seasons) ? movie.seasons : [];

  if (movie.contentType === 'series' || seasons.length > 0) {
    const episodes = seasons.flatMap((season) => {
      const rawSeason = season as PublicAsset;
      return Array.isArray(rawSeason.episodes) ? rawSeason.episodes : [];
    });

    return episodes.length > 0 && episodes.every((episode) =>
      isPublicPlaybackAssetReady(episode as PublicAsset, options)
    );
  }

  const parts = Array.isArray(movie.parts) ? movie.parts : [];

  if (parts.length > 0) {
    return parts.every((part) => isPublicPlaybackAssetReady(part as PublicAsset, options));
  }

  return isPublicPlaybackAssetReady(movie, options);
}
