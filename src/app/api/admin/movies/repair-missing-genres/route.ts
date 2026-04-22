import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { repairMissingMovieGenres } from '@/lib/server/adminGenreRepairs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await getCurrentAuthSession();

    if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        {
          error: 'Admin backend is not configured yet.',
          detail: adminSetupError,
        },
        { status: 500 }
      );
    }

    const summary = await repairMissingMovieGenres();

    return NextResponse.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    console.error('[admin] failed to repair missing movie genres', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to repair missing movie genres.',
      },
      { status: 500 }
    );
  }
}
