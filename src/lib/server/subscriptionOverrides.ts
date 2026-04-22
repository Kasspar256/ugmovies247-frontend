import { adminDb } from '@/lib/firebaseAdmin';
import type {
  ManualSubscriptionAccessType,
  SubscriptionAccessSource,
  SubscriptionOverrideAuditLogDocument,
  SubscriptionOverrideDocument,
  SubscriptionSnapshot,
  SubscriptionStatus,
} from '@/types/subscriptions';

export const SUBSCRIPTION_OVERRIDES_COLLECTION = 'subscription_overrides';
export const SUBSCRIPTION_OVERRIDE_AUDIT_COLLECTION = 'subscription_override_audit_logs';

function nowIso() {
  return new Date().toISOString();
}

function blankOverrideSnapshot(): SubscriptionSnapshot {
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

function normalizeOverrideSource(
  source: string | undefined,
  accessType: ManualSubscriptionAccessType | undefined
): Extract<SubscriptionAccessSource, 'admin_override' | 'promo'> {
  if (source === 'promo' || accessType === 'promo') {
    return 'promo';
  }

  return 'admin_override';
}

function deriveOverrideStatus(
  data?: Partial<SubscriptionOverrideDocument> | null
): Extract<SubscriptionStatus, 'active' | 'expired' | 'cancelled' | 'revoked' | 'scheduled'> {
  const rawStatus = data?.status;

  if (rawStatus === 'revoked' || rawStatus === 'cancelled') {
    return rawStatus;
  }

  const startsAtMs = data?.startsAt ? new Date(data.startsAt).getTime() : Number.NaN;
  const expiresAtMs = data?.expiresAt ? new Date(data.expiresAt).getTime() : Number.NaN;

  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
    return 'expired';
  }

  if (Number.isFinite(startsAtMs) && startsAtMs > Date.now()) {
    return 'scheduled';
  }

  return 'active';
}

export function getSubscriptionOverrideSnapshotFromData(
  data?: Partial<SubscriptionOverrideDocument> | null
): SubscriptionSnapshot {
  if (!data) {
    return blankOverrideSnapshot();
  }

  const status = deriveOverrideStatus(data);
  const isActive = Boolean(status === 'active' && data.isActive !== false);
  const source = normalizeOverrideSource(data.source, data.accessType);

  return {
    planType: data.planType || null,
    planName: data.planName || '',
    status,
    isActive,
    startsAt: data.startsAt || '',
    expiresAt: data.expiresAt || '',
    paymentProvider: '',
    source,
    accessType: data.accessType || (source === 'promo' ? 'promo' : 'admin_override'),
    autoRenewEnabled: false,
    updatedAt: data.updatedAt || '',
  };
}

export async function getCurrentSubscriptionOverride(userId: string) {
  const snapshot = await adminDb.collection(SUBSCRIPTION_OVERRIDES_COLLECTION).doc(userId).get();

  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data() as SubscriptionOverrideDocument;
}

export async function resolveSubscriptionOverrideForUser(userId: string) {
  const current = await getCurrentSubscriptionOverride(userId);

  if (!current) {
    return null;
  }

  const normalizedStatus = deriveOverrideStatus(current);
  const shouldBeActive = normalizedStatus === 'active';
  const normalizedSource = normalizeOverrideSource(current.source, current.accessType);

  if (
    current.status === normalizedStatus &&
    current.isActive === shouldBeActive &&
    current.source === normalizedSource
  ) {
    return current;
  }

  const updated: SubscriptionOverrideDocument = {
    ...current,
    source: normalizedSource,
    status: normalizedStatus,
    isActive: shouldBeActive,
    updatedAt: nowIso(),
  };

  await adminDb.collection(SUBSCRIPTION_OVERRIDES_COLLECTION).doc(userId).set(updated, { merge: true });
  return updated;
}

