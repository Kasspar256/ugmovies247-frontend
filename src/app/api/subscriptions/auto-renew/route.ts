import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { BILLING_OPERATOR } from '@/lib/billingIdentity';
import { checkRateLimit } from '@/lib/server/rateLimit';
import {
  buildPayFastTokenizationCheckout,
  cancelPayFastTokenizedAgreement,
  getPayFastRecurringConfigError,
} from '@/lib/server/payfastRecurring';
import { getPayFastPlanPrice } from '@/lib/server/payfast';
import {
  cancelRecurringAgreementForUser,
  createPaymentAttempt,
  resolveRecurringAgreementForUser,
  summarizeRecurringAgreement,
  updateSubscriptionRecurringState,
  updatePaymentAttempt,
  upsertRecurringAgreementForUser,
} from '@/lib/server/subscriptions';
import { SUBSCRIPTION_PLANS } from '@/lib/subscriptions/plans';
import type { SubscriptionPlanType } from '@/types/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || 'unknown';
}

function getSafeReturnTo(value: string) {
  return value.startsWith('/') && !value.startsWith('//') ? value : '';
}

export async function GET() {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const agreement = await resolveRecurringAgreementForUser(session.uid);

  return NextResponse.json({
    recurringAgreement: summarizeRecurringAgreement(agreement),
  });
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`subscription-auto-renew:${getRequestIp(request)}:${session.uid}`, {
    limit: 8,
    windowMs: 1000 * 60 * 15,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many auto-renew attempts. Please wait and try again.' },
      { status: 429 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      planType?: string;
      returnTo?: string;
    };
    const action = String(body.action || 'enroll');

    if (action === 'cancel') {
      const currentAgreement = await resolveRecurringAgreementForUser(session.uid);

      if (currentAgreement?.token) {
        const remoteCancellation = await cancelPayFastTokenizedAgreement(currentAgreement.token);

        if (!remoteCancellation.ok) {
          return NextResponse.json(
            {
              error:
                remoteCancellation.providerMessage ||
                'PayFast auto-renew cancellation could not be confirmed.',
            },
            { status: 502 }
          );
        }
      }

      const agreement = await cancelRecurringAgreementForUser(session.uid);

      return NextResponse.json({
        success: true,
        recurringAgreement: summarizeRecurringAgreement(agreement),
      });
    }

    const planType = String(body.planType || '') as SubscriptionPlanType;
    const returnTo = getSafeReturnTo(String(body.returnTo || '').trim());
    const plan = SUBSCRIPTION_PLANS[planType];

    if (!plan) {
      return NextResponse.json({ error: 'Choose a valid subscription plan.' }, { status: 400 });
    }

    const configError = getPayFastRecurringConfigError();

    if (configError) {
      return NextResponse.json(
        {
          error: 'Card auto-renew is not configured for this environment yet.',
          detail: configError,
        },
        { status: 500 }
      );
    }

    const amount = getPayFastPlanPrice(plan.type);

    if (!amount) {
      return NextResponse.json(
        {
          error: 'This plan is not priced for PayFast auto-renew yet.',
        },
        { status: 500 }
      );
    }

    const existingAgreement = await resolveRecurringAgreementForUser(session.uid);
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
        return NextResponse.json(
          {
            error:
              remoteCancellation.providerMessage ||
              'Your current card renewal could not be updated right now. Please try again in a moment.',
          },
          { status: 502 }
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
      await updateSubscriptionRecurringState(session.uid, {
        recurringAgreementId: session.uid,
        autoRenewEnabled: false,
        nextChargeAt: '',
      });
    }

    const paymentId = randomUUID();

    await upsertRecurringAgreementForUser(session.uid, {
      planType,
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
      userId: session.uid,
      planType,
      planName: plan.name,
      amount,
      currency: 'ZAR',
      paymentProvider: 'payfast',
      paymentMethodProvider: 'CARD_PAYFAST_RECURRING',
      phoneNumber: '',
      providerDepositId: paymentId,
      clientReferenceId: paymentId,
      recurringAgreementId: session.uid,
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
      session,
      returnTo,
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

    return NextResponse.json({
      success: true,
      paymentId,
      status: 'submitted',
      providerStatus: 'REDIRECT_READY',
      message: 'Redirecting to PayFast secure auto-renew setup.',
      redirect: {
        action: checkout.processUrl,
        method: 'POST',
        fields: checkout.fields,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to start PayFast auto-renew setup.',
      },
      { status: 500 }
    );
  }
}
