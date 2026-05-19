import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { repairMovieRegionalMetadata } from '@/lib/server/adminGenreRepairs';

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

    const summary = await repairMovieRegionalMetadata();

    return NextResponse.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    console.error('[admin] failed to repair movie regional metadata', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to repair movie regional metadata.',
      },
      { status: 500 }
    );
  }
}
