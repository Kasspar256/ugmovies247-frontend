import { isAppInReview } from '@/lib/appReview';
import { dedupeSeriesMovies } from '@/lib/moviePresentation';
import type { Movie } from '@/types/movie';

const DEFAULT_REVIEW_MIN_MOVIES = 5;

function getMovieStableKey(movie: Movie) {
  return String(movie.id || movie.movieId || movie.title || movie.name || movie.sourceFileName || '');
}

function hashString(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getStableFallbackMovies(seed: string, sourceMovies: Movie[]) {
  return [...sourceMovies].sort((left, right) => {
    const leftKey = hashString(`${seed}:${getMovieStableKey(left)}`);
    const rightKey = hashString(`${seed}:${getMovieStableKey(right)}`);
    return leftKey !== rightKey ? leftKey - rightKey : getMovieStableKey(left).localeCompare(getMovieStableKey(right));
  });
}

export function ensureReviewMinimumMovies(seed: string, movies: Movie[], sourceMovies: Movie[], minimumCount = DEFAULT_REVIEW_MIN_MOVIES) {
  const dedupedMovies = dedupeSeriesMovies(movies);

  if (!isAppInReview || dedupedMovies.length >= minimumCount || !sourceMovies.length) {
    return dedupedMovies;
  }

  const existingMovieKeys = new Set(dedupedMovies.map(getMovieStableKey));
  const fallbackSource = dedupeSeriesMovies(sourceMovies);
  const fallbackMovies = getStableFallbackMovies(seed, fallbackSource).filter(
    (movie) => !existingMovieKeys.has(getMovieStableKey(movie))
  );

  return [...dedupedMovies, ...fallbackMovies].slice(0, Math.min(minimumCount, fallbackSource.length));
}
