import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { getPaymentAttempt, updatePaymentAttempt } from '@/lib/server/subscriptions';

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
  }

  return NextResponse.json({
    payment: (await getPaymentAttempt(params.paymentId)) || payment,
  });
}
