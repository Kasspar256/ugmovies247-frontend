import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { getRevenueSummaryForAdmin } from '@/lib/server/adminControlCenter';

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

    const revenue = await getRevenueSummaryForAdmin();
    return NextResponse.json({ revenue });
  } catch (error) {
    console.error('[admin-revenue] failed to load revenue', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load revenue.',
      },
      { status: 500 }
    );
  }
}
