import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import {
  clearMovieCatalogQuotaFailure,
  type CachedMovieCatalog,
  inMemoryMovieCache,
  isFreshMovieCache,
  isMovieCatalogQuotaBlocked,
  pickMovieCatalogCache,
  persistMovieCatalog,
  readMovieCatalogFromDisk,
  recordMovieCatalogQuotaFailure,
  setInMemoryMovieCache,
  upsertMovieInCatalogCache,
} from '@/lib/server/movieCatalogCache';
import { buildEditableMovieDocument } from '@/lib/server/adminMovieMutations';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ADMIN_MOVIE_FALLBACK_TIMEOUT_MS = 1000 * 4;

async function readAdminMovieSnapshotWithFallback(hasFallback: boolean) {
  const queryPromise = adminDb.collection(MOVIES_COLLECTION).orderBy('date_added', 'desc').get();

  if (!hasFallback) {
    return queryPromise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Admin movie catalog read timed out while cache fallback was available.'));
    }, ADMIN_MOVIE_FALLBACK_TIMEOUT_MS);
  });

  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    queryPromise.catch(() => undefined);
  }
}

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

    if (isFreshMovieCache(inMemoryMovieCache)) {
      return NextResponse.json({ movies: inMemoryMovieCache.movies, source: 'memory-cache' });
    }

    const diskCache = await readMovieCatalogFromDisk();
    const staleCache = pickMovieCatalogCache(inMemoryMovieCache, diskCache);

    if (isFreshMovieCache(diskCache)) {
      setInMemoryMovieCache(diskCache);
      return NextResponse.json({ movies: diskCache.movies, source: 'disk-cache' });
    }

    if (staleCache?.movies?.length && isMovieCatalogQuotaBlocked()) {
      if (diskCache) {
        setInMemoryMovieCache(diskCache);
      }

      return NextResponse.json({ movies: staleCache.movies, source: 'stale-cache-quota-cooldown' });
    }

    let movies: Array<Record<string, unknown>>;

    try {
      const snapshot = await readAdminMovieSnapshotWithFallback(Boolean(staleCache?.movies?.length));
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
      clearMovieCatalogQuotaFailure();
    } catch (firestoreError) {
      recordMovieCatalogQuotaFailure(firestoreError);

      if (staleCache?.movies?.length) {
        console.warn('[admin] Firestore unavailable, serving stale admin movie cache', firestoreError);
        return NextResponse.json({ movies: staleCache.movies, source: 'stale-cache' });
      }

      throw firestoreError;
    }

    return NextResponse.json({ movies, source: 'firestore' });
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

export async function POST(request: Request) {
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

    const body = (await request.json().catch(() => ({}))) as {
      movie?: Record<string, unknown>;
    };
    const incomingMovie = body.movie || {};
    const movieRef = adminDb.collection(MOVIES_COLLECTION).doc();
    const moviePayload = buildEditableMovieDocument(incomingMovie);
    const createdMovie = {
      ...moviePayload,
      movieId: movieRef.id,
    };

    if (
      createdMovie.contentType === 'movie' &&
      !createdMovie.video_url &&
      (!createdMovie.parts || createdMovie.parts.length === 0)
    ) {
      return NextResponse.json(
        { error: 'Movie entries need either one MP4 source or at least one movie part.' },
        { status: 400 }
      );
    }

    if (
      createdMovie.contentType === 'series' &&
      (!createdMovie.seasons || createdMovie.seasons.length === 0)
    ) {
      return NextResponse.json(
        { error: 'Series entries need at least one season with one episode.' },
        { status: 400 }
      );
    }

    await movieRef.set(createdMovie);
    await upsertMovieInCatalogCache({
      id: movieRef.id,
      ...createdMovie,
    });

    return NextResponse.json({
      success: true,
      movie: {
        id: movieRef.id,
        ...createdMovie,
      },
    });
  } catch (error) {
    console.error('[admin] failed to create admin movie', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create admin movie.',
      },
      { status: 500 }
    );
  }
}
