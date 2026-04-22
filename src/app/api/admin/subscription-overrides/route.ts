import { NextResponse } from 'next/server';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { SUBSCRIPTION_PLAN_LIST } from '@/lib/subscriptions/plans';
import { clearAdminPanelServerCache } from '@/lib/server/adminControlCenter';
import {
  forceLogoutManagedAuthSession,
  resetManagedAuthSessions,
} from '@/lib/server/authSessions';
import {
  getAdminSubscriptionUser,
  listRecentAdminSubscriptionActivity,
  searchAdminSubscriptionUsers,
} from '@/lib/server/adminSubscriptionOverrides';
import {
  cancelRecurringAgreementForUser,
  getPlanDefinition,
  resolveEffectiveSubscriptionState,
  setCurrentSubscriptionState,
  syncUserSubscriptionSnapshot,
} from '@/lib/server/subscriptions';
import {
  clearSubscriptionOverrideForUser,
  logSubscriptionOverrideAudit,
  upsertSubscriptionOverrideForUser,
} from '@/lib/server/subscriptionOverrides';
import type {
  ManualSubscriptionAccessType,
  SubscriptionOverrideAuditAction,
  SubscriptionOverrideDocument,
  SubscriptionPlanType,
} from '@/types/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function nowIso() {
  return new Date().toISOString();
}

function createValidationError(message: string) {
  const error = new Error(message);
  error.name = 'ValidationError';
  return error;
}

function addDuration(startDate: Date, unit: 'days' | 'weeks' | 'months', amount: number) {
  const next = new Date(startDate);

  if (unit === 'months') {
    next.setMonth(next.getMonth() + amount);
    return next;
  }

  next.setDate(next.getDate() + amount * (unit === 'weeks' ? 7 : 1));
  return next;
}

function parsePositiveInteger(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : 0;
}

function parseIsoDate(value: unknown) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return '';
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function requireNote(value: unknown) {
  const note = String(value || '').trim();

  if (note.length < 3) {
    throw createValidationError('Add a short admin note or reason before saving this change.');
  }

  return note;
}

function normalizeAccessType(value: unknown): ManualSubscriptionAccessType {
  if (value === 'promo' || value === 'admin_override') {
    return value;
  }

  return 'paid_equivalent';
}

function serializeStateForAudit(target: Awaited<ReturnType<typeof getAdminSubscriptionUser>>) {
  if (!target) {
    return {};
  }

  return {
    effectiveSubscription: target.effectiveSubscription,
    paidSubscription: target.paidSubscription,
    manualOverride: target.manualOverride,
    recurringAgreement: target.recurringAgreement,
  };
}

async function requireAdmin() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return null;
  }

  return session;
}

async function writeAuditLog(options: {
  actionType: SubscriptionOverrideAuditAction;
  admin: NonNullable<Awaited<ReturnType<typeof requireAdmin>>>;
  before: Awaited<ReturnType<typeof getAdminSubscriptionUser>>;
  after: Awaited<ReturnType<typeof getAdminSubscriptionUser>>;
  planType: SubscriptionPlanType | null;
  planName: string;
  note: string;
}) {
  const target = options.after || options.before;

  if (!target) {
    return;
  }

  await logSubscriptionOverrideAudit({
    actionType: options.actionType,
    adminUserId: options.admin.uid,
    adminEmail: options.admin.email,
    adminName: options.admin.name,
    targetUserId: target.id,
    targetUserEmail: target.email,
    targetUserName: target.name,
    planType: options.planType,
    planName: options.planName,
    note: options.note,
    oldState: serializeStateForAudit(options.before),
    newState: serializeStateForAudit(options.after),
    createdAt: nowIso(),
  });
}

async function revokeManualOverride(options: {
  userId: string;
  adminId: string;
  adminEmail: string;
  adminName: string;
  note: string;
}) {
  const currentState = await resolveEffectiveSubscriptionState(options.userId);

  if (!currentState.manualOverride) {
    return null;
  }

  return upsertSubscriptionOverrideForUser(options.userId, {
    ...currentState.manualOverride,
    status: 'revoked',
    isActive: false,
    revokedAt: nowIso(),
    revokedByAdminId: options.adminId,
    revokedByAdminEmail: options.adminEmail,
    revokedByAdminName: options.adminName,
    revokedReason: options.note,
    note: currentState.manualOverride.note || options.note,
  });
}

