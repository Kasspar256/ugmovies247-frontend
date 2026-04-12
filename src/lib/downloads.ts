import { fetchAuthStatus, readCachedAuthStatus } from '@/lib/auth/status-client';
import type { DownloadMovieInput, DownloadRecord } from '@/types/downloads';

async function parseResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

export async function getClientDownloadUserId() {
  const cachedStatus = readCachedAuthStatus();

  if (cachedStatus?.authenticated && cachedStatus.user?.id) {
    return cachedStatus.user.id;
  }

  const status = await fetchAuthStatus({ force: true });

  if (!status.authenticated || !status.user?.id) {
    throw new Error('You must be logged in to use this feature.');
  }

  return status.user.id;
}

export async function getUserDownloadByMovieId(movieId: string) {
  const response = await fetch(`/api/user/downloads?movieId=${encodeURIComponent(movieId)}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  const payload = await parseResponse<{ record: DownloadRecord | null }>(response);
  return payload.record;
}

export async function saveMovieDownload(movie: DownloadMovieInput) {
  const response = await fetch('/api/user/downloads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(movie),
  });

  return parseResponse<{ alreadyExists: boolean; record: DownloadRecord }>(response);
}

export async function removeMovieDownload(movieId: string) {
  const response = await fetch(`/api/user/downloads?movieId=${encodeURIComponent(movieId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  return parseResponse<{ removed: boolean }>(response);
}

export async function fetchUserDownloads(_userId?: string) {
  const response = await fetch('/api/user/downloads', {
    credentials: 'include',
    cache: 'no-store',
  });

  const payload = await parseResponse<{ records: DownloadRecord[] }>(response);
  return payload.records || [];
}
