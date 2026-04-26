import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { checkRateLimit } from '@/lib/server/rateLimit';
import {
  buildExternalCheckoutUrl,
  createExternalCheckoutSession,
  createExternalCheckoutToken,
} from '@/lib/server/externalCheckoutSessions';
import {
  getSafeCheckoutReturnTo,
  normalizeCheckoutPaymentMethod,
} from '@/lib/server/subscriptionCheckout';
import { getConfiguredPawaPayProviders } from '@/lib/server/pawapay';
import type {
  PaymentMethodProvider,
  SubscriptionPlanType,
} from '@/types/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`external-checkout:${getRequestIp(request)}:${session.uid}`, {
    limit: 10,
    windowMs: 1000 * 60 * 15,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many checkout attempts. Please wait and try again.' },
      { status: 429 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      planType?: string;
      paymentMethod?: string;
      provider?: string;
      phoneNumber?: string;
      returnTo?: string;
    };
    const paymentMethod = normalizeCheckoutPaymentMethod(String(body.paymentMethod || 'mobile_money'));
    const provider = String(body.provider || '') as PaymentMethodProvider;

    if (paymentMethod === 'mobile_money') {
      const allowedProviders = getConfiguredPawaPayProviders().map((entry) => entry.id);

      if (!allowedProviders.includes(provider)) {
        return NextResponse.json({ error: 'Choose a valid Mobile Money provider.' }, { status: 400 });
      }
    }

    const { rawToken, tokenHash } = createExternalCheckoutToken();

    await createExternalCheckoutSession(tokenHash, {
      userId: session.uid,
      userEmail: session.email,
      userName: session.name || 'User',
      planType: String(body.planType || '') as SubscriptionPlanType,
      paymentMethod,
      provider,
      phoneNumber: String(body.phoneNumber || '').trim(),
      returnTo: getSafeCheckoutReturnTo(String(body.returnTo || '').trim()),
    });

    return NextResponse.json({
      success: true,
      checkoutUrl: buildExternalCheckoutUrl(rawToken),
    });
  } catch (error) {
    console.error('[subscriptions] external checkout token creation failed', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create secure checkout.',
      },
      { status: 500 }
    );
  }
}
