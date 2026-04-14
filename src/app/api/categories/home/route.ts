import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { CATEGORIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import { HOME_PAGE_CATEGORY_CONFIG } from '@/lib/homeCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function GET() {
  const adminSetupError = getFirebaseAdminSetupError();

  if (adminSetupError) {
    return NextResponse.json(
      {
        categories: HOME_PAGE_CATEGORY_CONFIG.map((category) => ({
          id: slugify(category.name),
          name: category.name,
          displayLabel: category.displayLabel,
          homeOrder: category.homeOrder,
          isVisible: true,
        })),
      },
      { status: 200 }
    );
  }

  try {
    const defaults = new Map(
      HOME_PAGE_CATEGORY_CONFIG.map((category) => [
        slugify(category.name),
        {
          id: slugify(category.name),
          name: category.name,
          displayLabel: category.displayLabel,
          homeOrder: category.homeOrder,
          isVisible: true,
        },
      ])
    );
    const snapshot = await adminDb.collection(CATEGORIES_COLLECTION).get();

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

    return NextResponse.json({
      categories: [...defaults.values()]
        .filter((category) => category.isVisible)
        .sort((left, right) => left.homeOrder - right.homeOrder),
    });
  } catch (error) {
    console.error('[public-home-categories] failed to load categories', error);
    return NextResponse.json(
      {
        categories: HOME_PAGE_CATEGORY_CONFIG.map((category) => ({
          id: slugify(category.name),
          name: category.name,
          displayLabel: category.displayLabel,
          homeOrder: category.homeOrder,
          isVisible: true,
        })),
      },
      { status: 200 }
    );
  }
}
