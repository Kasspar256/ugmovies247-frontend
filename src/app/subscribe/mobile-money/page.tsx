'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Smartphone, Wallet } from 'lucide-react';
import SubscribeFlowNotices from '@/components/subscribe/SubscribeFlowNotices';
import SubscribePlanSummaryCard from '@/components/subscribe/SubscribePlanSummaryCard';
import SubscribeStepShell from '@/components/subscribe/SubscribeStepShell';
import { useSubscribeFlow } from '@/components/subscribe/SubscribeFlowProvider';

export default function SubscribeMobileMoneyPage() {
  const router = useRouter();
  const {
    loadError,
    error,
    message,
    activePayment,
    clearFeedback,
    selectedPlanDefinition,
    paymentMethod,
    provider,
    setProvider,
    phoneNumber,
    setPhoneNumber,
    sortedProviders,
    selectedProviderOption,
    canPayWithMobileMoney,
    submitting,
    startMobileMoneyCheckout,
  } = useSubscribeFlow();

  useEffect(() => {
    if (!selectedPlanDefinition) {
      router.replace('/subscribe');
      return;
    }

    if (paymentMethod !== 'mobile_money') {
      router.replace('/subscribe/payment-method');
    }
  }, [paymentMethod, router, selectedPlanDefinition]);

  if (!selectedPlanDefinition || paymentMethod !== 'mobile_money') {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await startMobileMoneyCheckout();
  };

  return (
    <SubscribeStepShell
      title="Mobile Money"
      backHref="/subscribe/payment-method"
      actionHref="/subscribe"
      actionLabel="Change plan"
      tone="light"
      maxWidthClassName="max-w-4xl"
    >
      <div className="space-y-6">
        <section className="rounded-[30px] border border-slate-300/70 bg-[#EEF2F5] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] md:p-6">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">
            Mobile Money Payment
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] text-slate-950">
            Mobile Money Payment
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            Choose your network, enter your number, and confirm the prompt on your phone to finish premium checkout.
          </p>
        </section>

        {loadError ? (
          <div className="rounded-[24px] border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
            {loadError}
          </div>
        ) : null}

        <SubscribeFlowNotices
          error={error}
          message={message}
          activePayment={activePayment}
          tone="light"
        />

        <SubscribePlanSummaryCard
          plan={selectedPlanDefinition}
          eyebrow="You are paying for"
          tone="light"
        />

        <form
          onSubmit={handleSubmit}
          className="rounded-[30px] border border-slate-300/70 bg-[#EEF2F5] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] md:p-6"
        >
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">
            Choose network
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {sortedProviders.map((entry) => {
              const isSelected = provider === entry.id;
              const isAirtel = entry.id === 'AIRTEL_OAPI_UGA';
              const selectedClass = isAirtel
                ? 'border-[#C1121F] bg-[#C1121F] text-white shadow-[0_18px_40px_rgba(193,18,31,0.22)]'
                : 'border-[#D9A300] bg-[#FFD24D] text-slate-950 shadow-[0_18px_40px_rgba(217,163,0,0.18)]';

              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    clearFeedback();
                    setProvider(entry.id);
                  }}
                  className={`rounded-[24px] border px-4 py-4 text-left transition-all ${
                    isSelected
                      ? selectedClass
                      : 'border-slate-300/80 bg-white/70 text-slate-900 hover:border-slate-400 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${
                        isSelected
                          ? isAirtel
                            ? 'border-white/20 bg-white/10'
                            : 'border-black/10 bg-white/30'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <Wallet size={18} />
                    </div>
                    <div>
                      <div className="text-base font-black">{entry.label}</div>
                      <div
                        className={`mt-1 text-sm ${
                          isSelected
                            ? isAirtel
                              ? 'text-white/82'
                              : 'text-slate-900/78'
                            : 'text-slate-500'
                        }`}
                      >
                        {entry.country ? `Country: ${entry.country}` : 'Available now'}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-6">
            <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">
              Phone number
            </label>
            <div className="flex items-center rounded-[22px] border border-slate-300/80 bg-white/75 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
              <Smartphone size={18} className="text-slate-400" />
              <input
                type="tel"
                value={phoneNumber}
                onChange={(event) => {
                  clearFeedback();
                  setPhoneNumber(event.target.value);
                }}
                placeholder="0771234567"
                className="w-full bg-transparent px-3 py-4 text-slate-950 outline-none placeholder:text-slate-400"
              />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Use a Ugandan number like <span className="font-bold text-slate-900">0771234567</span>{' '}
              or <span className="font-bold text-slate-900">+256771234567</span>.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="submit"
              disabled={!canPayWithMobileMoney || submitting}
              className="flex w-full items-center justify-center gap-2 rounded-[22px] bg-[#C1121F] px-4 py-4 text-sm font-black uppercase tracking-[0.24em] text-white transition-colors disabled:cursor-not-allowed disabled:bg-[#A5A9B5]"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Wallet size={18} />}
              {submitting
                ? 'Starting Payment...'
                : selectedProviderOption
                  ? `Continue with ${selectedProviderOption.label}`
                  : 'Continue'}
            </button>

            <Link
              href="/subscribe/payment-method"
              className="flex w-full items-center justify-center rounded-[22px] border border-slate-300/80 bg-white/80 px-4 py-4 text-sm font-black uppercase tracking-[0.24em] text-slate-700"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </SubscribeStepShell>
  );
}
