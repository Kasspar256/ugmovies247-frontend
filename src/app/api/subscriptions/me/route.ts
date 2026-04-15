import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { BILLING_OPERATOR } from '@/lib/billingIdentity';
import { SUBSCRIPTION_PLAN_LIST } from '@/lib/subscriptions/plans';
import { getViewerEntitlement, listPaymentsForUser } from '@/lib/server/subscriptions';
import { getPayFastGatewayConfig } from '@/lib/server/payfast';
import { getConfiguredPawaPayProviders, getPawaPayProviderLabel } from '@/lib/server/pawapay';
import type { UserPaymentHistoryEntry } from '@/types/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getDaysLeft(expiresAt?: string) {
  if (!expiresAt) {
    return null;
  }

  const expiresAtMs = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }

  return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / (1000 * 60 * 60 * 24)));
}

export async function GET() {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [entitlement, payments] = await Promise.all([
    getViewerEntitlement(session.uid, {
      email: session.email,
      role: session.role,
    }),
    listPaymentsForUser(session.uid, 20),
  ]);

  const paymentHistory: UserPaymentHistoryEntry[] = payments.map((payment) => ({
    id: payment.id || '',
    planType: payment.planType,
    planName: payment.planName,
    status: payment.status,
    startsAt: payment.startsAt,
    expiresAt: payment.expiresAt,
    daysLeft: payment.status === 'completed' ? getDaysLeft(payment.expiresAt) : null,
    paymentMethodLabel:
      payment.paymentProvider === 'payfast'
        ? 'CARD / PAYFAST'
        : payment.paymentMethodProvider
          ? getPawaPayProviderLabel(payment.paymentMethodProvider)
          : payment.paymentProvider.toUpperCase(),
    paymentMethodProvider: payment.paymentMethodProvider || '',
    paymentProvider: payment.paymentProvider,
    providerStatus: payment.providerStatus,
    createdAt: payment.createdAt,
    billedBy: BILLING_OPERATOR,
  }));

  return NextResponse.json({
    plans: SUBSCRIPTION_PLAN_LIST,
    providers: getConfiguredPawaPayProviders(),
    cardGateway: getPayFastGatewayConfig(),
    entitlement,
    payments: paymentHistory,
  });
}
