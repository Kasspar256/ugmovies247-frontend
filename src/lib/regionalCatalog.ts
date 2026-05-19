export type RegionalCatalogRecord = {
  category?: readonly string[] | null;
  genres?: readonly string[] | null;
  tags?: readonly string[] | null;
  country?: string | null;
  language?: string | null;
  original_language?: string | null;
  originalLanguage?: string | null;
};

const INDIAN_COUNTRY_SIGNALS = new Set([
  'bharat',
  'hindustan',
  'in',
  'india',
  'republic of india',
]);

const INDIAN_LANGUAGE_SIGNALS = new Set([
  'as',
  'assamese',
  'bn',
  'bengali',
  'gu',
  'gujarati',
  'hi',
  'hin',
  'hindi',
  'kn',
  'kan',
  'kannada',
  'kokani',
  'kokborok',
  'ks',
  'kashmiri',
  'ml',
  'malayalam',
  'mr',
  'marathi',
  'or',
  'odia',
  'pa',
  'panjabi',
  'punjabi',
  'sa',
  'sanskrit',
  'ta',
  'tam',
  'tamil',
  'te',
  'tel',
  'telugu',
  'ur',
  'urdu',
]);

const INDIAN_METADATA_SIGNALS = new Set([
  'bollywood',
  'hindi cinema',
  'hindi movie',
  'hindi movies',
  'india',
  'indian',
  'indian cinema',
  'indian movie',
  'indian movies',
  'kollywood',
  'mollywood',
  'sandalwood',
  'south indian',
  'south indian movie',
  'south indian movies',
  'tollywood',
]);

export function normalizeRegionalCatalogValue(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompact(value: unknown) {
  return normalizeRegionalCatalogValue(value).replace(/\s+/g, '');
}

function includesSignal(value: unknown, signals: Set<string>) {
  const normalized = normalizeRegionalCatalogValue(value);

  if (!normalized) {
    return false;
  }

  if (signals.has(normalized) || signals.has(normalizeCompact(normalized))) {
    return true;
  }

  const tokens = normalized.split(' ').filter(Boolean);

  return tokens.some((token) => signals.has(token));
}

function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

export function isIndianSectionName(value: unknown) {
  return (
    includesSignal(value, INDIAN_METADATA_SIGNALS) ||
    includesSignal(value, INDIAN_LANGUAGE_SIGNALS)
  );
}

export function isIndianCatalogMovie(movie: RegionalCatalogRecord) {
  if (includesSignal(movie.country, INDIAN_COUNTRY_SIGNALS)) {
    return true;
  }

  if (
    includesSignal(movie.language, INDIAN_LANGUAGE_SIGNALS) ||
    includesSignal(movie.original_language, INDIAN_LANGUAGE_SIGNALS) ||
    includesSignal(movie.originalLanguage, INDIAN_LANGUAGE_SIGNALS)
  ) {
    return true;
  }

  const metadataValues = [
    ...toStringList(movie.category),
    ...toStringList(movie.genres),
    ...toStringList(movie.tags),
  ];

  return metadataValues.some(
    (value) =>
      includesSignal(value, INDIAN_METADATA_SIGNALS) ||
      includesSignal(value, INDIAN_LANGUAGE_SIGNALS)
  );
}

export function mergeUniqueRegionalValues(...lists: Array<readonly string[] | null | undefined>) {
  const values = new Map<string, string>();

  for (const list of lists) {
    for (const value of list || []) {
      const cleaned = String(value || '').trim();

      if (!cleaned) {
        continue;
      }

      const key = normalizeRegionalCatalogValue(cleaned);

      if (!values.has(key)) {
        values.set(key, cleaned);
      }
    }
  }

  return [...values.values()];
}
