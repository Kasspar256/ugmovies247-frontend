import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getRequestAuthSession } from '@/lib/auth/server';
import { createPresignedR2Download, getR2ObjectKeyFromPublicUrl } from '@/lib/server/r2';
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

function getDownloadTicketSecret() {
  return (
    process.env.DOWNLOAD_TICKET_SECRET ||
    process.env.REQUEST_WORKER_SECRET ||
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.NEXTAUTH_SECRET ||
    ''
  );
}

function signProxyDownload(sourceUrl: string, filename: string, expiresAt: number) {
  const secret = getDownloadTicketSecret();

  if (!secret) {
    throw new Error('Missing server download ticket secret.');
  }

  return createHmac('sha256', secret)
    .update(`${expiresAt}.${filename}.${sourceUrl}`)
    .digest('hex');
}

function isValidProxyDownloadSignature(options: {
  sourceUrl: string;
  filename: string;
  expiresAt: number;
  signature: string;
}) {
  if (!options.sourceUrl || !options.filename || !options.expiresAt || !options.signature) {
    return false;
  }

  if (options.expiresAt < Date.now()) {
    return false;
  }

  const expected = signProxyDownload(options.sourceUrl, options.filename, options.expiresAt);
  const receivedBuffer = Buffer.from(options.signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function createProxyDownloadUrl(request: Request, sourceUrl: string, filename: string) {
  const expiresAt = Date.now() + 1000 * 60 * 20;
  const url = new URL('/api/download', request.url);

  url.searchParams.set('source', sourceUrl);
  url.searchParams.set('filename', filename);
  url.searchParams.set('expiresAt', String(expiresAt));
  url.searchParams.set('signature', signProxyDownload(sourceUrl, filename, expiresAt));

  return {
    downloadUrl: url.toString(),
    expiresAt: new Date(expiresAt).toISOString(),
    expiresIn: 60 * 20,
  };
}

function isDownloadableMp4Url(value: string) {
  return /^https?:\/\//i.test(value) && !/\.m3u8(?:[?#]|$)/i.test(value);
}

async function requirePremiumDownloadAccess(request: Request) {
  const session = await getRequestAuthSession(request);

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
  const access = await requirePremiumDownloadAccess(request);

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
  const filename = sanitizeFilename(`${title}-${movieId}`);

  if (!objectKey) {
    if (!isDownloadableMp4Url(sourceUrl)) {
      return NextResponse.json(
        { error: 'This video source is not available for protected offline download yet.' },
        { status: 400 }
      );
    }

    const proxyTicket = createProxyDownloadUrl(request, sourceUrl, filename);

    return NextResponse.json({
      movieId,
      filename,
      downloadUrl: proxyTicket.downloadUrl,
      expiresAt: proxyTicket.expiresAt,
      expiresIn: proxyTicket.expiresIn,
      delivery: 'proxy',
    });
  }

  const ticket = await createPresignedR2Download({
    key: objectKey,
    filename,
  });

  return NextResponse.json({
    movieId,
    filename,
    downloadUrl: ticket.downloadUrl,
    expiresAt: ticket.expiresAt,
    expiresIn: ticket.expiresIn,
    delivery: 'r2',
  });
}

export async function GET(req: NextRequest) {
  const signedSourceUrl = req.nextUrl.searchParams.get('source') || '';
  const filename = sanitizeFilename(req.nextUrl.searchParams.get('filename') || 'movie.mp4');
  const expiresAt = Number(req.nextUrl.searchParams.get('expiresAt') || 0);
  const signature = req.nextUrl.searchParams.get('signature') || '';
  const legacyUrl = req.nextUrl.searchParams.get('url') || '';
  let url = signedSourceUrl;

  if (signedSourceUrl) {
    if (
      !isValidProxyDownloadSignature({
        sourceUrl: signedSourceUrl,
        filename,
        expiresAt,
        signature,
      })
    ) {
      return new NextResponse('Download ticket expired or invalid', { status: 403 });
    }
  } else {
    const access = await requirePremiumDownloadAccess(req);

    if (access.error) {
      return access.error;
    }

    url = legacyUrl;
  }

  if (!url) {
    return new NextResponse('Missing url', { status: 400 });
  }

  try {
    const headers = new Headers();
    const range = req.headers.get('range');

    if (range) {
      headers.set('range', range);
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return new NextResponse('Failed to fetch source file', { status: 502 });
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const responseHeaders = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });

    for (const headerName of ['content-length', 'content-range', 'accept-ranges']) {
      const headerValue = response.headers.get(headerName);

      if (headerValue) {
        responseHeaders.set(headerName, headerValue);
      }
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return new NextResponse('Download proxy failed', { status: 500 });
  }
}
