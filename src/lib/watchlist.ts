import type { WatchlistMovieInput, WatchlistRecord } from '@/types/watchlist';

async function parseResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

export async function getUserWatchlistMovie(movieId: string) {
  const response = await fetch(`/api/user/watchlist?movieId=${encodeURIComponent(movieId)}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  const payload = await parseResponse<{ record: WatchlistRecord | null }>(response);
  return payload.record;
}

export async function saveMovieToWatchlist(movie: WatchlistMovieInput) {
  const response = await fetch('/api/user/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(movie),
  });

  return parseResponse<{ alreadyExists: boolean; record: WatchlistRecord }>(response);
}

export async function removeMovieFromWatchlist(movieId: string) {
  const response = await fetch(`/api/user/watchlist?movieId=${encodeURIComponent(movieId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  return parseResponse<{ removed: boolean }>(response);
}

export async function fetchUserWatchlist(_userId?: string) {
  const response = await fetch('/api/user/watchlist', {
    credentials: 'include',
    cache: 'no-store',
  });

  const payload = await parseResponse<{ records: WatchlistRecord[] }>(response);
  return payload.records || [];
}
