import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { getR2ObjectKeyFromPublicUrl } from '@/lib/server/r2';
import { getViewerEntitlement } from '@/lib/server/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeFilename(value: string) {
  const base = value
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'ugmovies247-video';

  return base.toLowerCase().endsWith('.mp4') ? base : `${base}.mp4`;
}

async function requirePremiumDownloadAccess() {
  const session = await getCurrentAuthSession();

  if (!session) {
    return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const entitlement = await getViewerEntitlement(session.uid, {
    email: session.email,
    role: session.role,
  });

  if (!entitlement.hasPremiumAccess) {
    return {
      session: null,
      error: NextResponse.json({ error: 'Subscription required' }, { status: 403 }),
    };
  }

  return { session, error: null };
}

export async function POST(request: Request) {
  const access = await requirePremiumDownloadAccess();

  if (access.error) {
    return access.error;
  }

  const body = await request.json().catch(() => ({}));
  const sourceUrl = String(body.sourceUrl || body.video_url || '').trim();
  const title = String(body.title || 'UG Movies 247').trim();
  const movieId = String(body.movieId || '').trim();

  if (!movieId || !sourceUrl) {
    return NextResponse.json({ error: 'movieId and sourceUrl are required.' }, { status: 400 });
  }

  const objectKey = getR2ObjectKeyFromPublicUrl(sourceUrl);

  if (!objectKey) {
    return NextResponse.json(
      { error: 'This video source is not available for protected offline download yet.' },
      { status: 400 }
    );
  }

  const filename = sanitizeFilename(`${title}-${movieId}`);

  return NextResponse.json({
    movieId,
    filename,
    downloadUrl: sourceUrl,
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    expiresIn: 6 * 60 * 60,
  });
}

export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      error: 'Use POST /api/download to request a protected native download ticket.',
    },
    { status: 405 }
  );
}
