import { adminDb } from '@/lib/firebaseAdmin';
import { listManagedAuthSessionsForUser } from '@/lib/server/authSessions';
import {
  getDeviceLimitForSubscriptionSnapshot,
  getSubscriptionSnapshotFromData,
  summarizeRecurringAgreement,
  resolveEffectiveSubscriptionState,
  resolveRecurringAgreementForUser,
} from '@/lib/server/subscriptions';
import { listSubscriptionOverrideAuditLogs } from '@/lib/server/subscriptionOverrides';
import type {
  AdminSubscriptionOverrideActivity,
  AdminSubscriptionUserSummary,
} from '@/types/admin';

type RawAdminUserRecord = {
  id: string;
  name: string;
  email: string;
  username: string;
  phoneNumber: string;
  role: 'user' | 'admin';
  joinDate: string;
  lastLoginAt: string;
  isActive: boolean;
  avatarUrl: string;
  subscriptionSnapshot: ReturnType<typeof getSubscriptionSnapshotFromData>;
};

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function pickUserSortValue(user: RawAdminUserRecord) {
  return user.lastLoginAt || user.joinDate || '';
}

function matchesSearch(user: RawAdminUserRecord, query: string) {
  if (!query) {
    return true;
  }

  const haystack = [
    user.id,
    user.name,
    user.email,
    user.username,
    user.phoneNumber,
  ]
    .map((value) => normalizeSearchValue(value))
    .filter(Boolean);

  return haystack.some((value) => value.includes(query));
}

function matchesStatusFilter(
  user: AdminSubscriptionUserSummary,
  statusFilter: string
) {
  if (!statusFilter || statusFilter === 'all') {
    return true;
  }

  if (statusFilter === 'no_plan') {
    return !user.effectiveSubscription.isActive && !user.effectiveSubscription.planName;
  }

  if (statusFilter === 'admin_granted') {
    return (
      user.effectiveSubscription.source === 'admin_override' ||
      user.effectiveSubscription.source === 'promo'
    );
  }

  if (statusFilter === 'expired') {
    return user.effectiveSubscription.status === 'expired';
  }

  if (statusFilter === 'cancelled') {
    return user.effectiveSubscription.status === 'cancelled';
  }

  return user.effectiveSubscription.status === statusFilter;
}

function matchesSourceFilter(
  user: AdminSubscriptionUserSummary,
  sourceFilter: string
) {
  if (!sourceFilter || sourceFilter === 'all') {
    return true;
  }

  if (sourceFilter === 'none') {
    return !user.effectiveSubscription.source;
  }

  return user.effectiveSubscription.source === sourceFilter;
}

async function buildAdminSubscriptionUserSummary(
  user: RawAdminUserRecord,
  options?: { includeActiveDevices?: boolean }
): Promise<AdminSubscriptionUserSummary> {
  const [effectiveState, recurringAgreement, activeDevices] = await Promise.all([
    resolveEffectiveSubscriptionState(user.id),
    resolveRecurringAgreementForUser(user.id),
    options?.includeActiveDevices ? listManagedAuthSessionsForUser(user.id) : Promise.resolve([]),
  ]);
  const deviceLimit = getDeviceLimitForSubscriptionSnapshot(
    effectiveState.effectiveSnapshot,
    user.role
  );
  const activeDeviceCount = activeDevices.filter((device) => device.isActive).length;
  const currentManualOverride =
    effectiveState.manualSnapshot.isActive || effectiveState.manualSnapshot.status === 'scheduled'
      ? effectiveState.manualOverride
      : null;

  return {
    ...user,
    effectiveSubscription: effectiveState.effectiveSnapshot,
    paidSubscription: effectiveState.paidSubscription
      ? {
          planType: effectiveState.paidSubscription.planType,
          planName: effectiveState.paidSubscription.planName,
          status: effectiveState.paidSubscription.status,
          isActive: effectiveState.paidSubscription.isActive,
          startsAt: effectiveState.paidSubscription.startsAt,
          expiresAt: effectiveState.paidSubscription.expiresAt,
          paymentProvider: effectiveState.paidSubscription.paymentProvider,
          autoRenewEnabled: effectiveState.paidSubscription.autoRenewEnabled,
          nextChargeAt: effectiveState.paidSubscription.nextChargeAt,
          updatedAt: effectiveState.paidSubscription.updatedAt,
        }
      : null,
    manualOverride: currentManualOverride
      ? {
          planType: currentManualOverride.planType,
          planName: currentManualOverride.planName,
          source: currentManualOverride.source,
          accessType: currentManualOverride.accessType,
          status: currentManualOverride.status,
          isActive: currentManualOverride.isActive,
          startsAt: currentManualOverride.startsAt,
          expiresAt: currentManualOverride.expiresAt,
          note: currentManualOverride.note,
          grantedByAdminEmail: currentManualOverride.grantedByAdminEmail,
          grantedByAdminName: currentManualOverride.grantedByAdminName,
          updatedAt: currentManualOverride.updatedAt,
          revokedAt: currentManualOverride.revokedAt,
        }
      : null,
    recurringAgreement: summarizeRecurringAgreement(recurringAgreement),
    deviceLimit: Number.isFinite(deviceLimit) ? deviceLimit : -1,
    activeDeviceCount,
    activeDevices,
  };
}

