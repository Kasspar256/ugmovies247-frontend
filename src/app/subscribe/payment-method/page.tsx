'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CreditCard, Wallet } from 'lucide-react';
import SubscribeFlowNotices from '@/components/subscribe/SubscribeFlowNotices';
import SubscribePlanSummaryCard from '@/components/subscribe/SubscribePlanSummaryCard';
import SubscribeStepShell from '@/components/subscribe/SubscribeStepShell';
import { useSubscribeFlow } from '@/components/subscribe/SubscribeFlowProvider';

export default function SubscribePaymentMethodPage() {
  const router = useRouter();
  const {
    loadError,
    error,
    message,
    activePayment,
    clearFeedback,
    selectedPlanDefinition,
    paymentMethod,
    setPaymentMethod,
    cardAvailable,
    selectedPlanHasCardPricing,
    sortedProviders,
    submitting,
  } = useSubscribeFlow();

  useEffect(() => {
    if (!selectedPlanDefinition) {
      router.replace('/subscribe');
    }
  }, [router, selectedPlanDefinition]);

  if (!selectedPlanDefinition) {
    return null;
  }

  const handleProceed = () => {
    if (paymentMethod === 'mobile_money') {
      router.push('/subscribe/mobile-money');
      return;
    }

    if (paymentMethod === 'card') {
      router.push('/subscribe/card');
    }
  };

  return (
    <SubscribeStepShell
      title="Payment Method"
      backHref="/subscribe"
      actionHref="/subscribe"
      actionLabel="Change plan"
      maxWidthClassName="max-w-4xl"
    >
      <div className="space-y-6">
        <section className="rounded-[30px] border border-white/10 bg-[#11141C]/84 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.28)] md:p-6">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
            Payment step
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] text-white">
            Choose your payment method
          </h1>
          <p className="mt-3 text-sm leading-7 text-white/62">
            Choose how you&apos;d like to pay for this plan.
          </p>
        </section>

        {loadError ? (
          <div className="rounded-[24px] border border-red-500/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
            {loadError}
          </div>
        ) : null}

        <SubscribeFlowNotices error={error} message={message} activePayment={activePayment} />

        <SubscribePlanSummaryCard plan={selectedPlanDefinition} eyebrow="Selected plan" />

        <section className="rounded-[30px] border border-white/10 bg-[#11141C]/82 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.28)] md:p-6">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
            Payment options
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                clearFeedback();
                setPaymentMethod('mobile_money');
              }}
              disabled={!sortedProviders.length || submitting}
              className={`rounded-[24px] border px-4 py-5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                paymentMethod === 'mobile_money'
                  ? 'border-[#D90429] bg-[#D90429]/10'
                  : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-[#FFB3C1]">
                  <Wallet size={20} />
                </div>
                <div>
                  <div className="text-base font-black text-white">Mobile Money</div>
                  <div className="mt-1 text-sm leading-6 text-white/58">
                    Pay with Airtel Money or MTN Mobile Money on your phone.
                  </div>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                clearFeedback();
                setPaymentMethod('card');
              }}
              disabled={!cardAvailable || !selectedPlanHasCardPricing || submitting}
              className={`rounded-[24px] border px-4 py-5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                paymentMethod === 'card'
                  ? 'border-[#D90429] bg-[#D90429]/10'
                  : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-[#FFB3C1]">
                  <CreditCard size={20} />
                </div>
                <div>
                  <div className="text-base font-black text-white">Card</div>
                  <div className="mt-1 text-sm leading-6 text-white/58">
                    {selectedPlanHasCardPricing
                      ? 'Secure hosted checkout with a clean confirmation step before payment.'
                      : 'Card pricing is not available for this plan yet. Choose Mobile Money or another plan.'}
                  </div>
                </div>
              </div>
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={handleProceed}
              disabled={!paymentMethod || submitting}
              className="inline-flex items-center justify-center gap-2 rounded-[22px] bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.24em] text-white transition-colors disabled:cursor-not-allowed disabled:bg-[#5E1623] sm:min-w-[220px]"
            >
              Proceed
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </div>
    </SubscribeStepShell>
  );
}
