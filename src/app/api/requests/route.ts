import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { createMovieRequest } from '@/lib/server/movieRequests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getCurrentAuthSession({ hydrateUserRecord: true });

    if (!session) {
      return NextResponse.json(
        { error: 'Please sign in before submitting a request.', code: 'auth_required' },
        { status: 401 }
      );
    }

    if (session.userRecord.emailVerified !== true) {
      return NextResponse.json(
        {
          error: 'Please verify your email before submitting a request so we can alert you when it is ready.',
          code: 'email_not_verified',
        },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      movieTitle?: string;
      requestType?: 'movie' | 'series';
      contentType?: 'movie' | 'series';
      preferredVj?: string;
      notes?: string;
      fcmToken?: string;
    };

    const createdRequest = await createMovieRequest({
      movieTitle: String(body.movieTitle || body.title || ''),
      requestType: body.requestType === 'series' || body.contentType === 'series' ? 'series' : 'movie',
      preferredVj: String(body.preferredVj || ''),
      notes: String(body.notes || ''),
      userId: session.uid,
      requesterName: session.name,
      userEmail: session.email,
      fcmToken: String(body.fcmToken || ''),
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