export async function upsertSubscriptionOverrideForUser(
  userId: string,
  patch: Partial<SubscriptionOverrideDocument>
) {
  const current = await getCurrentSubscriptionOverride(userId);
  const timestamp = nowIso();

  const next: SubscriptionOverrideDocument = {
    userId,
    planType:
      patch.planType !== undefined ? patch.planType : current?.planType || null,
    planName:
      patch.planName !== undefined ? patch.planName : current?.planName || '',
    source: normalizeOverrideSource(
      patch.source || current?.source,
      patch.accessType || current?.accessType
    ),
    accessType:
      patch.accessType !== undefined
        ? patch.accessType
        : current?.accessType || 'admin_override',
    status:
      patch.status !== undefined
        ? patch.status
        : current?.status || 'active',
    isActive:
      patch.isActive !== undefined
        ? patch.isActive
        : current?.isActive !== undefined
          ? current.isActive
          : true,
    startsAt:
      patch.startsAt !== undefined ? patch.startsAt : current?.startsAt || timestamp,
    expiresAt:
      patch.expiresAt !== undefined ? patch.expiresAt : current?.expiresAt || timestamp,
    note: patch.note !== undefined ? patch.note : current?.note || '',
    grantedByAdminId:
      patch.grantedByAdminId !== undefined
        ? patch.grantedByAdminId
        : current?.grantedByAdminId || '',
    grantedByAdminEmail:
      patch.grantedByAdminEmail !== undefined
        ? patch.grantedByAdminEmail
        : current?.grantedByAdminEmail || '',
    grantedByAdminName:
      patch.grantedByAdminName !== undefined
        ? patch.grantedByAdminName
        : current?.grantedByAdminName || '',
    revokedAt:
      patch.revokedAt !== undefined ? patch.revokedAt : current?.revokedAt || '',
    revokedByAdminId:
      patch.revokedByAdminId !== undefined
        ? patch.revokedByAdminId
        : current?.revokedByAdminId || '',
    revokedByAdminEmail:
      patch.revokedByAdminEmail !== undefined
        ? patch.revokedByAdminEmail
        : current?.revokedByAdminEmail || '',
    revokedByAdminName:
      patch.revokedByAdminName !== undefined
        ? patch.revokedByAdminName
        : current?.revokedByAdminName || '',
    revokedReason:
      patch.revokedReason !== undefined
        ? patch.revokedReason
        : current?.revokedReason || '',
    createdAt: current?.createdAt || timestamp,
    updatedAt: timestamp,
  };

  const normalizedStatus = deriveOverrideStatus(next);
  next.status = normalizedStatus;
  next.isActive = normalizedStatus === 'active';

  await adminDb.collection(SUBSCRIPTION_OVERRIDES_COLLECTION).doc(userId).set(next, { merge: true });
  return next;
}

export async function clearSubscriptionOverrideForUser(userId: string) {
  const ref = adminDb.collection(SUBSCRIPTION_OVERRIDES_COLLECTION).doc(userId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    return null;
  }

  const existing = snapshot.data() as SubscriptionOverrideDocument;
  await ref.delete();
  return existing;
}

export async function logSubscriptionOverrideAudit(entry: SubscriptionOverrideAuditLogDocument) {
  const timestamp = nowIso();

  const auditDoc: SubscriptionOverrideAuditLogDocument = {
    ...entry,
    createdAt: entry.createdAt || timestamp,
  };

  const ref = entry.id
    ? adminDb.collection(SUBSCRIPTION_OVERRIDE_AUDIT_COLLECTION).doc(entry.id)
    : adminDb.collection(SUBSCRIPTION_OVERRIDE_AUDIT_COLLECTION).doc();

  await ref.set(auditDoc);

  return {
    id: ref.id,
    ...auditDoc,
  };
}

export async function listSubscriptionOverrideAuditLogs(options?: {
  userId?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(options?.limit || 20, 1), 100);
  let snapshot;

  if (options?.userId) {
    try {
      snapshot = await adminDb
        .collection(SUBSCRIPTION_OVERRIDE_AUDIT_COLLECTION)
        .where('targetUserId', '==', options.userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
    } catch (error) {
      console.warn(
        '[subscription-overrides] ordered audit read failed, retrying without orderBy',
        error
      );
      snapshot = await adminDb
        .collection(SUBSCRIPTION_OVERRIDE_AUDIT_COLLECTION)
        .where('targetUserId', '==', options.userId)
        .limit(limit * 3)
        .get();
    }
  } else {
    snapshot = await adminDb
      .collection(SUBSCRIPTION_OVERRIDE_AUDIT_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
  }

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as SubscriptionOverrideAuditLogDocument),
  }))
    .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))
    .slice(0, limit);
}
