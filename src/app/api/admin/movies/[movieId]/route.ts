import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { deleteR2Object, getR2ObjectKeyFromPublicUrl } from '@/lib/server/r2';
import { removeMovieFromCatalogCache } from '@/lib/server/movieCatalogCache';
import type { Episode, Movie } from '@/types/movie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function collectCandidateUrls(movie: Movie) {
  const urls = new Set<string>();

  if (movie.video_url) {
    urls.add(movie.video_url);
  }

  if (movie.sourceUrl) {
    urls.add(movie.sourceUrl);
  }

  for (const season of movie.seasons || []) {
    for (const episode of season.episodes || []) {
      const candidateEpisode = episode as Episode;

      if (candidateEpisode.video_url) {
        urls.add(candidateEpisode.video_url);
      }

      if (candidateEpisode.sourceUrl) {
        urls.add(candidateEpisode.sourceUrl);
      }
    }
  }

  return [...urls].filter(Boolean);
}

export async function DELETE(
  _request: Request,
  context: { params: { movieId: string } }
) {
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

    const { movieId } = context.params;

    if (!movieId) {
      return NextResponse.json({ error: 'Missing movie ID.' }, { status: 400 });
    }

    const movieRef = adminDb.collection('movies').doc(movieId);
    const snapshot = await movieRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Movie not found.' }, { status: 404 });
    }

    const movie = { id: snapshot.id, ...(snapshot.data() || {}) } as Movie;
    const objectKeys = collectCandidateUrls(movie)
      .map((url) => getR2ObjectKeyFromPublicUrl(url))
      .filter(Boolean);

    await movieRef.delete();

    const deletedObjectKeys: string[] = [];

    for (const objectKey of objectKeys) {
      try {
        await deleteR2Object(objectKey);
        deletedObjectKeys.push(objectKey);
      } catch (error) {
        console.warn('[admin] failed to delete R2 object during movie removal', {
          movieId,
          objectKey,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    await removeMovieFromCatalogCache(movieId);

    return NextResponse.json({
      success: true,
      movieId,
      deletedObjectKeys,
    });
  } catch (error) {
    console.error('[admin] failed to delete movie', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete movie.',
      },
      { status: 500 }
    );
  }
}