function buildAdminSubscriptionListSummary(
  user: RawAdminUserRecord
): AdminSubscriptionUserSummary {
  const deviceLimit = getDeviceLimitForSubscriptionSnapshot(user.subscriptionSnapshot, user.role);

  return {
    ...user,
    effectiveSubscription: user.subscriptionSnapshot,
    paidSubscription: null,
    manualOverride: null,
    recurringAgreement: summarizeRecurringAgreement(null),
    deviceLimit: Number.isFinite(deviceLimit) ? deviceLimit : -1,
    activeDeviceCount: 0,
    activeDevices: [],
  };
}

function mapRawAdminUserRecord(
  id: string,
  data: Record<string, unknown>
): RawAdminUserRecord {
  return {
    id,
    name: String(data.name || 'User'),
    email: String(data.email || ''),
    username: String(data.username || data.handle || ''),
    phoneNumber: String(data.phoneNumber || data.phone || ''),
    role: data.role === 'admin' ? 'admin' : 'user',
    joinDate: String(data.createdAt || ''),
    lastLoginAt: String(data.lastLoginAt || ''),
    isActive: data.isActive !== false,
    avatarUrl: String(data.avatarUrl || ''),
    subscriptionSnapshot:
      data.subscription && typeof data.subscription === 'object'
        ? getSubscriptionSnapshotFromData(
            data.subscription as Parameters<typeof getSubscriptionSnapshotFromData>[0]
          )
        : getSubscriptionSnapshotFromData(null),
  };
}

export async function getAdminSubscriptionUser(userId: string) {
  const snapshot = await adminDb.collection('users').doc(userId).get();

  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data() as Record<string, unknown>;

  return buildAdminSubscriptionUserSummary(mapRawAdminUserRecord(snapshot.id, data), {
    includeActiveDevices: true,
  });
}

export async function searchAdminSubscriptionUsers(options?: {
  query?: string;
  statusFilter?: string;
  sourceFilter?: string;
  scanLimit?: number;
  resultLimit?: number;
}) {
  const query = normalizeSearchValue(options?.query || '');
  const scanLimit = Math.min(Math.max(options?.scanLimit || 150, 50), 500);
  const resultLimit = Math.min(Math.max(options?.resultLimit || 30, 5), 100);

  const snapshot = await adminDb.collection('users').limit(scanLimit).get();
  const candidateUsers = snapshot.docs
    .map((doc) => mapRawAdminUserRecord(doc.id, doc.data() as Record<string, unknown>))
    .filter((user) => matchesSearch(user, query))
    .sort((left, right) => pickUserSortValue(right).localeCompare(pickUserSortValue(left)))
    .slice(0, Math.max(resultLimit * 2, 40));

  const users = candidateUsers.map((user) => buildAdminSubscriptionListSummary(user));

  return users.filter(
    (user) =>
      matchesStatusFilter(user, options?.statusFilter || 'all') &&
      matchesSourceFilter(user, options?.sourceFilter || 'all')
  ).slice(0, resultLimit);
}

export async function listRecentAdminSubscriptionActivity(limit = 20, userId?: string) {
  const auditLogs = await listSubscriptionOverrideAuditLogs({
    limit,
    userId,
  });

  return auditLogs.map(
    (entry): AdminSubscriptionOverrideActivity => ({
      id: entry.id || '',
      actionType: entry.actionType,
      adminUserId: entry.adminUserId,
      adminEmail: entry.adminEmail,
      adminName: entry.adminName,
      targetUserId: entry.targetUserId,
      targetUserEmail: entry.targetUserEmail,
      targetUserName: entry.targetUserName,
      planType: entry.planType,
      planName: entry.planName,
      note: entry.note,
      oldState: entry.oldState,
      newState: entry.newState,
      createdAt: entry.createdAt,
    })
  );
}
