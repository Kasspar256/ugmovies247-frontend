import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { listPaymentsForAdminByProvider } from '@/lib/server/subscriptions';
import { isAppInReview } from '@/lib/appReview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return null;
  }

  return session;
}

export async function GET() {
  try {
    if (isAppInReview) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payments = await listPaymentsForAdminByProvider('payfast', 200);
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const completedPayments = payments.filter((payment) => payment.status === 'completed');
    const monthPayments = completedPayments.filter((payment) =>
      String(payment.createdAt || '').startsWith(monthKey)
    );

    return NextResponse.json({
      summary: {
        monthLabel: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        monthAmount: monthPayments.reduce((total, payment) => total + Number(payment.amount || 0), 0),
        completedAmount: completedPayments.reduce(
          (total, payment) => total + Number(payment.amount || 0),
          0
        ),
        completedCount: completedPayments.length,
        pendingCount: payments.filter((payment) =>
          ['created', 'initiated', 'pending', 'submitted', 'needs_attention'].includes(payment.status)
        ).length,
        failedCount: payments.filter((payment) =>
          ['failed', 'cancelled', 'not_found'].includes(payment.status)
        ).length,
      },
      payments: payments.map((payment) => ({
        id: payment.id,
        userId: payment.userId,
        planType: payment.planType,
        planName: payment.planName,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paymentKind: payment.paymentKind,
        paymentProvider: payment.paymentProvider,
        paymentMethodProvider: payment.paymentMethodProvider,
        providerStatus: payment.providerStatus,
        providerMessage: payment.providerMessage,
        recurringAgreementId: payment.recurringAgreementId,
        recurringTokenLast4: payment.recurringTokenLast4,
        isAutoRenewal: payment.isAutoRenewal,
        triggerSource: payment.triggerSource,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      })),
    });
  } catch (error) {
    console.error('[admin-card-payments] failed to load card payments', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load card payments.',
      },
      { status: 500 }
    );
  }
}
