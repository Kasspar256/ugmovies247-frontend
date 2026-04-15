import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { BILLING_OPERATOR } from '@/lib/billingIdentity';
import { checkRateLimit } from '@/lib/server/rateLimit';
import {
  buildPayFastCheckout,
  getPayFastConfigError,
  getPayFastPlanPrice,
} from '@/lib/server/payfast';
import {
  getConfiguredPawaPayProviders,
  getPawaPayConfigError,
  getPawaPayFailureMessage,
  initiatePawaPayDeposit,
  mapPawaPayStatusToPaymentState,
} from '@/lib/server/pawapay';
import { SUBSCRIPTION_PLANS } from '@/lib/subscriptions/plans';
import type {
  CheckoutPaymentMethod,
  PaymentMethodProvider,
  SubscriptionPlanType,
} from '@/types/subscriptions';
import {
  applySuccessfulSubscriptionPayment,
  createPaymentAttempt,
  markPaymentAttemptFailed,
  updatePaymentAttempt,
} from '@/lib/server/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || 'unknown';
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`subscription-checkout:${getRequestIp(request)}:${session.uid}`, {
    limit: 8,
    windowMs: 1000 * 60 * 15,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many payment attempts. Please wait and try again.' },
      { status: 429 }
    );
  }

  let paymentId = '';

  try {
    const body = await request.json();
    const planType = String(body.planType || '') as SubscriptionPlanType;
    const paymentMethod = String(body.paymentMethod || 'mobile_money') as CheckoutPaymentMethod;
    const provider = String(body.provider || '') as PaymentMethodProvider;
    const phoneNumber = String(body.phoneNumber || '').trim();
    const returnTo = String(body.returnTo || '').trim();
    const plan = SUBSCRIPTION_PLANS[planType];

    if (!plan) {
      return NextResponse.json({ error: 'Choose a valid subscription plan.' }, { status: 400 });
    }

    if (paymentMethod === 'card') {
      const configError = getPayFastConfigError();

      if (configError) {
        return NextResponse.json(
          {
            error: 'Card payments are not configured for this environment yet.',
            detail: configError,
          },
          { status: 500 }
        );
      }

      const amount = getPayFastPlanPrice(plan.type);

      if (!amount) {
        return NextResponse.json(
          {
            error: 'This plan is not priced for PayFast card checkout yet.',
          },
          { status: 500 }
        );
      }

      paymentId = randomUUID();

      await createPaymentAttempt({
        id: paymentId,
        userId: session.uid,
        planType,
        planName: plan.name,
        amount,
        currency: 'ZAR',
        paymentProvider: 'payfast',
        paymentMethodProvider: 'CARD_PAYFAST',
        phoneNumber: '',
        providerDepositId: paymentId,
        clientReferenceId: paymentId,
        providerResponse: {
          processor: 'PayFast',
          billedBy: BILLING_OPERATOR,
        },
        providerCallbackPayload: {},
      });

      const checkout = buildPayFastCheckout({
        paymentId,
        plan,
        amount,
        returnTo,
      });

      if (process.env.NODE_ENV !== 'production') {
        console.info('[subscriptions] payfast redirect payload', {
          action: checkout.processUrl,
          merchantId: checkout.fields.merchant_id,
          amount: checkout.fields.amount,
          itemName: checkout.fields.item_name,
          returnUrl: checkout.fields.return_url,
          cancelUrl: checkout.fields.cancel_url,
          notifyUrl: checkout.fields.notify_url,
          fieldOrder: Object.keys(checkout.fields),
          billedBy: BILLING_OPERATOR,
          signature: checkout.fields.signature,
        });
      }

      await updatePaymentAttempt(paymentId, {
        status: 'submitted',
        providerStatus: 'REDIRECT_READY',
        providerMessage: 'Redirecting to PayFast secure card checkout.',
        providerResponse: {
          processor: 'PayFast',
          processUrl: checkout.processUrl,
          billedBy: BILLING_OPERATOR,
        },
      });

      return NextResponse.json({
        success: true,
        paymentId,
        status: 'submitted',
        providerStatus: 'REDIRECT_READY',
        message: 'Redirecting to PayFast secure card checkout.',
        redirect: {
          action: checkout.processUrl,
          method: 'POST',
          fields: checkout.fields,
        },
      });
    }

    const configError = getPawaPayConfigError();

    if (configError) {
      return NextResponse.json(
        {
          error: 'Subscription payments are not configured for this environment yet.',
          detail: configError,
        },
        { status: 500 }
      );
    }

    const allowedProviders = getConfiguredPawaPayProviders().map((entry) => entry.id);

    if (!allowedProviders.includes(provider)) {
      return NextResponse.json({ error: 'Choose a valid Mobile Money provider.' }, { status: 400 });
    }

    if (!phoneNumber) {
      return NextResponse.json({ error: 'Phone number is required.' }, { status: 400 });
    }

    paymentId = randomUUID();
    const clientReferenceId = `ugmovies-${session.uid}-${Date.now()}`;

    await createPaymentAttempt({
      id: paymentId,
      userId: session.uid,
      planType,
      planName: plan.name,
      amount: plan.amount,
      currency: plan.currency,
      paymentProvider: 'pawapay',
      paymentMethodProvider: provider,
      phoneNumber,
      providerDepositId: paymentId,
      clientReferenceId,
      providerResponse: {},
      providerCallbackPayload: {},
    });

    const providerResponse = await initiatePawaPayDeposit({
      depositId: paymentId,
      amount: plan.amount,
      currency: plan.currency,
      phoneNumber,
      provider,
      planType,
      userId: session.uid,
      customerMessage: `UGMovies247 ${plan.name}`,
      clientReferenceId,
    });

    const mappedStatus = mapPawaPayStatusToPaymentState(String(providerResponse.status || 'ACCEPTED'));

    if (mappedStatus === 'completed') {
      await applySuccessfulSubscriptionPayment({
        paymentId,
        providerTransactionId: '',
        providerStatus: String(providerResponse.status || 'COMPLETED'),
        providerMessage: 'Payment completed successfully.',
        rawPayload: providerResponse as Record<string, unknown>,
        source: 'poll',
      });
    } else if (mappedStatus === 'failed' || mappedStatus === 'cancelled' || mappedStatus === 'not_found') {
      const failureMessage =
        getPawaPayFailureMessage(providerResponse as unknown as Record<string, unknown>) ||
        String(providerResponse.status || 'Payment failed.');
      await markPaymentAttemptFailed({
        paymentId,
        status: mappedStatus,
        providerStatus: String(providerResponse.status || 'FAILED'),
        message: failureMessage,
        rawPayload: providerResponse as Record<string, unknown>,
        source: 'initiation',
      });
    } else {
      await updatePaymentAttempt(paymentId, {
        status: 'initiated',
        providerStatus: String(providerResponse.status || 'ACCEPTED'),
        providerResponse: providerResponse as Record<string, unknown>,
        providerMessage: 'Payment request sent. Complete the Mobile Money prompt on your phone.',
      });
    }

    return NextResponse.json({
      success: true,
      paymentId,
      status: mappedStatus === 'pending' ? 'initiated' : mappedStatus,
      providerStatus: providerResponse.status || 'ACCEPTED',
      message: 'Payment request sent. Complete the Mobile Money prompt on your phone.',
    });
  } catch (error) {
    console.error('[subscriptions] checkout failed', error);

    if (paymentId) {
      await updatePaymentAttempt(paymentId, {
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'Failed to initiate subscription payment.',
        providerMessage: error instanceof Error ? error.message : 'Failed to initiate subscription payment.',
      }).catch(() => undefined);
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to initiate subscription payment.',
      },
      { status: 500 }
    );
  }
}
