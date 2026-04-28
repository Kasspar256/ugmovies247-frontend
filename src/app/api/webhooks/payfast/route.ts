import { NextResponse } from 'next/server';
import {
  applySuccessfulSubscriptionPayment,
  getRecurringAgreementForUser,
  getPaymentAttempt,
  logPaymentWebhook,
  markPaymentAttemptFailed,
  updateRecurringAgreementAfterFailedPayment,
  updateRecurringAgreementAfterSuccessfulPayment,
  updateSubscriptionRecurringState,
  updatePaymentAttempt,
  upsertRecurringAgreementForUser,
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
import {
  buildNextChargeAtFromExpiry,
  cancelPayFastTokenizedAgreement,
  extractPayFastToken,
  getRecurringFailureRescheduleAt,
} from '@/lib/server/payfastRecurring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const payload = parsePayFastPayload(rawBody);
  const requestUrl = new URL(request.url);

  await logPaymentWebhook(payload as Record<string, unknown>).catch(() => undefined);

  const paymentId =
    payload.m_payment_id ||
    payload.custom_str1 ||
    payload.custom_str2 ||
    payload.custom_str3 ||
    requestUrl.searchParams.get('paymentId') ||
    '';

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

  const isRecurringEnrollment = payment.paymentKind === 'recurring_enrollment';
  const isRecurringRenewal = payment.paymentKind === 'recurring_renewal';
  const currentAgreement =
    isRecurringEnrollment || isRecurringRenewal
      ? await getRecurringAgreementForUser(payment.userId).catch(() => null)
      : null;
  const agreementWasCancelled = Boolean(
    currentAgreement &&
      (currentAgreement.status === 'cancelled' || Boolean(currentAgreement.cancelledAt))
  );
  const hasActiveTokenizedAgreement = Boolean(
    isRecurringEnrollment &&
      currentAgreement?.token &&
      currentAgreement.autoRenewEnabled === true &&
      currentAgreement.nextChargeAt &&
      currentAgreement.status !== 'cancelled'
  );
  const keepAgreementCancelled = async (lastChargeStatus: string, failureReason = '') => {
    await upsertRecurringAgreementForUser(payment.userId, {
      status: 'cancelled',
      autoRenewEnabled: false,
      token: '',
      tokenCapturedAt: '',
      tokenSourcePaymentId: '',
      nextChargeAt: '',
      pendingPaymentId: '',
      processingLockUntil: '',
      lastChargeAt: new Date().toISOString(),
      lastChargeStatus,
      lastPaymentId: paymentId,
      cancelledAt: currentAgreement?.cancelledAt || new Date().toISOString(),
      failureReason,
    });
    await updateSubscriptionRecurringState(payment.userId, {
      recurringAgreementId: payment.recurringAgreementId || payment.userId,
      autoRenewEnabled: false,
      nextChargeAt: '',
    });
  };

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

    if (isRecurringEnrollment && agreementWasCancelled) {
      await keepAgreementCancelled('SETUP_CANCELLED_LOCALLY', '');
    } else if (isRecurringEnrollment) {
      await upsertRecurringAgreementForUser(payment.userId, {
        status: 'needs_attention',
        autoRenewEnabled: false,
        pendingPaymentId: '',
        processingLockUntil: '',
        failureReason: 'PayFast signature validation failed during auto-renew setup.',
      });
      await updateSubscriptionRecurringState(payment.userId, {
        recurringAgreementId: payment.recurringAgreementId || payment.userId,
        autoRenewEnabled: false,
        nextChargeAt: '',
      });
    } else if (isRecurringRenewal && agreementWasCancelled) {
      await keepAgreementCancelled('RENEWAL_CANCELLED_LOCALLY', '');
    } else if (isRecurringRenewal) {
      await updateRecurringAgreementAfterFailedPayment({
        userId: payment.userId,
        paymentId,
        nextChargeAt: getRecurringFailureRescheduleAt(),
        status: 'needs_attention',
        failureReason: 'PayFast signature validation failed during recurring renewal.',
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

    if (isRecurringEnrollment && agreementWasCancelled) {
      await keepAgreementCancelled('SETUP_CANCELLED_LOCALLY', '');
    } else if (isRecurringEnrollment) {
      await upsertRecurringAgreementForUser(payment.userId, {
        status: 'needs_attention',
        autoRenewEnabled: false,
        pendingPaymentId: '',
        processingLockUntil: '',
        failureReason: 'PayFast ITN source IP did not match the configured allow list.',
      });
      await updateSubscriptionRecurringState(payment.userId, {
        recurringAgreementId: payment.recurringAgreementId || payment.userId,
        autoRenewEnabled: false,
        nextChargeAt: '',
      });
    } else if (isRecurringRenewal && agreementWasCancelled) {
      await keepAgreementCancelled('RENEWAL_CANCELLED_LOCALLY', '');
    } else if (isRecurringRenewal) {
      await updateRecurringAgreementAfterFailedPayment({
        userId: payment.userId,
        paymentId,
        nextChargeAt: getRecurringFailureRescheduleAt(),
        status: 'needs_attention',
        failureReason: 'PayFast ITN source IP did not match the configured allow list.',
      });
    }

    return new NextResponse('INVALID', { status: 400 });
  }

  const validation = await validatePayFastPayloadWithGateway(rawBody);

  if (!validation.ok) {
    if (hasActiveTokenizedAgreement) {
      await updatePaymentAttempt(paymentId, {
        providerStatus: payload.payment_status || 'VALIDATION_IGNORED_AFTER_TOKENIZED_SETUP',
        providerMessage:
          `${validation.reason || 'PayFast validation rejected the ITN payload.'} Existing tokenized auto-renew agreement was kept active.`,
        providerCallbackPayload: payload as Record<string, unknown>,
        webhookReceivedAt: new Date().toISOString(),
      });

      return new NextResponse('OK', { status: 200 });
    }

    await updatePaymentAttempt(paymentId, {
      status: 'needs_attention',
      providerStatus: payload.payment_status || 'VALIDATION_FAILED',
      providerMessage: validation.reason || 'PayFast validation rejected the ITN payload.',
      providerCallbackPayload: payload as Record<string, unknown>,
      webhookReceivedAt: new Date().toISOString(),
    });

    if (isRecurringEnrollment && agreementWasCancelled) {
      await keepAgreementCancelled('SETUP_CANCELLED_LOCALLY', '');
    } else if (isRecurringEnrollment) {
      await upsertRecurringAgreementForUser(payment.userId, {
        status: 'needs_attention',
        autoRenewEnabled: false,
        pendingPaymentId: '',
        processingLockUntil: '',
        failureReason: validation.reason || 'PayFast validation rejected the recurring setup payload.',
      });
      await updateSubscriptionRecurringState(payment.userId, {
        recurringAgreementId: payment.recurringAgreementId || payment.userId,
        autoRenewEnabled: false,
        nextChargeAt: '',
      });
    } else if (isRecurringRenewal && agreementWasCancelled) {
      await keepAgreementCancelled('RENEWAL_CANCELLED_LOCALLY', '');
    } else if (isRecurringRenewal) {
      await updateRecurringAgreementAfterFailedPayment({
        userId: payment.userId,
        paymentId,
        nextChargeAt: getRecurringFailureRescheduleAt(),
        status: 'needs_attention',
        failureReason: validation.reason || 'PayFast validation rejected the recurring renewal payload.',
      });
    }

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

    if (isRecurringEnrollment && agreementWasCancelled) {
      await keepAgreementCancelled('SETUP_CANCELLED_LOCALLY', '');
    } else if (isRecurringEnrollment) {
      await upsertRecurringAgreementForUser(payment.userId, {
        status: 'needs_attention',
        autoRenewEnabled: false,
        pendingPaymentId: '',
        processingLockUntil: '',
        failureReason: 'PayFast amount validation failed during recurring setup.',
      });
      await updateSubscriptionRecurringState(payment.userId, {
        recurringAgreementId: payment.recurringAgreementId || payment.userId,
        autoRenewEnabled: false,
        nextChargeAt: '',
      });
    } else if (isRecurringRenewal && agreementWasCancelled) {
      await keepAgreementCancelled('RENEWAL_CANCELLED_LOCALLY', '');
    } else if (isRecurringRenewal) {
      await updateRecurringAgreementAfterFailedPayment({
        userId: payment.userId,
        paymentId,
        nextChargeAt: getRecurringFailureRescheduleAt(),
        status: 'needs_attention',
        failureReason: 'PayFast amount validation failed during recurring renewal.',
      });
    }

    return new NextResponse('INVALID', { status: 400 });
  }

  const mappedStatus = mapPayFastStatusToPaymentState(payload.payment_status || '');
  const providerTransactionId = payload.pf_payment_id || payload.payment_id || '';
  const paymentWasCancelledLocally = payment.status === 'cancelled';

  if (isRecurringEnrollment && paymentWasCancelledLocally) {
    const token = mappedStatus === 'completed' ? extractPayFastToken(payload) : '';

    if (token) {
      await cancelPayFastTokenizedAgreement(token).catch(() => undefined);
    }

    await updatePaymentAttempt(paymentId, {
      status: 'cancelled',
      providerStatus:
        mappedStatus === 'completed'
          ? 'COMPLETED_AFTER_LOCAL_CANCEL'
          : payload.payment_status || payment.providerStatus || 'CANCELLED',
      providerMessage:
        mappedStatus === 'completed'
          ? 'Ignored a late PayFast auto-renew setup callback after this checkout was replaced or cancelled locally.'
          : payment.providerMessage || 'Card auto-renew setup was cancelled before completion.',
      providerCallbackPayload: payload as Record<string, unknown>,
      webhookReceivedAt: new Date().toISOString(),
    });

    return new NextResponse('OK', { status: 200 });
  }

  if (mappedStatus === 'completed') {
    await applySuccessfulSubscriptionPayment({
      paymentId,
      providerTransactionId,
      providerStatus: payload.payment_status || 'COMPLETE',
      providerMessage: 'Card payment completed successfully.',
      rawPayload: payload as Record<string, unknown>,
      source: 'webhook',
    });

    const updatedPayment = await getPaymentAttempt(paymentId);

    if (updatedPayment && isRecurringEnrollment) {
      const token = extractPayFastToken(payload);

      if (agreementWasCancelled) {
        if (token) {
          const remoteCancellation = await cancelPayFastTokenizedAgreement(token).catch((error) => ({
            ok: false,
            providerStatus: 'REMOTE_CANCEL_FAILED',
            providerMessage:
              error instanceof Error
                ? error.message
                : 'PayFast token cancellation failed after late recurring setup success.',
            rawPayload: {},
          }));

          if (!remoteCancellation.ok) {
            await upsertRecurringAgreementForUser(payment.userId, {
              status: 'needs_attention',
              autoRenewEnabled: false,
              token,
              tokenCapturedAt: new Date().toISOString(),
              tokenSourcePaymentId: paymentId,
              nextChargeAt: '',
              pendingPaymentId: '',
              processingLockUntil: '',
              lastChargeAt: new Date().toISOString(),
              lastChargeStatus: 'REMOTE_CANCEL_FAILED',
              lastPaymentId: paymentId,
              cancelledAt: currentAgreement?.cancelledAt || new Date().toISOString(),
              failureReason: remoteCancellation.providerMessage,
            });
            await updateSubscriptionRecurringState(payment.userId, {
              recurringAgreementId: payment.recurringAgreementId || payment.userId,
              autoRenewEnabled: false,
              nextChargeAt: '',
            });
          } else {
            await keepAgreementCancelled('SETUP_COMPLETE_AFTER_CANCELLATION', '');
          }
        } else {
          await keepAgreementCancelled('SETUP_COMPLETE_AFTER_CANCELLATION', '');
        }
      } else if (!token) {
        await upsertRecurringAgreementForUser(payment.userId, {
          status: 'needs_attention',
          autoRenewEnabled: false,
          pendingPaymentId: '',
          processingLockUntil: '',
          failureReason: 'The PayFast token was not returned after the recurring setup payment.',
        });
        await updateSubscriptionRecurringState(payment.userId, {
          recurringAgreementId: payment.recurringAgreementId || payment.userId,
          autoRenewEnabled: false,
          nextChargeAt: '',
        });
      } else {
        await updateRecurringAgreementAfterSuccessfulPayment({
          userId: payment.userId,
          paymentId,
          planType: payment.planType,
          planName: payment.planName,
          amount: payment.amount,
          token,
          sourcePaymentId: paymentId,
          nextChargeAt: buildNextChargeAtFromExpiry(updatedPayment.expiresAt),
          lastChargeStatus: 'SETUP_COMPLETE',
        });
      }
    } else if (updatedPayment && isRecurringRenewal) {
      if (agreementWasCancelled) {
        await keepAgreementCancelled('RENEWAL_COMPLETE_AFTER_CANCELLATION', '');
      } else {
        await updateRecurringAgreementAfterSuccessfulPayment({
          userId: payment.userId,
          paymentId,
          planType: payment.planType,
          planName: payment.planName,
          amount: payment.amount,
          nextChargeAt: buildNextChargeAtFromExpiry(updatedPayment.expiresAt),
          lastChargeStatus: 'RENEWAL_COMPLETE',
        });
      }
    }
  } else if (mappedStatus === 'failed' || mappedStatus === 'cancelled') {
    await markPaymentAttemptFailed({
      paymentId,
      status: mappedStatus,
      providerStatus: payload.payment_status || 'FAILED',
      message: payload.error_message || payload.payment_status || 'Card payment was not completed.',
      rawPayload: payload as Record<string, unknown>,
      source: 'webhook',
    });

    if (isRecurringEnrollment && agreementWasCancelled) {
      await keepAgreementCancelled('SETUP_CANCELLED_LOCALLY', '');
    } else if (isRecurringEnrollment) {
      await upsertRecurringAgreementForUser(payment.userId, {
        status: mappedStatus === 'cancelled' ? 'cancelled' : 'payment_failed',
        autoRenewEnabled: false,
        pendingPaymentId: '',
        processingLockUntil: '',
        failureReason: payload.error_message || payload.payment_status || 'Recurring setup was not completed.',
      });
      await updateSubscriptionRecurringState(payment.userId, {
        recurringAgreementId: payment.recurringAgreementId || payment.userId,
        autoRenewEnabled: false,
        nextChargeAt: '',
      });
    } else if (isRecurringRenewal && agreementWasCancelled) {
      await keepAgreementCancelled('RENEWAL_CANCELLED_LOCALLY', '');
    } else if (isRecurringRenewal) {
      await updateRecurringAgreementAfterFailedPayment({
        userId: payment.userId,
        paymentId,
        nextChargeAt: getRecurringFailureRescheduleAt(),
        status: 'payment_failed',
        failureReason: payload.error_message || payload.payment_status || 'Recurring renewal was not completed.',
      });
    }
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
