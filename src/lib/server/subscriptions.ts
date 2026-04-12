import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { SUBSCRIPTION_PLANS } from '@/lib/subscriptions/plans';
import type {
  PaymentAttemptDocument,
  PaymentAttemptStatus,
  SubscriptionEntitlement,
  SubscriptionPlanDefinition,
  SubscriptionPlanType,
  SubscriptionSnapshot,
  UserSubscriptionDocument,
} from '@/types/subscriptions';

const SUBSCRIPTIONS_COLLECTION = 'user_subscriptions';
const PAYMENTS_COLLECTION = 'subscription_payments';
const WEBHOOK_LOGS_COLLECTION = 'payment_webhook_logs';

function nowIso() {
  return new Date().toISOString();
}

function blankSubscriptionSnapshot(): SubscriptionSnapshot {
  return {
    planType: null,
    planName: '',
    status: 'inactive',
    isActive: false,
    startsAt: '',
    expiresAt: '',
    paymentProvider: '',
    updatedAt: '',
  };
}

function addDuration(startDate: Date, plan: SubscriptionPlanDefinition) {
  const nextDate = new Date(startDate);

  if (plan.durationUnit === 'days') {
    nextDate.setDate(nextDate.getDate() + plan.durationValue);
    return nextDate;
  }

  nextDate.setMonth(nextDate.getMonth() + plan.durationValue);
  return nextDate;
}

export function getPlanDefinition(planType: string) {
  return SUBSCRIPTION_PLANS[planType as SubscriptionPlanType] || null;
}

export function getSubscriptionSnapshotFromData(
  data?: Partial<UserSubscriptionDocument> | null
): SubscriptionSnapshot {
  if (!data) {
    return blankSubscriptionSnapshot();
  }

  const expiresAt = typeof data.expiresAt === 'string' ? data.expiresAt : '';
  const isExpired = Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
  const isActive = Boolean(data.isActive && !isExpired && data.status === 'active');

  return {
    planType: data.planType || null,
    planName: data.planName || '',
    status: isActive ? 'active' : isExpired ? 'expired' : data.status || 'inactive',
    isActive,
    startsAt: data.startsAt || '',
    expiresAt,
    paymentProvider: data.paymentProvider || '',
    updatedAt: data.updatedAt || '',
  };
}

export function getEntitlementFromSubscriptionData(
  data?: Partial<UserSubscriptionDocument> | Partial<SubscriptionSnapshot> | null
): SubscriptionEntitlement {
  const snapshot = getSubscriptionSnapshotFromData(
    data as Partial<UserSubscriptionDocument> | null | undefined
  );

  return {
    hasPremiumAccess: snapshot.isActive,
    requiresSubscription: !snapshot.isActive,
    subscription: snapshot,
  };
}

export async function getCurrentSubscription(userId: string) {
  try {
    const snapshot = await adminDb.collection(SUBSCRIPTIONS_COLLECTION).doc(userId).get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as UserSubscriptionDocument;
  } catch (error) {
    console.warn('[subscriptions] failed to read current subscription, using empty fallback', error);
    return null;
  }
}

export async function syncUserSubscriptionSnapshot(userId: string, subscription?: Partial<UserSubscriptionDocument> | null) {
  const snapshot = getSubscriptionSnapshotFromData(subscription || null);

  await adminDb.collection('users').doc(userId).set(
    {
      subscription: snapshot,
      updatedAt: nowIso(),
    },
    { merge: true }
  );

  return snapshot;
}

