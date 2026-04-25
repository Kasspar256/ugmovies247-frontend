import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { isAdminEmail } from '@/lib/auth/server';
import { SUBSCRIPTION_PLANS } from '@/lib/subscriptions/plans';
import {
  getSubscriptionOverrideSnapshotFromData,
  resolveSubscriptionOverrideForUser,
} from '@/lib/server/subscriptionOverrides';
import type {
  EffectiveSubscriptionState,
  ManualSubscriptionAccessType,
  PaymentAttemptDocument,
  PaymentAttemptStatus,
  PaymentKind,
  PaymentTriggerSource,
  RecurringAgreementDocument,
  RecurringAgreementSummary,
  RecurringAgreementStatus,
  SubscriptionAccessSource,
  SubscriptionEntitlement,
  SubscriptionPlanDefinition,
  SubscriptionPlanType,
  SubscriptionSnapshot,
  SubscriptionOverrideDocument,
  UserSubscriptionDocument,
} from '@/types/subscriptions';

const SUBSCRIPTIONS_COLLECTION = 'user_subscriptions';
const PAYMENTS_COLLECTION = 'subscription_payments';
const WEBHOOK_LOGS_COLLECTION = 'payment_webhook_logs';
const RECURRING_AGREEMENTS_COLLECTION = 'subscription_recurring_agreements';
const DEVICE_LIMIT_BY_PLAN: Record<SubscriptionPlanType, number> = {
  daily: 1,
  seven_days: 1,
  fourteen_days: 1,
  monthly: 2,
  two_months: 2,
  three_months: 2,
  six_months: 3,
  twelve_months: 4,
};

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
    source: '',
    accessType: '',
    autoRenewEnabled: false,
    updatedAt: '',
  };
}

