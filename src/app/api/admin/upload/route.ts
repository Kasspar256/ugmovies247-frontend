import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { getPublicR2BaseUrl } from '@/lib/server/env';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function POST(req: Request) {
  try {
    const session = await getCurrentAuthSession();

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { fileName, fileType } = await req.json();
    
    if (!fileName || !fileType) {
      return NextResponse.json({ error: 'Missing file metadata' }, { status: 400 });
    }

    const cleanFileName = fileName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '');

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: cleanFileName,
      ContentType: fileType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    const publicUrl = `${getPublicR2BaseUrl()}/${cleanFileName}`;

    return NextResponse.json({ signedUrl, publicUrl, fileName: cleanFileName });
  } catch (error: any) {
    console.error('R2 Presign Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
