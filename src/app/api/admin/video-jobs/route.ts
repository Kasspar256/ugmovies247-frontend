import { NextResponse } from 'next/server';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { listVideoJobs } from '@/lib/server/videoJobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentAuthSession();

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        {
          error: 'Failed to load video jobs.',
          detail: adminSetupError,
        },
        { status: 500 }
      );
    }

    const jobs = await listVideoJobs(100);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('[video-jobs] list failed', error);
    return NextResponse.json(
      {
        error: 'Failed to load video jobs.',
        detail: error instanceof Error ? error.message : 'Unknown video jobs error.',
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error: 'HLS uploads are disabled. Use the Direct Uploads workflow instead.',
    },
    { status: 410 }
  );
}
