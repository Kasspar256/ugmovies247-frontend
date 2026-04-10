import path from 'path';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { createPresignedR2Upload } from '@/lib/server/r2';
import { getCurrentAuthSession } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeFileName(fileName: string) {
  const baseName = path.basename(fileName || 'source.mp4');
  return baseName.replace(/[^A-Za-z0-9._-]/g, '_');
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentAuthSession();

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        {
          error: 'Video queue backend is not configured yet.',
          detail: adminSetupError,
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    const safeFileName = sanitizeFileName(String(body.fileName || 'source.mp4'));
    const contentType = String(body.contentType || 'application/octet-stream');
    const key = `video-job-sources/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFileName}`;
    const upload = await createPresignedR2Upload({
      key,
      contentType,
    });

    return NextResponse.json(upload);
  } catch (error) {
    console.error('[video-jobs] failed to create upload URL', error);
    return NextResponse.json(
      {
        error: 'Failed to prepare upload URL.',
        detail: error instanceof Error ? error.message : 'Unknown upload URL error.',
      },
      { status: 500 }
    );
  }
}
