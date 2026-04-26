import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { checkRateLimit } from '@/lib/server/rateLimit';
import {
  cancelCardAutoRenewForUser,
  getSafeCheckoutReturnTo,
  startCardCheckoutForUser,
} from '@/lib/server/subscriptionCheckout';
import {
  resolveRecurringAgreementForUser,
  summarizeRecurringAgreement,
} from '@/lib/server/subscriptions';
import type { SubscriptionPlanType } from '@/types/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || 'unknown';
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
      return NextResponse.json(await cancelCardAutoRenewForUser(session.uid));
    }

    const result = await startCardCheckoutForUser({
      session,
      planType: String(body.planType || '') as SubscriptionPlanType,
      returnTo: getSafeCheckoutReturnTo(String(body.returnTo || '').trim()),
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to start PayFast auto-renew setup.',
      },
      { status: 500 }
    );
  }
}
