import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { getViewerEntitlement } from '@/lib/server/subscriptions';

export async function GET(req: NextRequest) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const entitlement = await getViewerEntitlement(session.uid, {
    email: session.email,
    role: session.role,
  });

  if (!entitlement.hasPremiumAccess) {
    return new NextResponse('Subscription required', { status: 403 });
  }

  const url = req.nextUrl.searchParams.get('url');
  const filename = req.nextUrl.searchParams.get('filename') || 'movie.mp4';

  if (!url) {
    return new NextResponse('Missing url', { status: 400 });
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return new NextResponse('Failed to fetch source file', { status: 502 });
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await response.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new NextResponse('Download proxy failed', { status: 500 });
  }
}