function adminAccessSnapshot(): SubscriptionSnapshot {
  return {
    planType: null,
    planName: 'Admin Access',
    status: 'active',
    isActive: true,
    startsAt: '',
    expiresAt: '',
    paymentProvider: '',
    source: 'admin_role',
    accessType: 'admin_override',
    autoRenewEnabled: false,
    updatedAt: nowIso(),
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

function blankRecurringAgreementSummary(): RecurringAgreementSummary {
  return {
    status: 'inactive',
    planType: null,
    planName: '',
    amount: 0,
    currency: 'ZAR',
    autoRenewEnabled: false,
    nextChargeAt: '',
    lastChargeAt: '',
    lastChargeStatus: '',
    lastPaymentId: '',
    tokenAvailable: false,
    pendingPaymentId: '',
    failureReason: '',
  };
}

const STALE_RECURRING_SETUP_MS = 1000 * 60 * 60 * 2;

function getRecurringAgreementDocId(userId: string) {
  return userId;
}

function isIsoDateInFuture(value?: string) {
  if (!value) {
    return false;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function last4FromToken(token?: string) {
  if (!token) {
    return '';
  }

  const trimmed = String(token).trim();
  return trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;
}

function isRetryableRecurringStatus(status: RecurringAgreementStatus | string | undefined) {
  return status === 'active' || status === 'payment_failed';
}

function isRecurringSetupTerminalStatus(status?: PaymentAttemptStatus) {
  return status === 'failed' || status === 'cancelled' || status === 'not_found';
}

export function getPlanDefinition(planType: string) {
  return SUBSCRIPTION_PLANS[planType as SubscriptionPlanType] || null;
}

export function getSubscriptionSnapshotFromData(
  data?: Partial<UserSubscriptionDocument> | Partial<SubscriptionSnapshot> | null
): SubscriptionSnapshot {
  if (!data) {
    return blankSubscriptionSnapshot();
  }

  const expiresAt = typeof data.expiresAt === 'string' ? data.expiresAt : '';
  const startsAt = typeof data.startsAt === 'string' ? data.startsAt : '';
  const startsAtMs = startsAt ? new Date(startsAt).getTime() : Number.NaN;
  const isExpired = Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
  const isScheduled = Number.isFinite(startsAtMs) && startsAtMs > Date.now();
  const isActive = Boolean(data.isActive && !isExpired && !isScheduled && data.status === 'active');
  const snapshotSource =
    'source' in data && typeof data.source === 'string' ? data.source : '';
  const snapshotAccessType =
    'accessType' in data && typeof data.accessType === 'string' ? data.accessType : '';
  const source =
    snapshotSource ||
    (data.planName || data.paymentProvider || data.planType ? ('payment' as SubscriptionAccessSource) : '');
  const accessType =
    snapshotAccessType ||
    (source === 'admin_override'
      ? ('admin_override' as ManualSubscriptionAccessType)
      : source === 'promo'
        ? ('promo' as ManualSubscriptionAccessType)
        : '');

  return {
    planType: data.planType || null,
    planName: data.planName || '',
    status: isActive
      ? 'active'
      : isExpired
        ? 'expired'
        : isScheduled
          ? 'scheduled'
          : data.status || 'inactive',
    isActive,
    startsAt,
    expiresAt,
    paymentProvider: data.paymentProvider || '',
    source,
    accessType,
    autoRenewEnabled: data.autoRenewEnabled === true,
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

export function getDeviceLimitForPlanType(planType?: SubscriptionPlanType | null) {
  if (!planType) {
    return 1;
  }

  return DEVICE_LIMIT_BY_PLAN[planType] || 1;
}

export function getDeviceLimitForSubscriptionSnapshot(
  snapshot?: Partial<SubscriptionSnapshot> | null,
  role?: string
) {
  if (role === 'admin') {
    return Number.POSITIVE_INFINITY;
  }

  if (!snapshot?.isActive) {
    return 1;
  }

  return getDeviceLimitForPlanType(snapshot.planType || null);
}

function buildEffectiveSubscriptionState(options: {
  paidSubscription?: Partial<UserSubscriptionDocument> | null;
  manualOverride?: Partial<SubscriptionOverrideDocument> | null;
}): EffectiveSubscriptionState {
  const paidSnapshot = getSubscriptionSnapshotFromData(options.paidSubscription || null);
  const manualSnapshot = getSubscriptionOverrideSnapshotFromData(options.manualOverride || null);
  const effectiveSnapshot = manualSnapshot.isActive ? manualSnapshot : paidSnapshot;

  return {
    paidSubscription: (options.paidSubscription as UserSubscriptionDocument | null) || null,
    paidSnapshot,
    manualOverride: (options.manualOverride as SubscriptionOverrideDocument | null) || null,
    manualSnapshot,
    effectiveSnapshot,
    hasPremiumAccess: effectiveSnapshot.isActive,
    requiresSubscription: !effectiveSnapshot.isActive,
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

export async function resolveEffectiveSubscriptionState(
  userId: string,
  options?: {
    subscription?: Partial<UserSubscriptionDocument> | null;
    manualOverride?: Partial<SubscriptionOverrideDocument> | null;
  }
): Promise<EffectiveSubscriptionState> {
  const [subscription, manualOverride] = await Promise.all([
    options?.subscription === undefined ? getCurrentSubscription(userId) : options.subscription || null,
    options?.manualOverride === undefined
      ? resolveSubscriptionOverrideForUser(userId)
      : options.manualOverride || null,
  ]);

  return buildEffectiveSubscriptionState({
    paidSubscription: subscription,
    manualOverride,
  });
}

export async function syncUserSubscriptionSnapshot(
  userId: string,
  subscription?: Partial<UserSubscriptionDocument> | null,
  manualOverride?: Partial<SubscriptionOverrideDocument> | null
) {
  const resolved = await resolveEffectiveSubscriptionState(userId, {
    subscription,
    manualOverride,
  });
  const snapshot = resolved.effectiveSnapshot;

  await adminDb.collection('users').doc(userId).set(
    {
      subscription: snapshot,
      updatedAt: nowIso(),
    },
    { merge: true }
  );

  try {
    const { enforceDeviceSessionLimit } = await import('@/lib/server/authSessions');
    await enforceDeviceSessionLimit(userId, {
      subscriptionSnapshot: snapshot,
      deviceLimit: getDeviceLimitForSubscriptionSnapshot(snapshot),
    });
  } catch (error) {
    console.warn('[subscriptions] failed to reconcile managed auth sessions after subscription sync', error);
  }

  return snapshot;
}

export async function setCurrentSubscriptionState(
  userId: string,
  patch: Partial<UserSubscriptionDocument>
) {
  const currentSubscription = await getCurrentSubscription(userId);
  const timestamp = nowIso();

  const merged: UserSubscriptionDocument = {
    userId,
    planType:
      patch.planType !== undefined ? patch.planType : currentSubscription?.planType || null,
    planName:
      patch.planName !== undefined ? patch.planName : currentSubscription?.planName || '',
    amount:
      patch.amount !== undefined ? Number(patch.amount || 0) : Number(currentSubscription?.amount || 0),
    currency:
      patch.currency !== undefined ? patch.currency : currentSubscription?.currency || 'UGX',
    status:
      patch.status !== undefined ? patch.status : currentSubscription?.status || 'inactive',
    paymentProvider:
      patch.paymentProvider !== undefined
        ? patch.paymentProvider
        : currentSubscription?.paymentProvider || '',
    providerTransactionId:
      patch.providerTransactionId !== undefined
        ? patch.providerTransactionId
        : currentSubscription?.providerTransactionId || '',
    latestPaymentId:
      patch.latestPaymentId !== undefined
        ? patch.latestPaymentId
        : currentSubscription?.latestPaymentId || '',
    startsAt:
      patch.startsAt !== undefined ? patch.startsAt : currentSubscription?.startsAt || '',
    expiresAt:
      patch.expiresAt !== undefined ? patch.expiresAt : currentSubscription?.expiresAt || '',
    isActive:
      patch.isActive !== undefined
        ? patch.isActive
        : currentSubscription?.isActive === true,
    recurringAgreementId:
      patch.recurringAgreementId !== undefined
        ? patch.recurringAgreementId
        : currentSubscription?.recurringAgreementId || '',
    autoRenewEnabled:
      patch.autoRenewEnabled !== undefined
        ? patch.autoRenewEnabled
        : currentSubscription?.autoRenewEnabled === true,
    nextChargeAt:
      patch.nextChargeAt !== undefined ? patch.nextChargeAt : currentSubscription?.nextChargeAt || '',
    createdAt: currentSubscription?.createdAt || timestamp,
    updatedAt: timestamp,
  };

  await adminDb.collection(SUBSCRIPTIONS_COLLECTION).doc(userId).set(merged, { merge: true });
  await syncUserSubscriptionSnapshot(userId, merged);

  return merged;
}

export async function getViewerEntitlement(
  userId: string,
  viewer?: { email?: string; role?: string }
): Promise<SubscriptionEntitlement> {
  if (viewer?.role === 'admin' || isAdminEmail(viewer?.email)) {
    return {
      hasPremiumAccess: true,
      requiresSubscription: false,
      subscription: adminAccessSnapshot(),
    };
  }

  const resolved = await resolveEffectiveSubscriptionState(userId);

  if (!resolved.paidSnapshot.isActive && resolved.paidSubscription?.status === 'active') {
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
        ...resolved.paidSubscription,
        status: 'expired',
        isActive: false,
        updatedAt: nowIso(),
      }, resolved.manualOverride);
    } catch (error) {
      console.warn('[subscriptions] failed to sync expired subscription state', error);
    }
  }

  return {
    hasPremiumAccess: resolved.hasPremiumAccess,
    requiresSubscription: resolved.requiresSubscription,
    subscription: resolved.effectiveSnapshot,
  };
}

export async function createPaymentAttempt(
  input: Omit<
    PaymentAttemptDocument,
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'paymentKind'
    | 'startsAt'
    | 'expiresAt'
    | 'isActive'
    | 'activationAppliedAt'
    | 'failureReason'
    | 'providerTransactionId'
    | 'providerStatus'
    | 'providerMessage'
    | 'lastCheckedAt'
    | 'webhookReceivedAt'
    | 'recurringAgreementId'
    | 'recurringTokenLast4'
    | 'isAutoRenewal'
    | 'triggerSource'
  > & {
    id: string;
    paymentKind?: PaymentKind;
    recurringAgreementId?: string;
    recurringTokenLast4?: string;
    isAutoRenewal?: boolean;
    triggerSource?: PaymentTriggerSource;
  }
) {
  const timestamp = nowIso();
  const paymentDoc: PaymentAttemptDocument = {
    ...input,
    status: 'created',
    paymentKind: input.paymentKind || 'once_off',
    providerTransactionId: '',
    providerStatus: '',
    providerMessage: '',
    recurringAgreementId: input.recurringAgreementId || '',
    recurringTokenLast4: input.recurringTokenLast4 || '',
    isAutoRenewal: input.isAutoRenewal === true,
    triggerSource: input.triggerSource || 'user',
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

export function summarizeRecurringAgreement(
  agreement?: Partial<RecurringAgreementDocument> | null
): RecurringAgreementSummary {
  if (!agreement) {
    return blankRecurringAgreementSummary();
  }

  return {
    status: agreement.status || (agreement.autoRenewEnabled ? 'active' : 'inactive'),
    planType: agreement.planType || null,
    planName: agreement.planName || '',
    amount: Number(agreement.amount || 0),
    currency: 'ZAR',
    autoRenewEnabled: agreement.autoRenewEnabled === true,
    nextChargeAt: agreement.nextChargeAt || '',
    lastChargeAt: agreement.lastChargeAt || '',
    lastChargeStatus: agreement.lastChargeStatus || '',
    lastPaymentId: agreement.lastPaymentId || '',
    tokenAvailable: Boolean(agreement.token),
    pendingPaymentId: agreement.pendingPaymentId || '',
    failureReason: agreement.failureReason || '',
  };
}

export async function getRecurringAgreementForUser(userId: string) {
  try {
    const snapshot = await adminDb
      .collection(RECURRING_AGREEMENTS_COLLECTION)
      .doc(getRecurringAgreementDocId(userId))
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return {
      id: snapshot.id,
      ...(snapshot.data() as RecurringAgreementDocument),
    };
  } catch (error) {
    console.warn('[subscriptions] failed to read recurring agreement, using empty fallback', error);
    return null;
  }
}

export async function resolveRecurringAgreementForUser(userId: string) {
  const agreement = await getRecurringAgreementForUser(userId);

  if (!agreement || agreement.status !== 'pending_setup' || !agreement.pendingPaymentId) {
    return agreement;
  }

  const payment = await getPaymentAttempt(agreement.pendingPaymentId).catch(() => null);
  const paymentCreatedAtMs = payment?.createdAt ? new Date(payment.createdAt).getTime() : Number.NaN;
  const hasExpiredInFlightSetup =
    Boolean(payment) &&
    !isRecurringSetupTerminalStatus(payment.status) &&
    payment.status !== 'completed' &&
    Number.isFinite(paymentCreatedAtMs) &&
    Date.now() - paymentCreatedAtMs >= STALE_RECURRING_SETUP_MS;
  const shouldClearPendingSetup =
    !payment ||
    isRecurringSetupTerminalStatus(payment?.status) ||
    hasExpiredInFlightSetup;

  if (!shouldClearPendingSetup) {
    return agreement;
  }

  if (hasExpiredInFlightSetup && payment?.id) {
    await updatePaymentAttempt(payment.id, {
      status: 'cancelled',
      providerStatus: 'ABANDONED',
      providerMessage: 'Card auto-renew setup expired before completion.',
      failureReason: 'Card auto-renew setup expired before completion.',
    });
  }

  const clearedAgreement = await upsertRecurringAgreementForUser(userId, {
    status: 'inactive',
    autoRenewEnabled: false,
    nextChargeAt: '',
    pendingPaymentId: '',
    processingLockUntil: '',
    failureReason: '',
    lastChargeStatus: '',
    lastPaymentId: '',
  });

  await updateSubscriptionRecurringState(userId, {
    recurringAgreementId: clearedAgreement?.id || getRecurringAgreementDocId(userId),
    autoRenewEnabled: false,
    nextChargeAt: '',
  });

  return clearedAgreement;
}

export async function upsertRecurringAgreementForUser(
  userId: string,
  state: Partial<RecurringAgreementDocument> & {
    planType?: SubscriptionPlanType;
    planName?: string;
    amount?: number;
  }
) {
  const timestamp = nowIso();
  const ref = adminDb
    .collection(RECURRING_AGREEMENTS_COLLECTION)
    .doc(getRecurringAgreementDocId(userId));

  const current = await getRecurringAgreementForUser(userId);

  const nextDoc: Partial<RecurringAgreementDocument> = {
    userId,
    paymentProvider: 'payfast',
    planType: state.planType || current?.planType || 'monthly',
    planName: state.planName || current?.planName || '',
    amount: Number(state.amount ?? current?.amount ?? 0),
    currency: 'ZAR',
    status: state.status || current?.status || 'inactive',
    token: typeof state.token === 'string' ? state.token : current?.token || '',
    tokenCapturedAt:
      typeof state.tokenCapturedAt === 'string' ? state.tokenCapturedAt : current?.tokenCapturedAt || '',
    tokenSourcePaymentId:
      typeof state.tokenSourcePaymentId === 'string'
        ? state.tokenSourcePaymentId
        : current?.tokenSourcePaymentId || '',
    autoRenewEnabled:
      typeof state.autoRenewEnabled === 'boolean'
        ? state.autoRenewEnabled
        : current?.autoRenewEnabled === true,
    nextChargeAt:
      typeof state.nextChargeAt === 'string' ? state.nextChargeAt : current?.nextChargeAt || '',
    lastChargeAt:
      typeof state.lastChargeAt === 'string' ? state.lastChargeAt : current?.lastChargeAt || '',
    lastChargeStatus:
      typeof state.lastChargeStatus === 'string'
        ? state.lastChargeStatus
        : current?.lastChargeStatus || '',
    lastChargeAttemptAt:
      typeof state.lastChargeAttemptAt === 'string'
        ? state.lastChargeAttemptAt
        : current?.lastChargeAttemptAt || '',
    lastPaymentId:
      typeof state.lastPaymentId === 'string' ? state.lastPaymentId : current?.lastPaymentId || '',
    billingAnchorDay:
      typeof state.billingAnchorDay === 'number'
        ? state.billingAnchorDay
        : current?.billingAnchorDay || 0,
    pendingPaymentId:
      typeof state.pendingPaymentId === 'string'
        ? state.pendingPaymentId
        : current?.pendingPaymentId || '',
    processingLockUntil:
      typeof state.processingLockUntil === 'string'
        ? state.processingLockUntil
        : current?.processingLockUntil || '',
    cancelledAt:
      typeof state.cancelledAt === 'string' ? state.cancelledAt : current?.cancelledAt || '',
    failureReason:
      typeof state.failureReason === 'string' ? state.failureReason : current?.failureReason || '',
    createdAt: current?.createdAt || timestamp,
    updatedAt: timestamp,
  };

  await ref.set(nextDoc, { merge: true });
  return getRecurringAgreementForUser(userId);
}

export async function updateSubscriptionRecurringState(
  userId: string,
  state: {
    recurringAgreementId?: string;
    autoRenewEnabled?: boolean;
    nextChargeAt?: string;
  }
) {
  const timestamp = nowIso();
  const currentSubscription = await getCurrentSubscription(userId);

  const patch = {
    recurringAgreementId:
      typeof state.recurringAgreementId === 'string'
        ? state.recurringAgreementId
        : currentSubscription?.recurringAgreementId || '',
    autoRenewEnabled:
      typeof state.autoRenewEnabled === 'boolean'
        ? state.autoRenewEnabled
        : currentSubscription?.autoRenewEnabled === true,
    nextChargeAt:
      typeof state.nextChargeAt === 'string' ? state.nextChargeAt : currentSubscription?.nextChargeAt || '',
    updatedAt: timestamp,
  };

  await adminDb.collection(SUBSCRIPTIONS_COLLECTION).doc(userId).set(patch, { merge: true });

  const merged = currentSubscription
    ? {
        ...currentSubscription,
        ...patch,
      }
    : null;

  await syncUserSubscriptionSnapshot(userId, merged || undefined);
}

export async function listDueRecurringAgreements(limit = 10) {
  try {
    const snapshot = await adminDb
      .collection(RECURRING_AGREEMENTS_COLLECTION)
      .where('nextChargeAt', '<=', nowIso())
      .orderBy('nextChargeAt', 'asc')
      .limit(limit)
      .get();

    return snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as RecurringAgreementDocument),
      }))
      .filter(
        (agreement) =>
          agreement.paymentProvider === 'payfast' &&
          agreement.autoRenewEnabled === true &&
          isRetryableRecurringStatus(agreement.status) &&
          !agreement.pendingPaymentId &&
          isIsoDateInFuture(agreement.processingLockUntil) === false
      );
  } catch (error) {
    console.warn('[subscriptions] failed to list due recurring agreements', error);
    return [];
  }
}

export async function claimRecurringAgreementProcessing(userId: string, leaseMs: number) {
  const ref = adminDb
    .collection(RECURRING_AGREEMENTS_COLLECTION)
    .doc(getRecurringAgreementDocId(userId));
  const timestamp = nowIso();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString();

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists) {
      return null;
    }

    const agreement = snapshot.data() as RecurringAgreementDocument;
    const nextChargeTime = new Date(agreement.nextChargeAt || '').getTime();

    if (
      agreement.autoRenewEnabled !== true ||
      !isRetryableRecurringStatus(agreement.status) ||
      !agreement.nextChargeAt ||
      !Number.isFinite(nextChargeTime) ||
      nextChargeTime > Date.now()
    ) {
      return null;
    }

    if (agreement.processingLockUntil && new Date(agreement.processingLockUntil).getTime() > Date.now()) {
      return null;
    }

    transaction.set(
      ref,
      {
        processingLockUntil: leaseUntil,
        lastChargeAttemptAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true }
    );

    return {
      id: snapshot.id,
      ...agreement,
      processingLockUntil: leaseUntil,
      lastChargeAttemptAt: timestamp,
    };
  });
}

