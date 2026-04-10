import { NextResponse } from 'next/server';
import { cancelVideoJob } from '@/lib/server/videoJobs';
import { getCurrentAuthSession } from '@/lib/auth/server';

export async function POST(
  _req: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await getCurrentAuthSession();

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await cancelVideoJob(params.jobId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel job.' },
      { status: 500 }
    );
  }
}
