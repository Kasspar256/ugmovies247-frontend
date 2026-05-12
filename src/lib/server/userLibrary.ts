import * as admin from 'firebase-admin';
import { adminDb } from '@/lib/firebaseAdmin';
import type { DownloadMovieInput, DownloadRecord } from '@/types/downloads';
import type { LikeMovieInput, LikeRecord } from '@/types/likes';
import type { WatchHistoryMovieInput, WatchHistoryRecord } from '@/types/watchHistory';
import type { WatchlistMovieInput, WatchlistRecord } from '@/types/watchlist';

const DOWNLOADS_COLLECTION = 'downloads';
const WATCHLIST_COLLECTION = 'watchlist';
const LIKES_COLLECTION = 'likes';
const WATCH_HISTORY_COLLECTION = 'watch_history';

function buildLibraryDocumentId(userId: string, movieId: string) {
  return encodeURIComponent(`${userId}__${movieId}`);
}

function serializeTimestamp(
  value: unknown
): { seconds?: number; nanoseconds?: number } | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const timestamp = new Date(value).getTime();

    if (!Number.isFinite(timestamp)) {
      return null;
    }

    return {
      seconds: Math.floor(timestamp / 1000),
      nanoseconds: (timestamp % 1000) * 1_000_000,
    };
  }

  if (typeof value === 'object' && value !== null) {
    const rawValue = value as {
      seconds?: unknown;
      _seconds?: unknown;
      nanoseconds?: unknown;
      _nanoseconds?: unknown;
      toDate?: () => Date;
    };

    const seconds = rawValue.seconds ?? rawValue._seconds;
    const nanoseconds = rawValue.nanoseconds ?? rawValue._nanoseconds;

    if (typeof seconds === 'number') {
      return {
        seconds,
        nanoseconds: typeof nanoseconds === 'number' ? nanoseconds : 0,
      };
    }

    if (typeof rawValue.toDate === 'function') {
      const date = rawValue.toDate();
      const timestamp = date.getTime();

      if (!Number.isFinite(timestamp)) {
        return null;
      }

      return {
        seconds: Math.floor(timestamp / 1000),
        nanoseconds: (timestamp % 1000) * 1_000_000,
      };
    }
  }

  return null;
}

function getTimestampSeconds(value: { seconds?: number; nanoseconds?: number } | null | undefined) {
  return value?.seconds || 0;
}

function normalizeDownloadRecord(id: string, data: Record<string, unknown>): DownloadRecord {
  return {
    id,
    movieId: String(data.movieId || ''),
    title: String(data.title || 'Untitled movie'),
    video_url: String(data.video_url || ''),
    poster: String(data.poster || ''),
    userId: String(data.userId || ''),
    status: data.status === 'downloading' || data.status === 'failed' ? data.status : 'completed',
    description: typeof data.description === 'string' ? data.description : '',
    downloadedAt: serializeTimestamp(data.downloadedAt),
  };
}

function normalizeWatchlistRecord(id: string, data: Record<string, unknown>): WatchlistRecord {
  return {
    id,
    movieId: String(data.movieId || ''),
    title: String(data.title || 'Untitled movie'),
    poster: String(data.poster || ''),
    video_url: String(data.video_url || ''),
    userId: String(data.userId || ''),
    savedAt: serializeTimestamp(data.savedAt),
  };
}

function normalizeLikeRecord(id: string, data: Record<string, unknown>): LikeRecord {
  return {
    id,
    movieId: String(data.movieId || ''),
    title: String(data.title || 'Untitled movie'),
    poster: String(data.poster || ''),
    userId: String(data.userId || ''),
    likedAt: serializeTimestamp(data.likedAt),
  };
}

