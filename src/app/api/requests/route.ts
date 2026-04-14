import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { createRequestForAdmin } from '@/lib/server/adminControlCenter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getCurrentAuthSession();
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      preferredVj?: string;
      notes?: string;
    };

    const createdRequest = await createRequestForAdmin({
      title: String(body.title || ''),
      preferredVj: String(body.preferredVj || ''),
      notes: String(body.notes || ''),
      requesterId: session?.uid || '',
      requesterName: session?.name || '',
      requesterEmail: session?.email || '',
    });

    return NextResponse.json({
      success: true,
      request: createdRequest,
    });
  } catch (error) {
    console.error('[requests] failed to create request', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to submit request.',
      },
      { status: 500 }
    );
  }
}
