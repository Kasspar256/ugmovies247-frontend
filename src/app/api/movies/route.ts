import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { getViewerEntitlement } from '@/lib/server/subscriptions';
import { sanitizeMovieForViewer } from '@/lib/server/contentAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentAuthSession();

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entitlement = await getViewerEntitlement(session.uid);

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        { error: 'Movie catalog backend is not configured.', detail: adminSetupError },
        { status: 500 }
      );
    }

    const snapshot = await adminDb.collection('movies').orderBy('date_added', 'desc').get();
    const movies = snapshot.docs.map((movieDoc) =>
      sanitizeMovieForViewer(
        {
          id: movieDoc.id,
          ...movieDoc.data(),
        },
        entitlement
      )
    );

    return NextResponse.json({ movies, entitlement });
  } catch (error) {
    console.error('[movies-api] failed to load movies', error);
    return NextResponse.json(
      {
        error: 'Failed to load movies.',
        detail: error instanceof Error ? error.message : 'Unknown movies API error.',
      },
      { status: 500 }
    );
  }
}
