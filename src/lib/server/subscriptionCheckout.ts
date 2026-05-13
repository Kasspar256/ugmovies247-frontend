import { randomUUID } from 'crypto';
import type { AuthSession } from '@/lib/auth/server';
import { BILLING_OPERATOR } from '@/lib/billingIdentity';
import {
  buildPayFastTokenizationCheckout,
  cancelPayFastTokenizedAgreement,
  getPayFastRecurringConfigError,
} from '@/lib/server/payfastRecurring';
import { getPayFastPlanPrice } from '@/lib/server/payfast';
import {
  cancelRecurringAgreementForUser,
  applySuccessfulSubscriptionPayment,
  createPaymentAttempt,
  resolveRecurringAgreementForUser,
  summarizeRecurringAgreement,
  updatePaymentAttempt,
  updateSubscriptionRecurringState,
  upsertRecurringAgreementForUser,
} from '@/lib/server/subscriptions';
import {
  getPawaPayFailureMessage,
  getProviderTransactionId,
  initiatePawaPayDeposit,
  mapPawaPayStatusToPaymentState,
} from '@/lib/server/pawapay';
import { SUBSCRIPTION_PLANS } from '@/lib/subscriptions/plans';
import type {
  CheckoutPaymentMethod,
  PaymentMethodProvider,
  SubscriptionPlanType,
} from '@/types/subscriptions';

export type CheckoutRedirect = {
  action: string;
  method: 'POST';
  fields: Record<string, string>;
};

export type CheckoutResult = {
  success: true;
  paymentId: string;
  status: string;
  providerStatus: string;
  message: string;
  paymentProvider: 'pawapay' | 'payfast';
  redirect?: CheckoutRedirect;
  recurringAgreement?: ReturnType<typeof summarizeRecurringAgreement>;
};

export function getSafeCheckoutReturnTo(value: string) {
  return value.startsWith('/') && !value.startsWith('//') ? value : '';
}

export function getCheckoutSiteBaseUrl() {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://ugmovies247.com'
  ).replace(/\/$/, '');
}

export async function startMobileMoneyCheckoutForUser(options: {
  userId: string;
  planType: SubscriptionPlanType;
  paymentMethodProvider: PaymentMethodProvider;
  phoneNumber: string;
}) {
  const plan = SUBSCRIPTION_PLANS[options.planType];

  if (!plan) {
    throw new Error('Choose a valid subscription plan.');
  }

  if (!options.paymentMethodProvider) {
    throw new Error('Choose a valid Mobile Money provider.');
  }

  if (!options.phoneNumber.trim()) {
    throw new Error('Phone number is required.');
  }

  if (plan.currency !== 'UGX') {
    throw new Error('This plan is not configured for Mobile Money checkout.');
  }

  const paymentId = randomUUID();
  const clientReferenceId = `ugmovies-${options.userId}-${Date.now()}`;

  await createPaymentAttempt({
    id: paymentId,
    userId: options.userId,
    planType: plan.type,
    planName: plan.name,
    amount: plan.amount,
    currency: plan.currency,
    paymentProvider: 'pawapay',
    paymentMethodProvider: options.paymentMethodProvider,
    phoneNumber: options.phoneNumber,
    providerDepositId: paymentId,
    clientReferenceId,
    providerResponse: {},
    providerCallbackPayload: {},
  });

  const providerResponse = await initiatePawaPayDeposit({
    depositId: paymentId,
    amount: plan.amount,
    currency: 'UGX',
    phoneNumber: options.phoneNumber,
    provider: options.paymentMethodProvider,
    planType: plan.type,
    userId: options.userId,
    customerMessage: `UGMOVIES247 ${plan.name}`,
    clientReferenceId,
  });

  const mappedStatus = mapPawaPayStatusToPaymentState(String(providerResponse.status || 'ACCEPTED'));
  let status = mappedStatus === 'pending' ? 'initiated' : mappedStatus;
  let message = 'Payment request sent. Complete the Mobile Money prompt on your phone.';

  if (mappedStatus === 'completed') {
    await applySuccessfulSubscriptionPayment({
      paymentId,
      providerTransactionId: getProviderTransactionId(providerResponse as unknown as Record<string, unknown>),
      providerStatus: String(providerResponse.status || 'COMPLETED'),
      providerMessage: 'Payment completed successfully.',
      rawPayload: providerResponse as Record<string, unknown>,
      source: 'poll',
    });
  } else if (mappedStatus === 'failed' || mappedStatus === 'cancelled' || mappedStatus === 'not_found') {
    message =
      getPawaPayFailureMessage(providerResponse as unknown as Record<string, unknown>) ||
      String(providerResponse.status || 'Payment failed.');
    await updatePaymentAttempt(paymentId, {
      status: mappedStatus,
      providerStatus: String(providerResponse.status || 'FAILED'),
      providerMessage: message,
      failureReason: message,
      providerResponse: providerResponse as Record<string, unknown>,
    });
  } else {
    await updatePaymentAttempt(paymentId, {
      status,
      providerStatus: String(providerResponse.status || 'ACCEPTED'),
      providerResponse: providerResponse as Record<string, unknown>,
      providerMessage: message,
    });
  }

  return {
    success: true,
    paymentId,
    status,
    providerStatus: String(providerResponse.status || 'ACCEPTED'),
    message,
    paymentProvider: 'pawapay',
  } satisfies CheckoutResult;
}

