import { NextResponse } from 'next/server';
import { processNextVideoJob } from '@/lib/server/videoJobs';
import { getCurrentAuthSession } from '@/lib/auth/server';

export async function POST() {
  try {
    const session = await getCurrentAuthSession();

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await processNextVideoJob();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Queue processing failed.' },
      { status: 500 }
    );
  }
}
