import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { clearAiChatHistory, listAiChatHistory } from '@/lib/server/aiMemory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getCurrentAuthSession({ hydrateUserRecord: true }).catch(() => null);

  if (!session) {
    return NextResponse.json({ messages: [] }, { status: 401 });
  }

  const messages = await listAiChatHistory(session.uid, 50).catch((error) => {
    console.warn('[ai-history] read failed', error);
    return [];
  });

  return NextResponse.json({
    messages,
    user: {
      name: session.userRecord.name || session.name || '',
    },
  });
}

export async function DELETE() {
  const session = await getCurrentAuthSession({ hydrateUserRecord: true }).catch(() => null);

  if (!session) {
    return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  }

  await clearAiChatHistory(session.uid).catch((error) => {
    console.warn('[ai-history] clear failed', error);
  });

  return NextResponse.json({ success: true });
}