export async function updateRecurringAgreementAfterSuccessfulPayment(options: {
  userId: string;
  paymentId: string;
  planType: SubscriptionPlanType;
  planName: string;
  amount: number;
  token?: string;
  sourcePaymentId?: string;
  nextChargeAt: string;
  lastChargeStatus: string;
}) {
  const current = await getRecurringAgreementForUser(options.userId);
  const billingAnchorDate = options.nextChargeAt ? new Date(options.nextChargeAt) : new Date();

  const updated = await upsertRecurringAgreementForUser(options.userId, {
    planType: options.planType,
    planName: options.planName,
    amount: options.amount,
    status: 'active',
    autoRenewEnabled: true,
    token: typeof options.token === 'string' && options.token ? options.token : current?.token || '',
    tokenCapturedAt:
      typeof options.token === 'string' && options.token
        ? nowIso()
        : current?.tokenCapturedAt || '',
    tokenSourcePaymentId:
      typeof options.token === 'string' && options.token
        ? options.sourcePaymentId || options.paymentId
        : current?.tokenSourcePaymentId || '',
    nextChargeAt: options.nextChargeAt,
    lastChargeAt: nowIso(),
    lastChargeStatus: options.lastChargeStatus,
    lastPaymentId: options.paymentId,
    pendingPaymentId: '',
    processingLockUntil: '',
    cancelledAt: '',
    failureReason: '',
    billingAnchorDay: billingAnchorDate.getUTCDate(),
  });

  await updateSubscriptionRecurringState(options.userId, {
    recurringAgreementId: updated?.id || getRecurringAgreementDocId(options.userId),
    autoRenewEnabled: true,
    nextChargeAt: options.nextChargeAt,
  });

  return updated;
}

