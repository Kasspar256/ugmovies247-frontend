import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import {
  deleteCategoryForAdmin,
  listAllMoviesForAdmin,
  listCategoriesForAdmin,
  upsertCategoryForAdmin,
} from '@/lib/server/adminControlCenter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return null;
  }

  return session;
}

export async function GET() {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const movies = await listAllMoviesForAdmin();
    const categories = await listCategoriesForAdmin(movies);
    return NextResponse.json({ categories });
  } catch (error) {
    console.error('[admin-categories] failed to list categories', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list categories.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      type?: 'home_row' | 'genre' | 'custom';
    };

    const category = await upsertCategoryForAdmin({
      name: String(body.name || ''),
      description: String(body.description || ''),
      type: body.type,
    });

    return NextResponse.json({ success: true, category });
  } catch (error) {
    console.error('[admin-categories] failed to create category', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create category.',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      description?: string;
      type?: 'home_row' | 'genre' | 'custom';
    };

    const category = await upsertCategoryForAdmin({
      id: String(body.id || ''),
      name: String(body.name || ''),
      description: String(body.description || ''),
      type: body.type,
    });

    return NextResponse.json({ success: true, category });
  } catch (error) {
    console.error('[admin-categories] failed to update category', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update category.',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const requestUrl = new URL(request.url);
    const categoryId = String(requestUrl.searchParams.get('id') || '').trim();

    if (!categoryId) {
      return NextResponse.json({ error: 'Missing category ID.' }, { status: 400 });
    }

    await deleteCategoryForAdmin(categoryId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[admin-categories] failed to delete category', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete category.',
      },
      { status: 500 }
    );
  }
}
