import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import {
  listLegacyDirectUploadRepairCandidates,
  queueLegacyDirectUploadRepairs,
} from '@/lib/server/adminVideoProcessing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getCurrentAuthSession();

    if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const requestUrl = new URL(request.url);
    const limit = Number(requestUrl.searchParams.get('limit') || 250);
    const candidates = await listLegacyDirectUploadRepairCandidates({ limit });

    return NextResponse.json({
      candidates,
    });
  } catch (error) {
    console.error('[video-jobs] failed to list legacy direct-upload repair candidates', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load legacy direct-upload repair candidates.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentAuthSession();

    if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      movieLimit?: number;
      movieIds?: string[];
    };

    const result = await queueLegacyDirectUploadRepairs({
      movieLimit: body.movieLimit,
      movieIds: body.movieIds,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[video-jobs] failed to queue legacy direct-upload repairs', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to queue legacy direct-upload repairs.',
      },
      { status: 500 }
    );
  }
}
