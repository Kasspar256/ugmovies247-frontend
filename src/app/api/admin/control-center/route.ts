import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { getAdminControlCenterPayload } from '@/lib/server/adminControlCenter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentAuthSession();

    if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = await getAdminControlCenterPayload();
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[admin-control-center] failed to load payload', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load admin control center.',
      },
      { status: 500 }
    );
  }
}
