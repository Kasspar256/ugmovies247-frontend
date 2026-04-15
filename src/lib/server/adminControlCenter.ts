import { randomUUID } from 'crypto';
import { adminDb } from '@/lib/firebaseAdmin';
import { HOME_PAGE_CATEGORY_CONFIG } from '@/lib/homeCategories';
import { getSubscriptionSnapshotFromData, listPaymentsForAdmin, listSubscriptionsForAdmin } from '@/lib/server/subscriptions';
import { deleteR2Object, getR2ObjectKeyFromPublicUrl } from '@/lib/server/r2';
import {
  clearMovieCatalogQuotaFailure,
  type CachedMovieCatalog,
  inMemoryMovieCache,
  isFreshMovieCache,
  isMovieCatalogQuotaBlocked,
  pickMovieCatalogCache,
  persistMovieCatalog,
  readMovieCatalogFromDisk,
  recordMovieCatalogQuotaFailure,
  setInMemoryMovieCache,
  upsertMovieInCatalogCache,
} from '@/lib/server/movieCatalogCache';
import {
  persistAdminCache,
  readPersistedAdminCache,
  type PersistedAdminCache,
} from '@/lib/server/adminRuntimeCache';
import {
  CATEGORIES_COLLECTION,
  MEDIA_LIBRARY_COLLECTION,
  MOVIES_COLLECTION,
  REQUESTS_COLLECTION,
} from '@/lib/server/firestoreNamespaces';
import { normalizeMovie, type Movie } from '@/types/movie';
import type {
  AdminCategory,
  AdminCategoryType,
  AdminControlCenterPayload,
  AdminLibraryAsset,
  AdminLibraryAssignment,
  AdminRequest,
  AdminRequestStatus,
  AdminRevenuePlanSummary,
  AdminRevenueSummary,
  AdminUserSummary,
} from '@/types/admin';

const ADMIN_COLLECTION_CACHE_TTL_MS = 1000 * 45;
const ADMIN_REVENUE_CACHE_TTL_MS = 1000 * 60 * 2;
const ADMIN_QUOTA_COOLDOWN_MS = 1000 * 60 * 10;
const ADMIN_FALLBACK_READ_TIMEOUT_MS = 1000 * 4;

type TimedAdminCache<T> = {
  value: T;
  cachedAt: number;
};

let adminCategoriesCache: TimedAdminCache<AdminCategory[]> | null = null;
let adminUsersCache: TimedAdminCache<AdminUserSummary[]> | null = null;
let adminRequestsCache: TimedAdminCache<AdminRequest[]> | null = null;
let adminLibraryCache: TimedAdminCache<AdminLibraryAsset[]> | null = null;
let adminRevenueCache: TimedAdminCache<AdminRevenueSummary> | null = null;
const adminQuotaBlockedUntil = new Map<string, number>();

function nowIso() {
  return new Date().toISOString();
}

function createEmptyRevenueSummary(): AdminRevenueSummary {
  const now = new Date();

  return {
    monthLabel: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    monthRevenue: 0,
    activeSubscriberCount: 0,
    activeSubscriptionRevenue: 0,
    activePlanBreakdown: [],
    recentPayments: [],
  };
}

function isFreshAdminCache<T>(cache: TimedAdminCache<T> | null, ttlMs: number) {
  return Boolean(cache && Date.now() - cache.cachedAt < ttlMs);
}

function pickLatestAdminCache<T>(
  ...caches: Array<TimedAdminCache<T> | PersistedAdminCache<T> | null | undefined>
) {
  return (
    caches
      .filter(
        (cache): cache is TimedAdminCache<T> | PersistedAdminCache<T> =>
          Boolean(cache && typeof cache.cachedAt === 'number')
      )
      .sort((left, right) => right.cachedAt - left.cachedAt)[0] || null
  );
}

function isQuotaExceededAdminError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /resource_exhausted|quota exceeded/i.test(message);
}

function logAdminDataFailure(resource: string, error: unknown) {
  if (isQuotaExceededAdminError(error)) {
    console.error(`[admin-data] ${resource} read hit backend quota`, error);
    return;
  }

  console.error(`[admin-data] ${resource} read failed`, error);
}

function isAdminQuotaBlocked(resource: string) {
  return (adminQuotaBlockedUntil.get(resource) || 0) > Date.now();
}

