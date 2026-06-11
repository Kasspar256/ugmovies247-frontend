import type { Movie } from '@/types/movie';

export const PENDING_MOVIE_NAVIGATION_KEY = 'ugmovies247.pending-movie-navigation.v1';

export function rememberPendingMovieNavigation(movie: Movie) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(
      PENDING_MOVIE_NAVIGATION_KEY,
      JSON.stringify({
        movie: {
          id: movie.id,
          movieId: movie.movieId || movie.id,
          title: movie.title || movie.name || '',
          name: movie.name || '',
          poster: movie.poster || '',
          heroPoster: movie.heroPoster || '',
          backdrop: movie.overriddenBackdrop || movie.overriddenPlayerBackdrop || movie.playerBackdrop || '',
          contentType: movie.contentType || 'movie',
          vj: movie.vj || '',
          genres: movie.genres || [],
        },
        cachedAt: Date.now(),
      })
    );
  } catch {
    // A failed transition hint should never block navigation.
  }
}

export function readPendingMovieNavigation(maxAgeMs = 1000 * 60 * 5) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_MOVIE_NAVIGATION_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      movie?: Partial<Movie>;
      cachedAt?: number;
    };

    if (!parsed.movie?.id || !parsed.cachedAt || Date.now() - parsed.cachedAt > maxAgeMs) {
      window.sessionStorage.removeItem(PENDING_MOVIE_NAVIGATION_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingMovieNavigation() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.removeItem(PENDING_MOVIE_NAVIGATION_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}
