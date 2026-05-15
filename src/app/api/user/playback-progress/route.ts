import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import {
  getUserPlaybackProgress,
  listUserPlaybackProgress,
  saveUserPlaybackProgress,
} from '@/lib/server/userLibrary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const movieId = String(url.searchParams.get('movieId') || '').trim();

  if (movieId) {
    const record = await getUserPlaybackProgress(session.uid, movieId);
    return NextResponse.json({ record });
  }

  const records = await listUserPlaybackProgress(session.uid);
  return NextResponse.json({ records });
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const movieId = String(body.movieId || '').trim();

  if (!movieId) {
    return NextResponse.json({ error: 'movieId is required.' }, { status: 400 });
  }

  const record = await saveUserPlaybackProgress(session.uid, {
    movieId,
    title: String(body.title || '').trim(),
    poster: String(body.poster || '').trim(),
    watchHref: String(body.watchHref || '').trim(),
    lastPosition: Number(body.lastPosition || body.progressSeconds || 0),
    totalDuration: Number(body.totalDuration || body.durationSeconds || 0),
    isFinished: body.isFinished === true || body.completed === true,
  });

  return NextResponse.json({ record });
}
