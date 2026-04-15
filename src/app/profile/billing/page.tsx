'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronRight, CreditCard, ShieldCheck, Wallet } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import {
  BILLING_OPERATOR_LABEL,
  CARD_PAYMENT_TRUST_MESSAGE,
} from '@/lib/billingIdentity';
import type {
  CardPaymentGateway,
  SubscriptionEntitlement,
  SubscriptionPlanDefinition,
  UserPaymentHistoryEntry,
} from '@/types/subscriptions';

type BillingPayload = {
  plans: SubscriptionPlanDefinition[];
  providers: Array<{ id: string; label: string; country?: string }>;
  cardGateway: CardPaymentGateway;
  entitlement: SubscriptionEntitlement;
  payments: UserPaymentHistoryEntry[];
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

function formatMoney(currency: 'UGX' | 'ZAR', amount: number) {
  if (currency === 'ZAR') {
    return `ZAR ${amount.toFixed(2)}`;
  }

  return `UGX ${amount.toLocaleString()}`;
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

export default function BillingPage() {
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<BillingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const safeReturnTo = useMemo(() => {
    const value = searchParams.get('returnTo') || '';
    return value.startsWith('/') && !value.startsWith('//') ? value : '';
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;

    const loadBilling = async () => {
      try {
        const response = await fetch('/api/subscriptions/me', {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as BillingPayload & { error?: string };

        if (!mounted) {
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || 'Subscription details could not be loaded.');
        }

        setPayload(data);
      } catch (loadError) {
        if (mounted) {
          setError(
            loadError instanceof Error ? loadError.message : 'Subscription details could not be loaded.'
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadBilling();

    return () => {
      mounted = false;
    };
  }, []);

  const getSubscribeHref = (planType?: string) => {
    const params = new URLSearchParams();

    if (planType) {
      params.set('plan', planType);
    }

    if (safeReturnTo) {
      params.set('returnTo', safeReturnTo);
    }

    const query = params.toString();
    return query ? `/subscribe?${query}` : '/subscribe';
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B0C10]">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#1F2833] border-t-[#D90429]" />
      </div>
    );
  }

  const entitlement = payload?.entitlement || EMPTY_ENTITLEMENT;
  const plans = payload?.plans || [];
  const providers = payload?.providers || [];
  const payments = payload?.payments || [];
  const cardGateway = payload?.cardGateway;
  const primaryPlanType = plans[0]?.type || '';

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-16 text-white md:px-8 md:pb-16 md:pt-[118px] lg:px-10">
      <MobilePageHeader
        title="Plans"
        fallbackHref="/profile"
        actionHref={getSubscribeHref(primaryPlanType)}
        actionLabel="Upgrade"
      />

      <div className="mx-auto max-w-5xl">
        <div className="hidden items-center justify-between md:flex">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
              Billing
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">
              Subscription & Plans
            </h1>
          </div>
          <Link
            href={getSubscribeHref(primaryPlanType)}
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
                      ? 'Your subscription is active and premium playback is available right now.'
                      : 'Your account is currently on free access until you activate a premium plan.'}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.24em] ${
                    entitlement.subscription.isActive
                      ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                      : 'border border-white/10 bg-white/5 text-white/65'
                  }`}
                >
                  {entitlement.subscription.isActive ? 'Premium Active' : 'Free'}
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5">
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/42">
                    Starts
                  </div>
                  <div className="mt-1.5 text-base font-semibold text-white">
                    {formatDate(entitlement.subscription.startsAt)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5">
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/42">
                    Expires
                  </div>
                  <div className="mt-1.5 text-base font-semibold text-white">
                    {formatDate(entitlement.subscription.expiresAt)}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-[15px] leading-7 text-white/72">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 shrink-0 text-emerald-300" size={18} />
                  <div>
                    <div className="font-semibold text-white">Trusted billing</div>
                    <div className="mt-1">{CARD_PAYMENT_TRUST_MESSAGE}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/75 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                    Available Plans
                  </div>
                  <p className="mt-3 text-[15px] leading-7 text-white/62">
                    Select any plan below and we will open checkout with that plan already selected.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {plans.map((plan) => (
                  <Link
                    key={plan.type}
                    href={getSubscribeHref(plan.type)}
                    className="block rounded-[24px] border border-white/10 bg-white/5 p-4 transition-colors hover:border-[#D90429]/40 hover:bg-[#D90429]/10"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/42">
                          {plan.type}
                        </div>
                        <div className="mt-2 text-xl font-black text-white">{plan.name}</div>
                      </div>
                      <ChevronRight className="shrink-0 text-[#FFB3C1]" size={18} />
                    </div>
                    <div className="mt-3 text-2xl font-black text-[#D90429]">
                      {formatMoney(plan.currency, plan.amount)}
                    </div>
                    <p className="mt-3 text-[15px] leading-7 text-white/62">{plan.description}</p>
                    {cardGateway?.enabled && cardGateway.planPrices[plan.type] ? (
                      <div className="mt-3 text-sm font-semibold text-white/70">
                        Card via PayFast: {formatMoney('ZAR', cardGateway.planPrices[plan.type] || 0)}
                      </div>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/70 p-5 shadow-[0_16px_34px_rgba(0,0,0,0.24)]">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                Payment History
              </div>

              {payments.length ? (
                <div className="mt-4 overflow-x-auto">
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
                          <td className="px-3 py-3">
                            {payment.daysLeft === null ? '-' : payment.daysLeft}
                          </td>
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
              ) : (
                <div className="mt-4 rounded-2xl border border-white/8 bg-white/5 p-4 text-[15px] leading-7 text-white/62">
                  No payment history is available on this account yet.
                </div>
              )}
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/70 p-5 shadow-[0_16px_34px_rgba(0,0,0,0.24)]">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                Payment Providers
              </div>

              {providers.length || cardGateway?.enabled ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {providers.map((provider) => (
                    <div
                      key={provider.id}
                      className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-[#161B26] text-[#D90429]">
                        <Wallet size={18} />
                      </div>
                      <div>
                        <div className="text-base font-semibold text-white">{provider.label}</div>
                        <div className="mt-1 text-sm text-white/52">
                          {provider.country ? `Country: ${provider.country}` : 'Configured for checkout'}
                        </div>
                      </div>
                    </div>
                  ))}
                  {cardGateway?.enabled ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-[#161B26] text-[#D90429]">
                        <CreditCard size={18} />
                      </div>
                      <div>
                        <div className="text-base font-semibold text-white">Card / PayFast</div>
                        <div className="mt-1 text-sm text-white/52">
                          {BILLING_OPERATOR_LABEL}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-[15px] leading-7 text-amber-100">
                  No live payment providers are available in this environment right now.
                </div>
              )}
            </section>

            <Link
              href={getSubscribeHref(primaryPlanType)}
              className="flex items-center justify-between rounded-[28px] border border-[#D90429]/25 bg-[#D90429]/10 px-5 py-5 transition-colors hover:bg-[#D90429]/14"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#D90429]/20 bg-[#D90429]/15 text-[#FFB3C1]">
                  <CreditCard size={20} />
                </div>
                <div>
                  <div className="text-base font-semibold text-white">Open checkout</div>
                  <div className="mt-1 text-sm text-white/58">
                    Go straight into the live subscription checkout flow.
                  </div>
                </div>
              </div>
              <ChevronRight className="text-[#FFB3C1]" size={18} />
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