function normalizeWatchHistoryRecord(id: string, data: Record<string, unknown>): WatchHistoryRecord {
  const progressSeconds = Number(data.progressSeconds || 0);
  const durationSeconds = Number(data.durationSeconds || 0);
  const progressPercent = Number(data.progressPercent || 0);

  return {
    id,
    movieId: String(data.movieId || ''),
    title: String(data.title || 'Untitled movie'),
    poster: String(data.poster || ''),
    watchHref: String(data.watchHref || ''),
    userId: String(data.userId || ''),
    progressSeconds: Number.isFinite(progressSeconds) ? Math.max(0, progressSeconds) : 0,
    durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
    progressPercent: Number.isFinite(progressPercent)
      ? Math.min(Math.max(progressPercent, 0), 100)
      : 0,
    completed: data.completed === true,
    lastWatchedAt: serializeTimestamp(data.lastWatchedAt),
  };
}

export async function getUserDownload(uid: string, movieId: string) {
  const snapshot = await adminDb
    .collection(DOWNLOADS_COLLECTION)
    .doc(buildLibraryDocumentId(uid, movieId))
    .get();

  if (!snapshot.exists) {
    return null;
  }

  return normalizeDownloadRecord(snapshot.id, snapshot.data() || {});
}

export async function listUserDownloads(uid: string) {
  const snapshot = await adminDb
    .collection(DOWNLOADS_COLLECTION)
    .where('userId', '==', uid)
    .get();

  return snapshot.docs
    .map((doc) => normalizeDownloadRecord(doc.id, doc.data()))
    .sort((left, right) => getTimestampSeconds(right.downloadedAt) - getTimestampSeconds(left.downloadedAt));
}

