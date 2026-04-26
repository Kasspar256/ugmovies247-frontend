import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { checkRateLimit } from '@/lib/server/rateLimit';
import {
  getConfiguredPawaPayProviders,
  getPawaPayConfigError,
} from '@/lib/server/pawapay';
import {
  getSafeCheckoutReturnTo,
  normalizeCheckoutPaymentMethod,
  startCardCheckoutForUser,
  startMobileMoneyCheckoutForUser,
} from '@/lib/server/subscriptionCheckout';
import type {
  PaymentMethodProvider,
  SubscriptionPlanType,
} from '@/types/subscriptions';

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

  try {
    const body = await request.json();
    const planType = String(body.planType || '') as SubscriptionPlanType;
    const paymentMethod = normalizeCheckoutPaymentMethod(String(body.paymentMethod || 'mobile_money'));
    const returnTo = getSafeCheckoutReturnTo(String(body.returnTo || '').trim());

    if (paymentMethod === 'card') {
      const result = await startCardCheckoutForUser({
        session,
        planType,
        returnTo,
      });

      return NextResponse.json(result);
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

    const provider = String(body.provider || '') as PaymentMethodProvider;
    const allowedProviders = getConfiguredPawaPayProviders().map((entry) => entry.id);

    if (!allowedProviders.includes(provider)) {
      return NextResponse.json({ error: 'Choose a valid Mobile Money provider.' }, { status: 400 });
    }

    const result = await startMobileMoneyCheckoutForUser({
      userId: session.uid,
      planType,
      paymentMethodProvider: provider,
      phoneNumber: String(body.phoneNumber || '').trim(),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[subscriptions] checkout failed', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to initiate subscription payment.',
      },
      { status: 500 }
    );
  }
}
