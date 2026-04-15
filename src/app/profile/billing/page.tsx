'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Clock3, CreditCard, ShieldCheck } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { clearPublicMovieCache, fetchPublicMovies } from '@/lib/publicMovies';
import type { SubscriptionEntitlement, SubscriptionPlanDefinition } from '@/types/subscriptions';

type BillingPayload = {
  plans: SubscriptionPlanDefinition[];
  entitlement: SubscriptionEntitlement;
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

async function refreshMovieAccessCatalog() {
  clearPublicMovieCache();

  try {
    await fetchPublicMovies({ force: true, refreshEntitlement: true });
  } catch (error) {
    console.warn('[billing] failed to refresh public movie catalog after entitlement check', error);
  }
}

function getSafeReturnTo(value?: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '';
}

export default function BillingPage() {
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<BillingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const safeReturnTo = getSafeReturnTo(searchParams.get('returnTo'));
  const subscribeHref = safeReturnTo
    ? `/subscribe?returnTo=${encodeURIComponent(safeReturnTo)}`
    : '/subscribe';

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const response = await fetch('/api/subscriptions/me', {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json()) as BillingPayload & { error?: string };

        if (!mounted) {
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load billing information.');
        }

        setPayload(data);
        void refreshMovieAccessCatalog();
      } catch (billingError) {
        if (mounted) {
          setError(billingError instanceof Error ? billingError.message : 'Failed to load billing information.');
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

  const entitlement = payload?.entitlement || EMPTY_ENTITLEMENT;
  const currentPlan = entitlement.subscription.planType
    ? payload?.plans.find((plan) => plan.type === entitlement.subscription.planType) || null
    : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-16 md:px-8 md:pt-[118px] lg:px-10">
      <MobilePageHeader
        title="Billing Status"
        fallbackHref="/profile"
        returnTo={safeReturnTo}
        actionHref={subscribeHref}
        actionLabel="Buy Plan"
      />

      <div className="mx-auto max-w-3xl">
        <div className="hidden items-center justify-between gap-3 md:flex">
          <Link
            href="/profile"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white"
          >
            Back
          </Link>
          <Link
            href={subscribeHref}
            className="rounded-full border border-[#D90429]/30 bg-[#D90429]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-[#FFB3C1]"
          >
            Buy Plan
          </Link>
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-[#11141C]/80 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/50">
                Subscription Status
              </div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.12em] text-white">
                {entitlement.subscription.isActive ? 'Premium Active' : 'Premium Locked'}
              </h1>
            </div>
            <div className={`rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] ${
              entitlement.subscription.isActive
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-200 border border-amber-500/20'
            }`}>
              {entitlement.subscription.isActive ? 'Active' : entitlement.subscription.status}
            </div>
          </div>

          {error && (
            <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-3 text-white">
                <CreditCard size={18} className="text-[#D90429]" />
                <span className="text-sm font-bold uppercase tracking-[0.2em]">Current Plan</span>
              </div>
              <div className="mt-4 text-2xl font-black text-white">
                {entitlement.subscription.planName || 'No active plan'}
              </div>
              {currentPlan && (
                <p className="mt-2 text-sm text-white/65">
                  UGX {currentPlan.amount.toLocaleString()} via Mobile Money
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-3 text-white">
                <Clock3 size={18} className="text-[#D90429]" />
                <span className="text-sm font-bold uppercase tracking-[0.2em]">Access Window</span>
              </div>
              <div className="mt-4 space-y-2 text-sm text-white/75">
                <p>Starts: <span className="font-bold text-white">{entitlement.subscription.startsAt ? new Date(entitlement.subscription.startsAt).toLocaleString() : '—'}</span></p>
                <p>Expires: <span className="font-bold text-white">{entitlement.subscription.expiresAt ? new Date(entitlement.subscription.expiresAt).toLocaleString() : '—'}</span></p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 text-emerald-400" size={20} />
              <p className="text-sm leading-6 text-white/65">
                Access is granted only after confirmed payment. If your plan expires, premium playback is locked again automatically until you renew.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
