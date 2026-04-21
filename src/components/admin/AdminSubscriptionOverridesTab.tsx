'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Clock3,
  CreditCard,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  AdminSubscriptionOverrideActivity,
  AdminSubscriptionUserSummary,
} from '@/types/admin';
import type { SubscriptionPlanDefinition } from '@/types/subscriptions';
import { fetchAdminJson } from '@/lib/admin/fetchAdminJson';
import {
  Card,
  FieldLabel,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/admin/controlCenterFields';
import { formatDate } from '@/components/admin/controlCenterUtils';

type OverridesPayload = {
  plans: SubscriptionPlanDefinition[];
  users: AdminSubscriptionUserSummary[];
  selectedUser: AdminSubscriptionUserSummary | null;
  recentActivity: AdminSubscriptionOverrideActivity[];
};

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  payload: Record<string, unknown>;
};

const EMPTY_PAYLOAD: OverridesPayload = {
  plans: [],
  users: [],
  selectedUser: null,
  recentActivity: [],
};

function buildQueryString(params: Record<string, string>) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

function formatStatusLabel(user: AdminSubscriptionUserSummary | null) {
  if (!user) {
    return 'No user selected';
  }

  if (user.effectiveSubscription.isActive && user.effectiveSubscription.source === 'promo') {
    return 'Promo Access';
  }

  if (user.effectiveSubscription.isActive && user.effectiveSubscription.source === 'admin_override') {
    return 'Admin Granted';
  }

  if (!user.effectiveSubscription.planName) {
    return 'No Plan';
  }

  return user.effectiveSubscription.status.replace(/_/g, ' ');
}

function getSourceLabel(user: AdminSubscriptionUserSummary | null) {
  const source = user?.effectiveSubscription.source || '';

  if (!source) {
    return 'Free / none';
  }

  if (source === 'admin_override') {
    return 'Manual admin override';
  }

  if (source === 'promo') {
    return 'Promo / free pass';
  }

  if (source === 'admin_role') {
    return 'Admin role access';
  }

  return 'Real payment';
}

function getStatusTone(status: string) {
  if (status === 'active') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
  }

  if (status === 'scheduled') {
    return 'border-sky-500/25 bg-sky-500/10 text-sky-200';
  }

  if (status === 'expired') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-100';
  }

  return 'border-red-500/25 bg-red-500/10 text-red-100';
}

function normalizeDateTimeLocal(value: string) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

