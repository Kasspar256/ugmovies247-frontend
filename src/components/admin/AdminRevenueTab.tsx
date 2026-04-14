import { BarChart3, Tags, Users } from 'lucide-react';
import type { AdminRevenueSummary } from '@/types/admin';
import { Card, StatTile } from '@/components/admin/controlCenterFields';
import { formatDate } from '@/components/admin/controlCenterUtils';

export function AdminRevenueTab({ revenue }: { revenue: AdminRevenueSummary }) {
  return (
    <>
      <Card
        title="Revenue Dashboard"
        description="Real subscription money and active access pulled from current payment and subscription data."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <StatTile
            title="Month Revenue"
            value={`UGX ${revenue.monthRevenue.toLocaleString()}`}
            icon={<BarChart3 size={18} />}
            subcopy={revenue.monthLabel}
          />
          <StatTile
            title="Active Subscribers"
            value={revenue.activeSubscriberCount}
            icon={<Users size={18} />}
          />
          <StatTile
            title="Active Plans Value"
            value={`UGX ${revenue.activeSubscriptionRevenue.toLocaleString()}`}
            icon={<Tags size={18} />}
          />
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
        <Card title="Plan Breakdown" description="Active subscriptions grouped by plan.">
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
          title="Recent Payments"
          description="Latest completed, pending, or failed payments from the real payments collection."
        >
          <div className="overflow-x-auto">
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
