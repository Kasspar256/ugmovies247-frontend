import { NextResponse } from 'next/server';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { readCachedVideoJobs } from '@/lib/server/adminProcessingCache';
import { listVideoJobs } from '@/lib/server/videoJobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentAuthSession();

    if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
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

    const jobs = await readCachedVideoJobs(() => listVideoJobs(100));
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('[video-jobs] list failed', error);
    const detail = error instanceof Error ? error.message : 'Unknown video jobs error.';

    return NextResponse.json(
      {
        error: /resource_exhausted|quota exceeded|timed out|deadline exceeded/i.test(detail)
          ? 'Live processing jobs are temporarily unavailable. Please try again shortly.'
          : 'Failed to load video jobs.',
        detail,
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
