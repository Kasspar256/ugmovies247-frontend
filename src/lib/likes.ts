import { db } from '@/lib/firebase';
import { getClientDownloadUserId } from '@/lib/downloads';
import type { LikeMovieInput, LikeRecord } from '@/types/likes';
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

export function getLikeDocumentId(userId: string, movieId: string) {
  return encodeURIComponent(`${userId}__${movieId}`);
}

function normalizeLikeRecord(id: string, data: DocumentData): LikeRecord {
  return {
    id,
    movieId: String(data.movieId || ''),
    title: String(data.title || 'Untitled movie'),
    poster: String(data.poster || ''),
    userId: String(data.userId || ''),
    likedAt: data.likedAt || null,
  };
}

function logLikeFirebaseError(stage: string, error: unknown, context: Record<string, unknown>) {
  const firebaseError = error as FirebaseError & { customData?: unknown };

  console.error(`[likes] ${stage} failed`, {
    context,
    code: firebaseError?.code || 'unknown',
    message: firebaseError?.message || String(error),
    customData: firebaseError?.customData || null,
    fullError: error,
  });
}

export async function getUserLikedMovie(movieId: string, userId?: string) {
  const resolvedUserId = userId || (await getClientDownloadUserId());
  const likeRef = doc(db, 'likes', getLikeDocumentId(resolvedUserId, movieId));
  let snapshot;

  try {
    snapshot = await getDoc(likeRef);
  } catch (error) {
    logLikeFirebaseError('getDoc(like state)', error, {
      movieId,
      userId: resolvedUserId,
      likeId: getLikeDocumentId(resolvedUserId, movieId),
      collection: 'likes',
    });
    throw error;
  }

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeLikeRecord(snapshot.id, snapshot.data());
}

export async function saveMovieLike(movie: LikeMovieInput) {
  const userId = await getClientDownloadUserId();
  const likeId = getLikeDocumentId(userId, movie.movieId);
  const likeRef = doc(db, 'likes', likeId);
  const payload = {
    movieId: String(movie.movieId),
    title: String(movie.title || 'Untitled movie'),
    poster: String(movie.poster || ''),
    userId,
    likedAt: serverTimestamp(),
  };

  console.log('[likes] saveMovieLike:start', {
    movieId: payload.movieId,
    userId,
    likeId,
    collection: 'likes',
    payload: {
      ...payload,
      likedAt: 'serverTimestamp()',
    },
  });

  try {
    await setDoc(likeRef, payload);
    console.log('[likes] saveMovieLike:write-success', {
      movieId: payload.movieId,
      userId,
      likeId,
    });
  } catch (error) {
    logLikeFirebaseError('setDoc(like write)', error, {
      movieId: payload.movieId,
      userId,
      likeId,
      collection: 'likes',
      payloadKeys: Object.keys(payload),
    });
    throw error;
  }

  return { alreadyExists: false, userId, id: likeId };
}

export async function removeMovieLike(movieId: string) {
  const userId = await getClientDownloadUserId();
  const likeId = getLikeDocumentId(userId, movieId);
  const likeRef = doc(db, 'likes', likeId);

  try {
    await deleteDoc(likeRef);
    console.log('[likes] removeMovieLike:delete-success', {
      movieId,
      userId,
      likeId,
    });
  } catch (error) {
    logLikeFirebaseError('deleteDoc(like remove)', error, {
      movieId,
      userId,
      likeId,
      collection: 'likes',
    });
    throw error;
  }

  return { removed: true, userId, id: likeId };
}

export async function fetchUserLikes(userId: string) {
  const likesQuery = query(
    collection(db, 'likes'),
    where('userId', '==', userId)
  );
  const snapshot = await getDocs(likesQuery);

  return snapshot.docs
    .map((likeDoc) => normalizeLikeRecord(likeDoc.id, likeDoc.data()))
    .sort((a, b) => {
      const first = a.likedAt?.seconds || 0;
      const second = b.likedAt?.seconds || 0;
      return second - first;
    });
}
