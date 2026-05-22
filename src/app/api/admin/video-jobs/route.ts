import { NextResponse } from 'next/server';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { readCachedVideoJobs } from '@/lib/server/adminProcessingCache';
import { listVideoJobs } from '@/lib/server/videoJobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ADMIN_VIDEO_JOB_LIMIT = 500;
const MAX_ADMIN_VIDEO_JOB_LIMIT = 1000;

function readVideoJobLimit(request: Request) {
  const requestUrl = new URL(request.url);
  const requestedLimit = Number(requestUrl.searchParams.get('limit') || DEFAULT_ADMIN_VIDEO_JOB_LIMIT);

  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) {
    return DEFAULT_ADMIN_VIDEO_JOB_LIMIT;
  }

  return Math.min(MAX_ADMIN_VIDEO_JOB_LIMIT, Math.max(1, Math.floor(requestedLimit)));
}

export async function GET(request: Request) {
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

    const limit = readVideoJobLimit(request);
    const jobs = await readCachedVideoJobs(() => listVideoJobs(limit), 1000 * 60);
    return NextResponse.json({ jobs, limit });
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
