import type { Movie } from '@/types/movie';
import trailerData from './reviewTrailerData.json';

export type ReviewTrailerMapping = {
  title: string;
  trailerUrl: string;
  aliases?: string[];
};

export const REVIEW_TRAILER_MAPPINGS = trailerData as ReviewTrailerMapping[];
export const REVIEW_TRAILER_URLS = REVIEW_TRAILER_MAPPINGS.map((mapping) => mapping.trailerUrl);

export function normalizeReviewTrailerTitle(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function getMappedTrailerUrlForTitle(title: string) {
  const normalizedTitle = normalizeReviewTrailerTitle(title);

  if (!normalizedTitle) {
    return '';
  }

  const exactMatch = REVIEW_TRAILER_MAPPINGS.find((mapping) =>
    [mapping.title, ...(mapping.aliases || [])].some(
      (candidate) => normalizeReviewTrailerTitle(candidate) === normalizedTitle
    )
  );

  if (exactMatch) {
    return exactMatch.trailerUrl;
  }

  const partialMatch = REVIEW_TRAILER_MAPPINGS.find((mapping) =>
    [mapping.title, ...(mapping.aliases || [])].some((candidate) => {
      const normalizedCandidate = normalizeReviewTrailerTitle(candidate);
      return normalizedCandidate && normalizedTitle.includes(normalizedCandidate);
    })
  );

  return partialMatch?.trailerUrl || '';
}

export function pickRandomReviewTrailerUrl() {
  if (!REVIEW_TRAILER_URLS.length) {
    return '';
  }

  return REVIEW_TRAILER_URLS[Math.floor(Math.random() * REVIEW_TRAILER_URLS.length)] || '';
}

export function getYouTubeVideoId(url: string) {
  const value = String(url || '').trim();

  if (!value) {
    return '';
  }

  try {
    const parsedUrl = new URL(value);
    const host = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be') {
      return pathParts[0] || '';
    }

    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host.endsWith('.youtube.com')) {
      if (pathParts[0] === 'embed' || pathParts[0] === 'shorts' || pathParts[0] === 'live') {
        return pathParts[1] || '';
      }

      return parsedUrl.searchParams.get('v') || '';
    }
  } catch {
    const match = value.match(
      /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{6,})/
    );

    return match?.[1] || '';
  }

  return '';
}

export function getYouTubeEmbedUrl(url: string, options?: { autoplay?: boolean }) {
  const videoId = getYouTubeVideoId(url);

  if (!videoId) {
    return '';
  }

  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });

  if (options?.autoplay) {
    params.set('autoplay', '1');
  }

  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

export function getReviewTrailerUrl(
  movie: Pick<Movie, 'title' | 'name' | 'original_title' | 'file_name' | 'sourceFileName' | 'trailer_url'> | null
) {
  if (!movie) {
    return pickRandomReviewTrailerUrl();
  }

  const explicitTrailerUrl = String(movie.trailer_url || '').trim();

  if (explicitTrailerUrl) {
    return explicitTrailerUrl;
  }

  return (
    getMappedTrailerUrlForTitle(movie.title || '') ||
    getMappedTrailerUrlForTitle(movie.name || '') ||
    getMappedTrailerUrlForTitle(movie.original_title || '') ||
    getMappedTrailerUrlForTitle(movie.file_name || '') ||
    getMappedTrailerUrlForTitle(movie.sourceFileName || '') ||
    pickRandomReviewTrailerUrl()
  );
}

export function getReviewTrailerEmbedUrl(
  movie: Pick<Movie, 'title' | 'name' | 'original_title' | 'file_name' | 'sourceFileName' | 'trailer_url'> | null,
  options?: { autoplay?: boolean }
) {
  return getYouTubeEmbedUrl(getReviewTrailerUrl(movie), options);
}
