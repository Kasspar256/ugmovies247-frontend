import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  void request;
  return NextResponse.json(
    {
      error: 'HLS uploads are disabled. Use the Direct Uploads workflow instead.',
    },
    { status: 410 }
  );
}
