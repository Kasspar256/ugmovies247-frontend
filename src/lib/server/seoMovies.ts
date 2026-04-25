import { adminDb } from '@/lib/firebaseAdmin';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import {
  inMemoryMovieCache,
  pickMovieCatalogCache,
  readMovieCatalogFromDisk,
} from '@/lib/server/movieCatalogCache';
import { normalizeMovie, type Movie } from '@/types/movie';

const SEO_MOVIE_LIMIT = 1000;

function normalizeMovies(movies: Array<Record<string, unknown>>) {
  return movies
    .map((movie) => normalizeMovie(String(movie.id || movie.movieId || ''), movie))
    .filter((movie) => movie.id && movie.title);
}

export async function getSeoMovieCatalog(limit = SEO_MOVIE_LIMIT): Promise<Movie[]> {
  const diskCache = await readMovieCatalogFromDisk();
  const cache = pickMovieCatalogCache(inMemoryMovieCache, diskCache);

  if (cache?.movies?.length) {
    return normalizeMovies(cache.movies).slice(0, limit);
  }

  try {
    const snapshot = await adminDb.collection(MOVIES_COLLECTION).orderBy('date_added', 'desc').limit(limit).get();

    return normalizeMovies(
      snapshot.docs.map((movieDoc) => ({
        id: movieDoc.id,
        ...movieDoc.data(),
      }))
    );
  } catch (error) {
    console.warn('[seo] failed to load movie catalog for metadata', error);
    return [];
  }
}

export async function getSeoMovieById(movieId: string) {
  const decodedMovieId = decodeURIComponent(movieId || '');

  if (!decodedMovieId) {
    return null;
  }

  const cachedMovies = await getSeoMovieCatalog();
  const cachedMovie = cachedMovies.find(
    (movie) => movie.id === decodedMovieId || movie.movieId === decodedMovieId
  );

  if (cachedMovie) {
    return cachedMovie;
  }

  try {
    const snapshot = await adminDb.collection(MOVIES_COLLECTION).doc(decodedMovieId).get();

    if (!snapshot.exists) {
      return null;
    }

    return normalizeMovie(snapshot.id, {
      id: snapshot.id,
      ...snapshot.data(),
    });
  } catch (error) {
    console.warn('[seo] failed to load movie metadata', error);
    return null;
  }
}
