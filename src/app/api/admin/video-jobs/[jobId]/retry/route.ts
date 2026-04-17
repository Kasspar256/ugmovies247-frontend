import { NextResponse } from 'next/server';
import { retryVideoJob } from '@/lib/server/videoJobs';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';

export async function POST(
  _req: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await getCurrentAuthSession();

    if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await retryVideoJob(params.jobId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retry job.' },
      { status: 500 }
    );
  }
}
