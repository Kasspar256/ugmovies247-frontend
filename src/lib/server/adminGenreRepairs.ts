import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import { upsertMovieInCatalogCache } from '@/lib/server/movieCatalogCache';
import {
  hasExplicitIndianMetadata,
  isIndianCountryValue,
  isIndianOriginalLanguageValue,
  mergeUniqueRegionalValues,
  normalizeRegionalCatalogValue,
} from '@/lib/regionalCatalog';

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
  original_language?: string;
  genres?: Array<{
    id: number;
    name: string;
  }>;
  production_countries?: Array<{
    iso_3166_1?: string;
    name?: string;
  }>;
  spoken_languages?: Array<{
    english_name?: string;
    iso_639_1?: string;
    name?: string;
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

export type RegionalMetadataRepairSummary = {
  scannedMovies: number;
  candidateMovies: number;
  updatedMovies: number;
  taggedIndianMovies: number;
  cleanedIndianMovies: number;
  updatedCountries: number;
  updatedLanguages: number;
  unresolvedMovies: number;
  unresolvedTitles: string[];
};

const LANGUAGE_CODE_LABELS: Record<string, string> = {
  as: 'Assamese',
  bn: 'Bengali',
  gu: 'Gujarati',
  hi: 'Hindi',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  or: 'Odia',
  pa: 'Punjabi',
  ta: 'Tamil',
  te: 'Telugu',
  ur: 'Urdu',
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

function isBlankRegionalValue(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();

  return !normalized || normalized === 'unknown' || normalized === 'n/a' || normalized === 'na';
}

function getTmdbCountryLabel(details: TmdbMovieDetails) {
  const countries = details.production_countries || [];
  const india = countries.find((country) => country.iso_3166_1 === 'IN');
  const selectedCountry = india || countries[0];

  return selectedCountry?.name?.trim() || '';
}

function getTmdbLanguageLabel(details: TmdbMovieDetails) {
  const spokenLanguage = details.spoken_languages?.find(
    (language) => language.english_name || language.name
  );
  const languageCode = String(
    spokenLanguage?.iso_639_1 || details.original_language || ''
  ).toLowerCase();

  return (
    spokenLanguage?.english_name?.trim() ||
    spokenLanguage?.name?.trim() ||
    LANGUAGE_CODE_LABELS[languageCode] ||
    languageCode
  );
}

function tmdbDetailsConfirmIndian(details: TmdbMovieDetails) {
  return (
    isIndianCountryValue(getTmdbCountryLabel(details)) ||
    isIndianOriginalLanguageValue(details.original_language)
  );
}

function isIndianAutoTag(value: string) {
  const normalized = normalizeRegionalCatalogValue(value);

  return normalized === 'indian' || normalized === 'indian movies';
}

function removeIndianAutoTags(values: string[]) {
  return values.filter((value) => !isIndianAutoTag(value));
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

export async function repairMovieRegionalMetadata(): Promise<RegionalMetadataRepairSummary> {
  const snapshot = await adminDb.collection(MOVIES_COLLECTION).get();
  const allMovies = snapshot.docs.map((doc) => toRepairCandidate(doc));
  const candidateMovies = allMovies.filter((movie) => {
    const contentType = typeof movie.contentType === 'string' ? movie.contentType : 'movie';
    return (
      contentType !== 'series' &&
      typeof movie.tmdb_id === 'number' &&
      Number.isFinite(movie.tmdb_id) &&
      (isBlankRegionalValue(movie.country) ||
        isBlankRegionalValue(movie.language) ||
        isIndianCountryValue(movie.country) ||
        hasExplicitIndianMetadata({
          category: Array.isArray(movie.category)
            ? movie.category.filter((entry): entry is string => typeof entry === 'string')
            : [],
          genres: Array.isArray(movie.genres)
            ? movie.genres.filter((entry): entry is string => typeof entry === 'string')
            : [],
        }))
    );
  });

  let updatedMovies = 0;
  let taggedIndianMovies = 0;
  let cleanedIndianMovies = 0;
  let updatedCountries = 0;
  let updatedLanguages = 0;
  const unresolvedTitles: string[] = [];

  for (const movie of candidateMovies) {
    try {
      const details = await fetchMovieDetailsByTmdbId(movie.tmdb_id as number);
      const tmdbCountry = getTmdbCountryLabel(details);
      const tmdbLanguage = getTmdbLanguageLabel(details);
      const existingGenres = Array.isArray(movie.genres)
        ? movie.genres.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const tmdbGenres = (details.genres || [])
        .map((genre) => genre.name?.trim() || '')
        .filter(Boolean);
      const existingCategories = Array.isArray(movie.category)
        ? movie.category.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const nextPayload: Record<string, unknown> = {};

      if (
        tmdbCountry &&
        (isBlankRegionalValue(movie.country) ||
          (!tmdbDetailsConfirmIndian(details) && isIndianCountryValue(movie.country)))
      ) {
        nextPayload.country = tmdbCountry;
        updatedCountries += 1;
      }

      if (tmdbLanguage && isBlankRegionalValue(movie.language)) {
        nextPayload.language = tmdbLanguage;
        updatedLanguages += 1;
      }

      if (!hasUsableGenres(movie.genres) && tmdbGenres.length) {
        nextPayload.genres = tmdbGenres;
      }

      const nextGenres = (nextPayload.genres as string[] | undefined) || existingGenres;
      const confirmedIndianTitle = tmdbDetailsConfirmIndian(details);
      const currentlyTaggedIndian =
        isIndianCountryValue(movie.country) ||
        hasExplicitIndianMetadata({
          category: existingCategories,
          genres: existingGenres,
        });

      if (confirmedIndianTitle) {
        nextPayload.category = mergeUniqueRegionalValues(existingCategories, ['Indian movies']);
        nextPayload.genres = mergeUniqueRegionalValues(nextGenres, ['Indian']);
      } else if (currentlyTaggedIndian) {
        nextPayload.category = removeIndianAutoTags(existingCategories);
        nextPayload.genres = removeIndianAutoTags(nextGenres);
      }

      if (!Object.keys(nextPayload).length) {
        continue;
      }

      nextPayload.updatedAt = new Date().toISOString();

      await adminDb.collection(MOVIES_COLLECTION).doc(movie.id).update(nextPayload);
      await upsertMovieInCatalogCache({
        ...movie,
        ...nextPayload,
      });

      updatedMovies += 1;

      if (confirmedIndianTitle) {
        taggedIndianMovies += 1;
      } else if (currentlyTaggedIndian) {
        cleanedIndianMovies += 1;
      }
    } catch {
      unresolvedTitles.push(getMovieTitle(movie));
    }
  }

  return {
    scannedMovies: allMovies.length,
    candidateMovies: candidateMovies.length,
    updatedMovies,
    taggedIndianMovies,
    cleanedIndianMovies,
    updatedCountries,
    updatedLanguages,
    unresolvedMovies: unresolvedTitles.length,
    unresolvedTitles: unresolvedTitles.slice(0, 20),
  };
}
