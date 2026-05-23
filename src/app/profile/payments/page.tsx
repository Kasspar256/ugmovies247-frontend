'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, CreditCard, Loader2, ReceiptText } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import EmailVerificationWarning from '@/components/EmailVerificationWarning';
import { APP_REVIEW_HOME_PATH, isAppInReview } from '@/lib/appReview';
import type {
  RecurringAgreementSummary,
  SubscriptionEntitlement,
  UserPaymentHistoryEntry,
} from '@/types/subscriptions';

type PaymentsPayload = {
  entitlement: SubscriptionEntitlement;
  payments: UserPaymentHistoryEntry[];
  recurringAgreement?: RecurringAgreementSummary;
  emailVerified?: boolean;
};

const EMPTY_ENTITLEMENT: SubscriptionEntitlement = {
  hasPremiumAccess: false,
  requiresSubscription: true,
  subscription: {
    planType: null,
    planName: '',
    status: 'inactive',
    isActive: false,
    startsAt: '',
    expiresAt: '',
    paymentProvider: '',
    updatedAt: '',
  },
};

const EMPTY_RECURRING_AGREEMENT: RecurringAgreementSummary = {
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
  failedChargeAttempts: 0,
  firstFailedChargeAt: '',
};

function formatDate(value?: string, includeTime = true) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime
      ? {
          hour: 'numeric',
          minute: '2-digit',
        }
      : {}),
  }).format(date);
}

function formatStatusLabel(status: string) {
  return status.replace(/_/g, ' ').toUpperCase();
}

function getStatusTone(status: string) {
  if (status === 'completed') {
    return 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
  }

  if (status === 'pending' || status === 'initiated' || status === 'submitted' || status === 'created') {
    return 'border border-amber-500/20 bg-amber-500/10 text-amber-100';
  }

  return 'border border-red-500/20 bg-red-500/10 text-red-100';
}

