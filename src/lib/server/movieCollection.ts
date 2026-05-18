import { adminDb } from '@/lib/firebaseAdmin';
import {
  LEGACY_MOVIES_COLLECTION,
  MOVIES_COLLECTION,
} from '@/lib/server/firestoreNamespaces';

export const PRODUCTION_MEDIA_COLLECTION = 'movies__production';
export const TRAILER_MEDIA_COLLECTION = 'movies__trailers';
export const BETA_TESTER_EMAIL = 'test@ugmovies247.com';
const LICENSED_COUNTRIES = new Set(['ZA', 'UG']);

type HeaderValue = string | string[] | undefined;
type HeaderMap = Record<string, HeaderValue>;
type MediaCollectionRequest = {
  headers?: Headers | HeaderMap;
};

type MediaUserProfile = {
  email?: string;
} | null | undefined;

function getHeaderValue(req: MediaCollectionRequest, headerName: string) {
  const headers = req.headers;

  if (!headers) {
    return '';
  }

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(headerName) || '';
  }

  const headerMap = headers as HeaderMap;
  const value = Object.entries(headerMap).find(
    ([key]) => key.toLowerCase() === headerName.toLowerCase()
  )?.[1];

  return Array.isArray(value) ? value[0] || '' : value || '';
}

export function getMediaCollectionName(
  req: MediaCollectionRequest,
  userProfile: MediaUserProfile
) {
  const email = userProfile?.email || '';

  if (email === BETA_TESTER_EMAIL) {
    return TRAILER_MEDIA_COLLECTION;
  }

  const countryCode = getHeaderValue(req, 'cf-ipcountry').trim().toUpperCase();

  if (LICENSED_COUNTRIES.has(countryCode)) {
    return PRODUCTION_MEDIA_COLLECTION;
  }

  return TRAILER_MEDIA_COLLECTION;
}

let resolvedMovieCollectionNamePromise: Promise<string> | null = null;

async function collectionHasDocuments(collectionName: string) {
  const snapshot = await adminDb.collection(collectionName).limit(1).get();
  return !snapshot.empty;
}

export async function resolveMovieCollectionName() {
  if (MOVIES_COLLECTION === LEGACY_MOVIES_COLLECTION) {
    return MOVIES_COLLECTION;
  }

  if (!resolvedMovieCollectionNamePromise) {
    resolvedMovieCollectionNamePromise = (async () => {
      const [legacyHasDocuments, scopedHasDocuments] = await Promise.all([
        collectionHasDocuments(LEGACY_MOVIES_COLLECTION),
        collectionHasDocuments(MOVIES_COLLECTION),
      ]);

      // Restore the long-standing catalog first. Some environments may already
      // have a populated legacy `movies` collection plus a few newer scoped
      // test docs. Preferring scoped in that case makes the public app look
      // empty because the API only sees the newer partial data set.
      if (legacyHasDocuments) {
        return LEGACY_MOVIES_COLLECTION;
      }

      if (scopedHasDocuments) {
        return MOVIES_COLLECTION;
      }

      return MOVIES_COLLECTION;
    })().catch((error) => {
      resolvedMovieCollectionNamePromise = null;
      throw error;
    });
  }

  return resolvedMovieCollectionNamePromise;
}

export function resetResolvedMovieCollectionName() {
  resolvedMovieCollectionNamePromise = null;
}

export async function getMoviesCollectionRef() {
  const collectionName = await resolveMovieCollectionName();
  return adminDb.collection(collectionName);
}

export async function createMovieDocumentRef() {
  const collection = await getMoviesCollectionRef();
  return collection.doc();
}

export async function getMovieDocumentRef(movieId: string) {
  const preferredCollection = await resolveMovieCollectionName();
  const alternateCollection =
    preferredCollection === LEGACY_MOVIES_COLLECTION
      ? MOVIES_COLLECTION
      : LEGACY_MOVIES_COLLECTION;

  const preferredRef = adminDb.collection(preferredCollection).doc(movieId);
  const preferredSnapshot = await preferredRef.get();

  if (preferredSnapshot.exists) {
    return preferredRef;
  }

  if (alternateCollection !== preferredCollection) {
    const alternateRef = adminDb.collection(alternateCollection).doc(movieId);
    const alternateSnapshot = await alternateRef.get();

    if (alternateSnapshot.exists) {
      return alternateRef;
    }
  }

  return preferredRef;
}
