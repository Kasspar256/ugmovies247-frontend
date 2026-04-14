import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { listRequestsForAdmin, updateRequestForAdmin } from '@/lib/server/adminControlCenter';
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
      status?: AdminRequestStatus;
      adminNotes?: string;
    };

    const requestId = String(body.id || '').trim();

    if (!requestId) {
      return NextResponse.json({ error: 'Missing request ID.' }, { status: 400 });
    }

    await updateRequestForAdmin(requestId, {
      status: body.status,
      adminNotes: body.adminNotes,
    });

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