export async function updateRecurringAgreementAfterFailedPayment(options: {
  userId: string;
  paymentId: string;
  nextChargeAt: string;
  status: RecurringAgreementStatus;
  failureReason: string;
}) {
  const updated = await upsertRecurringAgreementForUser(options.userId, {
    status: options.status,
    autoRenewEnabled: true,
    lastChargeStatus: options.status,
    lastPaymentId: options.paymentId,
    pendingPaymentId: '',
    processingLockUntil: '',
    failureReason: options.failureReason,
    nextChargeAt: options.nextChargeAt,
  });

  await updateSubscriptionRecurringState(options.userId, {
    recurringAgreementId: updated?.id || getRecurringAgreementDocId(options.userId),
    autoRenewEnabled: true,
    nextChargeAt: options.nextChargeAt,
  });

  return updated;
}

export async function markRecurringAgreementChargeScheduled(options: {
  userId: string;
  paymentId: string;
  planType: SubscriptionPlanType;
  planName: string;
  amount: number;
}) {
  return upsertRecurringAgreementForUser(options.userId, {
    planType: options.planType,
    planName: options.planName,
    amount: options.amount,
    status: 'active',
    autoRenewEnabled: true,
    lastChargeAttemptAt: nowIso(),
    pendingPaymentId: options.paymentId,
    processingLockUntil: '',
    failureReason: '',
  });
}

