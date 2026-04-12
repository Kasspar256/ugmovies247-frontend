import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import {
  type CachedMovieCatalog,
  inMemoryMovieCache,
  persistMovieCatalog,
  readMovieCatalogFromDisk,
  setInMemoryMovieCache,
} from '@/lib/server/movieCatalogCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentAuthSession();

    if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        {
          error: 'Admin backend is not configured yet.',
          detail: adminSetupError,
        },
        { status: 500 }
      );
    }

    let movies: Array<Record<string, unknown>>;

    try {
      const snapshot = await adminDb.collection('movies').orderBy('date_added', 'desc').get();
      movies = snapshot.docs.map((movieDoc) => ({
        id: movieDoc.id,
        ...movieDoc.data(),
      }));

      const cache: CachedMovieCatalog = {
        movies,
        cachedAt: new Date().toISOString(),
      };

      setInMemoryMovieCache(cache);
      await persistMovieCatalog(cache);
    } catch (firestoreError) {
      const staleCache = (await readMovieCatalogFromDisk()) || inMemoryMovieCache;

      if (!staleCache?.movies?.length) {
        throw firestoreError;
      }

      console.warn('[admin] Firestore unavailable, serving stale admin movie cache', firestoreError);
      movies = staleCache.movies;
    }

    return NextResponse.json({ movies });
  } catch (error) {
    console.error('[admin] failed to load admin movies', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load admin movies.',
      },
      { status: 500 }
    );
  }
}
