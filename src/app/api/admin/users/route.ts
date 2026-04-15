import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { listUsersForAdmin } from '@/lib/server/adminControlCenter';

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

    const users = await listUsersForAdmin();
    return NextResponse.json({ users });
  } catch (error) {
    console.error('[admin-users] failed to list users', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list users.',
      },
      { status: 500 }
    );
  }
}
