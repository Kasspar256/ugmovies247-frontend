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
