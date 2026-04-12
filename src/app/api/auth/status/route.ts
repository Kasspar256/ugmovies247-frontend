import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.uid,
      name: session.userRecord.name,
      email: session.userRecord.email,
      role: session.userRecord.role,
    },
  });
}