export async function releaseRecurringAgreementProcessing(userId: string) {
  await upsertRecurringAgreementForUser(userId, {
    processingLockUntil: '',
  });
}

export async function cancelRecurringAgreementForUser(userId: string) {
  const cancelledAt = nowIso();
  const updated = await upsertRecurringAgreementForUser(userId, {
    status: 'cancelled',
    autoRenewEnabled: false,
    token: '',
    tokenCapturedAt: '',
    tokenSourcePaymentId: '',
    nextChargeAt: '',
    pendingPaymentId: '',
    processingLockUntil: '',
    cancelledAt,
  });

  await updateSubscriptionRecurringState(userId, {
    recurringAgreementId: updated?.id || getRecurringAgreementDocId(userId),
    autoRenewEnabled: false,
    nextChargeAt: '',
  });

  void import('@/lib/server/transactionalEmails').then(({ sendSubscriptionCancelledEmail }) =>
    sendSubscriptionCancelledEmail(userId, updated)
  ).catch((error) => {
    console.warn('[subscriptions] subscription cancelled email hook failed', error);
  });

  return updated;
}

export async function listPendingRecurringRenewalPayments(limit = 10, olderThanIso = nowIso()) {
  try {
    let docs: Array<{ id: string; data: () => unknown }> | null = null;

    try {
      const snapshot = await adminDb
        .collection(PAYMENTS_COLLECTION)
        .where('paymentKind', '==', 'recurring_renewal')
        .where('status', 'in', ['submitted', 'pending', 'needs_attention'])
        .limit(limit)
        .get();

      docs = snapshot.docs;
    } catch (queryError) {
      console.warn(
        '[subscriptions] pending recurring renewal query fell back to local filtering',
        queryError
      );

      const snapshot = await adminDb
        .collection(PAYMENTS_COLLECTION)
        .where('paymentKind', '==', 'recurring_renewal')
        .limit(limit * 10)
        .get();

      docs = snapshot.docs;
    }

    return (docs || [])
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as PaymentAttemptDocument),
      }))
      .filter(
        (payment) =>
          ['submitted', 'pending', 'needs_attention'].includes(payment.status) &&
          !payment.activationAppliedAt &&
          (payment.createdAt || '') <= olderThanIso
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  } catch (error) {
    console.warn('[subscriptions] failed to list pending recurring renewals', error);
    return [];
  }
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

