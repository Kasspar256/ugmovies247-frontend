export const MATURE_EXCLUSIVES_CATEGORY = 'Mature Exclusives (18+)';
export const MATURE_EXCLUSIVES_DISPLAY_LABEL = 'MATURE EXCLUSIVES (18+)';
export const MATURE_EXCLUSIVES_ADMIN_LABEL =
  'Mature Exclusives (18+) - strict erotic 18+ only';

const STRICT_MATURE_CERTIFICATION_VALUES = new Set([
  '18',
  '18+',
  '18A',
  'A',
  'AO',
  'M18',
  'NC-17',
  'R18',
  'R18+',
  'X',
]);

const EROTIC_CONTEXT_CERTIFICATION_VALUES = new Set(['R', 'TV-MA']);

const EROTIC_SIGNAL_PATTERNS = [
  /\berotic(?:a|ism)?\b/i,
  /\berotic\s+thriller\b/i,
  /\bsoft\s*-?\s*core\b/i,
  /\bsex(?:ual|uality)?\b/i,
  /\bnud(?:e|ity)\b/i,
  /\badult\s+(?:film|movie|content|entertainment)\b/i,
  /\bpornograph(?:ic|y)?\b/i,
  /\bseduction\b/i,
  /\blust\b/i,
  /\bstripper\b/i,
  /\bbrothel\b/i,
  /\bescort\b/i,
  /\bprostitut(?:e|ion)\b/i,
  /\bdominatrix\b/i,
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function addRating(ratings: string[], value: unknown) {
  if (typeof value !== 'string') {
    return;
  }

  const normalized = value.trim();

  if (normalized) {
    ratings.push(normalized);
  }
}

function addTextSignal(signals: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    signals.push(value.trim());
  }
}

export function normalizeMatureCertification(value: unknown) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function isMatureCertification(value: unknown) {
  const normalized = normalizeMatureCertification(value);

  if (!normalized) {
    return false;
  }

  return (
    STRICT_MATURE_CERTIFICATION_VALUES.has(normalized) ||
    /^(NC-17|R18\+?|18\+?|X)$/i.test(normalized)
  );
}

export function isEroticContextCertification(value: unknown) {
  const normalized = normalizeMatureCertification(value);

  return EROTIC_CONTEXT_CERTIFICATION_VALUES.has(normalized);
}

export function collectTmdbMaturityRatings(payload: unknown) {
  const record = asRecord(payload);
  const ratings: string[] = [];

  if (!record) {
    return ratings;
  }

  addRating(ratings, record.certification);
  addRating(ratings, record.rating);
  addRating(ratings, record.rated);
  addRating(ratings, record.contentRating);
  addRating(ratings, record.ageRating);

  const releaseDates = asRecord(record.release_dates);
  for (const country of asArray(releaseDates?.results)) {
    const countryRecord = asRecord(country);

    for (const release of asArray(countryRecord?.release_dates)) {
      addRating(ratings, asRecord(release)?.certification);
    }
  }

  const contentRatings = asRecord(record.content_ratings);
  for (const country of asArray(contentRatings?.results)) {
    const countryRecord = asRecord(country);
    addRating(ratings, countryRecord?.rating);
  }

  return Array.from(new Set(ratings));
}

export function collectTmdbEroticSignals(payload: unknown) {
  const record = asRecord(payload);
  const signals: string[] = [];

  if (!record) {
    return signals;
  }

  addTextSignal(signals, record.title);
  addTextSignal(signals, record.original_title);
  addTextSignal(signals, record.name);
  addTextSignal(signals, record.original_name);
  addTextSignal(signals, record.overview);
  addTextSignal(signals, record.tagline);

  for (const genre of asArray(record.genres)) {
    const genreRecord = asRecord(genre);
    addTextSignal(signals, genreRecord?.name || genre);
  }

  for (const category of asArray(record.category)) {
    addTextSignal(signals, category);
  }

  for (const tag of asArray(record.tags)) {
    addTextSignal(signals, tag);
  }

  const keywords = asRecord(record.keywords);
  const keywordEntries = [
    ...asArray(keywords?.keywords),
    ...asArray(keywords?.results),
    ...asArray(record.keywords),
  ];

  for (const keyword of keywordEntries) {
    const keywordRecord = asRecord(keyword);
    addTextSignal(signals, keywordRecord?.name || keyword);
  }

  return Array.from(new Set(signals));
}

export function hasEroticMaturitySignal(payload: unknown) {
  const text = collectTmdbEroticSignals(payload).join(' ');

  if (!text.trim()) {
    return false;
  }

  return EROTIC_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function isTmdbMatureExclusive(payload: unknown) {
  const record = asRecord(payload);

  if (!record) {
    return false;
  }

  const ratings = collectTmdbMaturityRatings(record);

  return (
    record.adult === true ||
    record.isMatureExclusive === true ||
    ratings.some(isMatureCertification) ||
    (ratings.some(isEroticContextCertification) && hasEroticMaturitySignal(record))
  );
}

export function mergeCategoryNames(...categoryLists: Array<unknown>) {
  const categories = new Map<string, string>();

  for (const categoryList of categoryLists) {
    const entries = Array.isArray(categoryList) ? categoryList : [categoryList];

    for (const entry of entries) {
      if (typeof entry !== 'string') {
        continue;
      }

      const trimmed = entry.trim();

      if (!trimmed) {
        continue;
      }

      const key = trimmed.toLowerCase();

      if (!categories.has(key)) {
        categories.set(key, trimmed);
      }
    }
  }

  return Array.from(categories.values());
}

export function mergeMatureExclusiveCategory(categories: unknown, isMatureExclusive: boolean) {
  return isMatureExclusive
    ? mergeCategoryNames(categories, [MATURE_EXCLUSIVES_CATEGORY])
    : mergeCategoryNames(categories);
}
