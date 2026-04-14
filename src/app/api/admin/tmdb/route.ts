import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';

type SearchMediaType = 'movie' | 'tv';

async function fetchTmdbJson(path: string, params?: URLSearchParams) {
  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    throw new Error('TMDb API key is not configured.');
  }

  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set('api_key', apiKey);

  if (params) {
    params.forEach((value, key) => {
      if (value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }

  const response = await fetch(url.toString(), { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof payload?.status_message === 'string'
        ? payload.status_message
        : 'TMDb request failed.'
    );
  }

  return payload;
}

export async function GET(req: Request) {
  const session = await getCurrentAuthSession();

  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const title = searchParams.get('title')?.trim() || '';
    const tmdbId = searchParams.get('tmdbId')?.trim() || '';
    const seasonNumber = searchParams.get('seasonNumber')?.trim() || '';
    const mediaType: SearchMediaType = searchParams.get('mediaType') === 'tv' ? 'tv' : 'movie';

    if (tmdbId && mediaType === 'tv' && seasonNumber) {
      const payload = await fetchTmdbJson(`/tv/${encodeURIComponent(tmdbId)}/season/${encodeURIComponent(seasonNumber)}`);
      return NextResponse.json(payload);
    }

    if (tmdbId) {
      const params = new URLSearchParams();

      if (mediaType === 'tv') {
        params.set('append_to_response', 'keywords');
      }

      const payload = await fetchTmdbJson(`/${mediaType}/${encodeURIComponent(tmdbId)}`, params);
      return NextResponse.json(payload);
    }

    if (!title) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    }

    const payload = await fetchTmdbJson(`/search/${mediaType}`, new URLSearchParams({ query: title }));
    return NextResponse.json(payload.results || []);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'TMDb request failed.',
      },
      { status: 500 }
    );
  }
}
