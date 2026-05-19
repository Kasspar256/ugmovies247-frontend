import { GENRE_DIRECTORY, VJ_DIRECTORY } from '@/config/constants';
import { isIndianCatalogMovie, isIndianSectionName } from '@/lib/regionalCatalog';
import type { Movie } from '@/types/movie';

export const CATALOG_FILTER_ALL = '__all__';

export type CatalogFilterKind = 'vj' | 'genre';

export function cleanCatalogOption(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeCatalogValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripCatalogVjPrefix(value?: string | null) {
  return cleanCatalogOption(value).replace(/^vj\s+/i, '');
}

export function formatCatalogVjOption(value?: string | null) {
  const vjName = stripCatalogVjPrefix(value);
  return vjName ? `VJ ${vjName}` : '';
}

function normalizeCompact(value: string) {
  return normalizeCatalogValue(value).replace(/\s+/g, '');
}

function getNormalizedTokens(value: string) {
  return normalizeCatalogValue(value).split(' ').filter(Boolean);
}

function normalizeVjForMatch(value: string) {
  return normalizeCatalogValue(stripCatalogVjPrefix(value));
}

export function getCatalogMovieGenres(movie: Movie) {
  return Array.from(
    new Set([...(movie.genres || []), ...(movie.category || [])].map(cleanCatalogOption).filter(Boolean))
  );
}

export function getCatalogVjName(movie: Movie) {
  const vj = stripCatalogVjPrefix(movie.vj);
  return vj && vj.toLowerCase() !== 'unknown' ? vj : '';
}

export function getCatalogVjLabel(movie: Movie) {
  const vj = getCatalogVjName(movie);
  return vj ? `VJ ${vj}` : 'VJ HD';
}

export function matchesCatalogSelectedValue(value: string, selectedValue: string) {
  const normalizedValue = normalizeCatalogValue(value);
  const normalizedSelected = normalizeCatalogValue(selectedValue);

  if (!normalizedValue || !normalizedSelected) {
    return false;
  }

  if (
    normalizedValue === normalizedSelected ||
    normalizeCompact(value) === normalizeCompact(selectedValue)
  ) {
    return true;
  }

  const valueTokens = new Set(getNormalizedTokens(value));
  return getNormalizedTokens(selectedValue).every((token) => valueTokens.has(token));
}

export function matchesCatalogSelectedVj(value: string, selectedValue: string) {
  const normalizedValue = normalizeVjForMatch(value);
  const normalizedSelected = normalizeVjForMatch(selectedValue);

  if (!normalizedValue || !normalizedSelected) {
    return false;
  }

  if (
    normalizedValue === normalizedSelected ||
    normalizeCompact(normalizedValue) === normalizeCompact(normalizedSelected)
  ) {
    return true;
  }

  const valueTokens = new Set(getNormalizedTokens(normalizedValue));
  return getNormalizedTokens(normalizedSelected).every((token) => valueTokens.has(token));
}

export function uniqueCatalogOptionsInOrder(values: string[]) {
  const seen = new Set<string>();
  const options: string[] = [];

  values.forEach((value) => {
    const option = cleanCatalogOption(value);
    const key = normalizeCatalogValue(option);

    if (!option || seen.has(key)) {
      return;
    }

    seen.add(key);
    options.push(option);
  });

  return options;
}

export function buildCatalogVjOptions(catalog: Movie[]) {
  return uniqueCatalogOptionsInOrder([
    ...VJ_DIRECTORY.map((vj) => formatCatalogVjOption(vj.name)),
    ...catalog.map((movie) => formatCatalogVjOption(getCatalogVjName(movie))),
  ]);
}

export function buildCatalogGenreOptions(catalog: Movie[]) {
  return uniqueCatalogOptionsInOrder([...GENRE_DIRECTORY, ...catalog.flatMap(getCatalogMovieGenres)]);
}

export function filterCatalogBySelection(catalog: Movie[], selectedVj: string, selectedGenre: string) {
  return catalog.filter((movie) => {
    const matchesVj =
      selectedVj === CATALOG_FILTER_ALL ||
      matchesCatalogSelectedVj(getCatalogVjName(movie), selectedVj);
    const matchesGenre =
      selectedGenre === CATALOG_FILTER_ALL ||
      (isIndianSectionName(selectedGenre) && isIndianCatalogMovie(movie)) ||
      getCatalogMovieGenres(movie).some((genre) => matchesCatalogSelectedValue(genre, selectedGenre));

    return matchesVj && matchesGenre;
  });
}

export function buildCatalogEmptyMessage(contentLabel: string, selectedVj: string, selectedGenre: string) {
  if (selectedVj !== CATALOG_FILTER_ALL && selectedGenre !== CATALOG_FILTER_ALL) {
    return `No ${contentLabel} found for the selected VJ and Genre.`;
  }

  if (selectedVj !== CATALOG_FILTER_ALL) {
    return `No ${contentLabel} found for the selected VJ.`;
  }

  if (selectedGenre !== CATALOG_FILTER_ALL) {
    return `No ${contentLabel} found for the selected Genre.`;
  }

  return `No ${contentLabel} found right now.`;
}