async function applyGrantAction(options: {
  userId: string;
  actionType: 'grant' | 'overlay' | 'replace';
  accessType: ManualSubscriptionAccessType;
  planType: SubscriptionPlanType;
  durationMode: 'plan' | 'custom';
  customStartsAt?: string;
  customExpiresAt?: string;
  note: string;
  adminId: string;
  adminEmail: string;
  adminName: string;
}) {
  const plan = getPlanDefinition(options.planType);

  if (!plan) {
    throw createValidationError('Choose a valid subscription plan.');
  }

  const currentState = await resolveEffectiveSubscriptionState(options.userId);
  const now = new Date();
  let startsAt = now.toISOString();
  let expiresAt = '';

  if (options.durationMode === 'custom') {
    startsAt = parseIsoDate(options.customStartsAt);
    expiresAt = parseIsoDate(options.customExpiresAt);

    if (!startsAt || !expiresAt) {
      throw createValidationError('Provide valid custom start and end dates.');
    }
  } else {
    expiresAt = addDuration(now, plan.durationUnit === 'months' ? 'months' : 'days', plan.durationValue).toISOString();
  }

  if (new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
    throw createValidationError('The expiry date must be later than the start date.');
  }

  const overrideDoc: Partial<SubscriptionOverrideDocument> = {
    userId: options.userId,
    planType: options.planType,
    planName: plan.name,
    source: options.accessType === 'promo' ? 'promo' : 'admin_override',
    accessType: options.accessType,
    status: new Date(startsAt).getTime() > Date.now() ? 'scheduled' : 'active',
    isActive: new Date(startsAt).getTime() <= Date.now(),
    startsAt,
    expiresAt,
    note: options.note,
    grantedByAdminId: options.adminId,
    grantedByAdminEmail: options.adminEmail,
    grantedByAdminName: options.adminName,
    revokedAt: '',
    revokedByAdminId: '',
    revokedByAdminEmail: '',
    revokedByAdminName: '',
    revokedReason: '',
  };

  await upsertSubscriptionOverrideForUser(options.userId, overrideDoc);

  if (options.actionType === 'replace' && currentState.paidSubscription?.status === 'active') {
    await setCurrentSubscriptionState(options.userId, {
      status: 'cancelled',
      isActive: false,
      expiresAt: startsAt,
      autoRenewEnabled: false,
      nextChargeAt: '',
    });

    if (currentState.paidSubscription.autoRenewEnabled || currentState.paidSubscription.nextChargeAt) {
      await cancelRecurringAgreementForUser(options.userId).catch(() => null);
    }
  } else {
    await syncUserSubscriptionSnapshot(options.userId);
  }

  return {
    planType: plan.type,
    planName: plan.name,
  };
}

async function applyExtendAction(options: {
  userId: string;
  planType?: SubscriptionPlanType;
  extensionUnit?: 'days' | 'weeks' | 'months';
  extensionAmount?: number;
  exactExpiresAt?: string;
  note: string;
  adminId: string;
  adminEmail: string;
  adminName: string;
}) {
  const currentState = await resolveEffectiveSubscriptionState(options.userId);
  const liveManualOverride =
    currentState.manualOverride &&
    (currentState.manualOverride.status === 'active' ||
      currentState.manualOverride.status === 'scheduled')
      ? currentState.manualOverride
      : null;
  const referencePlanType =
    options.planType ||
    liveManualOverride?.planType ||
    currentState.paidSubscription?.planType ||
    currentState.effectiveSnapshot.planType;

  if (!referencePlanType) {
    throw createValidationError('This user has no current plan to extend. Use the manual grant form instead.');
  }

  const plan = getPlanDefinition(referencePlanType);

  if (!plan) {
    throw createValidationError('The current subscription plan could not be resolved.');
  }

  const exactExpiresAt = parseIsoDate(options.exactExpiresAt);
  const extendUnit = options.extensionUnit || 'days';
  const extendAmount = parsePositiveInteger(options.extensionAmount);
  const now = new Date();
  const currentExpirySource =
    liveManualOverride?.expiresAt ||
    currentState.effectiveSnapshot.expiresAt ||
    now.toISOString();
  const currentExpiry = new Date(currentExpirySource);
  const startBase =
    liveManualOverride?.startsAt ||
    (currentState.effectiveSnapshot.isActive ? currentState.effectiveSnapshot.startsAt : '') ||
    now.toISOString();
  const startsAt =
    liveManualOverride?.startsAt ||
    (currentState.effectiveSnapshot.isActive && liveManualOverride == null
      ? currentExpiry.toISOString()
      : startBase);

  let expiresAt = exactExpiresAt;

  if (!expiresAt) {
    if (!extendAmount) {
      throw createValidationError('Choose how much time to add, or set a new exact expiry date.');
    }

    expiresAt = addDuration(
      Number.isFinite(currentExpiry.getTime()) && currentExpiry.getTime() > Date.now() ? currentExpiry : now,
      extendUnit,
      extendAmount
    ).toISOString();
  }

  if (new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
    throw createValidationError('The new expiry date must be later than the access start date.');
  }

  await upsertSubscriptionOverrideForUser(options.userId, {
    userId: options.userId,
    planType: referencePlanType,
    planName: plan.name,
    source:
      liveManualOverride?.source ||
      (currentState.effectiveSnapshot.source === 'promo' ? 'promo' : 'admin_override'),
    accessType:
      liveManualOverride?.accessType ||
      (currentState.effectiveSnapshot.source === 'promo' ? 'promo' : 'paid_equivalent'),
    status: new Date(startsAt).getTime() > Date.now() ? 'scheduled' : 'active',
    isActive: new Date(startsAt).getTime() <= Date.now(),
    startsAt,
    expiresAt,
    note: options.note,
    grantedByAdminId:
      liveManualOverride?.grantedByAdminId || options.adminId,
    grantedByAdminEmail:
      liveManualOverride?.grantedByAdminEmail || options.adminEmail,
    grantedByAdminName:
      liveManualOverride?.grantedByAdminName || options.adminName,
    revokedAt: '',
    revokedByAdminId: '',
    revokedByAdminEmail: '',
    revokedByAdminName: '',
    revokedReason: '',
  });

  await syncUserSubscriptionSnapshot(options.userId);

  return {
    planType: plan.type,
    planName: plan.name,
  };
}

