import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const message = String(payload.message || '').slice(0, 700);

    if (!message) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const record = {
      message,
      source: String(payload.source || 'client').slice(0, 80),
      path: String(payload.path || '').slice(0, 240),
      userAgent: String(payload.userAgent || request.headers.get('user-agent') || '').slice(0, 500),
      at: String(payload.at || new Date().toISOString()).slice(0, 60),
      createdAt: new Date().toISOString(),
    };

    console.warn('[client-error]', record);

    await adminDb
      .collection('client_startup_errors')
      .add(record)
      .catch(() => undefined);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('[client-error] failed to record client error', error);
    return NextResponse.json({ success: true });
  }
}
