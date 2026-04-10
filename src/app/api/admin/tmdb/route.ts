import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';

export async function GET(req: Request) {
  const session = await getCurrentAuthSession();

  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const title = searchParams.get('title');

  if (!title) return NextResponse.json({ error: 'Missing title' }, { status: 400 });

  const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(title)}`);
  const tmdbData = await tmdbRes.json();
  
  return NextResponse.json(tmdbData.results || []);
}