function recordAdminQuotaFailure(resource: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');

  if (!/resource_exhausted|quota exceeded|timed out/i.test(message)) {
    return;
  }

  adminQuotaBlockedUntil.set(resource, Date.now() + ADMIN_QUOTA_COOLDOWN_MS);
}

function clearAdminQuotaFailure(resource: string) {
  adminQuotaBlockedUntil.delete(resource);
}

async function readCachedAdminValue<T>(options: {
  resource: string;
  cache: TimedAdminCache<T> | null;
  ttlMs: number;
  loader: () => Promise<T>;
  onWrite: (value: TimedAdminCache<T> | null) => void;
  fallback?: () => T;
  timeoutMs?: number;
  allowFallbackWithoutCache?: boolean;
}) {
  const persistedCache = await readPersistedAdminCache<T>(options.resource);
  const bestCache = pickLatestAdminCache(options.cache, persistedCache);
  const hasWarmCache = bestCache !== null;
  const canUsePlaceholderFallback = options.allowFallbackWithoutCache === true;

  if (isFreshAdminCache(bestCache, options.ttlMs)) {
    if (bestCache !== options.cache) {
      options.onWrite({
        value: bestCache.value,
        cachedAt: bestCache.cachedAt,
      });
    }

    return bestCache?.value as T;
  }

  if (isAdminQuotaBlocked(options.resource)) {
    if (bestCache?.value) {
      if (bestCache !== options.cache) {
        options.onWrite({
          value: bestCache.value,
          cachedAt: bestCache.cachedAt,
        });
      }

      return bestCache.value;
    }

    if (options.fallback && canUsePlaceholderFallback) {
      return options.fallback();
    }
  }

  try {
    const value = await (async () => {
      if (!options.fallback || (!hasWarmCache && !canUsePlaceholderFallback)) {
        return options.loader();
      }

      const loaderPromise = options.loader();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${options.resource} read timed out while fallback data was available.`));
        }, options.timeoutMs ?? ADMIN_FALLBACK_READ_TIMEOUT_MS);
      });

      try {
        return await Promise.race([loaderPromise, timeoutPromise]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        loaderPromise.catch(() => undefined);
      }
    })();
    const nextCache = {
      value,
      cachedAt: Date.now(),
    };
    options.onWrite(nextCache);
    await persistAdminCache(options.resource, nextCache);
    clearAdminQuotaFailure(options.resource);
    return value;
  } catch (error) {
    recordAdminQuotaFailure(options.resource, error);
    logAdminDataFailure(options.resource, error);

    if (bestCache?.value) {
      if (bestCache !== options.cache) {
        options.onWrite({
          value: bestCache.value,
          cachedAt: bestCache.cachedAt,
        });
      }

      return bestCache.value;
    }

    if (options.fallback && canUsePlaceholderFallback) {
      return options.fallback();
    }

    throw error;
  }
}

export function clearAdminPanelServerCache(
  ...resources: Array<'categories' | 'users' | 'requests' | 'library' | 'revenue'>
) {
  const targets = resources.length
    ? resources
    : ['categories', 'users', 'requests', 'library', 'revenue'];

  if (targets.includes('categories')) {
    adminCategoriesCache = null;
  }

  if (targets.includes('users')) {
    adminUsersCache = null;
  }

  if (targets.includes('requests')) {
    adminRequestsCache = null;
  }

  if (targets.includes('library')) {
    adminLibraryCache = null;
  }

  if (targets.includes('revenue')) {
    adminRevenueCache = null;
  }

  for (const resource of targets) {
    clearAdminQuotaFailure(resource);
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function sortCategories(categories: AdminCategory[]) {
  return categories.slice().sort((left, right) => {
    if (left.type === 'home_row' || right.type === 'home_row') {
      const leftOrder = left.homeOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.homeOrder ?? Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
    }

    return left.name.localeCompare(right.name);
  });
}

function findHomeCategoryConfig(value: string) {
  const slug = slugify(value);
  return HOME_PAGE_CATEGORY_CONFIG.find((category) => slugify(category.name) === slug) || null;
}

function parseStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function buildDefaultCategories(movies: Movie[]) {
  const categories = new Map<string, AdminCategory>();
  const timestamp = nowIso();

  const addCategory = (
    name: string,
    type: AdminCategoryType,
    description: string,
    isSystem = true,
    options?: Partial<Pick<AdminCategory, 'displayLabel' | 'homeOrder' | 'isVisible'>>
  ) => {
    const normalizedName = name.trim();

    if (!normalizedName) {
      return;
    }

    const slug = slugify(normalizedName);

    if (categories.has(slug)) {
      return;
    }

      categories.set(slug, {
        id: slug,
        name: normalizedName,
        slug,
        displayLabel: options?.displayLabel || normalizedName,
        description,
        type,
        homeOrder: options?.homeOrder ?? null,
        isVisible: options?.isVisible ?? true,
        createdAt: timestamp,
        updatedAt: timestamp,
        isSystem,
      });
    };

  for (const category of HOME_PAGE_CATEGORY_CONFIG) {
    addCategory(category.name, 'home_row', 'Homepage shelf category', true, {
      displayLabel: category.displayLabel,
      homeOrder: category.homeOrder,
      isVisible: true,
    });
  }

  for (const movie of movies) {
    for (const category of movie.category || []) {
      addCategory(category, 'custom', 'Existing catalog category', false);
    }

    for (const genre of movie.genres || []) {
      addCategory(genre, 'genre', 'Existing catalog genre', false);
    }
  }

  return sortCategories([...categories.values()]);
}

async function readAdminMovieSnapshotWithFallback(hasFallback: boolean) {
  const queryPromise = adminDb.collection(MOVIES_COLLECTION).get();

  if (!hasFallback) {
    return queryPromise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Movies read timed out while fallback data was available.'));
    }, ADMIN_FALLBACK_READ_TIMEOUT_MS);
  });

  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    queryPromise.catch(() => undefined);
  }
}

export async function listAllMoviesForAdmin() {
  const normalizeCatalog = (catalog: CachedMovieCatalog) =>
    catalog.movies
      .map((movie) =>
        normalizeMovie(String(movie.id || movie.movieId || ''), {
          id: String(movie.id || movie.movieId || ''),
          ...movie,
        })
      )
      .sort((left, right) => (right.date_added || '').localeCompare(left.date_added || ''));

  if (isFreshMovieCache(inMemoryMovieCache)) {
    return normalizeCatalog(inMemoryMovieCache);
  }

  const diskCache = await readMovieCatalogFromDisk();
  const staleCache = pickMovieCatalogCache(inMemoryMovieCache, diskCache);

  if (isFreshMovieCache(diskCache)) {
    setInMemoryMovieCache(diskCache);
    return normalizeCatalog(diskCache);
  }

  if (staleCache?.movies?.length && isMovieCatalogQuotaBlocked()) {
    if (diskCache) {
      setInMemoryMovieCache(diskCache);
    }

    return normalizeCatalog(staleCache);
  }

  try {
    const snapshot = await readAdminMovieSnapshotWithFallback(Boolean(staleCache?.movies?.length));
    const movies = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    const cache: CachedMovieCatalog = {
      movies,
      cachedAt: new Date().toISOString(),
    };

    setInMemoryMovieCache(cache);
    await persistMovieCatalog(cache);
    clearMovieCatalogQuotaFailure();

    return normalizeCatalog(cache);
  } catch (error) {
    recordMovieCatalogQuotaFailure(error);

    if (staleCache?.movies?.length) {
      console.warn('[admin-data] serving stale admin movie catalog cache', error);
      return normalizeCatalog(staleCache);
    }

    throw error;
  }
}

export async function listCategoriesForAdmin(movies?: Movie[]) {
  const defaults = buildDefaultCategories(movies || []);
  return readCachedAdminValue({
    resource: 'categories',
    cache: adminCategoriesCache,
    ttlMs: ADMIN_COLLECTION_CACHE_TTL_MS,
    onWrite: (value) => {
      adminCategoriesCache = value;
    },
    allowFallbackWithoutCache: true,
    fallback: () => defaults,
    loader: async () => {
      const snapshot = await adminDb.collection(CATEGORIES_COLLECTION).get();

      if (snapshot.empty) {
        if (defaults.length > 0) {
          const batch = adminDb.batch();

          for (const category of defaults) {
            const ref = adminDb.collection(CATEGORIES_COLLECTION).doc(category.id);
            batch.set(ref, category, { merge: true });
          }

          await batch.commit();
        }

        return defaults;
      }

      const existingCategories = snapshot.docs
        .map((doc): AdminCategory => {
          const data = doc.data() as Partial<AdminCategory>;
          const homeCategoryDefaults = findHomeCategoryConfig(data.name || doc.id);

          return {
            id: doc.id,
            name: data.name || doc.id,
            slug: data.slug || slugify(data.name || doc.id),
            displayLabel:
              data.displayLabel ||
              homeCategoryDefaults?.displayLabel ||
              data.name ||
              doc.id,
            description: data.description || '',
            type:
              data.type === 'home_row' || data.type === 'genre' || data.type === 'custom'
                ? data.type
                : homeCategoryDefaults
                  ? 'home_row'
                  : 'custom',
            homeOrder:
              typeof data.homeOrder === 'number'
                ? data.homeOrder
                : homeCategoryDefaults?.homeOrder ?? null,
            isVisible: data.isVisible !== false,
            createdAt: data.createdAt || '',
            updatedAt: data.updatedAt || '',
            isSystem: data.isSystem === true || Boolean(homeCategoryDefaults),
          };
        });

      const categoryMap = new Map(existingCategories.map((category) => [category.slug, category]));
      const missingDefaults = defaults.filter((category) => !categoryMap.has(category.slug));

      if (missingDefaults.length > 0) {
        const batch = adminDb.batch();

        for (const category of missingDefaults) {
          const ref = adminDb.collection(CATEGORIES_COLLECTION).doc(category.id);
          batch.set(ref, category, { merge: true });
          categoryMap.set(category.slug, category);
        }

        await batch.commit();
      }

      return sortCategories([...categoryMap.values()]);
    },
  });
}

export async function upsertCategoryForAdmin(input: {
  id?: string;
  name: string;
  displayLabel?: string;
  description?: string;
  type?: AdminCategoryType;
  homeOrder?: number | null;
  isVisible?: boolean;
}) {
  const name = input.name.trim();

  if (!name) {
    throw new Error('Category name is required.');
  }

  const timestamp = nowIso();
  const slug = slugify(name);
  const categoryId = input.id?.trim() || slug;
  const ref = adminDb.collection(CATEGORIES_COLLECTION).doc(categoryId);
  const existing = await ref.get();
  const existingData = existing.data() as Partial<AdminCategory> | undefined;
  const homeCategoryDefaults = findHomeCategoryConfig(name);
  const nextType = input.type || existingData?.type || 'custom';

  const payload: AdminCategory = {
    id: categoryId,
    name,
    slug,
    displayLabel:
      input.displayLabel?.trim() ||
      existingData?.displayLabel ||
      homeCategoryDefaults?.displayLabel ||
      name,
    description: input.description?.trim() || '',
    type: nextType,
    homeOrder:
      typeof input.homeOrder === 'number'
        ? input.homeOrder
        : existingData?.homeOrder ??
          (nextType === 'home_row' ? homeCategoryDefaults?.homeOrder ?? null : null),
    isVisible: input.isVisible ?? existingData?.isVisible ?? true,
    createdAt: existing.exists ? (existingData?.createdAt || timestamp) : timestamp,
    updatedAt: timestamp,
    isSystem: existingData?.isSystem === true || (nextType === 'home_row' && Boolean(homeCategoryDefaults)),
  };

  await ref.set(payload, { merge: true });
  clearAdminPanelServerCache('categories');
  return payload;
}

export async function reorderHomeCategoriesForAdmin(categoryIds: string[]) {
  if (!categoryIds.length) {
    throw new Error('No homepage categories provided for reorder.');
  }

  const batch = adminDb.batch();
  const timestamp = nowIso();

  for (const [index, categoryId] of categoryIds.entries()) {
    const ref = adminDb.collection(CATEGORIES_COLLECTION).doc(categoryId);
    batch.set(
      ref,
      {
        homeOrder: HOME_PAGE_CATEGORY_CONFIG[index]?.homeOrder ?? (index + 1) * 10,
        updatedAt: timestamp,
      },
      { merge: true }
    );
  }

  await batch.commit();
  clearAdminPanelServerCache('categories');
}

export async function removeMovieFromCategoryForAdmin(categoryId: string, movieId: string) {
  const [categorySnapshot, movieSnapshot] = await Promise.all([
    adminDb.collection(CATEGORIES_COLLECTION).doc(categoryId).get(),
    adminDb.collection(MOVIES_COLLECTION).doc(movieId).get(),
  ]);

  if (!categorySnapshot.exists) {
    throw new Error('Category not found.');
  }

  if (!movieSnapshot.exists) {
    throw new Error('Movie or series not found.');
  }

  const category = categorySnapshot.data() as Partial<AdminCategory>;
  const movie = normalizeMovie(movieSnapshot.id, {
    id: movieSnapshot.id,
    ...movieSnapshot.data(),
  });
  const categoryName = String(category.name || '').trim();

  if (!categoryName) {
    throw new Error('Category name is required.');
  }

  const updates: Record<string, unknown> = {
    updatedAt: nowIso(),
  };

  if (category.type === 'genre') {
    updates.genres = (movie.genres || []).filter((entry) => entry !== categoryName);
  } else {
    updates.category = (movie.category || []).filter((entry) => entry !== categoryName);

    if (slugify(categoryName) === 'trending-on-tiktok') {
      updates.is_trending_tiktok = false;
    }
  }

  await movieSnapshot.ref.set(updates, { merge: true });
  await upsertMovieInCatalogCache({
    ...movie,
    ...updates,
  });
  clearAdminPanelServerCache('categories');
}

export async function deleteCategoryForAdmin(categoryId: string) {
  const ref = adminDb.collection(CATEGORIES_COLLECTION).doc(categoryId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new Error('Category not found.');
  }

  const data = snapshot.data() as Partial<AdminCategory>;
  const categoryName = String(data.name || '').trim();

    if (categoryName) {
    const impactedMovies = await adminDb
      .collection(MOVIES_COLLECTION)
      .where('category', 'array-contains', categoryName)
      .get();

    if (!impactedMovies.empty) {
      const batch = adminDb.batch();

      for (const movieDoc of impactedMovies.docs) {
        const movieData = normalizeMovie(movieDoc.id, movieDoc.data());
        const nextCategories = (movieData.category || []).filter((entry) => entry !== categoryName);

        batch.set(
          movieDoc.ref,
          {
            category: nextCategories,
            updatedAt: nowIso(),
          },
          { merge: true }
        );
      }

      await batch.commit();
    }
  }

  await ref.delete();
  clearAdminPanelServerCache('categories');
}

export async function listUsersForAdmin(limit = 200) {
  return readCachedAdminValue({
    resource: 'users',
    cache: adminUsersCache,
    ttlMs: ADMIN_COLLECTION_CACHE_TTL_MS,
    onWrite: (value) => {
      adminUsersCache = value;
    },
    fallback: () => [],
    loader: async () => {
      const snapshot = await adminDb.collection('users').limit(limit).get();

      return snapshot.docs
        .map((doc): AdminUserSummary => {
          const data = doc.data() as Record<string, unknown>;

          return {
            id: doc.id,
            name: String(data.name || 'User'),
            email: String(data.email || ''),
            role: data.role === 'admin' ? 'admin' : 'user',
            joinDate: String(data.createdAt || ''),
            lastLoginAt: String(data.lastLoginAt || ''),
            isActive: data.isActive !== false,
            avatarUrl: String(data.avatarUrl || ''),
            subscription: getSubscriptionSnapshotFromData(
              data.subscription && typeof data.subscription === 'object'
                ? (data.subscription as Record<string, unknown>)
                : null
            ),
          };
        })
        .sort((left, right) =>
          (right.lastLoginAt || right.joinDate || '').localeCompare(
            left.lastLoginAt || left.joinDate || ''
          )
        );
    },
  });
}

export async function listRequestsForAdmin(limit = 200) {
  return readCachedAdminValue({
    resource: 'requests',
    cache: adminRequestsCache,
    ttlMs: ADMIN_COLLECTION_CACHE_TTL_MS,
    onWrite: (value) => {
      adminRequestsCache = value;
    },
    fallback: () => [],
    loader: async () => {
      const snapshot = await adminDb.collection(REQUESTS_COLLECTION).limit(limit).get();

      return snapshot.docs
        .map((doc): AdminRequest => {
          const data = doc.data() as Partial<AdminRequest>;

          return {
            id: doc.id,
            title: data.title || 'Untitled request',
            preferredVj: data.preferredVj || '',
            notes: data.notes || '',
            status:
              data.status === 'reviewing' ||
              data.status === 'planned' ||
              data.status === 'uploaded' ||
              data.status === 'closed'
                ? data.status
                : 'new',
            requesterId: data.requesterId || '',
            requesterName: data.requesterName || '',
            requesterEmail: data.requesterEmail || '',
            adminNotes: data.adminNotes || '',
            createdAt: data.createdAt || '',
            updatedAt: data.updatedAt || '',
          };
        })
        .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''));
    },
  });
}

export async function createRequestForAdmin(input: {
  title: string;
  preferredVj?: string;
  notes?: string;
  requesterId?: string;
  requesterName?: string;
  requesterEmail?: string;
}) {
  const title = input.title.trim();

  if (!title) {
    throw new Error('Request title is required.');
  }

  const timestamp = nowIso();
  const ref = adminDb.collection(REQUESTS_COLLECTION).doc();
  const payload: AdminRequest = {
    id: ref.id,
    title,
    preferredVj: input.preferredVj?.trim() || '',
    notes: input.notes?.trim() || '',
    status: 'new',
    requesterId: input.requesterId?.trim() || '',
    requesterName: input.requesterName?.trim() || '',
    requesterEmail: input.requesterEmail?.trim() || '',
    adminNotes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await ref.set(payload);
  clearAdminPanelServerCache('requests');
  return payload;
}

export async function updateRequestForAdmin(
  requestId: string,
  input: {
    status?: AdminRequestStatus;
    adminNotes?: string;
  }
) {
  const ref = adminDb.collection(REQUESTS_COLLECTION).doc(requestId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new Error('Request not found.');
  }

  const updates: Record<string, unknown> = {
    updatedAt: nowIso(),
  };

  if (input.status) {
    updates.status = input.status;
  }

  if (typeof input.adminNotes === 'string') {
    updates.adminNotes = input.adminNotes.trim();
  }

  await ref.set(updates, { merge: true });
  clearAdminPanelServerCache('requests');
}

function collectMovieAssignments(movie: Movie) {
  const assignments = new Map<string, AdminLibraryAssignment[]>();

  const appendAssignment = (url: string | undefined, assignment: AdminLibraryAssignment) => {
    const normalizedUrl = String(url || '').trim();

    if (!normalizedUrl) {
      return;
    }

    const current = assignments.get(normalizedUrl) || [];
    current.push(assignment);
    assignments.set(normalizedUrl, current);
  };

  appendAssignment(movie.video_url, {
    type: 'movie',
    movieId: movie.id,
    movieTitle: movie.title,
  });

  for (const part of movie.parts || []) {
    appendAssignment(part.video_url, {
      type: 'movie_part',
      movieId: movie.id,
      movieTitle: movie.title,
      partId: part.id,
      partLabel: part.label,
    });
  }

  for (const season of movie.seasons || []) {
    for (const episode of season.episodes || []) {
      appendAssignment(episode.video_url, {
        type: 'episode',
        movieId: movie.id,
        movieTitle: movie.title,
        seasonNumber: season.seasonNumber,
        episodeNumber: episode.episodeNumber,
      });
    }
  }

  return assignments;
}

type ManagedLibraryAssetDocument = {
  id?: string;
  label?: string;
  fileName?: string;
  url?: string;
  key?: string;
  contentType?: string;
  sourceType?: 'upload' | 'remote_link' | 'direct_upload';
  fileSizeBytes?: number;
  createdAt?: string;
  updatedAt?: string;
};

function buildDerivedLibraryAssets(
  assignmentMap: Map<string, AdminLibraryAssignment[]>
): AdminLibraryAsset[] {
  const derivedAssets: AdminLibraryAsset[] = [];

  for (const [url, assignments] of assignmentMap.entries()) {
    const fileName = url.split('/').pop() || '';
    derivedAssets.push({
      id: `derived:${slugify(url).slice(0, 60)}`,
      label: assignments[0]?.partLabel || fileName || assignments[0]?.movieTitle || 'Linked asset',
      fileName,
      url,
      contentType: 'video/mp4',
      sourceType: 'direct_upload',
      fileSizeBytes: 0,
      createdAt: '',
      updatedAt: '',
      isManaged: false,
      canDelete: false,
      assignments,
    });
  }

  return derivedAssets;
}

export async function listLibraryAssetsForAdmin(movies: Movie[]) {
  const assignmentMap = new Map<string, AdminLibraryAssignment[]>();

  for (const movie of movies) {
    const movieAssignments = collectMovieAssignments(movie);

    for (const [url, assignments] of movieAssignments.entries()) {
      const current = assignmentMap.get(url) || [];
      assignmentMap.set(url, [...current, ...assignments]);
    }
  }

  const derivedAssets = buildDerivedLibraryAssets(assignmentMap);

  return readCachedAdminValue({
    resource: 'library',
    cache: adminLibraryCache,
    ttlMs: ADMIN_COLLECTION_CACHE_TTL_MS,
    onWrite: (value) => {
      adminLibraryCache = value;
    },
    allowFallbackWithoutCache: true,
    fallback: () => derivedAssets,
    loader: async () => {
      const managedSnapshot = await adminDb.collection(MEDIA_LIBRARY_COLLECTION).limit(500).get();
      const managedAssets = managedSnapshot.docs.map((doc) => {
        const data = doc.data() as ManagedLibraryAssetDocument;
        const url = String(data.url || '');
        const assignments = assignmentMap.get(url) || [];

        return {
          id: doc.id,
          label: data.label || data.fileName || 'Library asset',
          fileName: data.fileName || '',
          url,
          contentType: data.contentType || 'video/mp4',
          sourceType: data.sourceType || 'direct_upload',
          fileSizeBytes: typeof data.fileSizeBytes === 'number' ? data.fileSizeBytes : 0,
          createdAt: data.createdAt || '',
          updatedAt: data.updatedAt || '',
          isManaged: true,
          canDelete: assignments.length === 0,
          assignments,
        } satisfies AdminLibraryAsset;
      });

      const managedUrlSet = new Set(managedAssets.map((asset) => asset.url).filter(Boolean));

      return [...managedAssets, ...derivedAssets.filter((asset) => !managedUrlSet.has(asset.url))].sort(
        (left, right) =>
          (right.updatedAt || right.createdAt || '').localeCompare(
            left.updatedAt || left.createdAt || ''
          )
      );
    },
  });
}

export async function registerLibraryAssetForAdmin(input: {
  label?: string;
  fileName: string;
  url: string;
  key?: string;
  fileSizeBytes?: number;
  contentType?: string;
  sourceType?: 'upload' | 'remote_link' | 'direct_upload';
}) {
  const url = input.url.trim();
  const fileName = input.fileName.trim();

  if (!url || !fileName) {
    throw new Error('Library asset URL and file name are required.');
  }

  const timestamp = nowIso();
  const existing = await adminDb
    .collection(MEDIA_LIBRARY_COLLECTION)
    .where('url', '==', url)
    .limit(1)
    .get();

  const ref = existing.empty
    ? adminDb.collection(MEDIA_LIBRARY_COLLECTION).doc()
    : existing.docs[0].ref;

  const payload: ManagedLibraryAssetDocument = {
    label: input.label?.trim() || fileName,
    fileName,
    url,
    key: input.key?.trim() || getR2ObjectKeyFromPublicUrl(url),
    contentType: input.contentType || 'video/mp4',
    sourceType: input.sourceType || 'direct_upload',
    fileSizeBytes: typeof input.fileSizeBytes === 'number' ? input.fileSizeBytes : 0,
    createdAt: existing.empty
      ? timestamp
      : ((existing.docs[0].data() as ManagedLibraryAssetDocument)?.createdAt || timestamp),
    updatedAt: timestamp,
  };

  await ref.set(payload, { merge: true });
  clearAdminPanelServerCache('library');

  return {
    id: ref.id,
    ...payload,
  };
}

export async function deleteLibraryAssetForAdmin(assetId: string, movies: Movie[]) {
  const ref = adminDb.collection(MEDIA_LIBRARY_COLLECTION).doc(assetId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new Error('Library asset not found.');
  }

  const data = snapshot.data() as ManagedLibraryAssetDocument;
  const url = String(data.url || '');
  const assignments = collectAssignmentsForUrl(url, movies);

  if (assignments.length > 0) {
    throw new Error('This asset is still attached to a movie, movie part, or episode.');
  }

  const objectKey = String(data.key || getR2ObjectKeyFromPublicUrl(url));

  if (objectKey) {
    await deleteR2Object(objectKey);
  }

  await ref.delete();
  clearAdminPanelServerCache('library');
}

function collectAssignmentsForUrl(url: string, movies: Movie[]) {
  const assignments: AdminLibraryAssignment[] = [];

  for (const movie of movies) {
    const map = collectMovieAssignments(movie);
    assignments.push(...(map.get(url) || []));
  }

  return assignments;
}

export async function getRevenueSummaryForAdmin(): Promise<AdminRevenueSummary> {
  return readCachedAdminValue({
    resource: 'revenue',
    cache: adminRevenueCache,
    ttlMs: ADMIN_REVENUE_CACHE_TTL_MS,
    onWrite: (value) => {
      adminRevenueCache = value;
    },
    fallback: () => createEmptyRevenueSummary(),
    loader: async () => {
      const [payments, subscriptions] = await Promise.all([
        listPaymentsForAdmin(500),
        listSubscriptionsForAdmin(500),
      ]);

      const now = new Date();
      const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const monthRevenue = payments
        .filter((payment) => payment.status === 'completed')
        .filter((payment) => String(payment.createdAt || '').startsWith(monthKey))
        .reduce((total, payment) => total + Number(payment.amount || 0), 0);

      const activeSubscriptions = subscriptions.filter((subscription) => {
        if (!subscription.isActive || subscription.status !== 'active' || !subscription.expiresAt) {
          return false;
        }

        return new Date(subscription.expiresAt).getTime() > Date.now();
      });

      const activePlanBreakdown = new Map<string, AdminRevenuePlanSummary>();

      for (const subscription of activeSubscriptions) {
        const key = subscription.planType || 'unknown';
        const current = activePlanBreakdown.get(key) || {
          planType: key,
          planName: subscription.planName || 'Unknown plan',
          activeCount: 0,
          totalAmount: 0,
        };

        current.activeCount += 1;
        current.totalAmount += Number(subscription.amount || 0);
        activePlanBreakdown.set(key, current);
      }

      return {
        monthLabel: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        monthRevenue,
        activeSubscriberCount: activeSubscriptions.length,
        activeSubscriptionRevenue: activeSubscriptions.reduce(
          (total, subscription) => total + Number(subscription.amount || 0),
          0
        ),
        activePlanBreakdown: [...activePlanBreakdown.values()].sort(
          (left, right) => right.totalAmount - left.totalAmount
        ),
        recentPayments: payments.slice(0, 20).map((payment) => ({
          id: payment.id,
          userId: payment.userId,
          planType: payment.planType,
          planName: payment.planName,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          paymentProvider: payment.paymentProvider,
          paymentMethodProvider: payment.paymentMethodProvider,
          phoneNumber: payment.phoneNumber,
          providerStatus: payment.providerStatus,
          providerMessage: payment.providerMessage,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
        })),
      };
    },
  });
}

export async function getAdminControlCenterPayload(): Promise<AdminControlCenterPayload> {
  const [moviesEntry] = await Promise.allSettled([listAllMoviesForAdmin()]);
  const movies = moviesEntry.status === 'fulfilled' ? moviesEntry.value : [];

  if (moviesEntry.status === 'rejected') {
    logAdminDataFailure('movies', moviesEntry.reason);
  }

  const [categoriesResult, usersResult, requestsResult, libraryAssetsResult, revenueResult] =
    await Promise.allSettled([
      listCategoriesForAdmin(movies),
      listUsersForAdmin(),
      listRequestsForAdmin(),
      listLibraryAssetsForAdmin(movies),
      getRevenueSummaryForAdmin(),
    ]);

  if (categoriesResult.status === 'rejected') {
    logAdminDataFailure('categories', categoriesResult.reason);
  }

  if (usersResult.status === 'rejected') {
    logAdminDataFailure('users', usersResult.reason);
  }

  if (requestsResult.status === 'rejected') {
    logAdminDataFailure('requests', requestsResult.reason);
  }

  if (libraryAssetsResult.status === 'rejected') {
    logAdminDataFailure('library', libraryAssetsResult.reason);
  }

  if (revenueResult.status === 'rejected') {
    logAdminDataFailure('revenue', revenueResult.reason);
  }

  return {
    movies,
    categories: categoriesResult.status === 'fulfilled' ? categoriesResult.value : [],
    users: usersResult.status === 'fulfilled' ? usersResult.value : [],
    requests: requestsResult.status === 'fulfilled' ? requestsResult.value : [],
    libraryAssets: libraryAssetsResult.status === 'fulfilled' ? libraryAssetsResult.value : [],
    revenue:
      revenueResult.status === 'fulfilled'
        ? revenueResult.value
        : createEmptyRevenueSummary(),
  };
}

export function createPartId() {
  return `part_${randomUUID()}`;
}

export function normalizeEditableStringList(value: unknown) {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return parseStringList(value);
}
