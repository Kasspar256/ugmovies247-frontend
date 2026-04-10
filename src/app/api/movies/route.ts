import { NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { getViewerEntitlement } from '@/lib/server/subscriptions';
import { sanitizeMovieForViewer } from '@/lib/server/contentAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MOVIE_CACHE_TTL_MS = 1000 * 60 * 2;
const MOVIE_CACHE_PATH = path.join(process.cwd(), '.runtime-cache', 'movies-catalog.json');

type CachedMovieCatalog = {
  movies: Array<Record<string, unknown>>;
  cachedAt: string;
};

let inMemoryMovieCache: CachedMovieCatalog | null = null;

function isFreshCache(cache: CachedMovieCatalog | null) {
  if (!cache?.cachedAt) {
    return false;
  }

  return Date.now() - new Date(cache.cachedAt).getTime() < MOVIE_CACHE_TTL_MS;
}

async function readMovieCatalogFromDisk() {
  try {
    const raw = await readFile(MOVIE_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CachedMovieCatalog;

    if (!Array.isArray(parsed.movies) || typeof parsed.cachedAt !== 'string') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function persistMovieCatalog(cache: CachedMovieCatalog) {
  try {
    await mkdir(path.dirname(MOVIE_CACHE_PATH), { recursive: true });
    await writeFile(MOVIE_CACHE_PATH, JSON.stringify(cache), 'utf8');
  } catch (error) {
    console.warn('[movies-api] failed to persist movie cache', error);
  }
}

async function fetchMovieCatalog() {
  if (isFreshCache(inMemoryMovieCache)) {
    return inMemoryMovieCache;
  }

  const diskCache = await readMovieCatalogFromDisk();

  if (isFreshCache(diskCache)) {
    inMemoryMovieCache = diskCache;
    return diskCache;
  }

  try {
    const snapshot = await adminDb.collection('movies').orderBy('date_added', 'desc').get();
    const cache: CachedMovieCatalog = {
      movies: snapshot.docs.map((movieDoc) => ({
        id: movieDoc.id,
        ...movieDoc.data(),
      })),
      cachedAt: new Date().toISOString(),
    };

    inMemoryMovieCache = cache;
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

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entitlement = await getViewerEntitlement(session.uid);

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
