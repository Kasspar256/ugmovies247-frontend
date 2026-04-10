import { NextResponse } from 'next/server';
import {
  applySuccessfulSubscriptionPayment,
  getPaymentAttempt,
  logPaymentWebhook,
  markPaymentAttemptFailed,
} from '@/lib/server/subscriptions';
import {
  getProviderTransactionId,
  mapPawaPayStatusToPaymentState,
  validatePawaPayContentDigest,
} from '@/lib/server/pawapay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const digestHeader = request.headers.get('content-digest') || '';

  if (digestHeader && !validatePawaPayContentDigest(rawBody, digestHeader)) {
    return NextResponse.json({ error: 'Invalid Content-Digest.' }, { status: 400 });
  }

  let payload: Record<string, unknown> = {};

  try {
    payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  await logPaymentWebhook(payload).catch(() => undefined);

  const depositId = String(
    payload.depositId ||
      (payload.data as Record<string, unknown> | undefined)?.depositId ||
      ''
  );
  const providerStatus = String(
    payload.status ||
      (payload.data as Record<string, unknown> | undefined)?.status ||
      ''
  );

  if (!depositId) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'Missing depositId.' });
  }

  const payment = await getPaymentAttempt(depositId);

  if (!payment) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'Unknown payment id.' });
  }

  const mappedStatus = mapPawaPayStatusToPaymentState(providerStatus);
  const providerTransactionId =
    getProviderTransactionId(payload) ||
    getProviderTransactionId(
      ((payload.data as Record<string, unknown> | undefined) || {}) as Record<string, unknown>
    );

  if (mappedStatus === 'completed') {
    await applySuccessfulSubscriptionPayment({
      paymentId: depositId,
      providerTransactionId,
      providerStatus,
      providerMessage: 'Payment completed successfully.',
      rawPayload: payload,
      source: 'webhook',
    });
  } else if (mappedStatus === 'failed' || mappedStatus === 'cancelled' || mappedStatus === 'not_found') {
    await markPaymentAttemptFailed({
      paymentId: depositId,
      status: mappedStatus,
      providerStatus,
      message: providerStatus || 'Payment failed.',
      rawPayload: payload,
      source: 'webhook',
    });
  }

  return NextResponse.json({ ok: true });
}