export function AdminSubscriptionOverridesTab() {
  const [payload, setPayload] = useState<OverridesPayload>(EMPTY_PAYLOAD);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const [grantPlanType, setGrantPlanType] = useState('monthly');
  const [grantAccessType, setGrantAccessType] = useState('paid_equivalent');
  const [grantMode, setGrantMode] = useState<'overlay' | 'replace' | 'grant'>('overlay');
  const [grantDurationMode, setGrantDurationMode] = useState<'plan' | 'custom'>('plan');
  const [grantCustomStartsAt, setGrantCustomStartsAt] = useState('');
  const [grantCustomExpiresAt, setGrantCustomExpiresAt] = useState('');
  const [grantNote, setGrantNote] = useState('');

  const [extendUnit, setExtendUnit] = useState<'days' | 'weeks' | 'months' | 'exact'>('days');
  const [extendAmount, setExtendAmount] = useState('7');
  const [extendExactExpiresAt, setExtendExactExpiresAt] = useState('');
  const [extendNote, setExtendNote] = useState('');

  const [actionNote, setActionNote] = useState('');

  const loadState = async (options?: { userId?: string; keepSelection?: boolean }) => {
    setLoading(true);
    setErrorMessage('');

    try {
      const requestedUserId = options?.userId ?? selectedUserId;
      const response = await fetchAdminJson<OverridesPayload>(
        `/api/admin/subscription-overrides${buildQueryString({
          query,
          status: statusFilter,
          source: sourceFilter,
          userId: requestedUserId,
        })}`,
        { force: true }
      );

      setPayload(response || EMPTY_PAYLOAD);

      const nextSelectedId =
        requestedUserId ||
        response.selectedUser?.id ||
        response.users[0]?.id ||
        '';

      if (!options?.keepSelection || nextSelectedId !== selectedUserId) {
        setSelectedUserId(nextSelectedId);
      }

      if (!grantPlanType && response.plans[0]?.type) {
        setGrantPlanType(response.plans[0].type);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load subscription override tools.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadState({ keepSelection: true });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query, statusFilter, sourceFilter]);

  useEffect(() => {
    void loadState({ userId: selectedUserId, keepSelection: true });
  }, []);

  const selectedUser = useMemo(() => {
    if (payload.selectedUser?.id === selectedUserId) {
      return payload.selectedUser;
    }

    return payload.users.find((user) => user.id === selectedUserId) || payload.selectedUser || null;
  }, [payload, selectedUserId]);

  useEffect(() => {
    if (!selectedUser && payload.users[0]?.id && !selectedUserId) {
      setSelectedUserId(payload.users[0].id);
    }
  }, [payload.users, selectedUser, selectedUserId]);

  useEffect(() => {
    if (selectedUser?.effectiveSubscription.planType) {
      setGrantPlanType(selectedUser.effectiveSubscription.planType);
    }
  }, [selectedUser?.effectiveSubscription.planType]);

  const executeAction = async (body: Record<string, unknown>) => {
    setActionBusy(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await fetch('/api/admin/subscription-overrides', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as OverridesPayload & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || 'The subscription change could not be saved.');
      }

      setStatusMessage('Subscription access updated successfully.');
      setGrantNote('');
      setExtendNote('');
      setActionNote('');
      setPayload((current) => ({
        ...current,
        selectedUser: data.selectedUser || current.selectedUser,
        recentActivity: data.recentActivity || current.recentActivity,
      }));
      await loadState({ userId: selectedUserId || String(body.userId || ''), keepSelection: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The subscription change could not be saved.');
    } finally {
      setActionBusy(false);
      setConfirmState(null);
    }
  };

  const openConfirm = (state: ConfirmState) => {
    setConfirmState(state);
  };

  const activePlanWarning =
    selectedUser?.effectiveSubscription.isActive &&
    (selectedUser.effectiveSubscription.source === 'payment' ||
      selectedUser.effectiveSubscription.source === 'admin_override' ||
      selectedUser.effectiveSubscription.source === 'promo');

  return (
    <div className="space-y-5">
      {(statusMessage || errorMessage) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            errorMessage
              ? 'border-red-500/30 bg-red-500/10 text-red-100'
              : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
          }`}
        >
          {errorMessage || statusMessage}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card
          title="User Search"
          description="Find users by email, UID, name, username, or phone number and open their access controls."
          action={
            <button
              type="button"
              onClick={() => void loadState({ userId: selectedUserId, keepSelection: true })}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/75"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          }
        >
          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search email, UID, username, phone..."
                className="pl-10"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div>
                <FieldLabel>Status Filter</FieldLabel>
                <SelectInput
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">All users</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="admin_granted">Admin granted</option>
                  <option value="no_plan">No plan</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Source Filter</FieldLabel>
                <SelectInput
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value)}
                >
                  <option value="all">All sources</option>
                  <option value="payment">Paid</option>
                  <option value="admin_override">Admin override</option>
                  <option value="promo">Promo access</option>
                  <option value="none">No source</option>
                </SelectInput>
              </div>
            </div>

            <div className="space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/60">
                  Loading matching users...
                </div>
              ) : payload.users.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/60">
                  No users matched the current search.
                </div>
              ) : (
                payload.users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedUserId(user.id);
                      void loadState({ userId: user.id, keepSelection: true });
                    }}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                      selectedUserId === user.id
                        ? 'border-[#D90429]/40 bg-[#D90429]/10'
                        : 'border-white/10 bg-black/20 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-white">{user.name}</div>
                        <div className="mt-1 truncate text-xs text-white/50">{user.email || user.id}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getStatusTone(user.effectiveSubscription.status)}`}>
                            {formatStatusLabel(user)}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
                            {getSourceLabel(user)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right text-[11px] uppercase tracking-[0.18em] text-white/38">
                        <div>{user.role}</div>
                        <div className="mt-1">{user.effectiveSubscription.planName || 'Free'}</div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card
            title="Subscription Summary"
            description="Review the selected user's live access state, payment status, and any manual override currently in force."
          >
            {selectedUser ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-2xl font-black text-white">{selectedUser.name}</div>
                    <div className="mt-2 text-sm text-white/58">{selectedUser.email || 'No email on file'}</div>
                    <div className="mt-1 text-xs text-white/38">UID: {selectedUser.id}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] ${getStatusTone(selectedUser.effectiveSubscription.status)}`}>
                      {formatStatusLabel(selectedUser)}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-white/72">
                      {getSourceLabel(selectedUser)}
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/42">
                      Current Plan
                    </div>
                    <div className="mt-3 text-lg font-black text-white">
                      {selectedUser.effectiveSubscription.planName || 'Free'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/42">
                      Access Window
                    </div>
                    <div className="mt-3 text-sm leading-6 text-white/75">
                      <div>Start: <span className="font-semibold text-white">{formatDate(selectedUser.effectiveSubscription.startsAt)}</span></div>
                      <div>End: <span className="font-semibold text-white">{formatDate(selectedUser.effectiveSubscription.expiresAt)}</span></div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/42">
                      Payment
                    </div>
                    <div className="mt-3 text-sm leading-6 text-white/75">
                      <div>Method: <span className="font-semibold text-white">{selectedUser.paidSubscription?.paymentProvider || 'Manual / none'}</span></div>
                      <div>Auto-renew: <span className="font-semibold text-white">{selectedUser.paidSubscription?.autoRenewEnabled ? 'Enabled' : 'Disabled'}</span></div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/42">
                      Manual Override
                    </div>
                    <div className="mt-3 text-sm leading-6 text-white/75">
                      <div>Status: <span className="font-semibold text-white">{selectedUser.manualOverride?.status || 'None'}</span></div>
                      <div>Granted by: <span className="font-semibold text-white">{selectedUser.manualOverride?.grantedByAdminEmail || '-'}</span></div>
                    </div>
                  </div>
                </div>

                {activePlanWarning && (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    This user already has an active access source. Choose carefully between overlaying new access, replacing it immediately, or extending from expiry.
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/60">
                Select a user from the search results to manage their subscription access.
              </div>
            )}
          </Card>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <Card
              title="Manual Grant"
              description="Grant full paid-equivalent, promo, or admin override access using the standard plan duration or a custom access window."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Plan</FieldLabel>
                  <SelectInput
                    value={grantPlanType}
                    onChange={(event) => setGrantPlanType(event.target.value)}
                  >
                    {payload.plans.map((plan) => (
                      <option key={plan.type} value={plan.type}>
                        {plan.name}
                      </option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Access Type</FieldLabel>
                  <SelectInput
                    value={grantAccessType}
                    onChange={(event) => setGrantAccessType(event.target.value)}
                  >
                    <option value="paid_equivalent">Full paid-equivalent access</option>
                    <option value="promo">Promo / free access</option>
                    <option value="admin_override">Admin override access</option>
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Apply Mode</FieldLabel>
                  <SelectInput
                    value={grantMode}
                    onChange={(event) =>
                      setGrantMode(event.target.value as 'overlay' | 'replace' | 'grant')
                    }
                  >
                    <option value="overlay">Overlay now (keep paid record underneath)</option>
                    <option value="replace">Replace current access immediately</option>
                    <option value="grant">Grant now (standard manual access)</option>
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Dates</FieldLabel>
                  <SelectInput
                    value={grantDurationMode}
                    onChange={(event) =>
                      setGrantDurationMode(event.target.value === 'custom' ? 'custom' : 'plan')
                    }
                  >
                    <option value="plan">Use standard plan duration</option>
                    <option value="custom">Custom start + end</option>
                  </SelectInput>
                </div>
              </div>

              {grantDurationMode === 'custom' && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel>Custom Start</FieldLabel>
                    <TextInput
                      type="datetime-local"
                      value={grantCustomStartsAt}
                      onChange={(event) => setGrantCustomStartsAt(event.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Custom End</FieldLabel>
                    <TextInput
                      type="datetime-local"
                      value={grantCustomExpiresAt}
                      onChange={(event) => setGrantCustomExpiresAt(event.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="mt-4">
                <FieldLabel>Admin Note / Reason</FieldLabel>
                <TextArea
                  value={grantNote}
                  onChange={(event) => setGrantNote(event.target.value)}
                  rows={4}
                  placeholder="Explain why this manual access is being granted."
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!selectedUser || actionBusy}
                  onClick={() =>
                    openConfirm({
                      title: 'Apply manual access',
                      message:
                        grantMode === 'replace'
                          ? 'This will immediately replace the current access source and may cancel the user’s active paid entitlement.'
                          : 'This will immediately write a manual access record for the selected user.',
                      confirmLabel: 'Apply Access',
                      payload: {
                        actionType: grantMode,
                        userId: selectedUser?.id,
                        planType: grantPlanType,
                        accessType: grantAccessType,
                        durationMode: grantDurationMode,
                        customStartsAt: normalizeDateTimeLocal(grantCustomStartsAt),
                        customExpiresAt: normalizeDateTimeLocal(grantCustomExpiresAt),
                        note: grantNote,
                      },
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.2em] text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ShieldCheck size={15} />
                  Apply Manual Access
                </button>
              </div>
            </Card>

            <div className="space-y-5">
              <Card
                title="Extend Access"
                description="Add more time to the current access window, or set a new exact expiry date."
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                  <div>
                    <FieldLabel>Extension Mode</FieldLabel>
                    <SelectInput
                      value={extendUnit}
                      onChange={(event) =>
                        setExtendUnit(event.target.value as 'days' | 'weeks' | 'months' | 'exact')
                      }
                    >
                      <option value="days">Add days</option>
                      <option value="weeks">Add weeks</option>
                      <option value="months">Add months</option>
                      <option value="exact">Set exact expiry</option>
                    </SelectInput>
                  </div>
                  {extendUnit === 'exact' ? (
                    <div>
                      <FieldLabel>Exact Expiry</FieldLabel>
                      <TextInput
                        type="datetime-local"
                        value={extendExactExpiresAt}
                        onChange={(event) => setExtendExactExpiresAt(event.target.value)}
                      />
                    </div>
                  ) : (
                    <div>
                      <FieldLabel>Amount</FieldLabel>
                      <TextInput
                        type="number"
                        min={1}
                        value={extendAmount}
                        onChange={(event) => setExtendAmount(event.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <FieldLabel>Admin Note / Reason</FieldLabel>
                  <TextArea
                    value={extendNote}
                    onChange={(event) => setExtendNote(event.target.value)}
                    rows={3}
                    placeholder="Explain why this access is being extended."
                  />
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    disabled={!selectedUser || actionBusy}
                    onClick={() =>
                      openConfirm({
                        title: 'Extend access',
                        message:
                          'This will extend the user’s current access window, or create a scheduled manual extension if the paid plan is still active.',
                        confirmLabel: 'Extend Access',
                        payload: {
                          actionType: 'extend',
                          userId: selectedUser?.id,
                          extensionUnit: extendUnit === 'exact' ? undefined : extendUnit,
                          extensionAmount: extendUnit === 'exact' ? undefined : Number(extendAmount),
                          exactExpiresAt:
                            extendUnit === 'exact'
                              ? normalizeDateTimeLocal(extendExactExpiresAt)
                              : '',
                          note: extendNote,
                        },
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-xs font-black uppercase tracking-[0.2em] text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Clock3 size={15} />
                    Extend Access
                  </button>
                </div>
              </Card>

              <Card
                title="Quick Actions"
                description="Use destructive actions carefully. These write audit logs and affect live entitlement checks immediately."
              >
                <div className="space-y-4">
                  <div>
                    <FieldLabel>Reason For Destructive Action</FieldLabel>
                    <TextArea
                      value={actionNote}
                      onChange={(event) => setActionNote(event.target.value)}
                      rows={3}
                      placeholder="Required for revoke, clear override, or cancel auto-renew."
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={!selectedUser || actionBusy}
                      onClick={() =>
                        openConfirm({
                          title: 'Revoke premium access now',
                          message:
                            'This will revoke manual access, cancel any active paid subscription immediately, and downgrade the user to free access.',
                          confirmLabel: 'Revoke Access',
                          danger: true,
                          payload: {
                            actionType: 'revoke',
                            userId: selectedUser?.id,
                            note: actionNote,
                          },
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-full border border-red-500/25 bg-red-500/10 px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ShieldAlert size={15} />
                      Revoke Access Now
                    </button>
                    <button
                      type="button"
                      disabled={!selectedUser || actionBusy}
                      onClick={() =>
                        openConfirm({
                          title: 'Disable auto-renew',
                          message:
                            'This will stop future paid renewals and let the user keep access only until the current paid entitlement expires.',
                          confirmLabel: 'Disable Renewal',
                          payload: {
                            actionType: 'cancel_auto_renew',
                            userId: selectedUser?.id,
                            note: actionNote,
                          },
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-white/78 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CreditCard size={15} />
                      End At Expiry
                    </button>
                    <button
                      type="button"
                      disabled={!selectedUser || actionBusy}
                      onClick={() =>
                        openConfirm({
                          title: 'Clear manual override',
                          message:
                            'This only removes the manual override. If the user still has a valid paid plan underneath, that paid access will become active again.',
                          confirmLabel: 'Clear Override',
                          danger: true,
                          payload: {
                            actionType: 'clear_override',
                            userId: selectedUser?.id,
                            note: actionNote,
                          },
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-white/78 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X size={15} />
                      Clear Manual Override
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <Card
            title="Recent Override Activity"
            description="Audit trail of the latest manual subscription actions and who performed them."
          >
            {payload.recentActivity.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/60">
                No manual subscription activity has been recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                    <tr>
                      <th className="px-3 py-3">Action</th>
                      <th className="px-3 py-3">Target User</th>
                      <th className="px-3 py-3">Plan</th>
                      <th className="px-3 py-3">Admin</th>
                      <th className="px-3 py-3">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.recentActivity.map((entry) => (
                      <tr key={entry.id} className="border-t border-white/10">
                        <td className="px-3 py-4">
                          <div className="font-semibold capitalize text-white">
                            {entry.actionType.replace(/_/g, ' ')}
                          </div>
                          <div className="mt-1 text-xs text-white/50">{entry.note || '-'}</div>
                        </td>
                        <td className="px-3 py-4 text-white/75">
                          <div className="font-semibold text-white">{entry.targetUserName || entry.targetUserEmail}</div>
                          <div className="mt-1 text-xs text-white/50">{entry.targetUserEmail || entry.targetUserId}</div>
                        </td>
                        <td className="px-3 py-4 text-white/75">{entry.planName || '-'}</td>
                        <td className="px-3 py-4 text-white/75">{entry.adminEmail || entry.adminName}</td>
                        <td className="px-3 py-4 text-white/75">{formatDate(entry.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      {confirmState && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/72 px-4">
          <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#11141C] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/42">
                  Confirm Admin Action
                </div>
                <h3 className="mt-2 text-xl font-black text-white">{confirmState.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/70"
              >
                <X size={18} />
              </button>
            </div>

            <p className="mt-4 text-sm leading-7 text-white/68">{confirmState.message}</p>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-white/75"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void executeAction(confirmState.payload)}
                className={`rounded-full px-4 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  confirmState.danger ? 'bg-[#D90429]' : 'bg-white/10'
                }`}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
