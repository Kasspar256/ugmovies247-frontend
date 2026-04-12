import { dedupeSeriesMovies } from '@/lib/moviePresentation';
import type { Movie } from '@/types/movie';

const LATEST_UPLOAD_SEEN_AT_KEY = 'ugmovies247.latest-uploads.last-seen-at';
const LATEST_UPLOAD_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getMovieTimestamp(movie: Movie) {
  const candidate = movie.date_added || movie.updatedAt || movie.createdAt || '';
  const timestamp = candidate ? new Date(candidate).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getLatestUploadedMovies(input: Movie[]) {
  return dedupeSeriesMovies(input)
    .filter((movie) => {
      const timestamp = getMovieTimestamp(movie);
      return Boolean(timestamp) && Date.now() - timestamp <= LATEST_UPLOAD_WINDOW_MS;
    })
    .sort((left, right) => getMovieTimestamp(right) - getMovieTimestamp(left))
    .slice(0, 20);
}

export function readLatestUploadsSeenAt() {
  if (!canUseLocalStorage()) {
    return 0;
  }

  try {
    const rawValue = window.localStorage.getItem(LATEST_UPLOAD_SEEN_AT_KEY);
    const parsed = rawValue ? Number(rawValue) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function markLatestUploadsAsSeen(movies: Movie[]) {
  const latestUploads = getLatestUploadedMovies(movies);
  const latestTimestamp = latestUploads.reduce((highest, movie) => {
    const timestamp = getMovieTimestamp(movie);
    return timestamp > highest ? timestamp : highest;
  }, 0);

  if (!latestTimestamp || !canUseLocalStorage()) {
    return latestTimestamp;
  }

  try {
    window.localStorage.setItem(LATEST_UPLOAD_SEEN_AT_KEY, String(latestTimestamp));
  } catch {
    // Ignore local storage write issues and keep the badge derived from current session state.
  }

  return latestTimestamp;
}

export function countUnreadLatestUploads(movies: Movie[]) {
  const latestUploads = getLatestUploadedMovies(movies);
  const seenAt = readLatestUploadsSeenAt();

  if (!seenAt) {
    return latestUploads.length;
  }

  return latestUploads.filter((movie) => getMovieTimestamp(movie) > seenAt).length;
}
