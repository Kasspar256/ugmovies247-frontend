import { createHash, randomBytes } from 'crypto';
import { adminDb } from '@/lib/firebaseAdmin';
import { getCheckoutSiteBaseUrl } from '@/lib/server/subscriptionCheckout';
import type {
  CheckoutPaymentMethod,
  PaymentMethodProvider,
  SubscriptionPlanType,
} from '@/types/subscriptions';

const EXTERNAL_CHECKOUT_COLLECTION = 'external_checkout_sessions';
const TOKEN_TTL_MS = 1000 * 60 * 10;

export type ExternalCheckoutSession = {
  userId: string;
  userEmail: string;
  userName: string;
  planType: SubscriptionPlanType;
  paymentMethod: CheckoutPaymentMethod;
  provider: PaymentMethodProvider;
  phoneNumber: string;
  returnTo: string;
  status: 'created' | 'started' | 'completed' | 'failed' | 'cancelled' | 'expired';
  paymentId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export function hashExternalCheckoutToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createExternalCheckoutToken() {
  const rawToken = randomBytes(32).toString('base64url');
  return {
    rawToken,
    tokenHash: hashExternalCheckoutToken(rawToken),
  };
}

export function buildExternalCheckoutUrl(rawToken: string) {
  const url = new URL('/mobile-checkout', getCheckoutSiteBaseUrl());
  url.searchParams.set('token', rawToken);
  return url.toString();
}

export function buildExternalCheckoutReturnUrl(rawToken: string, paymentId?: string) {
  const url = new URL('/mobile-checkout', getCheckoutSiteBaseUrl());
  url.searchParams.set('token', rawToken);

  if (paymentId) {
    url.searchParams.set('paymentId', paymentId);
  }

  return url.toString();
}

export async function createExternalCheckoutSession(
  tokenHash: string,
  input: Omit<ExternalCheckoutSession, 'status' | 'paymentId' | 'createdAt' | 'updatedAt' | 'expiresAt'>
) {
  const now = new Date();
  const timestamp = now.toISOString();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();
  const session: ExternalCheckoutSession = {
    ...input,
    status: 'created',
    paymentId: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt,
  };

  await adminDb.collection(EXTERNAL_CHECKOUT_COLLECTION).doc(tokenHash).set(session);
  return session;
}

export async function getExternalCheckoutSession(rawToken: string) {
  const tokenHash = hashExternalCheckoutToken(rawToken);
  const snapshot = await adminDb.collection(EXTERNAL_CHECKOUT_COLLECTION).doc(tokenHash).get();

  if (!snapshot.exists) {
    return null;
  }

  return {
    id: snapshot.id,
    tokenHash,
    ...(snapshot.data() as ExternalCheckoutSession),
  };
}

export function isExternalCheckoutExpired(session: ExternalCheckoutSession) {
  const expiresAtMs = new Date(session.expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

export async function updateExternalCheckoutSession(
  tokenHash: string,
  patch: Partial<ExternalCheckoutSession>
) {
  await adminDb.collection(EXTERNAL_CHECKOUT_COLLECTION).doc(tokenHash).set(
    {
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}
