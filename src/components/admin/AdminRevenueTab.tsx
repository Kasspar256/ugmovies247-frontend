import Link from 'next/link';
import { BarChart3, CreditCard, Tags, Users } from 'lucide-react';
import type { AdminRevenueSummary } from '@/types/admin';
import { Card, StatTile } from '@/components/admin/controlCenterFields';
import { formatDate } from '@/components/admin/controlCenterUtils';

export function AdminRevenueTab({ revenue }: { revenue: AdminRevenueSummary }) {
  return (
    <>
      <Card
        title="Mobile Money Revenue"
        description="PawaPay mobile money payments only. Card payments are tracked separately."
      >
        <div className="mb-4 flex justify-end">
          <Link
            href="/cardspayments"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-white transition-colors hover:border-[#D90429]/35 hover:bg-[#D90429]/10"
          >
            <CreditCard size={14} />
            Card Payments
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <StatTile
            title="Mobile Money Month"
            value={`UGX ${revenue.monthRevenue.toLocaleString()}`}
            icon={<BarChart3 size={18} />}
            subcopy={revenue.monthLabel}
          />
          <StatTile
            title="Mobile Money Subscribers"
            value={revenue.activeSubscriberCount}
            icon={<Users size={18} />}
          />
          <StatTile
            title="Mobile Money Plans Value"
            value={`UGX ${revenue.activeSubscriptionRevenue.toLocaleString()}`}
            icon={<Tags size={18} />}
          />
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
        <Card title="Mobile Money Plan Breakdown" description="Active PawaPay subscriptions grouped by plan.">
          <div className="space-y-3">
            {revenue.activePlanBreakdown.map((plan) => (
              <div
                key={plan.planType}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-white">{plan.planName}</div>
                    <div className="mt-1 text-xs text-white/50">
                      {plan.activeCount} active subscriber(s)
                    </div>
                  </div>
                  <div className="text-sm font-black text-white">
                    UGX {plan.totalAmount.toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Recent Mobile Money Payments"
          description="Latest PawaPay payments from the real payments collection."
        >
          <div className="space-y-3 md:hidden">
            {revenue.recentPayments.map((payment) => (
              <div
                key={payment.id}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-white">{payment.planName}</div>
                    <div className="mt-1 text-xs text-white/50">
                      {payment.phoneNumber || '-'}
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/72">
                    {payment.status}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
                      Amount
                    </div>
                    <div className="mt-1 text-sm font-bold text-white">
                      {payment.currency} {Number(payment.amount || 0).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
                      Created
                    </div>
                    <div className="mt-1 text-xs leading-6 text-white/65">
                      {formatDate(payment.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                <tr>
                  <th className="px-3 py-3">Plan</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3">Phone</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {revenue.recentPayments.map((payment) => (
                  <tr key={payment.id} className="border-t border-white/10">
                    <td className="px-3 py-4 text-white">{payment.planName}</td>
                    <td className="px-3 py-4 text-white/75">
                      {payment.currency} {Number(payment.amount || 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-4 text-white/75">{payment.phoneNumber || '-'}</td>
                    <td className="px-3 py-4 text-white/75">{payment.status}</td>
                    <td className="px-3 py-4 text-white/75">{formatDate(payment.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