export async function saveUserDownload(uid: string, movie: DownloadMovieInput) {
  const documentId = buildLibraryDocumentId(uid, movie.movieId);
  const documentRef = adminDb.collection(DOWNLOADS_COLLECTION).doc(documentId);
  const existing = await documentRef.get();

  if (existing.exists) {
    return {
      alreadyExists: true,
      record: normalizeDownloadRecord(existing.id, existing.data() || {}),
    };
  }

  await documentRef.set({
    movieId: String(movie.movieId),
    title: String(movie.title || 'Untitled movie'),
    video_url: String(movie.video_url || ''),
    poster: String(movie.poster || ''),
    userId: uid,
    status: 'completed',
    downloadedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const created = await documentRef.get();

  return {
    alreadyExists: false,
    record: normalizeDownloadRecord(created.id, created.data() || {}),
  };
}

export async function removeUserDownload(uid: string, movieId: string) {
  await adminDb
    .collection(DOWNLOADS_COLLECTION)
    .doc(buildLibraryDocumentId(uid, movieId))
    .delete();

  return { removed: true };
}

export async function getUserWatchlistMovie(uid: string, movieId: string) {
  const snapshot = await adminDb
    .collection(WATCHLIST_COLLECTION)
    .doc(buildLibraryDocumentId(uid, movieId))
    .get();

  if (!snapshot.exists) {
    return null;
  }

  return normalizeWatchlistRecord(snapshot.id, snapshot.data() || {});
}

export async function listUserWatchlist(uid: string) {
  const snapshot = await adminDb
    .collection(WATCHLIST_COLLECTION)
    .where('userId', '==', uid)
    .get();

  return snapshot.docs
    .map((doc) => normalizeWatchlistRecord(doc.id, doc.data()))
    .sort((left, right) => getTimestampSeconds(right.savedAt) - getTimestampSeconds(left.savedAt));
}

export async function saveUserWatchlistMovie(uid: string, movie: WatchlistMovieInput) {
  const documentId = buildLibraryDocumentId(uid, movie.movieId);
  const documentRef = adminDb.collection(WATCHLIST_COLLECTION).doc(documentId);
  const existing = await documentRef.get();

  if (existing.exists) {
    return {
      alreadyExists: true,
      record: normalizeWatchlistRecord(existing.id, existing.data() || {}),
    };
  }

  await documentRef.set({
    movieId: String(movie.movieId),
    title: String(movie.title || 'Untitled movie'),
    poster: String(movie.poster || ''),
    video_url: String(movie.video_url || ''),
    userId: uid,
    savedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const created = await documentRef.get();

  return {
    alreadyExists: false,
    record: normalizeWatchlistRecord(created.id, created.data() || {}),
  };
}

export async function removeUserWatchlistMovie(uid: string, movieId: string) {
  await adminDb
    .collection(WATCHLIST_COLLECTION)
    .doc(buildLibraryDocumentId(uid, movieId))
    .delete();

  return { removed: true };
}

export async function getUserLike(uid: string, movieId: string) {
  const snapshot = await adminDb
    .collection(LIKES_COLLECTION)
    .doc(buildLibraryDocumentId(uid, movieId))
    .get();

  if (!snapshot.exists) {
    return null;
  }

  return normalizeLikeRecord(snapshot.id, snapshot.data() || {});
}

export async function listUserLikes(uid: string) {
  const snapshot = await adminDb
    .collection(LIKES_COLLECTION)
    .where('userId', '==', uid)
    .get();

  return snapshot.docs
    .map((doc) => normalizeLikeRecord(doc.id, doc.data()))
    .sort((left, right) => getTimestampSeconds(right.likedAt) - getTimestampSeconds(left.likedAt));
}

export async function saveUserLike(uid: string, movie: LikeMovieInput) {
  const documentId = buildLibraryDocumentId(uid, movie.movieId);
  const documentRef = adminDb.collection(LIKES_COLLECTION).doc(documentId);
  const existing = await documentRef.get();

  if (existing.exists) {
    return {
      alreadyExists: true,
      record: normalizeLikeRecord(existing.id, existing.data() || {}),
    };
  }

  await documentRef.set({
    movieId: String(movie.movieId),
    title: String(movie.title || 'Untitled movie'),
    poster: String(movie.poster || ''),
    userId: uid,
    likedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const created = await documentRef.get();

  return {
    alreadyExists: false,
    record: normalizeLikeRecord(created.id, created.data() || {}),
  };
}

export async function removeUserLike(uid: string, movieId: string) {
  await adminDb
    .collection(LIKES_COLLECTION)
    .doc(buildLibraryDocumentId(uid, movieId))
    .delete();

  return { removed: true };
}

export async function listUserWatchHistory(uid: string) {
  const snapshot = await adminDb
    .collection(WATCH_HISTORY_COLLECTION)
    .where('userId', '==', uid)
    .get();

  return snapshot.docs
    .map((doc) => normalizeWatchHistoryRecord(doc.id, doc.data()))
    .sort((left, right) => getTimestampSeconds(right.lastWatchedAt) - getTimestampSeconds(left.lastWatchedAt));
}

export async function saveUserWatchHistory(uid: string, movie: WatchHistoryMovieInput) {
  const documentId = buildLibraryDocumentId(uid, movie.movieId);
  const documentRef = adminDb.collection(WATCH_HISTORY_COLLECTION).doc(documentId);
  const existing = await documentRef.get();
  const progressSeconds = Number(movie.progressSeconds || 0);
  const durationSeconds = Number(movie.durationSeconds || 0);
  const progressPercent =
    Number.isFinite(movie.progressPercent) && movie.progressPercent !== undefined
      ? movie.progressPercent
      : durationSeconds > 0
        ? Math.round((progressSeconds / durationSeconds) * 100)
        : 0;

  await documentRef.set(
    {
      movieId: String(movie.movieId),
      title: String(movie.title || 'Untitled movie'),
      poster: String(movie.poster || ''),
      watchHref: String(movie.watchHref || ''),
      userId: uid,
      progressSeconds: Number.isFinite(progressSeconds) ? Math.max(0, progressSeconds) : 0,
      durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
      progressPercent: Number.isFinite(progressPercent)
        ? Math.min(Math.max(progressPercent, 0), 100)
        : 0,
      completed: movie.completed === true,
      lastWatchedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const saved = await documentRef.get();

  return {
    record: normalizeWatchHistoryRecord(saved.id, saved.data() || {}),
    countedAsNewPlay: !existing.exists,
  };
}