export async function getViewerEntitlement(userId: string): Promise<SubscriptionEntitlement> {
  const subscription = await getCurrentSubscription(userId);
  const snapshot = getSubscriptionSnapshotFromData(subscription);

  if (!snapshot.isActive && subscription?.status === 'active') {
    try {
      await adminDb.collection(SUBSCRIPTIONS_COLLECTION).doc(userId).set(
        {
          status: 'expired',
          isActive: false,
          updatedAt: nowIso(),
        },
        { merge: true }
      );
      await syncUserSubscriptionSnapshot(userId, {
        ...subscription,
        status: 'expired',
        isActive: false,
        updatedAt: nowIso(),
      });
    } catch (error) {
      console.warn('[subscriptions] failed to sync expired subscription state', error);
    }

    return {
      hasPremiumAccess: false,
      requiresSubscription: true,
      subscription: getSubscriptionSnapshotFromData({
        ...subscription,
        status: 'expired',
        isActive: false,
      }),
    };
  }

  return {
    hasPremiumAccess: snapshot.isActive,
    requiresSubscription: !snapshot.isActive,
    subscription: snapshot,
  };
}

export async function createPaymentAttempt(input: Omit<PaymentAttemptDocument, 'createdAt' | 'updatedAt' | 'status' | 'startsAt' | 'expiresAt' | 'isActive' | 'activationAppliedAt' | 'failureReason' | 'providerTransactionId' | 'providerStatus' | 'providerMessage' | 'lastCheckedAt' | 'webhookReceivedAt'> & { id: string }) {
  const timestamp = nowIso();
  const paymentDoc: PaymentAttemptDocument = {
    ...input,
    status: 'created',
    providerTransactionId: '',
    providerStatus: '',
    providerMessage: '',
    startsAt: '',
    expiresAt: '',
    isActive: false,
    activationAppliedAt: '',
    failureReason: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastCheckedAt: '',
    webhookReceivedAt: '',
  };

  await adminDb.collection(PAYMENTS_COLLECTION).doc(input.id).set(paymentDoc);
  return paymentDoc;
}

export async function getPaymentAttempt(paymentId: string) {
  const snapshot = await adminDb.collection(PAYMENTS_COLLECTION).doc(paymentId).get();

  if (!snapshot.exists) {
    return null;
  }

  return {
    id: snapshot.id,
    ...(snapshot.data() as PaymentAttemptDocument),
  };
}

export async function updatePaymentAttempt(paymentId: string, state: Partial<PaymentAttemptDocument>) {
  await adminDb.collection(PAYMENTS_COLLECTION).doc(paymentId).set(
    {
      ...state,
      updatedAt: nowIso(),
    },
    { merge: true }
  );
}

export async function logPaymentWebhook(payload: Record<string, unknown>) {
  await adminDb.collection(WEBHOOK_LOGS_COLLECTION).add({
    payload,
    createdAt: nowIso(),
  });
}

export async function listPaymentsForAdmin(limit = 50) {
  const snapshot = await adminDb
    .collection(PAYMENTS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as PaymentAttemptDocument),
  }));
}

export async function listSubscriptionsForAdmin(limit = 50) {
  const snapshot = await adminDb
    .collection(SUBSCRIPTIONS_COLLECTION)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({
    userId: doc.id,
    ...(doc.data() as UserSubscriptionDocument),
  }));
}

