import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { listRequestsForAdmin, updateRequestForAdmin } from '@/lib/server/adminControlCenter';
import {
  queueAdvancedMovieRequestFulfillment,
  rejectMovieRequest,
  sendVjVarianceMovieRequest,
} from '@/lib/server/movieRequests';
import type { AdminRequestStatus } from '@/types/admin';

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

    const requests = await listRequestsForAdmin();
    return NextResponse.json({ requests });
  } catch (error) {
    console.error('[admin-requests] failed to list requests', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list requests.',
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
      action?: 'fulfill' | 'vjVariance' | 'reply' | 'reject' | 'status';
      status?: AdminRequestStatus;
      adminNotes?: string;
      sourceUrl?: string;
      sourceFileName?: string;
      sourceFileSizeBytes?: number | string | null;
      sourceStorageKey?: string;
      sourceStorageProvider?: 'r2_staging' | 'external_url';
      message?: string;
      movieId?: string;
      title?: string;
      originalTitle?: string;
      description?: string;
      overview?: string;
      poster?: string;
      backdrop?: string;
      banner?: string;
      genres?: string[] | string;
      category?: string[] | string;
      vj?: string;
      releaseDate?: string;
      releaseYear?: number | string | null;
      tmdbId?: number | string | null;
      contentType?: 'movie' | 'series';
      seasonNumber?: number | string | null;
      episodeNumber?: number | string | null;
      seasonTitle?: string;
      episodeTitle?: string;
    };

    const requestId = String(body.id || '').trim();

    if (!requestId) {
      return NextResponse.json({ error: 'Missing request ID.' }, { status: 400 });
    }

    if (body.action === 'fulfill') {
      await queueAdvancedMovieRequestFulfillment(requestId, {
        sourceUrl: String(body.sourceUrl || ''),
        sourceFileName: String(body.sourceFileName || ''),
        sourceFileSizeBytes: body.sourceFileSizeBytes,
        sourceStorageKey: String(body.sourceStorageKey || ''),
        sourceStorageProvider:
          body.sourceStorageProvider === 'r2_staging' ? 'r2_staging' : 'external_url',
        adminNotes: String(body.adminNotes || ''),
        title: String(body.title || ''),
        originalTitle: String(body.originalTitle || ''),
        description: String(body.description || ''),
        overview: String(body.overview || ''),
        poster: String(body.poster || ''),
        backdrop: String(body.backdrop || ''),
        banner: String(body.banner || ''),
        genres: body.genres,
        category: body.category,
        vj: String(body.vj || ''),
        releaseDate: String(body.releaseDate || ''),
        releaseYear: body.releaseYear,
        tmdbId: body.tmdbId,
        contentType: body.contentType === 'series' ? 'series' : 'movie',
        seasonNumber: body.seasonNumber,
        episodeNumber: body.episodeNumber,
        seasonTitle: String(body.seasonTitle || ''),
        episodeTitle: String(body.episodeTitle || ''),
      });
    } else if (body.action === 'vjVariance' || body.action === 'reply') {
      await sendVjVarianceMovieRequest(requestId, String(body.message || body.adminNotes || ''));
    } else if (body.action === 'reject') {
      await rejectMovieRequest(requestId, String(body.message || ''));
    } else {
      await updateRequestForAdmin(requestId, {
        status: body.status,
        adminNotes: body.adminNotes,
        movieId: body.movieId,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[admin-requests] failed to update request', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update request.',
      },
      { status: 500 }
    );
  }
}
