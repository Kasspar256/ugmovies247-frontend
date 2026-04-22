import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import { upsertMovieInCatalogCache } from '@/lib/server/movieCatalogCache';

type TmdbMovieSearchResult = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
};

type TmdbMovieDetails = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  genres?: Array<{
    id: number;
    name: string;
  }>;
};

type RepairCandidateRecord = Record<string, unknown> & {
  id: string;
};

export type GenreRepairSummary = {
  scannedMovies: number;
  candidateMovies: number;
  updatedMovies: number;
  updatedFromTmdbId: number;
  updatedFromSearch: number;
  unresolvedMovies: number;
  unresolvedTitles: string[];
};

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(vj|episode|season|part)\b.*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractReleaseYear(movie: Record<string, unknown>) {
  const releaseYear = movie.releaseYear;

  if (typeof releaseYear === 'number' && Number.isFinite(releaseYear)) {
    return releaseYear;
  }

  const releaseDate = movie.release_date;

  if (typeof releaseDate === 'string') {
    const year = Number.parseInt(releaseDate.slice(0, 4), 10);
    return Number.isFinite(year) ? year : null;
  }

  return null;
}

function getMovieTitle(movie: Record<string, unknown>) {
  const title =
    (typeof movie.title === 'string' && movie.title.trim()) ||
    (typeof movie.original_title === 'string' && movie.original_title.trim()) ||
    (typeof movie.name === 'string' && movie.name.trim()) ||
    'Untitled movie';

  return title;
}

function hasUsableGenres(value: unknown) {
  if (!Array.isArray(value)) {
    return false;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (!normalized.length) {
    return false;
  }

  return normalized.some((entry) => entry !== 'unknown');
}

async function fetchTmdbJson(path: string, params?: URLSearchParams) {
  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    throw new Error('TMDb API key is not configured.');
  }

  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set('api_key', apiKey);

  if (params) {
    params.forEach((value, key) => {
      if (value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }

  const response = await fetch(url.toString(), { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof payload?.status_message === 'string'
        ? payload.status_message
        : 'TMDb request failed.'
    );
  }

  return payload;
}

async function fetchMovieDetailsByTmdbId(tmdbId: number) {
  const payload = (await fetchTmdbJson(
    `/movie/${encodeURIComponent(String(tmdbId))}`
  )) as TmdbMovieDetails;

  return payload;
}

async function findMovieDetailsBySearch(movie: Record<string, unknown>) {
  const title = getMovieTitle(movie);
  const normalizedTitle = normalizeTitle(title);

  if (!normalizedTitle) {
    return null;
  }

  const params = new URLSearchParams({ query: title });
  const releaseYear = extractReleaseYear(movie);

  if (releaseYear) {
    params.set('year', String(releaseYear));
  }

  const payload = (await fetchTmdbJson('/search/movie', params)) as {
    results?: TmdbMovieSearchResult[];
  };
  const results = Array.isArray(payload.results) ? payload.results : [];

  if (!results.length) {
    return null;
  }

  const exactMatch = results.find((result) => {
    const candidateTitles = [result.title || '', result.original_title || '']
      .map((entry) => normalizeTitle(entry))
      .filter(Boolean);
    const resultYear = typeof result.release_date === 'string'
      ? Number.parseInt(result.release_date.slice(0, 4), 10)
      : null;

    const titleMatches = candidateTitles.includes(normalizedTitle);
    const yearMatches = !releaseYear || !resultYear || resultYear === releaseYear;

    return titleMatches && yearMatches;
  });

  const matchedResult =
    exactMatch ||
    (results.length === 1 ? results[0] : null);

  if (!matchedResult) {
    return null;
  }

  return fetchMovieDetailsByTmdbId(matchedResult.id);
}

async function resolveMovieGenres(movie: Record<string, unknown>) {
  const tmdbId = movie.tmdb_id;

  if (typeof tmdbId === 'number' && Number.isFinite(tmdbId)) {
    const details = await fetchMovieDetailsByTmdbId(tmdbId);
    return {
      details,
      matchedBy: 'tmdb_id' as const,
    };
  }

  const details = await findMovieDetailsBySearch(movie);

  if (!details) {
    return null;
  }

  return {
    details,
    matchedBy: 'title_search' as const,
  };
}

function toRepairCandidate(doc: QueryDocumentSnapshot) {
  return {
    id: doc.id,
    ...doc.data(),
  } as RepairCandidateRecord;
}

export async function repairMissingMovieGenres(): Promise<GenreRepairSummary> {
  const snapshot = await adminDb.collection(MOVIES_COLLECTION).get();
  const allMovies = snapshot.docs.map((doc) => toRepairCandidate(doc));
  const candidateMovies = allMovies.filter((movie) => {
    const contentType = typeof movie.contentType === 'string' ? movie.contentType : 'movie';
    return contentType !== 'series' && !hasUsableGenres(movie.genres);
  });

  let updatedMovies = 0;
  let updatedFromTmdbId = 0;
  let updatedFromSearch = 0;
  const unresolvedTitles: string[] = [];

  for (const movie of candidateMovies) {
    try {
      const resolved = await resolveMovieGenres(movie);

      if (!resolved) {
        unresolvedTitles.push(getMovieTitle(movie));
        continue;
      }

      const nextGenres = (resolved.details.genres || [])
        .map((genre) => genre.name?.trim() || '')
        .filter(Boolean);

      if (!nextGenres.length) {
        unresolvedTitles.push(getMovieTitle(movie));
        continue;
      }

      const nextPayload: Record<string, unknown> = {
        genres: nextGenres,
        updatedAt: new Date().toISOString(),
      };

      if (
        typeof movie.tmdb_id !== 'number' &&
        typeof resolved.details.id === 'number' &&
        Number.isFinite(resolved.details.id)
      ) {
        nextPayload.tmdb_id = resolved.details.id;
      }

      await adminDb.collection(MOVIES_COLLECTION).doc(movie.id).update(nextPayload);
      await upsertMovieInCatalogCache({
        ...movie,
        ...nextPayload,
      });

      updatedMovies += 1;

      if (resolved.matchedBy === 'tmdb_id') {
        updatedFromTmdbId += 1;
      } else {
        updatedFromSearch += 1;
      }
    } catch {
      unresolvedTitles.push(getMovieTitle(movie));
    }
  }

  return {
    scannedMovies: allMovies.length,
    candidateMovies: candidateMovies.length,
    updatedMovies,
    updatedFromTmdbId,
    updatedFromSearch,
    unresolvedMovies: unresolvedTitles.length,
    unresolvedTitles: unresolvedTitles.slice(0, 20),
  };
}
