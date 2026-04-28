'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import SubscribeFlowNotices from '@/components/subscribe/SubscribeFlowNotices';
import SubscribePlanSummaryCard from '@/components/subscribe/SubscribePlanSummaryCard';
import SubscribeStepShell from '@/components/subscribe/SubscribeStepShell';
import { useSubscribeFlow } from '@/components/subscribe/SubscribeFlowProvider';
import { BILLING_OPERATOR } from '@/lib/billingIdentity';

export default function SubscribeCardPage() {
  const router = useRouter();
  const {
    loadError,
    error,
    message,
    activePayment,
    selectedPlanDefinition,
    paymentMethod,
    cardAvailable,
    selectedPlanHasCardPricing,
    submitting,
    hasPendingCardUpdate,
    startCardCheckout,
  } = useSubscribeFlow();

  useEffect(() => {
    if (!selectedPlanDefinition) {
      router.replace('/subscribe');
      return;
    }

    if (paymentMethod !== 'card') {
      router.replace('/subscribe/payment-method');
    }
  }, [paymentMethod, router, selectedPlanDefinition]);

  if (!selectedPlanDefinition || paymentMethod !== 'card') {
    return null;
  }

  const handleProceed = async () => {
    await startCardCheckout();
  };

  return (
    <SubscribeStepShell
      title="Card Payment"
      backHref="/subscribe/payment-method"
      actionHref="/subscribe"
      actionLabel="Change plan"
      maxWidthClassName="max-w-4xl"
    >
      <div className="space-y-6">
        <section className="rounded-[30px] border border-white/10 bg-[#11141C]/84 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.28)] md:p-6">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
            Card payment
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] text-white">
            Confirm your secure card checkout
          </h1>
          <p className="mt-3 text-sm leading-7 text-white/62">
            Review your plan, continue to secure hosted checkout, and we&apos;ll activate premium access as soon as payment is confirmed.
          </p>
        </section>

        {loadError ? (
          <div className="rounded-[24px] border border-red-500/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
            {loadError}
          </div>
        ) : null}

        <SubscribeFlowNotices error={error} message={message} activePayment={activePayment} />

        <SubscribePlanSummaryCard plan={selectedPlanDefinition} eyebrow="Ready for card checkout" />

        <section className="rounded-[30px] border border-white/10 bg-[#11141C]/82 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.28)] md:p-6">
          <div className="rounded-[26px] border border-white/10 bg-white/5 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-[#FFB3C1]">
                <ShieldCheck size={20} />
              </div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                  Trusted & Secure Billing
                </div>
                <p className="mt-3 text-sm leading-7 text-white/66">
                  All premium payments are securely managed by {BILLING_OPERATOR}, our trusted billing partner. Payments are processed through PayFast&apos;s secure checkout, keeping your card details fully protected. Once payment is completed, your premium access is activated instantly and continues without interruption.
                </p>
              </div>
            </div>
          </div>

          {!cardAvailable ? (
            <div className="mt-5 rounded-[22px] border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
              Card checkout is temporarily unavailable in this environment.
            </div>
          ) : null}

          {cardAvailable && !selectedPlanHasCardPricing ? (
            <div className="mt-5 rounded-[22px] border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
              Card pricing is not available for this plan yet. Choose Mobile Money or switch to another plan.
            </div>
          ) : null}

          {hasPendingCardUpdate ? (
            <div className="mt-5 rounded-[22px] border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
              An earlier card update did not finish. Continue and we&apos;ll replace it with a fresh secure checkout for this plan.
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={handleProceed}
              disabled={!cardAvailable || !selectedPlanHasCardPricing || submitting}
              className="inline-flex items-center justify-center gap-2 rounded-[22px] bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.24em] text-white transition-all hover:bg-[#F0062F] active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-[#5E1623] disabled:opacity-70 sm:min-w-[260px]"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <CreditCard size={18} />}
              {submitting ? 'Preparing Checkout...' : 'Proceed to Card Payment'}
            </button>
          </div>
        </section>
      </div>
    </SubscribeStepShell>
  );
}
