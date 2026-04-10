import { db } from '@/lib/firebase';
import { getClientDownloadUserId } from '@/lib/downloads';
import type { WatchlistMovieInput, WatchlistRecord } from '@/types/watchlist';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
} from 'firebase/firestore';
import type { FirebaseError } from 'firebase/app';

export function getWatchlistDocumentId(userId: string, movieId: string) {
  return encodeURIComponent(`${userId}__${movieId}`);
}

function normalizeWatchlistRecord(id: string, data: DocumentData): WatchlistRecord {
  return {
    id,
    movieId: String(data.movieId || ''),
    title: String(data.title || 'Untitled movie'),
    poster: String(data.poster || ''),
    video_url: String(data.video_url || ''),
    userId: String(data.userId || ''),
    savedAt: data.savedAt || null,
  };
}

function logWatchlistFirebaseError(stage: string, error: unknown, context: Record<string, unknown>) {
  const firebaseError = error as FirebaseError & { customData?: unknown };

  console.error(`[watchlist] ${stage} failed`, {
    context,
    code: firebaseError?.code || 'unknown',
    message: firebaseError?.message || String(error),
    customData: firebaseError?.customData || null,
    fullError: error,
  });
}

export async function getUserWatchlistMovie(movieId: string, userId?: string) {
  const resolvedUserId = userId || (await getClientDownloadUserId());
  const watchlistRef = doc(db, 'watchlist', getWatchlistDocumentId(resolvedUserId, movieId));
  let snapshot;

  try {
    snapshot = await getDoc(watchlistRef);
  } catch (error) {
    logWatchlistFirebaseError('getDoc(watchlist state)', error, {
      movieId,
      userId: resolvedUserId,
      watchlistId: getWatchlistDocumentId(resolvedUserId, movieId),
      collection: 'watchlist',
    });
    throw error;
  }

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeWatchlistRecord(snapshot.id, snapshot.data());
}

export async function saveMovieToWatchlist(movie: WatchlistMovieInput) {
  const userId = await getClientDownloadUserId();
  const watchlistId = getWatchlistDocumentId(userId, movie.movieId);
  const watchlistRef = doc(db, 'watchlist', watchlistId);
  const payload = {
    movieId: String(movie.movieId),
    title: String(movie.title || 'Untitled movie'),
    poster: String(movie.poster || ''),
    video_url: String(movie.video_url || ''),
    userId,
    savedAt: serverTimestamp(),
  };

  console.log('[watchlist] saveMovieToWatchlist:start', {
    movieId: payload.movieId,
    userId,
    watchlistId,
    collection: 'watchlist',
    payload: {
      ...payload,
      savedAt: 'serverTimestamp()',
    },
  });

  try {
    await setDoc(watchlistRef, payload);
    console.log('[watchlist] saveMovieToWatchlist:write-success', {
      movieId: payload.movieId,
      userId,
      watchlistId,
    });
  } catch (error) {
    logWatchlistFirebaseError('setDoc(watchlist write)', error, {
      movieId: payload.movieId,
      userId,
      watchlistId,
      collection: 'watchlist',
      payloadKeys: Object.keys(payload),
    });
    throw error;
  }

  return { alreadyExists: false, userId, id: watchlistId };
}

export async function removeMovieFromWatchlist(movieId: string) {
  const userId = await getClientDownloadUserId();
  const watchlistId = getWatchlistDocumentId(userId, movieId);
  const watchlistRef = doc(db, 'watchlist', watchlistId);

  try {
    await deleteDoc(watchlistRef);
    console.log('[watchlist] removeMovieFromWatchlist:delete-success', {
      movieId,
      userId,
      watchlistId,
    });
  } catch (error) {
    logWatchlistFirebaseError('deleteDoc(watchlist remove)', error, {
      movieId,
      userId,
      watchlistId,
      collection: 'watchlist',
    });
    throw error;
  }

  return { removed: true, userId, id: watchlistId };
}

export async function fetchUserWatchlist(userId: string) {
  const watchlistQuery = query(
    collection(db, 'watchlist'),
    where('userId', '==', userId)
  );
  const snapshot = await getDocs(watchlistQuery);

  return snapshot.docs
    .map((watchlistDoc) => normalizeWatchlistRecord(watchlistDoc.id, watchlistDoc.data()))
    .sort((a, b) => {
      const first = a.savedAt?.seconds || 0;
      const second = b.savedAt?.seconds || 0;
      return second - first;
    });
}