async function applyRevokeAction(options: {
  userId: string;
  note: string;
  adminId: string;
  adminEmail: string;
  adminName: string;
}) {
  await revokeManualOverride(options);

  const currentState = await resolveEffectiveSubscriptionState(options.userId);

  if (currentState.paidSubscription?.status === 'active' || currentState.paidSubscription?.isActive) {
    await setCurrentSubscriptionState(options.userId, {
      status: 'cancelled',
      isActive: false,
      expiresAt: nowIso(),
      autoRenewEnabled: false,
      nextChargeAt: '',
    });
  } else {
    await syncUserSubscriptionSnapshot(options.userId);
  }

  if (currentState.paidSubscription?.autoRenewEnabled || currentState.paidSubscription?.nextChargeAt) {
    await cancelRecurringAgreementForUser(options.userId).catch(() => null);
  }
}

async function applyClearOverrideAction(options: {
  userId: string;
}) {
  const currentState = await resolveEffectiveSubscriptionState(options.userId);

  if (!currentState.manualOverride) {
    throw createValidationError('There is no manual override to clear for this user.');
  }

  await clearSubscriptionOverrideForUser(options.userId);
  await syncUserSubscriptionSnapshot(options.userId);
}

async function applyCancelAutoRenewAction(options: {
  userId: string;
}) {
  const currentState = await resolveEffectiveSubscriptionState(options.userId);

  if (
    !currentState.paidSubscription ||
    (!currentState.paidSubscription.autoRenewEnabled && !currentState.paidSubscription.nextChargeAt)
  ) {
    throw createValidationError('This user does not have an auto-renewing paid subscription to disable.');
  }

  await cancelRecurringAgreementForUser(options.userId);
  await setCurrentSubscriptionState(options.userId, {
    autoRenewEnabled: false,
    nextChargeAt: '',
  });
}

