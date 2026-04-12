import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import {
  getUserWatchlistMovie,
  listUserWatchlist,
  removeUserWatchlistMovie,
  saveUserWatchlistMovie,
} from '@/lib/server/userLibrary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const movieId = url.searchParams.get('movieId') || '';

  if (movieId) {
    const record = await getUserWatchlistMovie(session.uid, movieId);
    return NextResponse.json({ record });
  }

  const records = await listUserWatchlist(session.uid);
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
  const videoUrl = String(body.video_url || '').trim();
  const poster = String(body.poster || '').trim();

  if (!movieId || !title) {
    return NextResponse.json({ error: 'movieId and title are required.' }, { status: 400 });
  }

  const result = await saveUserWatchlistMovie(session.uid, {
    movieId,
    title,
    video_url: videoUrl,
    poster,
  });

  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const movieId = String(url.searchParams.get('movieId') || '').trim();

  if (!movieId) {
    return NextResponse.json({ error: 'movieId is required.' }, { status: 400 });
  }

  await removeUserWatchlistMovie(session.uid, movieId);
  return NextResponse.json({ removed: true });
}