export async function applySuccessfulSubscriptionPayment(options: {
  paymentId: string;
  providerTransactionId: string;
  providerStatus: string;
  providerMessage?: string;
  rawPayload?: Record<string, unknown>;
  source: 'webhook' | 'poll';
}) {
  const paymentRef = adminDb.collection(PAYMENTS_COLLECTION).doc(options.paymentId);
  const timestamp = nowIso();

  return adminDb.runTransaction(async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);

    if (!paymentSnapshot.exists) {
      throw new Error(`Payment attempt ${options.paymentId} was not found.`);
    }

    const payment = paymentSnapshot.data() as PaymentAttemptDocument;

    const subscriptionRef = adminDb.collection(SUBSCRIPTIONS_COLLECTION).doc(payment.userId);
    const subscriptionSnapshot = await transaction.get(subscriptionRef);
    const currentSubscription = subscriptionSnapshot.exists
      ? (subscriptionSnapshot.data() as UserSubscriptionDocument)
      : null;

    if (payment.activationAppliedAt) {
      transaction.set(
        paymentRef,
        {
          providerStatus: options.providerStatus,
          providerTransactionId: options.providerTransactionId,
          providerMessage: options.providerMessage || payment.providerMessage || '',
          providerCallbackPayload: options.rawPayload || payment.providerCallbackPayload || {},
          webhookReceivedAt: options.source === 'webhook' ? timestamp : payment.webhookReceivedAt || '',
          lastCheckedAt: options.source === 'poll' ? timestamp : payment.lastCheckedAt || '',
          updatedAt: timestamp,
        },
        { merge: true }
      );

      return {
        alreadyApplied: true,
        subscription: currentSubscription,
      };
    }

    const plan = getPlanDefinition(payment.planType);

    if (!plan) {
      throw new Error(`Unknown subscription plan: ${payment.planType}`);
    }

    const currentExpiry =
      currentSubscription?.isActive && currentSubscription.expiresAt
        ? new Date(currentSubscription.expiresAt)
        : null;
    const startBase =
      currentExpiry && currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
    const newStartsAt =
      currentSubscription?.isActive && currentSubscription.startsAt
        ? currentSubscription.startsAt
        : timestamp;
    const expiresAt = addDuration(startBase, plan).toISOString();

    const subscriptionDoc: UserSubscriptionDocument = {
      userId: payment.userId,
      planType: payment.planType,
      planName: payment.planName,
      amount: payment.amount,
      currency: payment.currency,
      status: 'active',
      paymentProvider: payment.paymentProvider,
      providerTransactionId: options.providerTransactionId,
      latestPaymentId: options.paymentId,
      startsAt: newStartsAt,
      expiresAt,
      isActive: true,
      createdAt: currentSubscription?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    transaction.set(subscriptionRef, subscriptionDoc);
    transaction.set(
      paymentRef,
      {
        status: 'completed' as PaymentAttemptStatus,
        providerStatus: options.providerStatus,
        providerTransactionId: options.providerTransactionId,
        providerMessage: options.providerMessage || '',
        providerCallbackPayload: options.rawPayload || {},
        activationAppliedAt: timestamp,
        startsAt: newStartsAt,
        expiresAt,
        isActive: true,
        webhookReceivedAt: options.source === 'webhook' ? timestamp : payment.webhookReceivedAt || '',
        lastCheckedAt: options.source === 'poll' ? timestamp : payment.lastCheckedAt || '',
        updatedAt: timestamp,
      },
      { merge: true }
    );

    transaction.set(
      adminDb.collection('users').doc(payment.userId),
      {
        subscription: getSubscriptionSnapshotFromData(subscriptionDoc),
        updatedAt: timestamp,
      },
      { merge: true }
    );

    return {
      alreadyApplied: false,
      subscription: subscriptionDoc,
    };
  });
}

export async function markPaymentAttemptFailed(options: {
  paymentId: string;
  status: PaymentAttemptStatus;
  providerStatus: string;
  message: string;
  rawPayload?: Record<string, unknown>;
  source: 'initiation' | 'webhook' | 'poll';
}) {
  const timestamp = nowIso();

  await adminDb.collection(PAYMENTS_COLLECTION).doc(options.paymentId).set(
    {
      status: options.status,
      providerStatus: options.providerStatus,
      providerMessage: options.message,
      failureReason: options.message,
      providerCallbackPayload: options.rawPayload || {},
      webhookReceivedAt: options.source === 'webhook' ? timestamp : '',
      lastCheckedAt: options.source === 'poll' ? timestamp : '',
      updatedAt: timestamp,
    },
    { merge: true }
  );
}

export async function appendPaymentLog(paymentId: string, message: string) {
  await adminDb.collection(PAYMENTS_COLLECTION).doc(paymentId).set(
    {
      updatedAt: nowIso(),
      logs: FieldValue.arrayUnion(`[${nowIso()}] ${message}`),
    },
    { merge: true }
  );
}
