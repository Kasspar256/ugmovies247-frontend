'use client';

import type { SubscriptionPlanDefinition } from '@/types/subscriptions';
import {
  formatMoney,
  getPlanDurationLabel,
} from './subscribeFlowUtils';

type SubscribePlanSummaryCardProps = {
  plan: SubscriptionPlanDefinition;
  eyebrow?: string;
  tone?: 'dark' | 'light';
};

export default function SubscribePlanSummaryCard({
  plan,
  eyebrow = 'Selected plan',
  tone = 'dark',
}: SubscribePlanSummaryCardProps) {
  const isLight = tone === 'light';

  return (
    <div
      className={`rounded-[28px] border p-5 ${
        isLight
          ? 'border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.08)]'
          : 'border-white/10 bg-white/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-[11px] font-black uppercase tracking-[0.24em] ${isLight ? 'text-slate-500' : 'text-white/45'}`}>
            {eyebrow}
          </div>
          <h2 className={`mt-2 text-2xl font-black tracking-[-0.04em] ${isLight ? 'text-slate-950' : 'text-white'}`}>
            {plan.name}
          </h2>
        </div>

        <span
          className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
            isLight
              ? 'border-slate-200 bg-slate-50 text-slate-700'
              : 'border-white/10 bg-black/20 text-white/62'
          }`}
        >
          {getPlanDurationLabel(plan)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className={`text-3xl font-black tracking-[-0.04em] ${isLight ? 'text-[#C1121F]' : 'text-[#D90429]'}`}>
          {formatMoney(plan.currency, plan.amount)}
        </div>
        <div className={`max-w-md text-sm leading-6 ${isLight ? 'text-slate-600' : 'text-white/62'}`}>
          {plan.description}
        </div>
      </div>
    </div>
  );
}
