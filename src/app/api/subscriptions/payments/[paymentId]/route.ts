import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import {
  applySuccessfulSubscriptionPayment,
  getPaymentAttempt,
  markPaymentAttemptFailed,
} from '@/lib/server/subscriptions';
import {
  fetchPawaPayDepositStatus,
  getPawaPayConfigError,
  getProviderTransactionId,
  mapPawaPayStatusToPaymentState,
} from '@/lib/server/pawapay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
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

  if (payment.status === 'completed' || payment.status === 'failed' || payment.status === 'cancelled') {
    return NextResponse.json({ payment });
  }

  const configError = getPawaPayConfigError();

  if (configError) {
    return NextResponse.json({ payment, warning: configError });
  }

  try {
    const providerStatusResponse = await fetchPawaPayDepositStatus(payment.providerDepositId || params.paymentId);
    const rawStatus = String(providerStatusResponse.data?.status || providerStatusResponse.status || '');
    const mappedStatus = mapPawaPayStatusToPaymentState(rawStatus);
    const providerTransactionId = getProviderTransactionId(
      (providerStatusResponse.data || {}) as Record<string, unknown>
    );

    if (mappedStatus === 'completed') {
      await applySuccessfulSubscriptionPayment({
        paymentId: params.paymentId,
        providerTransactionId,
        providerStatus: rawStatus,
        providerMessage: 'Payment completed successfully.',
        rawPayload: providerStatusResponse as unknown as Record<string, unknown>,
        source: 'poll',
      });
    } else if (mappedStatus === 'failed' || mappedStatus === 'cancelled' || mappedStatus === 'not_found') {
      await markPaymentAttemptFailed({
        paymentId: params.paymentId,
        status: mappedStatus,
        providerStatus: rawStatus,
        message: rawStatus || 'Payment was not completed.',
        rawPayload: providerStatusResponse as unknown as Record<string, unknown>,
        source: 'poll',
      });
    }

    const updatedPayment = await getPaymentAttempt(params.paymentId);
    return NextResponse.json({ payment: updatedPayment || payment });
  } catch (error) {
    console.error('[subscriptions] payment status refresh failed', error);
    return NextResponse.json(
      {
        payment,
        error: error instanceof Error ? error.message : 'Failed to refresh payment status.',
      },
      { status: 500 }
    );
  }
}
