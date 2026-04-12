import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { SUBSCRIPTION_PLAN_LIST } from '@/lib/subscriptions/plans';
import { getViewerEntitlement } from '@/lib/server/subscriptions';
import { getConfiguredPawaPayProviders } from '@/lib/server/pawapay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const entitlement = await getViewerEntitlement(session.uid, {
    email: session.email,
    role: session.role,
  });

  return NextResponse.json({
    plans: SUBSCRIPTION_PLAN_LIST,
    providers: getConfiguredPawaPayProviders(),
    entitlement,
  });
}
