'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import SubscribeFlowNotices from '@/components/subscribe/SubscribeFlowNotices';
import SubscribeStepShell from '@/components/subscribe/SubscribeStepShell';
import { useSubscribeFlow } from '@/components/subscribe/SubscribeFlowProvider';
import {
  formatDate,
  formatMoney,
  getPlanDurationLabel,
} from '@/components/subscribe/subscribeFlowUtils';

export default function SubscribePlanPage() {
  const router = useRouter();
  const [proceeding, setProceeding] = useState(false);
  const proceedSectionRef = useRef<HTMLDivElement | null>(null);
  const {
    loadError,
    error,
    message,
    activePayment,
    cancelActivePayment,
    clearFeedback,
    plans,
    entitlement,
    selectedPlan,
    setSelectedPlan,
    selectedPlanDefinition,
    hasActiveSubscription,
    safeReturnTo,
  } = useSubscribeFlow();
  const backHref = safeReturnTo || '/profile';

  const scrollToProceedSection = () => {
    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      proceedSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  };

  const handleProceed = () => {
    if (!selectedPlanDefinition) {
      return;
    }

    setProceeding(true);
    router.push('/subscribe/payment-method');
  };

  return (
    <SubscribeStepShell
      title="Premium Access"
      backHref={backHref}
      returnTo={safeReturnTo}
    >
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(217,4,41,0.18),_transparent_42%),linear-gradient(180deg,_rgba(17,20,28,0.95),_rgba(11,12,16,0.98))] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.38)] md:p-7">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-[#FFB3C1]">
              <Sparkles size={14} />
              Premium
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-[-0.05em] text-white md:text-4xl">
              {hasActiveSubscription ? 'Manage your premium access' : 'Choose your premium plan'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/68 md:text-[15px]">
              {hasActiveSubscription
                ? 'Keep your access going, switch plans when needed, and finish checkout in a few quick taps.'
                : 'Choose a plan below and finish checkout in a few quick taps.'}
            </p>
          </div>
        </section>

        {loadError ? (
          <div className="rounded-[24px] border border-red-500/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
            {loadError}
          </div>
        ) : null}

        <SubscribeFlowNotices error={error} message={message} activePayment={activePayment} onCancelPayment={cancelActivePayment} />

        {hasActiveSubscription ? (
          <section className="rounded-[30px] border border-white/10 bg-[#11141C]/84 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.28)] md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                  Current Subscription
                </div>
                <h2 className="mt-3 text-2xl font-black tracking-[-0.04em] text-white">
                  {entitlement.subscription.planName || 'Premium Access'}
                </h2>
                <p className="mt-3 text-sm leading-7 text-white/62">
                  Your premium access is active. You can extend this plan or switch to another one whenever you need to.
                </p>
              </div>

              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.24em] text-emerald-200">
                {entitlement.subscription.isActive ? 'Premium Active' : entitlement.subscription.status}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/42">
                  Current Plan
                </div>
                <div className="mt-2 text-sm font-bold text-white">
                  {entitlement.subscription.planName || 'No active plan'}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/42">
                  Started
                </div>
                <div className="mt-2 text-sm font-bold text-white">
                  {formatDate(entitlement.subscription.startsAt)}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/42">
                  Expires
                </div>
                <div className="mt-2 text-sm font-bold text-white">
                  {formatDate(entitlement.subscription.expiresAt)}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-[30px] border border-white/10 bg-[#11141C]/82 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.28)] md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                Choose your next plan
              </div>
            </div>
          </div>

          {plans.length ? (
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {plans.map((plan) => {
                const isSelected = selectedPlan === plan.type;
                const isCurrent = entitlement.subscription.planType === plan.type && hasActiveSubscription;

                return (
                  <button
                    key={plan.type}
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setSelectedPlan(plan.type);
                      scrollToProceedSection();
                    }}
                    className={`rounded-[22px] border px-3 py-3 text-left transition-all active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D90429]/70 ${
                      isSelected
                        ? 'border-[#D90429] bg-[#D90429]/10 shadow-[0_16px_36px_rgba(217,4,41,0.14)]'
                        : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/42">
                          {plan.type}
                        </div>
                        <div className="mt-1 text-base font-black text-white">{plan.name}</div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        {isCurrent ? (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                            Current
                          </span>
                        ) : null}
                        <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/62">
                          {getPlanDurationLabel(plan)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2.5 text-xl font-black tracking-[-0.04em] text-[#D90429]">
                      {formatMoney(plan.currency, plan.amount)}
                    </div>
                    <p className="mt-1 text-[13px] leading-5 text-white/60">{plan.description}</p>

                    {isSelected ? (
                      <div className="mt-2.5 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#FFB3C1]">
                        <CheckCircle2 size={14} />
                        Selected
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/62">
              No plans are available right now.
            </div>
          )}

          <div
            ref={proceedSectionRef}
            className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <button
              type="button"
              onClick={handleProceed}
              disabled={!selectedPlanDefinition || proceeding}
              className="inline-flex items-center justify-center gap-2 rounded-[22px] bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.24em] text-white transition-all hover:bg-[#F0062F] active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-[#5E1623] disabled:opacity-70 sm:min-w-[220px]"
            >
              {proceeding ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {proceeding ? 'Opening Payment...' : 'Proceed'}
            </button>
          </div>
        </section>
      </div>
    </SubscribeStepShell>
  );
}
