import { randomUUID } from 'crypto';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function processRecurringCharges() {
  const [
    {
      SUBSCRIPTION_RECONCILE_AFTER_MS,
      SUBSCRIPTION_RECONCILE_GIVE_UP_MS,
      SUBSCRIPTION_RENEWAL_LEASE_MS,
      SUBSCRIPTION_WORKER_BATCH_SIZE,
    },
    {
      applySuccessfulSubscriptionPayment,
      claimRecurringAgreementProcessing,
      createPaymentAttempt,
      getPaymentAttempt,
      getRecurringAgreementForUser,
      listDueRecurringAgreements,
      listPendingRecurringRenewalPayments,
      markPaymentAttemptFailed,
      markRecurringAgreementChargeScheduled,
      updatePaymentAttempt,
      updateRecurringAgreementAfterFailedPayment,
      updateRecurringAgreementAfterSuccessfulPayment,
      updateSubscriptionRecurringState,
      upsertRecurringAgreementForUser,
    },
    {
      processScheduledTransactionalEmails,
    },
    {
      buildNextChargeAtFromExpiry,
      buildRecurringChargeItemName,
      chargePayFastTokenizedAgreement,
      findPayFastTransactionByPaymentId,
      getRecurringFailureRescheduleAt,
      isInvalidPayFastRecurringState,
      mapRecurringChargeResultToPaymentState,
    },
  ] = await Promise.all([
    import('@/lib/server/env'),
    import('@/lib/server/subscriptions'),
    import('@/lib/server/transactionalEmails'),
    import('@/lib/server/payfastRecurring'),
  ]);

  const keepAgreementCancelled = async (
    userId: string,
    paymentId: string,
    lastChargeStatus: string,
    cancelledAt = '',
    failureReason = ''
  ) => {
    await upsertRecurringAgreementForUser(userId, {
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
      cancelledAt: cancelledAt || new Date().toISOString(),
      failureReason,
    }).catch(() => undefined);

    await updateSubscriptionRecurringState(userId, {
      recurringAgreementId: userId,
      autoRenewEnabled: false,
      nextChargeAt: '',
    }).catch(() => undefined);
  };

  const markAgreementNeedsAttention = async (
    userId: string,
    paymentId: string,
    message: string,
    cancelledAt = ''
  ) => {
    await updatePaymentAttempt(paymentId, {
      status: 'needs_attention',
      providerStatus: 'RECONCILIATION_REQUIRED',
      providerMessage: message,
      failureReason: message,
      lastCheckedAt: new Date().toISOString(),
    }).catch(() => undefined);

    if (cancelledAt) {
      await keepAgreementCancelled(
        userId,
        paymentId,
        'RENEWAL_RECONCILE_CANCELLED',
        cancelledAt,
        message
      );
      return;
    }

    await upsertRecurringAgreementForUser(userId, {
      status: 'needs_attention',
      autoRenewEnabled: false,
      nextChargeAt: '',
      pendingPaymentId: '',
      processingLockUntil: '',
      lastChargeStatus: 'NEEDS_ATTENTION',
      lastPaymentId: paymentId,
      failureReason: message,
    }).catch(() => undefined);

    await updateSubscriptionRecurringState(userId, {
      recurringAgreementId: userId,
      autoRenewEnabled: false,
      nextChargeAt: '',
    }).catch(() => undefined);
  };

  const reconcilePendingRecurringCharges = async () => {
    const olderThanIso = new Date(Date.now() - SUBSCRIPTION_RECONCILE_AFTER_MS).toISOString();
    const pendingPayments = await listPendingRecurringRenewalPayments(
      SUBSCRIPTION_WORKER_BATCH_SIZE,
      olderThanIso
    );

    for (const payment of pendingPayments) {
      const agreement = await getRecurringAgreementForUser(payment.userId).catch(() => null);

      if (!agreement || agreement.pendingPaymentId !== payment.id) {
        continue;
      }

      const cancelledLocally = Boolean(
        agreement.status === 'cancelled' || Boolean(agreement.cancelledAt)
      );
      const lookup = await findPayFastTransactionByPaymentId(payment.id || '', payment.createdAt || '');

      if (lookup.found) {
        const mappedStatus = mapRecurringChargeResultToPaymentState(lookup.providerStatus);

        if (mappedStatus === 'completed') {
          await applySuccessfulSubscriptionPayment({
            paymentId: payment.id || '',
            providerTransactionId: lookup.providerTransactionId,
            providerStatus: lookup.providerStatus,
            providerMessage: lookup.providerMessage,
            rawPayload: lookup.rawPayload,
            source: 'poll',
          });

          const updatedPayment = await getPaymentAttempt(payment.id || '');

          if (updatedPayment) {
            if (cancelledLocally) {
              await keepAgreementCancelled(
                payment.userId,
                payment.id || '',
                'RENEWAL_COMPLETE_AFTER_CANCELLATION',
                agreement.cancelledAt || '',
                ''
              );
            } else {
              await updateRecurringAgreementAfterSuccessfulPayment({
                userId: payment.userId,
                paymentId: payment.id || '',
                planType: payment.planType,
                planName: payment.planName,
                amount: payment.amount,
                nextChargeAt: buildNextChargeAtFromExpiry(updatedPayment.expiresAt),
                lastChargeStatus: 'RENEWAL_RECONCILED',
              });
            }
          }

          continue;
        }

        if (mappedStatus === 'failed' || mappedStatus === 'cancelled') {
          await markPaymentAttemptFailed({
            paymentId: payment.id || '',
            status: mappedStatus,
            providerStatus: lookup.providerStatus,
            message: lookup.providerMessage,
            rawPayload: lookup.rawPayload,
            source: 'poll',
          });

          if (cancelledLocally) {
            await keepAgreementCancelled(
              payment.userId,
              payment.id || '',
              'RENEWAL_CANCELLED_LOCALLY',
              agreement.cancelledAt || '',
              ''
            );
          } else {
            await updateRecurringAgreementAfterFailedPayment({
              userId: payment.userId,
              paymentId: payment.id || '',
              nextChargeAt: getRecurringFailureRescheduleAt(),
              status: 'payment_failed',
              failureReason: lookup.providerMessage,
            });
          }

          continue;
        }

        await updatePaymentAttempt(payment.id || '', {
          status: mappedStatus === 'pending' ? 'pending' : 'submitted',
          providerStatus: lookup.providerStatus,
          providerMessage:
            lookup.providerMessage || 'PayFast renewal is still awaiting final confirmation.',
          providerResponse: lookup.rawPayload,
          lastCheckedAt: new Date().toISOString(),
        }).catch(() => undefined);

        continue;
      }

      const paymentAgeMs = Math.max(
        0,
        Date.now() - new Date(payment.createdAt || 0).getTime()
      );

      if (
        paymentAgeMs >= SUBSCRIPTION_RECONCILE_GIVE_UP_MS ||
        lookup.providerStatus === 'HISTORY_LOOKUP_FAILED'
      ) {
        await markAgreementNeedsAttention(
          payment.userId,
          payment.id || '',
          lookup.providerMessage ||
            'PayFast renewal confirmation could not be reconciled automatically. Review this payment before retrying.',
          agreement.cancelledAt || ''
        );
      }
    }
  };

  await reconcilePendingRecurringCharges();

  const dueAgreements = await listDueRecurringAgreements(SUBSCRIPTION_WORKER_BATCH_SIZE);

  for (const dueAgreement of dueAgreements) {
    const claimed = await claimRecurringAgreementProcessing(
      dueAgreement.userId,
      SUBSCRIPTION_RENEWAL_LEASE_MS
    );

    if (!claimed) {
      continue;
    }

    if (!claimed.token) {
      await upsertRecurringAgreementForUser(claimed.userId, {
        status: 'needs_attention',
        autoRenewEnabled: false,
        pendingPaymentId: '',
        processingLockUntil: '',
        failureReason: 'Recurring renewal is due but no PayFast token is stored for this agreement.',
      }).catch(() => undefined);
      await updateSubscriptionRecurringState(claimed.userId, {
        recurringAgreementId: claimed.id || claimed.userId,
        autoRenewEnabled: false,
        nextChargeAt: '',
      }).catch(() => undefined);
      continue;
    }

    const paymentId = randomUUID();

    try {
      await createPaymentAttempt({
        id: paymentId,
        userId: claimed.userId,
        planType: claimed.planType,
        planName: claimed.planName,
        amount: claimed.amount,
        currency: 'ZAR',
        paymentProvider: 'payfast',
        paymentMethodProvider: 'CARD_PAYFAST_RECURRING',
        phoneNumber: '',
        providerDepositId: paymentId,
        clientReferenceId: paymentId,
        recurringAgreementId: claimed.id || claimed.userId,
        recurringTokenLast4: claimed.token.slice(-4),
        paymentKind: 'recurring_renewal',
        isAutoRenewal: true,
        triggerSource: 'scheduler',
        providerResponse: {
          processor: 'PayFast',
          recurringMode: 'tokenization',
          billedBy: 'SK ALL IN ONE TRADERS',
        },
        providerCallbackPayload: {},
      });

      await markRecurringAgreementChargeScheduled({
        userId: claimed.userId,
        paymentId,
        planType: claimed.planType,
        planName: claimed.planName,
        amount: claimed.amount,
      });

      let chargeResult;

      try {
        chargeResult = await chargePayFastTokenizedAgreement({
          paymentId,
          itemName: buildRecurringChargeItemName(claimed),
          amount: claimed.amount,
          token: claimed.token,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'PayFast renewal submission outcome is unknown. Reconciliation is required.';

        await updatePaymentAttempt(paymentId, {
          status: 'submitted',
          providerStatus: 'SUBMISSION_UNKNOWN',
          providerMessage: message,
          lastCheckedAt: new Date().toISOString(),
        }).catch(() => undefined);

        await upsertRecurringAgreementForUser(claimed.userId, {
          status: claimed.status === 'payment_failed' ? 'payment_failed' : 'active',
          autoRenewEnabled: true,
          pendingPaymentId: paymentId,
          processingLockUntil: '',
          failureReason: 'Awaiting reconciliation after an uncertain renewal submission.',
        }).catch(() => undefined);

        continue;
      }

      const mappedStatus = mapRecurringChargeResultToPaymentState(chargeResult.providerStatus);

      if (chargeResult.ok && mappedStatus === 'completed') {
        await applySuccessfulSubscriptionPayment({
          paymentId,
          providerTransactionId: chargeResult.providerTransactionId,
          providerStatus: chargeResult.providerStatus,
          providerMessage: chargeResult.providerMessage,
          rawPayload: chargeResult.rawPayload,
          source: 'poll',
        });

        const updatedPayment = await getPaymentAttempt(paymentId);

        if (updatedPayment) {
          await updateRecurringAgreementAfterSuccessfulPayment({
            userId: claimed.userId,
            paymentId,
            planType: claimed.planType,
            planName: claimed.planName,
            amount: claimed.amount,
            nextChargeAt: buildNextChargeAtFromExpiry(updatedPayment.expiresAt),
            lastChargeStatus: 'RENEWAL_COMPLETE',
          });
        }

        continue;
      }

      if (chargeResult.ok && (mappedStatus === 'submitted' || mappedStatus === 'pending')) {
        await updatePaymentAttempt(paymentId, {
          status: mappedStatus,
          providerStatus: chargeResult.providerStatus,
          providerMessage: chargeResult.providerMessage,
          providerTransactionId: chargeResult.providerTransactionId,
          providerResponse: chargeResult.rawPayload,
          lastCheckedAt: new Date().toISOString(),
        });

        continue;
      }

      await markPaymentAttemptFailed({
        paymentId,
        status: mappedStatus === 'cancelled' ? 'cancelled' : 'failed',
        providerStatus: chargeResult.providerStatus,
        message: chargeResult.providerMessage,
        rawPayload: chargeResult.rawPayload,
        source: 'poll',
      });

      if (isInvalidPayFastRecurringState(chargeResult)) {
        const invalidAgreementMessage =
          'PayFast says this recurring card agreement is not active anymore. Please set up card auto-renew again.';

        await upsertRecurringAgreementForUser(claimed.userId, {
          status: 'needs_attention',
          autoRenewEnabled: false,
          token: '',
          tokenCapturedAt: '',
          tokenSourcePaymentId: '',
          nextChargeAt: '',
          pendingPaymentId: '',
          processingLockUntil: '',
          lastChargeStatus: 'PAYFAST_INVALID_STATE',
          lastPaymentId: paymentId,
          failureReason: invalidAgreementMessage,
        });

        await updateSubscriptionRecurringState(claimed.userId, {
          recurringAgreementId: claimed.id || claimed.userId,
          autoRenewEnabled: false,
          nextChargeAt: '',
        }).catch(() => undefined);

        continue;
      }

      await updateRecurringAgreementAfterFailedPayment({
        userId: claimed.userId,
        paymentId,
        nextChargeAt: getRecurringFailureRescheduleAt(),
        status: 'payment_failed',
        failureReason: chargeResult.providerMessage,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to prepare recurring renewal submission.';

      await updatePaymentAttempt(paymentId, {
        status: 'failed',
        providerStatus: 'WORKER_ERROR',
        providerMessage: message,
        failureReason: message,
      }).catch(() => undefined);

      await updateRecurringAgreementAfterFailedPayment({
        userId: claimed.userId,
        paymentId,
        nextChargeAt: getRecurringFailureRescheduleAt(),
        status: 'payment_failed',
        failureReason: message,
      }).catch(() => undefined);
    }
  }

  await processScheduledTransactionalEmails(SUBSCRIPTION_WORKER_BATCH_SIZE).catch((error) => {
    console.warn('[subscription-worker] scheduled email processing failed', error);
  });
}

async function loop() {
  const { SUBSCRIPTION_WORKER_POLL_MS } = await import('@/lib/server/env');

  while (true) {
    try {
      await processRecurringCharges();
    } catch (error) {
      console.error('[subscription-worker] loop error', error);
    }

    await new Promise((resolve) => setTimeout(resolve, SUBSCRIPTION_WORKER_POLL_MS));
  }
}

loop().catch((error) => {
  console.error('[subscription-worker] fatal error', error);
  process.exit(1);
});
