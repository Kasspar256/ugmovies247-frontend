import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { listPaymentsForAdmin, listSubscriptionsForAdmin } from '@/lib/server/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [payments, subscriptions] = await Promise.all([
    listPaymentsForAdmin(100),
    listSubscriptionsForAdmin(100),
  ]);

  return NextResponse.json({
    payments,
    subscriptions,
  });
}