export async function GET(request: Request) {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const query = String(url.searchParams.get('query') || '');
    const statusFilter = String(url.searchParams.get('status') || 'all');
    const sourceFilter = String(url.searchParams.get('source') || 'all');
    const userId = String(url.searchParams.get('userId') || '');
    const includeActivity = url.searchParams.get('includeActivity') !== '0';

    const [users, selectedUser, recentActivity] = await Promise.all([
      searchAdminSubscriptionUsers({
        query,
        statusFilter,
        sourceFilter,
      }),
      userId ? getAdminSubscriptionUser(userId) : Promise.resolve(null),
      includeActivity
        ? listRecentAdminSubscriptionActivity(20, userId || undefined)
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      plans: SUBSCRIPTION_PLAN_LIST,
      users,
      selectedUser,
      recentActivity,
    });
  } catch (error) {
    console.error('[admin-subscription-overrides] failed to load state', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load subscription override tools.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const actionType = String(body.actionType || '').trim();
    const userId = String(body.userId || '').trim();
    const note = requireNote(body.note);

    if (!userId) {
      return NextResponse.json({ error: 'Choose a user first.' }, { status: 400 });
    }

    const before = await getAdminSubscriptionUser(userId);

    if (!before) {
      return NextResponse.json({ error: 'The selected user could not be found.' }, { status: 404 });
    }

    let planType: SubscriptionPlanType | null = null;
    let planName = '';

    if (actionType === 'grant' || actionType === 'overlay' || actionType === 'replace') {
      const applied = await applyGrantAction({
        userId,
        actionType: actionType as 'grant' | 'overlay' | 'replace',
        accessType: normalizeAccessType(body.accessType),
        planType: String(body.planType || '') as SubscriptionPlanType,
        durationMode: body.durationMode === 'custom' ? 'custom' : 'plan',
        customStartsAt: parseIsoDate(body.customStartsAt),
        customExpiresAt: parseIsoDate(body.customExpiresAt),
        note,
        adminId: session.uid,
        adminEmail: session.email,
        adminName: session.name,
      });
      planType = applied.planType;
      planName = applied.planName;
    } else if (actionType === 'extend') {
      const applied = await applyExtendAction({
        userId,
        planType: body.planType ? (String(body.planType) as SubscriptionPlanType) : undefined,
        extensionUnit:
          body.extensionUnit === 'weeks' || body.extensionUnit === 'months'
            ? body.extensionUnit
            : 'days',
        extensionAmount: parsePositiveInteger(body.extensionAmount),
        exactExpiresAt: parseIsoDate(body.exactExpiresAt),
        note,
        adminId: session.uid,
        adminEmail: session.email,
        adminName: session.name,
      });
      planType = applied.planType;
      planName = applied.planName;
    } else if (actionType === 'revoke') {
      await applyRevokeAction({
        userId,
        note,
        adminId: session.uid,
        adminEmail: session.email,
        adminName: session.name,
      });
      planType = before.effectiveSubscription.planType;
      planName = before.effectiveSubscription.planName;
    } else if (actionType === 'clear_override') {
      await applyClearOverrideAction({
        userId,
      });
      planType = before.manualOverride?.planType || null;
      planName = before.manualOverride?.planName || '';
    } else if (actionType === 'cancel_auto_renew') {
      await applyCancelAutoRenewAction({ userId });
      planType = before.paidSubscription?.planType || null;
      planName = before.paidSubscription?.planName || '';
    } else if (actionType === 'force_logout_device') {
      const sessionId = String(body.sessionId || '').trim();

      if (!sessionId) {
        return NextResponse.json({ error: 'Choose the device session to end first.' }, { status: 400 });
      }

      await forceLogoutManagedAuthSession({
        userId,
        sessionId,
        admin: {
          adminUserId: session.uid,
          adminEmail: session.email,
          adminName: session.name,
        },
        note,
        targetUserEmail: before.email,
        targetUserName: before.name,
      });
    } else if (actionType === 'reset_all_sessions') {
      await resetManagedAuthSessions({
        userId,
        admin: {
          adminUserId: session.uid,
          adminEmail: session.email,
          adminName: session.name,
        },
        note,
        targetUserEmail: before.email,
        targetUserName: before.name,
      });
    } else {
      return NextResponse.json({ error: 'Unsupported admin action.' }, { status: 400 });
    }

    const after = await getAdminSubscriptionUser(userId);
    clearAdminPanelServerCache('users');

    if (
      actionType === 'grant' ||
      actionType === 'overlay' ||
      actionType === 'replace' ||
      actionType === 'extend' ||
      actionType === 'revoke' ||
      actionType === 'clear_override' ||
      actionType === 'cancel_auto_renew'
    ) {
      await writeAuditLog({
        actionType: actionType as SubscriptionOverrideAuditAction,
        admin: session,
        before,
        after,
        planType,
        planName,
        note,
      });
    }

    return NextResponse.json({
      success: true,
      selectedUser: after,
      recentActivity: await listRecentAdminSubscriptionActivity(20, userId),
    });
  } catch (error) {
    console.error('[admin-subscription-overrides] action failed', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update subscription access.',
      },
      {
        status:
          error instanceof Error && error.name === 'ValidationError'
            ? 400
            : 500,
      }
    );
  }
}
