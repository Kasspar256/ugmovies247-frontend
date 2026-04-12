import type { LikeMovieInput, LikeRecord } from '@/types/likes';

async function parseResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

export async function getUserLikedMovie(movieId: string) {
  const response = await fetch(`/api/user/likes?movieId=${encodeURIComponent(movieId)}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  const payload = await parseResponse<{ record: LikeRecord | null }>(response);
  return payload.record;
}

export async function saveMovieLike(movie: LikeMovieInput) {
  const response = await fetch('/api/user/likes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(movie),
  });

  return parseResponse<{ alreadyExists: boolean; record: LikeRecord }>(response);
}

export async function removeMovieLike(movieId: string) {
  const response = await fetch(`/api/user/likes?movieId=${encodeURIComponent(movieId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  return parseResponse<{ removed: boolean }>(response);
}

export async function fetchUserLikes(_userId?: string) {
  const response = await fetch('/api/user/likes', {
    credentials: 'include',
    cache: 'no-store',
  });

  const payload = await parseResponse<{ records: LikeRecord[] }>(response);
  return payload.records || [];
}
