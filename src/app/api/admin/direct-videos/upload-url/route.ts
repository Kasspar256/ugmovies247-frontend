import path from 'path';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import {
  abortMultipartR2Upload,
  completeMultipartR2Upload,
  createMultipartR2Upload,
  getMultipartR2UploadPartUrls,
  getR2PublicUrl,
  listMultipartR2UploadParts,
  R2_MULTIPART_PART_SIZE_BYTES,
} from '@/lib/server/r2';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeFileName(fileName: string) {
  const baseName = path.basename(fileName || 'source.mp4');
  return baseName.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function requireAdminSession() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const adminSetupError = getFirebaseAdminSetupError();

  if (adminSetupError) {
    return NextResponse.json(
      {
        error: 'Direct upload backend is not configured yet.',
        detail: adminSetupError,
      },
      { status: 500 }
    );
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const authFailure = await requireAdminSession();

    if (authFailure) {
      return authFailure;
    }

    const body = await request.json();
    const safeFileName = sanitizeFileName(String(body.fileName || 'source.mp4'));
    const contentType = String(body.contentType || 'application/octet-stream');
    const fileSize = Number(body.fileSize || 0);
    const existingKey = String(body.key || '').trim();
    const existingUploadId = String(body.uploadId || '').trim();
    const stage =
      body.stage === 'staging'
        ? 'staging'
        : body.stage === 'library'
          ? 'library'
          : 'final';
    const keyPrefix =
      stage === 'staging'
        ? 'direct-source-staging'
        : stage === 'library'
          ? 'library-assets'
          : 'direct-uploads';
    const partSize = Number(body.partSize || 0);
    const resolvedPartSize =
      Number.isFinite(partSize) && partSize > 0 ? partSize : R2_MULTIPART_PART_SIZE_BYTES;

    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return NextResponse.json({ error: 'Missing or invalid file size.' }, { status: 400 });
    }

    if (existingKey && existingUploadId) {
      const partCount = Number(body.partCount || 0);
      const partNumbers = Array.isArray(body.partNumbers)
        ? body.partNumbers
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        : [];
      const resolvedPartNumbers =
        partNumbers.length > 0
          ? partNumbers
          : Array.from(
              { length: Math.max(1, Math.ceil(fileSize / resolvedPartSize), partCount) },
              (_, index) => index + 1
            );

      const [parts, uploadedParts] = await Promise.all([
        getMultipartR2UploadPartUrls({
          key: existingKey,
          uploadId: existingUploadId,
          partNumbers: resolvedPartNumbers,
        }),
        listMultipartR2UploadParts({
          key: existingKey,
          uploadId: existingUploadId,
        }),
      ]);

      return NextResponse.json({
        mode: 'multipart-resume',
        key: existingKey,
        uploadId: existingUploadId,
        publicUrl: getR2PublicUrl(existingKey),
        partSize: resolvedPartSize,
        parts,
        uploadedParts,
        requiredResponseHeaders: ['ETag'],
      });
    }

    const key = `${keyPrefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFileName}`;

    const upload = await createMultipartR2Upload({
      key,
      contentType,
      partCount: Math.max(1, Math.ceil(fileSize / resolvedPartSize)),
      partSize: resolvedPartSize,
    });

    return NextResponse.json({
      mode: 'multipart',
      ...upload,
      requiredResponseHeaders: ['ETag'],
    });
  } catch (error) {
    console.error('[direct-videos] failed to create upload URL', error);
    return NextResponse.json(
      {
        error: 'Failed to prepare direct upload URL.',
        detail: error instanceof Error ? error.message : 'Unknown direct upload URL error.',
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const authFailure = await requireAdminSession();

    if (authFailure) {
      return authFailure;
    }

    const body = await request.json();
    const key = String(body.key || '');
    const uploadId = String(body.uploadId || '');
    const parts = Array.isArray(body.parts)
      ? body.parts
          .map((part) => ({
            partNumber: Number(part?.partNumber || 0),
            etag: String(part?.etag || '').trim(),
          }))
          .filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag)
      : [];

    if (!key || !uploadId || !parts.length) {
      return NextResponse.json(
        { error: 'Missing multipart upload completion payload.' },
        { status: 400 }
      );
    }

    const upload = await completeMultipartR2Upload({
      key,
      uploadId,
      parts,
    });

    return NextResponse.json({ success: true, ...upload });
  } catch (error) {
    console.error('[direct-videos] failed to complete multipart upload', error);
    return NextResponse.json(
      {
        error: 'Failed to finalize direct upload.',
        detail: error instanceof Error ? error.message : 'Unknown multipart completion error.',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const authFailure = await requireAdminSession();

    if (authFailure) {
      return authFailure;
    }

    const body = await request.json();
    const key = String(body.key || '');
    const uploadId = String(body.uploadId || '');

    if (!key || !uploadId) {
      return NextResponse.json(
        { error: 'Missing multipart upload abort payload.' },
        { status: 400 }
      );
    }

    await abortMultipartR2Upload({
      key,
      uploadId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[direct-videos] failed to abort multipart upload', error);
    return NextResponse.json(
      {
        error: 'Failed to abort direct upload.',
        detail: error instanceof Error ? error.message : 'Unknown multipart abort error.',
      },
      { status: 500 }
    );
  }
}
