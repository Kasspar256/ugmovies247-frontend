import { NextResponse } from 'next/server';
import {
  applySuccessfulSubscriptionPayment,
  getPaymentAttempt,
  logPaymentWebhook,
  markPaymentAttemptFailed,
  updatePaymentAttempt,
} from '@/lib/server/subscriptions';
import {
  mapPayFastStatusToPaymentState,
  parsePayFastPayload,
  validatePayFastAmount,
  validatePayFastPayloadWithGateway,
  validatePayFastSignature,
  validatePayFastSignatureFromRawBody,
  validatePayFastSourceIp,
} from '@/lib/server/payfast';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const payload = parsePayFastPayload(rawBody);

  await logPaymentWebhook(payload as Record<string, unknown>).catch(() => undefined);

  const paymentId = payload.m_payment_id || '';

  if (!paymentId) {
    return new NextResponse('OK', { status: 200 });
  }

  const payment = await getPaymentAttempt(paymentId);

  if (!payment) {
    return new NextResponse('OK', { status: 200 });
  }

  if (payment.paymentProvider !== 'payfast') {
    return new NextResponse('OK', { status: 200 });
  }

  const signatureValid =
    validatePayFastSignatureFromRawBody(payload, rawBody) || validatePayFastSignature(payload);

  if (!signatureValid) {
    await updatePaymentAttempt(paymentId, {
      status: 'needs_attention',
      providerStatus: payload.payment_status || 'INVALID_SIGNATURE',
      providerMessage: 'PayFast signature validation failed.',
      providerCallbackPayload: payload as Record<string, unknown>,
      webhookReceivedAt: new Date().toISOString(),
    });

    if (process.env.NODE_ENV !== 'production') {
      console.warn('[subscriptions] payfast signature validation failed', {
        paymentId,
        paymentStatus: payload.payment_status || '',
        receivedSignature: payload.signature || '',
        rawBody,
      });
    }

    return new NextResponse('INVALID', { status: 400 });
  }

  if (!validatePayFastSourceIp(request)) {
    await updatePaymentAttempt(paymentId, {
      status: 'needs_attention',
      providerStatus: payload.payment_status || 'SOURCE_IP_REJECTED',
      providerMessage: 'PayFast ITN source IP did not match the configured allow list.',
      providerCallbackPayload: payload as Record<string, unknown>,
      webhookReceivedAt: new Date().toISOString(),
    });

    return new NextResponse('INVALID', { status: 400 });
  }

  const validation = await validatePayFastPayloadWithGateway(rawBody);

  if (!validation.ok) {
    await updatePaymentAttempt(paymentId, {
      status: 'needs_attention',
      providerStatus: payload.payment_status || 'VALIDATION_FAILED',
      providerMessage: validation.reason || 'PayFast validation rejected the ITN payload.',
      providerCallbackPayload: payload as Record<string, unknown>,
      webhookReceivedAt: new Date().toISOString(),
    });

    return new NextResponse('INVALID', { status: 400 });
  }

  if (!validatePayFastAmount(payment.amount, payload.amount_gross || payload.amount || '')) {
    await updatePaymentAttempt(paymentId, {
      status: 'needs_attention',
      providerStatus: payload.payment_status || 'AMOUNT_MISMATCH',
      providerMessage: 'PayFast amount validation failed.',
      providerCallbackPayload: payload as Record<string, unknown>,
      webhookReceivedAt: new Date().toISOString(),
    });

    return new NextResponse('INVALID', { status: 400 });
  }

  const mappedStatus = mapPayFastStatusToPaymentState(payload.payment_status || '');
  const providerTransactionId = payload.pf_payment_id || payload.payment_id || '';

  if (mappedStatus === 'completed') {
    await applySuccessfulSubscriptionPayment({
      paymentId,
      providerTransactionId,
      providerStatus: payload.payment_status || 'COMPLETE',
      providerMessage: 'Card payment completed successfully.',
      rawPayload: payload as Record<string, unknown>,
      source: 'webhook',
    });
  } else if (mappedStatus === 'failed' || mappedStatus === 'cancelled') {
    await markPaymentAttemptFailed({
      paymentId,
      status: mappedStatus,
      providerStatus: payload.payment_status || 'FAILED',
      message: payload.error_message || payload.payment_status || 'Card payment was not completed.',
      rawPayload: payload as Record<string, unknown>,
      source: 'webhook',
    });
  } else {
    await updatePaymentAttempt(paymentId, {
      status: mappedStatus,
      providerStatus: payload.payment_status || 'PENDING',
      providerMessage: 'Awaiting final PayFast confirmation.',
      providerCallbackPayload: payload as Record<string, unknown>,
      webhookReceivedAt: new Date().toISOString(),
    });
  }

  return new NextResponse('OK', { status: 200 });
}
