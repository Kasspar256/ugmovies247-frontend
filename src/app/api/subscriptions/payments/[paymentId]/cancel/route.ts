import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import {
  getPaymentAttempt,
  updatePaymentAttempt,
  updateSubscriptionRecurringState,
  upsertRecurringAgreementForUser,
} from '@/lib/server/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: { paymentId: string } }
) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payment = await getPaymentAttempt(params.paymentId);

  if (!payment) {
    return NextResponse.json({ error: 'Payment attempt not found.' }, { status: 404 });
  }

  if (payment.userId !== session.uid && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (payment.paymentProvider !== 'payfast') {
    return NextResponse.json({ payment });
  }

  if (!['completed', 'failed', 'cancelled'].includes(payment.status)) {
    await updatePaymentAttempt(params.paymentId, {
      status: 'cancelled',
      providerStatus: 'CANCELLED',
      providerMessage: 'Card payment was cancelled before completion.',
      failureReason: 'Card payment was cancelled before completion.',
    });

    if (payment.paymentKind === 'recurring_enrollment') {
      await upsertRecurringAgreementForUser(payment.userId, {
        status: 'cancelled',
        autoRenewEnabled: false,
        token: '',
        tokenCapturedAt: '',
        tokenSourcePaymentId: '',
        pendingPaymentId: '',
        processingLockUntil: '',
        failureReason: 'Card auto-renew setup was cancelled before completion.',
      });
      await updateSubscriptionRecurringState(payment.userId, {
        recurringAgreementId: payment.recurringAgreementId || payment.userId,
        autoRenewEnabled: false,
        nextChargeAt: '',
      });
    }
  }

  return NextResponse.json({
    payment: (await getPaymentAttempt(params.paymentId)) || payment,
  });
}