export async function listPaymentsForUser(userId: string, limit = 20) {
  try {
    let docs: Array<{ id: string; data: () => unknown }> | null = null;

    try {
      const snapshot = await adminDb
        .collection(PAYMENTS_COLLECTION)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      docs = snapshot.docs;
    } catch (orderedReadError) {
      const message =
        orderedReadError instanceof Error ? orderedReadError.message : String(orderedReadError || '');

      if (/requires an index/i.test(message)) {
        console.warn(
          '[subscriptions] user payment history index is missing in this environment, retrying without orderBy'
        );
      } else {
        console.warn(
          '[subscriptions] ordered user payment history read failed, retrying without orderBy',
          orderedReadError
        );
      }

      const snapshot = await adminDb
        .collection(PAYMENTS_COLLECTION)
        .where('userId', '==', userId)
        .limit(limit)
        .get();

      docs = snapshot.docs;
    }

    return (docs || [])
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as PaymentAttemptDocument),
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  } catch (error) {
    console.warn('[subscriptions] failed to read user payment history, using empty fallback', error);
    return [];
  }
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

  const result = await adminDb.runTransaction(async (transaction) => {
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
        payment: {
          id: options.paymentId,
          ...payment,
        },
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
      recurringAgreementId: payment.recurringAgreementId || currentSubscription?.recurringAgreementId || '',
      autoRenewEnabled: currentSubscription?.autoRenewEnabled === true,
      nextChargeAt: currentSubscription?.nextChargeAt || '',
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

    return {
      alreadyApplied: false,
      subscription: subscriptionDoc,
      payment: {
        id: options.paymentId,
        ...payment,
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
      } as PaymentAttemptDocument,
    };
  });

  if (result.subscription?.userId) {
    await syncUserSubscriptionSnapshot(result.subscription.userId, result.subscription);
  }

  if (!result.alreadyApplied && result.payment) {
    void import('@/lib/server/transactionalEmails').then(
      ({ sendPaymentSuccessEmail, sendSubscriptionActivatedEmail }) =>
        Promise.all([
          sendPaymentSuccessEmail(result.payment as PaymentAttemptDocument),
          sendSubscriptionActivatedEmail(result.payment as PaymentAttemptDocument),
        ])
    ).catch((error) => {
      console.warn('[subscriptions] payment success email hook failed', error);
    });
  }

  return result;
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

  const payment = await getPaymentAttempt(options.paymentId).catch(() => null);

  if (payment) {
    void import('@/lib/server/transactionalEmails').then(({ sendPaymentFailedEmail }) =>
      sendPaymentFailedEmail(payment)
    ).catch((error) => {
      console.warn('[subscriptions] payment failure email hook failed', error);
    });
  }
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
