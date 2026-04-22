import type { Movie } from '@/types/movie';
import {
  DEFAULT_HOME_PAGE_CATEGORIES,
  type HomePageCategoryRecord,
} from '@/lib/homeRows';

type CachedHomePageCategories = {
  categories: HomePageCategoryRecord[];
  cachedAt: number;
};

const HOME_PAGE_CATEGORIES_CACHE_KEY = 'ugmovies247.home-categories.v1';
const HOME_PAGE_CATEGORIES_TTL_MS = 1000 * 60 * 5;

let inMemoryHomePageCategories: CachedHomePageCategories | null = null;
let inFlightHomePageCategoriesRequest: Promise<HomePageCategoryRecord[]> | null = null;

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function isFreshCategoriesCache(cache: CachedHomePageCategories | null) {
  return Boolean(cache && Date.now() - cache.cachedAt < HOME_PAGE_CATEGORIES_TTL_MS);
}

function normalizeHomePageCategories(payload: unknown) {
  if (!Array.isArray(payload)) {
    return DEFAULT_HOME_PAGE_CATEGORIES;
  }

  const categories = payload
    .map((entry) => {
      const candidate = entry as Partial<HomePageCategoryRecord> | null | undefined;

      if (
        !candidate ||
        typeof candidate.id !== 'string' ||
        typeof candidate.name !== 'string' ||
        typeof candidate.displayLabel !== 'string'
      ) {
        return null;
      }

      return {
        id: candidate.id,
        name: candidate.name,
        displayLabel: candidate.displayLabel,
        homeOrder:
          typeof candidate.homeOrder === 'number' ? candidate.homeOrder : Number.MAX_SAFE_INTEGER,
        isVisible: candidate.isVisible !== false,
      } satisfies HomePageCategoryRecord;
    })
    .filter((entry): entry is HomePageCategoryRecord => Boolean(entry));

  return categories.length ? categories : DEFAULT_HOME_PAGE_CATEGORIES;
}

function persistHomePageCategories(cache: CachedHomePageCategories) {
  inMemoryHomePageCategories = cache;

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(HOME_PAGE_CATEGORIES_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures and keep the in-memory cache only.
  }
}

function readHomePageCategoriesFromSessionStorage() {
  if (!canUseSessionStorage()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(HOME_PAGE_CATEGORIES_CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedHomePageCategories>;

    if (typeof parsed.cachedAt !== 'number') {
      return null;
    }

    return {
      categories: normalizeHomePageCategories(parsed.categories),
      cachedAt: parsed.cachedAt,
    } satisfies CachedHomePageCategories;
  } catch {
    return null;
  }
}

function getBestAvailableHomePageCategories() {
  if (isFreshCategoriesCache(inMemoryHomePageCategories)) {
    return inMemoryHomePageCategories;
  }

  const storedCache = readHomePageCategoriesFromSessionStorage();

  if (isFreshCategoriesCache(storedCache)) {
    inMemoryHomePageCategories = storedCache;
    return storedCache;
  }

  return null;
}

export function readCachedHomePageCategories() {
  return getBestAvailableHomePageCategories()?.categories || DEFAULT_HOME_PAGE_CATEGORIES;
}

export async function fetchHomePageCategories(options?: { force?: boolean }) {
  if (!options?.force) {
    const cached = getBestAvailableHomePageCategories();

    if (cached) {
      return cached.categories;
    }

    if (inFlightHomePageCategoriesRequest) {
      return inFlightHomePageCategoriesRequest;
    }
  }

  inFlightHomePageCategoriesRequest = fetch('/api/categories/home', {
    cache: 'no-store',
    credentials: 'include',
  })
    .then(async (response) => {
      const payload = (await response.json().catch(() => ({}))) as {
        categories?: HomePageCategoryRecord[];
      };

      if (!response.ok) {
        throw new Error('Failed to load home page categories.');
      }

      const categories = normalizeHomePageCategories(payload.categories);
      persistHomePageCategories({
        categories,
        cachedAt: Date.now(),
      });

      return categories;
    })
    .catch((error) => {
      const staleCategories = getBestAvailableHomePageCategories();

      if (staleCategories?.categories?.length) {
        return staleCategories.categories;
      }

      throw error;
    })
    .finally(() => {
      inFlightHomePageCategoriesRequest = null;
    });

  return inFlightHomePageCategoriesRequest;
}

export function warmHomePageArtwork(movies: Movie[], limit = 14) {
  if (typeof window === 'undefined') {
    return;
  }

  const artworkUrls = Array.from(
    new Set(
      movies
        .flatMap((movie) => [movie.poster, movie.thumbnail])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  ).slice(0, limit);

  if (!artworkUrls.length) {
    return;
  }

  const schedule =
    typeof window.requestIdleCallback === 'function'
      ? (callback: () => void) => window.requestIdleCallback(() => callback())
      : (callback: () => void) => window.setTimeout(callback, 16);

  schedule(() => {
    artworkUrls.forEach((url) => {
      const image = new window.Image();
      image.decoding = 'async';
      image.src = url;
    });
  });
}
