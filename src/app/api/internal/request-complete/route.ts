import { NextResponse } from 'next/server';
import { markMovieRequestUploaded } from '@/lib/server/movieRequests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getExpectedSecret() {
  return process.env.REQUEST_WORKER_SECRET || '';
}

export async function POST(request: Request) {
  try {
    const expectedSecret = getExpectedSecret();
    const providedSecret = request.headers.get('x-request-worker-secret') || '';

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      requestId?: string;
      movieId?: string;
    };
    const requestId = String(body.requestId || '').trim();
    const movieId = String(body.movieId || '').trim();

    if (!requestId || !movieId) {
      return NextResponse.json(
        { error: 'Missing requestId or movieId.' },
        { status: 400 }
      );
    }

    await markMovieRequestUploaded(requestId, movieId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[request-complete] failed to mark request uploaded', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to mark request as uploaded.',
      },
      { status: 500 }
    );
  }
}
