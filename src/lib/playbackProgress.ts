import type {
  CachedPlaybackProgressRecord,
  PlaybackProgressMovieInput,
  PlaybackProgressRecord,
} from '@/types/playbackProgress';

const PLAYBACK_PROGRESS_CACHE_KEY = 'ugmovies247.playback-progress.v1';
const MAX_CACHED_PROGRESS_ITEMS = 50;

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeSeconds(value: unknown) {
  const parsedValue = Number(value || 0);
  return Number.isFinite(parsedValue) ? Math.max(0, Math.floor(parsedValue)) : 0;
}

function normalizeProgressPercent(lastPosition: number, totalDuration: number) {
  if (totalDuration <= 0) {
    return 0;
  }

  return Math.min(Math.max(Math.round((lastPosition / totalDuration) * 100), 0), 100);
}

function timestampToMs(value: PlaybackProgressRecord['lastUpdated']) {
  if (!value?.seconds) {
    return Date.now();
  }

  return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
}

function normalizeCachedRecord(
  record: Partial<CachedPlaybackProgressRecord> & PlaybackProgressMovieInput
): CachedPlaybackProgressRecord | null {
  const movieId = String(record.movieId || '').trim();

  if (!movieId) {
    return null;
  }

  const lastPosition = normalizeSeconds(record.lastPosition);
  const totalDuration = normalizeSeconds(record.totalDuration);
  const isFinished =
    record.isFinished === true || (totalDuration > 0 && lastPosition / totalDuration > 0.9);

  return {
    id: String(record.id || movieId),
    movieId,
    title: String(record.title || 'Untitled movie'),
    poster: String(record.poster || ''),
    watchHref: String(record.watchHref || `/movie/${movieId}`),
    lastPosition,
    totalDuration,
    progressPercent: normalizeProgressPercent(lastPosition, totalDuration),
    isFinished,
    lastUpdatedMs: typeof record.lastUpdatedMs === 'number' && Number.isFinite(record.lastUpdatedMs)
      ? Number(record.lastUpdatedMs)
      : Date.now(),
  };
}

function readRawCache() {
  if (!canUseLocalStorage()) {
    return [] as CachedPlaybackProgressRecord[];
  }

  try {
    const rawValue = window.localStorage.getItem(PLAYBACK_PROGRESS_CACHE_KEY);

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .map((record) => normalizeCachedRecord(record as CachedPlaybackProgressRecord))
      .filter((record): record is CachedPlaybackProgressRecord => Boolean(record));
  } catch {
    return [];
  }
}

function persistCache(records: CachedPlaybackProgressRecord[]) {
  if (!canUseLocalStorage()) {
    return records;
  }

  const normalizedRecords = records
    .map((record) => normalizeCachedRecord(record))
    .filter((record): record is CachedPlaybackProgressRecord => Boolean(record))
    .sort((left, right) => right.lastUpdatedMs - left.lastUpdatedMs)
    .slice(0, MAX_CACHED_PROGRESS_ITEMS);

  try {
    window.localStorage.setItem(PLAYBACK_PROGRESS_CACHE_KEY, JSON.stringify(normalizedRecords));
  } catch {
    // If storage is full or blocked, the app still works from Firestore.
  }

  return normalizedRecords;
}

export function readCachedContinueWatching() {
  return readRawCache()
    .filter((record) => !record.isFinished)
    .sort((left, right) => right.lastUpdatedMs - left.lastUpdatedMs);
}

export function getCachedPlaybackProgress(movieId: string) {
  const normalizedMovieId = String(movieId || '').trim();

  if (!normalizedMovieId) {
    return null;
  }

  return readRawCache().find((record) => record.movieId === normalizedMovieId) || null;
}

export function writeCachedPlaybackProgress(record: PlaybackProgressMovieInput) {
  const normalizedRecord = normalizeCachedRecord({
    ...record,
    lastUpdatedMs: Date.now(),
  });

  if (!normalizedRecord) {
    return readCachedContinueWatching();
  }

  const recordsByMovieId = new Map(readRawCache().map((cachedRecord) => [
    cachedRecord.movieId,
    cachedRecord,
  ]));

  recordsByMovieId.set(normalizedRecord.movieId, normalizedRecord);

  persistCache(Array.from(recordsByMovieId.values()));

  return readCachedContinueWatching();
}

export function cachePlaybackProgressRecords(records: PlaybackProgressRecord[]) {
  const cachedRecords = records
    .map((record) =>
      normalizeCachedRecord({
        ...record,
        lastUpdatedMs: timestampToMs(record.lastUpdated),
      })
    )
    .filter((record): record is CachedPlaybackProgressRecord => Boolean(record));

  return persistCache(cachedRecords).filter((record) => !record.isFinished);
}

export async function fetchPlaybackProgressRecords() {
  const response = await fetch('/api/user/playback-progress', {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    return readCachedContinueWatching();
  }

  const payload = (await response.json().catch(() => ({}))) as {
    records?: PlaybackProgressRecord[];
  };

  return cachePlaybackProgressRecords(Array.isArray(payload.records) ? payload.records : []);
}

export async function fetchPlaybackProgressRecord(movieId: string) {
  const normalizedMovieId = String(movieId || '').trim();

  if (!normalizedMovieId) {
    return null;
  }

  const response = await fetch(
    `/api/user/playback-progress?movieId=${encodeURIComponent(normalizedMovieId)}`,
    {
      credentials: 'include',
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    return getCachedPlaybackProgress(normalizedMovieId);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    record?: PlaybackProgressRecord | null;
  };

  if (!payload.record) {
    return getCachedPlaybackProgress(normalizedMovieId);
  }

  const [cachedRecord] = cachePlaybackProgressRecords([payload.record]);
  return cachedRecord || getCachedPlaybackProgress(normalizedMovieId);
}
