import { normalizeMovie, type Movie } from '@/types/movie';

export async function fetchPublicMovies(): Promise<Movie[]> {
  const response = await fetch('/api/movies', {
    credentials: 'include',
    cache: 'no-store',
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || 'Failed to load movies.');
  }

  if (!Array.isArray(payload.movies)) {
    return [];
  }

  return payload.movies.map((movie: Record<string, unknown>) =>
    normalizeMovie(String(movie.id || ''), movie)
  );
}
