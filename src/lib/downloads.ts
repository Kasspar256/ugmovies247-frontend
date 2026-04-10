import { auth, db } from '@/lib/firebase';
import {
  collection,
  deleteDoc,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import type { FirebaseError } from 'firebase/app';
import type { DownloadMovieInput, DownloadRecord, DownloadStatus } from '@/types/downloads';

const TEMP_DOWNLOAD_USER_KEY = 'ugmovies247-temp-download-user';

function createTemporaryUserId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `temp-${crypto.randomUUID()}`;
  }

  return `temp-${Math.random().toString(36).slice(2, 10)}`;
}

export function getTemporaryDownloadUserId() {
  if (typeof window === 'undefined') {
    return 'temp-server-user';
  }

  const existingId = window.localStorage.getItem(TEMP_DOWNLOAD_USER_KEY);
  if (existingId) {
    return existingId;
  }

  const newId = createTemporaryUserId();
  window.localStorage.setItem(TEMP_DOWNLOAD_USER_KEY, newId);
  return newId;
}

export function getDownloadDocumentId(userId: string, movieId: string) {
  return encodeURIComponent(`${userId}__${movieId}`);
}

export function getClientDownloadUserId() {
  if (auth.currentUser?.uid) {
    return Promise.resolve(auth.currentUser.uid);
  }

  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Authentication is required.'));
  }

  return new Promise<string>((resolve) => {
    let settled = false;

    const finish = (userId: string) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(userId);
    };

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        finish(user?.uid || '');
      },
      () => {
        unsubscribe();
        finish('');
      }
    );
    
    setTimeout(() => {
      if (!settled) {
        unsubscribe();
        finish('');
      }
    }, 2000);
  }).then((userId) => {
    if (!userId) {
      throw new Error('You must be logged in to use this feature.');
    }

    return userId;
  });
}

function normalizeDownloadRecord(id: string, data: DocumentData) {
  const status: DownloadStatus =
    data.status === 'downloading' || data.status === 'failed' || data.status === 'completed'
      ? data.status
      : 'completed';

  return {
    id,
    movieId: String(data.movieId || ''),
    title: String(data.title || 'Untitled movie'),
    video_url: String(data.video_url || ''),
    poster: String(data.poster || ''),
    userId: String(data.userId || ''),
    status,
    description: typeof data.description === 'string' ? data.description : '',
    downloadedAt: data.downloadedAt || null,
  } as DownloadRecord;
}

function logDownloadFirebaseError(stage: string, error: unknown, context: Record<string, unknown>) {
  const firebaseError = error as FirebaseError & { customData?: unknown };

  console.error(`[downloads] ${stage} failed`, {
    context,
    code: firebaseError?.code || 'unknown',
    message: firebaseError?.message || String(error),
    customData: firebaseError?.customData || null,
    fullError: error,
  });
}

export async function getUserDownloadByMovieId(movieId: string, userId?: string) {
  const resolvedUserId = userId || (await getClientDownloadUserId());
  const downloadRef = doc(db, 'downloads', getDownloadDocumentId(resolvedUserId, movieId));
  const snapshot = await getDoc(downloadRef);

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeDownloadRecord(snapshot.id, snapshot.data());
}

export async function saveMovieDownload(movie: DownloadMovieInput) {
  const userId = await getClientDownloadUserId();
  const downloadId = getDownloadDocumentId(userId, movie.movieId);
  const downloadRef = doc(db, 'downloads', downloadId);

  const downloadPayload = {
    movieId: String(movie.movieId),
    title: String(movie.title || 'Untitled movie'),
    video_url: String(movie.video_url || ''),
    poster: String(movie.poster || ''),
    userId,
    downloadedAt: serverTimestamp(),
  };

  console.log('[downloads] saveMovieDownload:start', {
    movieId: downloadPayload.movieId,
    userId,
    downloadId,
    collection: 'downloads',
    payload: {
      ...downloadPayload,
      downloadedAt: 'serverTimestamp()',
    },
  });

  try {
    await setDoc(downloadRef, downloadPayload);
    console.log('[downloads] saveMovieDownload:write-success', {
      movieId: downloadPayload.movieId,
      userId,
      downloadId,
    });
  } catch (error) {
    logDownloadFirebaseError('setDoc(download write)', error, {
      movieId: downloadPayload.movieId,
      userId,
      downloadId,
      collection: 'downloads',
      payloadKeys: Object.keys(downloadPayload),
    });
    throw error;
  }

  return { alreadyExists: false, userId, id: downloadId };
}

export async function removeMovieDownload(movieId: string) {
  const userId = await getClientDownloadUserId();
  const downloadId = getDownloadDocumentId(userId, movieId);
  const downloadRef = doc(db, 'downloads', downloadId);

  try {
    await deleteDoc(downloadRef);
    console.log('[downloads] removeMovieDownload:delete-success', {
      movieId,
      userId,
      downloadId,
    });
  } catch (error) {
    logDownloadFirebaseError('deleteDoc(download remove)', error, {
      movieId,
      userId,
      downloadId,
      collection: 'downloads',
    });
    throw error;
  }

  return { removed: true, userId, id: downloadId };
}

export async function fetchUserDownloads(userId: string) {
  const downloadsQuery = query(
    collection(db, 'downloads'),
    where('userId', '==', userId)
  );
  const snapshot = await getDocs(downloadsQuery);

  return snapshot.docs
    .map((downloadDoc) => normalizeDownloadRecord(downloadDoc.id, downloadDoc.data()))
    .sort((a, b) => {
      const first = a.downloadedAt?.seconds || 0;
      const second = b.downloadedAt?.seconds || 0;
      return second - first;
    });
}
