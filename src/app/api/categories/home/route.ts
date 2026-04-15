import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { CATEGORIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import { HOME_PAGE_CATEGORY_CONFIG } from '@/lib/homeCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOME_CATEGORY_CACHE_TTL_MS = 1000 * 45;
const HOME_CATEGORY_QUOTA_COOLDOWN_MS = 1000 * 60 * 10;
const HOME_CATEGORY_FALLBACK_TIMEOUT_MS = 1000 * 4;

let cachedHomeCategories:
  | {
      categories: PublicHomeCategory[];
      cachedAt: number;
    }
  | null = null;
let homeCategoryQuotaBlockedUntil = 0;

type PublicHomeCategory = {
  id: string;
  name: string;
  displayLabel: string;
  homeOrder: number;
  isVisible: boolean;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isQuotaExceededError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /resource_exhausted|quota exceeded|timed out/i.test(message);
}

async function readHomeCategorySnapshot() {
  const queryPromise = adminDb.collection(CATEGORIES_COLLECTION).get();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Home categories read timed out while fallback data was available.'));
    }, HOME_CATEGORY_FALLBACK_TIMEOUT_MS);
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

export async function GET() {
  const adminSetupError = getFirebaseAdminSetupError();
  const defaultCategories: PublicHomeCategory[] = HOME_PAGE_CATEGORY_CONFIG.map((category) => ({
    id: slugify(category.name),
    name: category.name,
    displayLabel: category.displayLabel,
    homeOrder: category.homeOrder,
    isVisible: true,
  }));

  if (adminSetupError) {
    return NextResponse.json(
      {
        categories: defaultCategories,
      },
      { status: 200 }
    );
  }

  if (
    cachedHomeCategories &&
    Date.now() - cachedHomeCategories.cachedAt < HOME_CATEGORY_CACHE_TTL_MS
  ) {
    return NextResponse.json({ categories: cachedHomeCategories.categories });
  }

  if (homeCategoryQuotaBlockedUntil > Date.now()) {
    return NextResponse.json({
      categories: cachedHomeCategories?.categories || defaultCategories,
    });
  }

  try {
    const defaults = new Map<string, PublicHomeCategory>(
      defaultCategories.map((category) => [
        slugify(category.name),
        category,
      ])
    );
    const snapshot = await readHomeCategorySnapshot();

    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const name = typeof data.name === 'string' ? data.name : doc.id;
      const slug = slugify(name);

      if (!defaults.has(slug)) {
        continue;
      }

      defaults.set(slug, {
        id: doc.id,
        name,
        displayLabel:
          typeof data.displayLabel === 'string' && data.displayLabel.trim()
            ? data.displayLabel
            : defaults.get(slug)?.displayLabel || name,
        homeOrder:
          typeof data.homeOrder === 'number'
            ? data.homeOrder
            : defaults.get(slug)?.homeOrder || 0,
        isVisible: data.isVisible !== false,
      });
    }

    const categories = [...defaults.values()]
      .filter((category) => category.isVisible)
      .sort((left, right) => left.homeOrder - right.homeOrder);

    cachedHomeCategories = {
      categories,
      cachedAt: Date.now(),
    };
    homeCategoryQuotaBlockedUntil = 0;

    return NextResponse.json({ categories });
  } catch (error) {
    if (isQuotaExceededError(error)) {
      homeCategoryQuotaBlockedUntil = Date.now() + HOME_CATEGORY_QUOTA_COOLDOWN_MS;
    }

    console.error('[public-home-categories] failed to load categories', error);
    return NextResponse.json(
      {
        categories: cachedHomeCategories?.categories || defaultCategories,
      },
      { status: 200 }
    );
  }
}
