'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, LockKeyhole, Smartphone } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { clearPublicMovieCache, fetchPublicMovies } from '@/lib/publicMovies';
import type {
  PaymentMethodProvider,
  PaymentMethodProviderOption,
  SubscriptionEntitlement,
  SubscriptionPlanDefinition,
} from '@/types/subscriptions';

type SubscriptionResponse = {
  plans: SubscriptionPlanDefinition[];
  providers: PaymentMethodProviderOption[];
  entitlement: SubscriptionEntitlement;
};

type PaymentState = {
  id: string;
  status: string;
  providerStatus: string;
  providerMessage: string;
};

const DEFAULT_ENTITLEMENT: SubscriptionEntitlement = {
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

async function refreshUnlockedCatalog() {
  clearPublicMovieCache();

  try {
    await fetchPublicMovies({ force: true, refreshEntitlement: true });
  } catch (error) {
    console.warn('[subscribe] failed to refresh public movie catalog after subscription change', error);
  }
}

function getSafeReturnTo(value?: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '';
}

export default function SubscribePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<SubscriptionPlanDefinition[]>([]);
  const [entitlement, setEntitlement] = useState<SubscriptionEntitlement>(DEFAULT_ENTITLEMENT);
  const [selectedPlan, setSelectedPlan] = useState('daily');
  const [providers, setProviders] = useState<PaymentMethodProviderOption[]>([]);
  const [provider, setProvider] = useState<PaymentMethodProvider>('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activePayment, setActivePayment] = useState<PaymentState | null>(null);
  const [showUpgradeSuccess, setShowUpgradeSuccess] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const safeReturnTo = getSafeReturnTo(searchParams.get('returnTo'));
  const billingHref = safeReturnTo
    ? `/profile/billing?returnTo=${encodeURIComponent(safeReturnTo)}`
    : '/profile/billing';

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const response = await fetch('/api/subscriptions/me', {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = (await response.json()) as SubscriptionResponse;

        if (!mounted) {
          return;
        }

        if (!response.ok) {
          throw new Error((payload as unknown as { error?: string }).error || 'Failed to load subscription plans.');
        }

        setPlans(payload.plans || []);
        setProviders(payload.providers || []);
        setProvider(payload.providers?.[0]?.id || '');
        setEntitlement(payload.entitlement || DEFAULT_ENTITLEMENT);

        if (payload.entitlement) {
          void refreshUnlockedCatalog();
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load subscription plans.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activePayment || ['completed', 'failed', 'cancelled', 'not_found'].includes(activePayment.status)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/subscriptions/payments/${activePayment.id}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await response.json();

        if (!response.ok) {
          return;
        }

        const payment = payload.payment;

        if (!payment) {
          return;
        }

        setActivePayment({
          id: activePayment.id,
          status: payment.status || activePayment.status,
          providerStatus: payment.providerStatus || activePayment.providerStatus,
          providerMessage: payment.providerMessage || activePayment.providerMessage,
        });

        if (payment.status === 'completed') {
          setMessage('Payment confirmed. Your subscription is now active. Redirecting you to home...');
          setError('');
          const subscriptionResponse = await fetch('/api/subscriptions/me', {
            credentials: 'include',
            cache: 'no-store',
          });
          const subscriptionPayload = (await subscriptionResponse.json()) as SubscriptionResponse;

          if (subscriptionResponse.ok) {
            const nextEntitlement = subscriptionPayload.entitlement || DEFAULT_ENTITLEMENT;
            setEntitlement(nextEntitlement);
            await refreshUnlockedCatalog();
            setShowUpgradeSuccess(true);
            setRedirectCountdown(4);
          }
        } else if (payment.status === 'failed' || payment.status === 'cancelled') {
          setError(payment.providerMessage || 'Payment was not completed.');
          setMessage('');
        }
      } catch {
        return;
      }
    }, 8000);

    return () => clearInterval(interval);
  }, [activePayment]);

  useEffect(() => {
    if (!showUpgradeSuccess) {
      return;
    }

    const countdownInterval = window.setInterval(() => {
      setRedirectCountdown((current) => {
        if (current === null) {
          return current;
        }

        return current > 1 ? current - 1 : 1;
      });
    }, 1000);

    const redirectTimer = window.setTimeout(() => {
      router.replace('/');
    }, 4000);

    return () => {
      window.clearInterval(countdownInterval);
      window.clearTimeout(redirectTimer);
    };
  }, [router, showUpgradeSuccess]);

  const selectedPlanDefinition = useMemo(
    () => plans.find((plan) => plan.type === selectedPlan) || null,
    [plans, selectedPlan]
  );

  const handleCheckout = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');
    setShowUpgradeSuccess(false);
    setRedirectCountdown(null);

    try {
      const response = await fetch('/api/subscriptions/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          planType: selectedPlan,
          provider,
          phoneNumber,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || 'Failed to start payment.');
      }

      setActivePayment({
        id: payload.paymentId,
        status: payload.status || 'initiated',
        providerStatus: payload.providerStatus || 'ACCEPTED',
        providerMessage: payload.message || '',
      });
      setMessage(payload.message || 'Payment request sent. Approve it on your phone.');
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Failed to start payment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-16 md:px-8 md:pt-[118px] lg:px-10">
      {showUpgradeSuccess && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#0B0C10]/88 px-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-[28px] border border-emerald-500/20 bg-[#11141C] p-6 text-center shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
              <CheckCircle2 size={32} />
            </div>
            <div className="mt-5 text-[11px] font-black uppercase tracking-[0.3em] text-emerald-300">
              Plan Upgraded
            </div>
            <h2 className="mt-3 text-3xl font-black uppercase tracking-[0.12em] text-white">
              Premium Unlocked
            </h2>
            <p className="mt-4 text-sm leading-6 text-white/70">
              Your payment has been approved and your account now has premium access. We are taking you to the home page so you can start watching right away.
            </p>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.22em] text-white/70">
              Redirecting in {redirectCountdown ?? 4}s
            </div>
            <button
              type="button"
              onClick={() => router.replace('/')}
              className="mt-5 w-full rounded-2xl bg-[#D90429] px-4 py-4 text-sm font-black uppercase tracking-[0.28em] text-white"
            >
              Go Home Now
            </button>
            {safeReturnTo && (
              <Link
                href={safeReturnTo}
                className="mt-3 block text-xs font-black uppercase tracking-[0.22em] text-emerald-200/80"
              >
                Return To Your Movie Instead
              </Link>
            )}
          </div>
        </div>
      )}

      <MobilePageHeader
        title="Unlock Premium"
        fallbackHref="/profile/billing"
        returnTo={safeReturnTo}
        actionHref={billingHref}
        actionLabel="Billing"
      />

      <div className="mx-auto max-w-6xl">
        <div className="hidden items-center justify-between gap-3 md:flex">
          <Link
            href={billingHref}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white"
          >
            Back
          </Link>
          <Link
            href={billingHref}
            className="rounded-full border border-[#D90429]/30 bg-[#D90429]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-[#FFB3C1]"
          >
            Billing Status
          </Link>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/10 bg-[#11141C]/80 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#D90429]/30 bg-[#D90429]/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-[#FFB3C1]">
              <LockKeyhole size={14} />
              Premium Access
            </div>

            <h1 className="mt-5 text-3xl font-black uppercase tracking-[0.12em] text-white">
              Unlock Premium Movies
            </h1>
            <p className="mt-3 text-sm leading-6 text-white/70">
              Pay with Ugandan Mobile Money using PawaPay. Access is granted only after confirmed payment, and it expires automatically when the plan window ends.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {plans.map((plan) => (
                <button
                  key={plan.type}
                  onClick={() => setSelectedPlan(plan.type)}
                  className={`rounded-2xl border p-5 text-left transition-colors ${
                    selectedPlan === plan.type
                      ? 'border-[#D90429] bg-[#D90429]/10'
                      : 'border-white/10 bg-white/5 hover:border-white/30'
                  }`}
                >
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/50">
                    {plan.type}
                  </div>
                  <div className="mt-2 text-xl font-black text-white">{plan.name}</div>
                  <div className="mt-2 text-2xl font-black text-[#D90429]">
                    UGX {plan.amount.toLocaleString()}
                  </div>
                  <p className="mt-3 text-sm text-white/65">{plan.description}</p>
                </button>
              ))}
            </div>

            <form onSubmit={handleCheckout} className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-white/60">
                  Mobile Money Provider
                </label>
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as PaymentMethodProvider)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-white outline-none"
                >
                  {providers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
              {!providers.length && (
                <p className="mt-2 text-xs text-amber-200">
                  No Mobile Money providers are configured for this environment yet. Add <span className="font-bold">PAWAPAY_ALLOWED_PROVIDERS</span>.
                </p>
              )}

              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-white/60">
                  Phone Number
                </label>
                <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4">
                  <Smartphone size={18} className="text-white/45" />
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="0771234567"
                    className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
                  />
                </div>
                <p className="mt-2 text-xs text-white/45">
                  Use a Ugandan number like <span className="font-bold text-white/70">0771234567</span> or <span className="font-bold text-white/70">+256771234567</span>.
                </p>
              </div>

              {error && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              )}

              {message && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  {message}
                </div>
              )}

              {safeReturnTo && entitlement.subscription.isActive && (
                <Link
                  href={safeReturnTo}
                  className="flex w-full items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-black uppercase tracking-[0.22em] text-emerald-100"
                >
                  Continue Watching
                </Link>
              )}

              <button
                type="submit"
                disabled={submitting || !selectedPlanDefinition || !provider}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-4 py-4 text-sm font-black uppercase tracking-[0.28em] text-white disabled:cursor-not-allowed disabled:bg-[#5E1623]"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                {submitting ? 'Starting Payment...' : `Pay UGX ${selectedPlanDefinition?.amount.toLocaleString() || ''}`}
              </button>
            </form>
          </section>

          <aside className="rounded-3xl border border-white/10 bg-[#11141C]/80 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/45">
              Current Access
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm text-white/55">Status</div>
              <div className={`mt-2 text-2xl font-black uppercase ${entitlement.subscription.isActive ? 'text-emerald-300' : 'text-amber-200'}`}>
                {entitlement.subscription.isActive ? 'Active' : 'Locked'}
              </div>
              <div className="mt-4 space-y-2 text-sm text-white/70">
                <p>Plan: <span className="font-bold text-white">{entitlement.subscription.planName || 'No active plan'}</span></p>
                <p>Starts: <span className="font-bold text-white">{entitlement.subscription.startsAt ? new Date(entitlement.subscription.startsAt).toLocaleString() : '—'}</span></p>
                <p>Expires: <span className="font-bold text-white">{entitlement.subscription.expiresAt ? new Date(entitlement.subscription.expiresAt).toLocaleString() : '—'}</span></p>
              </div>
            </div>

            {activePayment && (
              <div className="mt-5 rounded-2xl border border-[#D90429]/20 bg-[#D90429]/10 p-5">
                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-[#FFB3C1]">
                  Latest Payment Attempt
                </div>
                <div className="mt-3 text-sm text-white/80">
                  <p>Status: <span className="font-bold uppercase text-white">{activePayment.status}</span></p>
                  <p className="mt-2">Provider: <span className="font-bold uppercase text-white">{activePayment.providerStatus || 'Awaiting update'}</span></p>
                  {activePayment.providerMessage && (
                    <p className="mt-3 text-white/70">{activePayment.providerMessage}</p>
                  )}
                </div>
              </div>
            )}

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-5 text-sm leading-6 text-white/65">
              If the Mobile Money confirmation takes a moment, keep this page open. The app polls your payment status and unlocks access once PawaPay confirms the deposit.
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
