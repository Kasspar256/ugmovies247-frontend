import { adminDb } from '@/lib/firebaseAdmin';
import {
  LEGACY_MOVIES_COLLECTION,
  MOVIES_COLLECTION,
} from '@/lib/server/firestoreNamespaces';

export const TRAILER_MEDIA_COLLECTION = 'movies__trailers';
export const BETA_TESTER_EMAIL = 'test@ugmovies247.com';
const LICENSED_COUNTRIES = new Set(['ZA', 'UG']);
const PRODUCTION_COLLECTION_CANDIDATES = Array.from(
  new Set([
    LEGACY_MOVIES_COLLECTION,
    MOVIES_COLLECTION,
    'movies__production',
    'movies__development',
    'movies__staging',
  ])
);

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

export async function getMediaCollectionName(
  req: MediaCollectionRequest,
  userProfile: MediaUserProfile
) {
  const email = userProfile?.email || '';

  if (email === BETA_TESTER_EMAIL) {
    return TRAILER_MEDIA_COLLECTION;
  }

  const countryCode = getHeaderValue(req, 'cf-ipcountry').trim().toUpperCase();

  if (LICENSED_COUNTRIES.has(countryCode)) {
    return resolveMovieCollectionName();
  }

  return TRAILER_MEDIA_COLLECTION;
}

let resolvedMovieCollectionNamePromise: Promise<string> | null = null;

async function countCollectionDocuments(collectionName: string) {
  try {
    const snapshot = await adminDb.collection(collectionName).count().get();
    const count = snapshot.data().count;
    return Number.isFinite(count) ? count : 0;
  } catch (error) {
    console.warn(
      `[movie-collection] count failed for ${collectionName}, falling back to sampled read`,
      error
    );
    const snapshot = await adminDb.collection(collectionName).limit(500).get();
    return snapshot.size;
  }
}

export async function resolveMovieCollectionName() {
  if (MOVIES_COLLECTION === LEGACY_MOVIES_COLLECTION) {
    return MOVIES_COLLECTION;
  }

  if (!resolvedMovieCollectionNamePromise) {
    resolvedMovieCollectionNamePromise = (async () => {
      const rankedCollections = await Promise.all(
        PRODUCTION_COLLECTION_CANDIDATES.map(async (collectionName, index) => {
          try {
            return {
              collectionName,
              count: await countCollectionDocuments(collectionName),
              index,
            };
          } catch (error) {
            console.warn(`[movie-collection] failed to inspect ${collectionName}`, error);
            return {
              collectionName,
              count: 0,
              index,
            };
          }
        })
      );

      rankedCollections.sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }

        return left.index - right.index;
      });

      return (
        rankedCollections.find((entry) => entry.count > 0)?.collectionName ||
        MOVIES_COLLECTION
      );
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
