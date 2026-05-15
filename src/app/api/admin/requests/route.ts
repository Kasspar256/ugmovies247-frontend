import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { listRequestsForAdmin, updateRequestForAdmin } from '@/lib/server/adminControlCenter';
import {
  queueMovieRequestFulfillment,
  rejectMovieRequest,
  replyToMovieRequest,
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
      action?: 'fulfill' | 'reply' | 'reject' | 'status';
      status?: AdminRequestStatus;
      adminNotes?: string;
      sourceUrl?: string;
      sourceFileName?: string;
      message?: string;
      movieId?: string;
    };

    const requestId = String(body.id || '').trim();

    if (!requestId) {
      return NextResponse.json({ error: 'Missing request ID.' }, { status: 400 });
    }

    if (body.action === 'fulfill') {
      await queueMovieRequestFulfillment(requestId, {
        sourceUrl: String(body.sourceUrl || ''),
        sourceFileName: String(body.sourceFileName || ''),
        adminNotes: String(body.adminNotes || ''),
      });
    } else if (body.action === 'reply') {
      await replyToMovieRequest(requestId, String(body.message || body.adminNotes || ''));
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
