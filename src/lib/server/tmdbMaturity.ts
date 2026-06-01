import {
  isTmdbMatureExclusive,
  mergeMatureExclusiveCategory,
} from '@/lib/matureContent';

type TmdbMaturityMediaType = 'movie' | 'tv';

function normalizeTmdbId(value: unknown) {
  const numericValue = typeof value === 'number' ? value : Number(String(value || '').trim());
  return Number.isFinite(numericValue) && numericValue > 0 ? Math.round(numericValue) : null;
}

async function fetchTmdbMaturityPayload(tmdbId: number, mediaType: TmdbMaturityMediaType) {
  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    return null;
  }

  const url = new URL(`https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(String(tmdbId))}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set(
    'append_to_response',
    mediaType === 'tv' ? 'content_ratings' : 'release_dates'
  );

  const response = await fetch(url.toString(), { cache: 'no-store' });

  if (!response.ok) {
    return null;
  }

  return response.json().catch(() => null);
}

export async function applyTmdbMatureExclusiveCategory(options: {
  categories: unknown;
  tmdbId?: unknown;
  mediaType: TmdbMaturityMediaType;
  tmdbPayload?: unknown;
  isKnownMatureExclusive?: boolean;
}) {
  const knownMature =
    options.isKnownMatureExclusive === true || isTmdbMatureExclusive(options.tmdbPayload);
  let categories = mergeMatureExclusiveCategory(options.categories, knownMature);

  if (knownMature) {
    return categories;
  }

  const tmdbId = normalizeTmdbId(options.tmdbId);

  if (!tmdbId) {
    return categories;
  }

  try {
    const payload = await fetchTmdbMaturityPayload(tmdbId, options.mediaType);
    categories = mergeMatureExclusiveCategory(categories, isTmdbMatureExclusive(payload));
  } catch (error) {
    console.warn('[tmdb-maturity] failed to inspect TMDB maturity rating', {
      tmdbId,
      mediaType: options.mediaType,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return categories;
}
