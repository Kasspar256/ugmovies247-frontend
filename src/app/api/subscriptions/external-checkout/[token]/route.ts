import { NextResponse } from 'next/server';
import type { AuthSession } from '@/lib/auth/server';
import {
  buildExternalCheckoutReturnUrl,
  getExternalCheckoutSession,
  isExternalCheckoutExpired,
  updateExternalCheckoutSession,
} from '@/lib/server/externalCheckoutSessions';
import {
  startCardCheckoutForUser,
  startMobileMoneyCheckoutForUser,
} from '@/lib/server/subscriptionCheckout';
import {
  applySuccessfulSubscriptionPayment,
  getPaymentAttempt,
  markPaymentAttemptFailed,
  updatePaymentAttempt,
} from '@/lib/server/subscriptions';
import {
  fetchPawaPayDepositStatus,
  getPawaPayConfigError,
  getPawaPayFailureMessage,
  getProviderTransactionId,
  mapPawaPayStatusToPaymentState,
} from '@/lib/server/pawapay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function buildTokenAuthSession(session: NonNullable<Awaited<ReturnType<typeof getExternalCheckoutSession>>>): AuthSession {
  return {
    uid: session.userId,
    email: session.userEmail,
    name: session.userName || 'User',
    role: 'user',
    userRecord: {
      id: session.userId,
      name: session.userName || 'User',
      email: session.userEmail,
      emailVerified: true,
      emailVerifiedAt: '',
      emailVerificationSentAt: '',
      authProvider: 'external_checkout',
      role: 'user',
      createdAt: '',
      updatedAt: '',
      lastLoginAt: '',
      isActive: true,
    },
  };
}

async function refreshExternalPaymentStatus(paymentId: string) {
  const payment = await getPaymentAttempt(paymentId);

  if (!payment) {
    return null;
  }

  if (payment.status === 'completed' || payment.status === 'failed' || payment.status === 'cancelled') {
    return payment;
  }

  if (payment.paymentProvider === 'payfast') {
    await updatePaymentAttempt(paymentId, {
      lastCheckedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return (await getPaymentAttempt(paymentId)) || payment;
  }

  const configError = getPawaPayConfigError();

  if (configError) {
    return payment;
  }

  const providerStatusResponse = await fetchPawaPayDepositStatus(payment.providerDepositId || paymentId);
  const rawStatus = String(providerStatusResponse.data?.status || providerStatusResponse.status || '');
  const mappedStatus = mapPawaPayStatusToPaymentState(rawStatus);
  const providerTransactionId = getProviderTransactionId(
    (providerStatusResponse.data || {}) as Record<string, unknown>
  );

  if (mappedStatus === 'completed') {
    await applySuccessfulSubscriptionPayment({
      paymentId,
      providerTransactionId,
      providerStatus: rawStatus,
      providerMessage: 'Payment completed successfully.',
      rawPayload: providerStatusResponse as unknown as Record<string, unknown>,
      source: 'poll',
    });
  } else if (mappedStatus === 'failed' || mappedStatus === 'cancelled' || mappedStatus === 'not_found') {
    const failureMessage =
      getPawaPayFailureMessage(providerStatusResponse as unknown as Record<string, unknown>) ||
      rawStatus ||
      'Payment was not completed.';
    await markPaymentAttemptFailed({
      paymentId,
      status: mappedStatus,
      providerStatus: rawStatus,
      message: failureMessage,
      rawPayload: providerStatusResponse as unknown as Record<string, unknown>,
      source: 'poll',
    });
  }

  return (await getPaymentAttempt(paymentId)) || payment;
}

async function resolveToken(rawToken: string) {
  const session = await getExternalCheckoutSession(rawToken);

  if (!session) {
    return { error: jsonError('This checkout link is invalid or expired.', 404), session: null };
  }

  if (isExternalCheckoutExpired(session)) {
    await updateExternalCheckoutSession(session.tokenHash, { status: 'expired' }).catch(() => undefined);
    return { error: jsonError('This checkout link has expired.', 410), session: null };
  }

  if (session.status === 'cancelled') {
    return { error: jsonError('This checkout was cancelled.', 410), session: null };
  }

  return { error: null, session };
}

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const { error, session } = await resolveToken(params.token);

  if (error || !session) {
    return error || jsonError('This checkout link is invalid or expired.', 404);
  }

  const payment = session.paymentId ? await refreshExternalPaymentStatus(session.paymentId) : null;

  if (payment?.status === 'completed') {
    await updateExternalCheckoutSession(session.tokenHash, { status: 'completed' }).catch(() => undefined);
  } else if (payment?.status === 'failed' || payment?.status === 'cancelled') {
    await updateExternalCheckoutSession(session.tokenHash, { status: payment.status }).catch(() => undefined);
  }

  return NextResponse.json({
    success: true,
    checkout: {
      status: session.status,
      paymentMethod: session.paymentMethod,
      paymentId: session.paymentId,
      expiresAt: session.expiresAt,
    },
    payment,
  });
}

export async function POST(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const { error, session } = await resolveToken(params.token);

  if (error || !session) {
    return error || jsonError('This checkout link is invalid or expired.', 404);
  }

  if (session.paymentId) {
    const payment = await refreshExternalPaymentStatus(session.paymentId);
    return NextResponse.json({
      success: true,
      checkout: {
        status: session.status,
        paymentMethod: session.paymentMethod,
        paymentId: session.paymentId,
        expiresAt: session.expiresAt,
      },
      payment,
    });
  }

  try {
    if (session.paymentMethod === 'card') {
      const returnUrl = buildExternalCheckoutReturnUrl(params.token);
      const result = await startCardCheckoutForUser({
        session: buildTokenAuthSession(session),
        planType: session.planType,
        returnTo: session.returnTo,
        returnUrlOverride: returnUrl,
        cancelUrlOverride: `${returnUrl}&cancelled=1`,
      });

      await updateExternalCheckoutSession(session.tokenHash, {
        status: 'started',
        paymentId: result.paymentId,
      });

      return NextResponse.json({
        ...result,
        checkout: {
          status: 'started',
          paymentMethod: session.paymentMethod,
          paymentId: result.paymentId,
          expiresAt: session.expiresAt,
        },
      });
    }

    const result = await startMobileMoneyCheckoutForUser({
      userId: session.userId,
      planType: session.planType,
      paymentMethodProvider: session.provider,
      phoneNumber: session.phoneNumber,
    });

    await updateExternalCheckoutSession(session.tokenHash, {
      status: 'started',
      paymentId: result.paymentId,
    });

    return NextResponse.json({
      ...result,
      checkout: {
        status: 'started',
        paymentMethod: session.paymentMethod,
        paymentId: result.paymentId,
        expiresAt: session.expiresAt,
      },
    });
  } catch (startError) {
    await updateExternalCheckoutSession(session.tokenHash, { status: 'failed' }).catch(() => undefined);
    return NextResponse.json(
      {
        error: startError instanceof Error ? startError.message : 'Failed to start checkout.',
      },
      { status: 500 }
    );
  }
}
