import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import {
  deleteLibraryAssetForAdmin,
  listAllMoviesForAdmin,
  listLibraryAssetsForAdmin,
  registerLibraryAssetForAdmin,
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
    const assets = await listLibraryAssetsForAdmin(movies);

    return NextResponse.json({ assets });
  } catch (error) {
    console.error('[admin-library] failed to list library assets', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list library assets.',
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
      label?: string;
      fileName?: string;
      url?: string;
      key?: string;
      fileSizeBytes?: number;
      contentType?: string;
      sourceType?: 'upload' | 'remote_link' | 'direct_upload';
    };

    const asset = await registerLibraryAssetForAdmin({
      label: String(body.label || ''),
      fileName: String(body.fileName || ''),
      url: String(body.url || ''),
      key: String(body.key || ''),
      fileSizeBytes: Number(body.fileSizeBytes || 0),
      contentType: String(body.contentType || 'video/mp4'),
      sourceType: body.sourceType,
    });

    return NextResponse.json({ success: true, asset });
  } catch (error) {
    console.error('[admin-library] failed to register library asset', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to register library asset.',
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
    const assetId = String(requestUrl.searchParams.get('id') || '').trim();

    if (!assetId) {
      return NextResponse.json({ error: 'Missing asset ID.' }, { status: 400 });
    }

    const movies = await listAllMoviesForAdmin();
    await deleteLibraryAssetForAdmin(assetId, movies);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[admin-library] failed to delete library asset', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete library asset.',
      },
      { status: 500 }
    );
  }
}