export default function PaymentsPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<PaymentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [confirmingAutoRenewCancel, setConfirmingAutoRenewCancel] = useState(false);
  const [cancellingAutoRenew, setCancellingAutoRenew] = useState(false);

  useEffect(() => {
    if (isAppInReview) {
      router.replace(APP_REVIEW_HOME_PATH);
      return;
    }

    let mounted = true;

    const loadPayments = async () => {
      try {
        const response = await fetch('/api/subscriptions/me', {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as PaymentsPayload & { error?: string };

        if (!mounted) {
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || 'Payment history could not be loaded.');
        }

        setPayload({
          entitlement: data.entitlement || EMPTY_ENTITLEMENT,
          payments: data.payments || [],
          recurringAgreement: data.recurringAgreement || EMPTY_RECURRING_AGREEMENT,
          emailVerified: data.emailVerified === true,
        });
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Payment history could not be loaded.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadPayments();

    return () => {
      mounted = false;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B0C10]">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#1F2833] border-t-[#D90429]" />
      </div>
    );
  }

  const entitlement = payload?.entitlement || EMPTY_ENTITLEMENT;
  const payments = payload?.payments || [];
  const recurringAgreement = payload?.recurringAgreement || EMPTY_RECURRING_AGREEMENT;
  const canCancelAutoRenew =
    entitlement.subscription.isActive === true &&
    entitlement.subscription.paymentProvider === 'payfast' &&
    (recurringAgreement.autoRenewEnabled === true ||
      entitlement.subscription.autoRenewEnabled === true) &&
    recurringAgreement.status !== 'cancelled';

  const handleCancelAutoRenew = async () => {
    setCancellingAutoRenew(true);
    setActionError('');
    setActionMessage('');

    try {
      const response = await fetch('/api/subscriptions/auto-renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        recurringAgreement?: RecurringAgreementSummary;
      };

      if (!response.ok) {
        throw new Error(data.error || 'Auto-renew could not be cancelled.');
      }

      setPayload((current) => {
        const nextSubscription = {
          ...(current?.entitlement.subscription || EMPTY_ENTITLEMENT.subscription),
          autoRenewEnabled: false,
        };

        return {
          entitlement: {
            ...(current?.entitlement || EMPTY_ENTITLEMENT),
            subscription: nextSubscription,
          },
          payments: current?.payments || [],
          recurringAgreement: data.recurringAgreement || {
            ...EMPTY_RECURRING_AGREEMENT,
            status: 'cancelled',
          },
          emailVerified: current?.emailVerified,
        };
      });
      setConfirmingAutoRenewCancel(false);
      setActionMessage('Auto-renew has been cancelled. Your current access stays active until it expires.');
    } catch (cancelError) {
      setActionError(cancelError instanceof Error ? cancelError.message : 'Auto-renew could not be cancelled.');
    } finally {
      setCancellingAutoRenew(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-16 text-white md:px-8 md:pb-16 md:pt-[118px] lg:px-10">
      <MobilePageHeader title="Payments" fallbackHref="/profile" actionHref="/subscribe" actionLabel="Plans" />

      <div className="mx-auto max-w-5xl">
        <div className="hidden items-center justify-between md:flex">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
              Profile
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">
              Payment History
            </h1>
          </div>
          <Link
            href="/subscribe"
            className="inline-flex items-center gap-2 rounded-full border border-[#D90429]/25 bg-[#D90429]/10 px-4 py-2.5 text-sm font-black uppercase tracking-[0.2em] text-[#FFB3C1]"
          >
            View Plans
            <ChevronRight size={16} />
          </Link>
        </div>

        {error ? (
          <div className="mt-6 rounded-[24px] border border-red-500/20 bg-red-500/10 p-5 text-base text-red-100">
            {error}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <EmailVerificationWarning emailVerified={payload?.emailVerified === true} />
            {(actionMessage || actionError) ? (
              <div
                className={`rounded-[22px] border px-4 py-3 text-sm font-semibold leading-6 ${
                  actionError
                    ? 'border-red-500/20 bg-red-500/10 text-red-100'
                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                }`}
              >
                {actionError || actionMessage}
              </div>
            ) : null}

            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/82 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.32)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                    Current Access
                  </div>
                  <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] text-white">
                    {entitlement.subscription.planName || 'Free Access'}
                  </h2>
                  <p className="mt-3 text-[15px] leading-7 text-white/66">
                    {entitlement.subscription.isActive
                      ? 'Your premium access is active. Use Subscribe whenever you want to extend or switch plans.'
                      : 'No active premium plan on this account right now.'}
                  </p>
                </div>

                <div className="flex flex-col items-stretch gap-2 sm:items-end">
                  <Link
                    href="/subscribe"
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-white/82"
                  >
                    <CreditCard size={14} />
                    Manage Plans
                  </Link>
                  {canCancelAutoRenew ? (
                    confirmingAutoRenewCancel ? (
                      <div className="w-full rounded-[20px] border border-[#D90429]/25 bg-[#D90429]/10 p-3 sm:w-80">
                        <p className="text-xs font-semibold leading-5 text-rose-100/82">
                          Cancel future card renewals? You will keep access until this plan expires.
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmingAutoRenewCancel(false)}
                            disabled={cancellingAutoRenew}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                          >
                            Keep It
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCancelAutoRenew()}
                            disabled={cancellingAutoRenew}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#D90429] px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                          >
                            {cancellingAutoRenew ? <Loader2 size={13} className="animate-spin" /> : null}
                            Confirm
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActionError('');
                          setActionMessage('');
                          setConfirmingAutoRenewCancel(true);
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-[#D90429]/30 bg-[#D90429]/10 px-4 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-[#FFB3C1]"
                      >
                        Cancel Auto Renew
                      </button>
                    )
                  ) : null}
                </div>
              </div>
              {canCancelAutoRenew && recurringAgreement.nextChargeAt ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-white/62">
                  Next card renewal: <span className="font-bold text-white">{formatDate(recurringAgreement.nextChargeAt)}</span>
                </div>
              ) : null}
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/70 p-5 shadow-[0_16px_34px_rgba(0,0,0,0.24)]">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#FFB3C1]">
                  <ReceiptText size={18} />
                </div>
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                    Payments
                  </div>
                  <div className="mt-1 text-base font-semibold text-white">
                    Recent premium charges
                  </div>
                </div>
              </div>

              {payments.length ? (
                <>
                  <div className="mt-4 space-y-3 md:hidden">
                    {payments.map((payment) => (
                      <article
                        key={payment.id}
                        className="rounded-[22px] border border-white/8 bg-white/5 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-white">#{payment.id}</div>
                            <div className="mt-1 text-sm text-white/62">{payment.planName}</div>
                          </div>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getStatusTone(payment.status)}`}
                          >
                            {formatStatusLabel(payment.status)}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-white/68">
                          <div>Started: <span className="font-semibold text-white">{formatDate(payment.startsAt, false)}</span></div>
                          <div>Ends: <span className="font-semibold text-white">{formatDate(payment.expiresAt, false)}</span></div>
                          <div>Method: <span className="font-semibold text-white">{payment.paymentMethodLabel}</span></div>
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="mt-4 hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-left">
                      <thead>
                        <tr className="text-[11px] font-black uppercase tracking-[0.22em] text-white/42">
                          <th className="px-3 py-2">Order Id</th>
                          <th className="px-3 py-2">Start</th>
                          <th className="px-3 py-2">End</th>
                          <th className="px-3 py-2">Days Left</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Payment Method</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((payment) => (
                          <tr key={payment.id} className="rounded-2xl bg-white/5 text-sm text-white/78">
                            <td className="rounded-l-2xl px-3 py-3 font-semibold text-white">
                              <span className="break-all">#{payment.id}</span>
                            </td>
                            <td className="px-3 py-3">{formatDate(payment.startsAt, false)}</td>
                            <td className="px-3 py-3">{formatDate(payment.expiresAt, false)}</td>
                            <td className="px-3 py-3">{payment.daysLeft === null ? '-' : payment.daysLeft}</td>
                            <td className="px-3 py-3">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${getStatusTone(payment.status)}`}
                              >
                                {formatStatusLabel(payment.status)}
                              </span>
                            </td>
                            <td className="rounded-r-2xl px-3 py-3 font-semibold text-white">
                              <div>{payment.paymentMethodLabel.toUpperCase()}</div>
                              <div className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-white/45">
                                {payment.billedBy}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-2xl border border-white/8 bg-white/5 p-4 text-[15px] leading-7 text-white/62">
                  No payment history is available on this account yet.
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

