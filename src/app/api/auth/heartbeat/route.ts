import { NextResponse } from 'next/server';
import { getRequestAuthSessionValidation } from '@/lib/auth/server';
import { touchManagedAuthSession } from '@/lib/server/authSessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
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

    const touched = await touchManagedAuthSession({
      request,
      userId: validation.session.uid,
    });

    if (!touched.valid) {
      return NextResponse.json(
        {
          authenticated: false,
          reason: touched.reason,
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      authenticated: true,
      lastActivityAt: touched.record.lastActivityAt,
    });
  } catch (error) {
    console.error('[auth] heartbeat failed', error);
    return NextResponse.json(
      { error: 'Could not refresh the active session.' },
      { status: 500 }
    );
  }
}
