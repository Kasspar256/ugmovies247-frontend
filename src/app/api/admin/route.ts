import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';

export async function GET() {
  const session = await getCurrentAuthSession();

  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ message: "Admin system active. Waiting for Auth middleware." });
}
