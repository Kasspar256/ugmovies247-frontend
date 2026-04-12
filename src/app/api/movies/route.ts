import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { getSubscriptionSnapshotFromData, getViewerEntitlement } from '@/lib/server/subscriptions';
import { sanitizeMovieForViewer } from '@/lib/server/contentAccess';
import type { SubscriptionEntitlement } from '@/types/subscriptions';
import {
  type CachedMovieCatalog,
  inMemoryMovieCache,
  isFreshMovieCache,
  persistMovieCatalog,
  readMovieCatalogFromDisk,
  setInMemoryMovieCache,
} from '@/lib/server/movieCatalogCache';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ENTITLEMENT: SubscriptionEntitlement = {
  hasPremiumAccess: false,
  requiresSubscription: true,
  subscription: getSubscriptionSnapshotFromData(null),
};

async function fetchMovieCatalog() {
  if (isFreshMovieCache(inMemoryMovieCache)) {
    return inMemoryMovieCache;
  }

  const diskCache = await readMovieCatalogFromDisk();

  if (isFreshMovieCache(diskCache)) {
    setInMemoryMovieCache(diskCache);
    return diskCache;
  }

  try {
    const snapshot = await adminDb.collection(MOVIES_COLLECTION).orderBy('date_added', 'desc').get();
    const cache: CachedMovieCatalog = {
      movies: snapshot.docs.map((movieDoc) => ({
        id: movieDoc.id,
        ...movieDoc.data(),
      })),
      cachedAt: new Date().toISOString(),
    };

    setInMemoryMovieCache(cache);
    await persistMovieCatalog(cache);
    return cache;
  } catch (error) {
    const staleCache = diskCache || inMemoryMovieCache;

    if (staleCache?.movies?.length) {
      console.warn('[movies-api] Firestore unavailable, serving stale movie cache', error);
      return staleCache;
    }

    throw error;
  }
}

export async function GET() {
  try {
    const session = await getCurrentAuthSession();
    const entitlement = session ? await getViewerEntitlement(session.uid) : DEFAULT_ENTITLEMENT;

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        { error: 'Movie catalog backend is not configured.', detail: adminSetupError },
        { status: 500 }
      );
    }

    const catalog = await fetchMovieCatalog();
    const movies = catalog.movies.map((movieDoc) =>
      sanitizeMovieForViewer(
        movieDoc,
        entitlement
      )
    );

    return NextResponse.json({ movies, entitlement });
  } catch (error) {
    console.error('[movies-api] failed to load movies', error);
    return NextResponse.json(
      {
        error: 'Failed to load movies.',
        detail: error instanceof Error ? error.message : 'Unknown movies API error.',
      },
      { status: 500 }
    );
  }
}