export async function startCardCheckoutForUser(options: {
  session: AuthSession;
  planType: SubscriptionPlanType;
  returnTo?: string;
  returnUrlOverride?: string;
  cancelUrlOverride?: string;
}) {
  const plan = SUBSCRIPTION_PLANS[options.planType];

  if (!plan) {
    throw new Error('Choose a valid subscription plan.');
  }

  const configError = getPayFastRecurringConfigError();

  if (configError) {
    throw new Error(`Card auto-renew is not configured for this environment yet. ${configError}`);
  }

  const amount = getPayFastPlanPrice(plan.type);

  if (!amount) {
    throw new Error('This plan is not priced for PayFast auto-renew yet.');
  }

  const existingAgreement = await resolveRecurringAgreementForUser(options.session.uid);
  const hasReplaceableAgreement = Boolean(
    existingAgreement &&
      existingAgreement.status !== 'cancelled' &&
      (existingAgreement.autoRenewEnabled === true ||
        existingAgreement.status === 'active' ||
        existingAgreement.status === 'payment_failed' ||
        Boolean(existingAgreement.token) ||
        Boolean(existingAgreement.nextChargeAt))
  );

  if (hasReplaceableAgreement && existingAgreement?.token) {
    const remoteCancellation = await cancelPayFastTokenizedAgreement(existingAgreement.token);

    if (!remoteCancellation.ok) {
      throw new Error(
        remoteCancellation.providerMessage ||
          'Your current card renewal could not be updated right now. Please try again in a moment.'
      );
    }
  }

  if (hasReplaceableAgreement && existingAgreement?.pendingPaymentId) {
    await updatePaymentAttempt(existingAgreement.pendingPaymentId, {
      status: 'cancelled',
      providerStatus: 'REPLACED',
      providerMessage: 'Replaced by a newer card plan update.',
      failureReason: 'Replaced by a newer card plan update.',
    });
  }

  if (hasReplaceableAgreement) {
    await updateSubscriptionRecurringState(options.session.uid, {
      recurringAgreementId: options.session.uid,
      autoRenewEnabled: false,
      nextChargeAt: '',
    });
  }

  const paymentId = randomUUID();

  await upsertRecurringAgreementForUser(options.session.uid, {
    planType: plan.type,
    planName: plan.name,
    amount,
    status: 'pending_setup',
    autoRenewEnabled: true,
    token: '',
    tokenCapturedAt: '',
    tokenSourcePaymentId: '',
    nextChargeAt: '',
    pendingPaymentId: paymentId,
    processingLockUntil: '',
    cancelledAt: '',
    failureReason: '',
    lastPaymentId: '',
    lastChargeStatus: 'SETUP_PENDING',
  });

  await createPaymentAttempt({
    id: paymentId,
    userId: options.session.uid,
    planType: plan.type,
    planName: plan.name,
    amount,
    currency: 'ZAR',
    paymentProvider: 'payfast',
    paymentMethodProvider: 'CARD_PAYFAST_RECURRING',
    phoneNumber: '',
    providerDepositId: paymentId,
    clientReferenceId: paymentId,
    recurringAgreementId: options.session.uid,
    paymentKind: 'recurring_enrollment',
    isAutoRenewal: false,
    triggerSource: 'user',
    providerResponse: {
      processor: 'PayFast',
      billedBy: BILLING_OPERATOR,
      recurringMode: 'tokenization',
    },
    providerCallbackPayload: {},
  });

  const checkout = buildPayFastTokenizationCheckout({
    paymentId,
    plan,
    amount,
    session: options.session,
    returnTo: options.returnTo,
    returnUrlOverride: options.returnUrlOverride,
    cancelUrlOverride: options.cancelUrlOverride,
  });

  await updatePaymentAttempt(paymentId, {
    status: 'submitted',
    providerStatus: 'REDIRECT_READY',
    providerMessage: 'Redirecting to PayFast secure auto-renew setup.',
    providerResponse: {
      processor: 'PayFast',
      processUrl: checkout.processUrl,
      billedBy: BILLING_OPERATOR,
      recurringMode: 'tokenization',
    },
  });

  return {
    success: true,
    paymentId,
    status: 'submitted',
    providerStatus: 'REDIRECT_READY',
    message: 'Redirecting to PayFast secure auto-renew setup.',
    paymentProvider: 'payfast',
    redirect: {
      action: checkout.processUrl,
      method: 'POST',
      fields: checkout.fields,
    },
  } satisfies CheckoutResult;
}

export async function cancelCardAutoRenewForUser(userId: string) {
  const currentAgreement = await resolveRecurringAgreementForUser(userId);

  if (currentAgreement?.token) {
    const remoteCancellation = await cancelPayFastTokenizedAgreement(currentAgreement.token);

    if (!remoteCancellation.ok) {
      throw new Error(
        remoteCancellation.providerMessage ||
          'PayFast auto-renew cancellation could not be confirmed.'
      );
    }
  }

  const agreement = await cancelRecurringAgreementForUser(userId);

  return {
    success: true,
    recurringAgreement: summarizeRecurringAgreement(agreement),
  };
}

export function normalizeCheckoutPaymentMethod(value: string): CheckoutPaymentMethod {
  return value === 'card' ? 'card' : 'mobile_money';
}
