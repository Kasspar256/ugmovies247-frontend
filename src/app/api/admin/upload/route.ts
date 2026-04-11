import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { createPresignedR2Upload } from '@/lib/server/r2';

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

    const { uploadUrl, publicUrl } = await createPresignedR2Upload({
      key: cleanFileName,
      contentType: fileType,
    });

    return NextResponse.json({ signedUrl: uploadUrl, publicUrl, fileName: cleanFileName });
  } catch (error: any) {
    console.error('R2 Presign Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
