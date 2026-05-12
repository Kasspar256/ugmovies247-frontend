import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import {
  listUserWatchHistory,
  saveUserWatchHistory,
} from '@/lib/server/userLibrary';
import { recordAiMoviePlay } from '@/lib/server/aiMovieSearch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const records = await listUserWatchHistory(session.uid);
  return NextResponse.json({ records });
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const movieId = String(body.movieId || '').trim();
  const title = String(body.title || '').trim();
  const poster = String(body.poster || '').trim();
  const watchHref = String(body.watchHref || '').trim();
  const progressSeconds = Number(body.progressSeconds || 0);
  const durationSeconds = Number(body.durationSeconds || 0);
  const progressPercent = Number(body.progressPercent || 0);
  const completed = body.completed === true;

  if (!movieId || !title) {
    return NextResponse.json({ error: 'movieId and title are required.' }, { status: 400 });
  }

  const result = await saveUserWatchHistory(session.uid, {
    movieId,
    title,
    poster,
    watchHref,
    progressSeconds,
    durationSeconds,
    progressPercent,
    completed,
  });

  if (result.countedAsNewPlay && (completed || progressSeconds >= 10)) {
    void recordAiMoviePlay(movieId).catch((error) => {
      console.warn('[ai-chat] failed to record movie play count', error);
    });
  }

  return NextResponse.json({ record: result.record });
}
