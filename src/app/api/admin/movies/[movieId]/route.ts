import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { deleteR2Object, getR2ObjectKeyFromPublicUrl } from '@/lib/server/r2';
import {
  removeEpisodeFromCatalogCache,
  removeMovieFromCatalogCache,
  upsertMovieInCatalogCache,
} from '@/lib/server/movieCatalogCache';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import type { Episode, Movie } from '@/types/movie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function collectCandidateUrlsFromEpisode(episode: Partial<Episode>) {
  const urls = new Set<string>();

  if (episode.video_url) {
    urls.add(episode.video_url);
  }

  if (episode.sourceUrl) {
    urls.add(episode.sourceUrl);
  }

  if (episode.poster) {
    urls.add(episode.poster);
  }

  if (episode.thumbnail) {
    urls.add(episode.thumbnail);
  }

  if (episode.masterPlaylistUrl) {
    urls.add(episode.masterPlaylistUrl);
  }

  for (const rendition of episode.availableRenditions || []) {
    if (rendition?.playlistUrl) {
      urls.add(rendition.playlistUrl);
    }
  }

  return [...urls].filter(Boolean);
}

function parseOptionalInteger(requestUrl: URL, name: string) {
  const rawValue = requestUrl.searchParams.get(name);

  if (rawValue === null || rawValue.trim() === '') {
    return null;
  }

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function collectCandidateUrls(movie: Movie) {
  const urls = new Set<string>();

  if (movie.video_url) {
    urls.add(movie.video_url);
  }

  if (movie.sourceUrl) {
    urls.add(movie.sourceUrl);
  }

  if (movie.poster) {
    urls.add(movie.poster);
  }

  if (movie.masterPlaylistUrl) {
    urls.add(movie.masterPlaylistUrl);
  }

  for (const rendition of movie.availableRenditions || []) {
    if (rendition?.playlistUrl) {
      urls.add(rendition.playlistUrl);
    }
  }

  for (const season of movie.seasons || []) {
    for (const episode of season.episodes || []) {
      for (const url of collectCandidateUrlsFromEpisode(episode as Episode)) {
        urls.add(url);
      }
    }
  }

  return [...urls].filter(Boolean);
}

export async function DELETE(
  request: Request,
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

    const movieRef = adminDb.collection(MOVIES_COLLECTION).doc(movieId);
    const snapshot = await movieRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Movie not found.' }, { status: 404 });
    }

    const movie = { id: snapshot.id, ...(snapshot.data() || {}) } as Movie;
    const requestUrl = new URL(request.url);
    const seasonNumber = parseOptionalInteger(requestUrl, 'seasonNumber');
    const episodeNumber = parseOptionalInteger(requestUrl, 'episodeNumber');

    const deletedObjectKeys: string[] = [];

    if (seasonNumber !== null && episodeNumber !== null) {
      const targetSeason = (movie.seasons || []).find(
        (season) => Number(season.seasonNumber) === seasonNumber
      );
      const targetEpisode = targetSeason?.episodes?.find(
        (episode) => Number(episode.episodeNumber) === episodeNumber
      );

      if (!targetSeason || !targetEpisode) {
        return NextResponse.json({ error: 'Episode not found.' }, { status: 404 });
      }

      const nextSeasons = (movie.seasons || [])
        .map((season) => {
          if (Number(season.seasonNumber) !== seasonNumber) {
            return season;
          }

          return {
            ...season,
            episodes: (season.episodes || []).filter(
              (episode) => Number(episode.episodeNumber) !== episodeNumber
            ),
          };
        })
        .filter((season) => (season.episodes || []).length > 0);

      await movieRef.set(
        {
          seasons: nextSeasons,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      const objectKeys = collectCandidateUrlsFromEpisode(targetEpisode)
        .map((url) => getR2ObjectKeyFromPublicUrl(url))
        .filter(Boolean);

      for (const objectKey of objectKeys) {
        try {
          await deleteR2Object(objectKey);
          deletedObjectKeys.push(objectKey);
        } catch (error) {
          console.warn('[admin] failed to delete R2 object during episode removal', {
            movieId,
            seasonNumber,
            episodeNumber,
            objectKey,
            error: error instanceof Error ? error.message : error,
          });
        }
      }

      await removeEpisodeFromCatalogCache(movieId, seasonNumber, episodeNumber);

      return NextResponse.json({
        success: true,
        movieId,
        seasonNumber,
        episodeNumber,
        deletedObjectKeys,
      });
    }

    const objectKeys = collectCandidateUrls(movie)
      .map((url) => getR2ObjectKeyFromPublicUrl(url))
      .filter(Boolean);

    await movieRef.delete();

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

export async function PATCH(
  request: Request,
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

    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      description?: string;
      poster?: string;
      vj?: string;
    };

    const movieRef = adminDb.collection(MOVIES_COLLECTION).doc(movieId);
    const snapshot = await movieRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Movie not found.' }, { status: 404 });
    }

    const movie = { id: snapshot.id, ...(snapshot.data() || {}) } as Movie;
    const requestUrl = new URL(request.url);
    const seasonNumber = parseOptionalInteger(requestUrl, 'seasonNumber');
    const episodeNumber = parseOptionalInteger(requestUrl, 'episodeNumber');
    const nextUpdatedAt = new Date().toISOString();

    const nextTitle = typeof body.title === 'string' ? body.title.trim() : undefined;
    const nextDescription =
      typeof body.description === 'string' ? body.description.trim() : undefined;
    const nextPoster = typeof body.poster === 'string' ? body.poster.trim() : undefined;
    const nextVj = typeof body.vj === 'string' ? body.vj.trim() : undefined;

    if (nextTitle !== undefined && !nextTitle) {
      return NextResponse.json({ error: 'Title cannot be empty.' }, { status: 400 });
    }

    if (seasonNumber !== null && episodeNumber !== null) {
      const targetSeason = (movie.seasons || []).find(
        (season) => Number(season.seasonNumber) === seasonNumber
      );
      const targetEpisode = targetSeason?.episodes?.find(
        (episode) => Number(episode.episodeNumber) === episodeNumber
      );

      if (!targetSeason || !targetEpisode) {
        return NextResponse.json({ error: 'Episode not found.' }, { status: 404 });
      }

      const updatedSeasons = (movie.seasons || []).map((season) => {
        if (Number(season.seasonNumber) !== seasonNumber) {
          return season;
        }

        return {
          ...season,
          episodes: (season.episodes || []).map((episode) => {
            if (Number(episode.episodeNumber) !== episodeNumber) {
              return episode;
            }

            const updatedEpisode = {
              ...episode,
              title: nextTitle ?? episode.title,
              description: nextDescription ?? episode.description ?? '',
              poster: nextPoster ?? episode.poster ?? '',
              thumbnail:
                nextPoster !== undefined &&
                (!episode.thumbnail || episode.thumbnail === episode.poster)
                  ? nextPoster
                  : episode.thumbnail ?? '',
              updatedAt: nextUpdatedAt,
            };

            return updatedEpisode;
          }),
        };
      });

      await movieRef.set(
        {
          seasons: updatedSeasons,
          updatedAt: nextUpdatedAt,
        },
        { merge: true }
      );

      const updatedMovie = {
        ...movie,
        seasons: updatedSeasons,
        updatedAt: nextUpdatedAt,
      };

      await upsertMovieInCatalogCache(updatedMovie);

      return NextResponse.json({
        success: true,
        movie: {
          id: movie.id,
          ...updatedMovie,
        },
      });
    }

    const updates: Record<string, unknown> = {
      updatedAt: nextUpdatedAt,
    };

    if (nextTitle !== undefined) {
      updates.title = nextTitle;
      updates.original_title = nextTitle;
      updates.name = nextTitle;
    }

    if (nextDescription !== undefined) {
      updates.description = nextDescription;
      updates.overview = nextDescription;
    }

    if (nextPoster !== undefined) {
      updates.poster = nextPoster;
    }

    if (nextVj !== undefined) {
      updates.vj = nextVj || 'Unknown';
    }

    await movieRef.set(updates, { merge: true });

    const updatedMovie = {
      ...movie,
      ...updates,
    };

    await upsertMovieInCatalogCache(updatedMovie);

    return NextResponse.json({
      success: true,
      movie: {
        id: movie.id,
        ...updatedMovie,
      },
    });
  } catch (error) {
    console.error('[admin] failed to update movie metadata', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update movie metadata.',
      },
      { status: 500 }
    );
  }
}
