import { NextResponse } from 'next/server';
import { getRequestAuthSessionValidation } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const validation = await getRequestAuthSessionValidation(request);

  if (!validation.session) {
    return NextResponse.json(
      {
        authenticated: false,
        reason: validation.reason || 'session_missing',
      },
      { status: 401 }
    );
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: validation.session.uid,
      name: validation.session.userRecord.name,
      email: validation.session.userRecord.email,
      role: validation.session.userRecord.role,
    },
  });
}
