'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CreditCard,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { formatDate } from '@/components/admin/controlCenterUtils';
import type { PaymentAttemptDocument } from '@/types/subscriptions';

type CardPayment = Pick<
  PaymentAttemptDocument,
  | 'userId'
  | 'planType'
  | 'planName'
  | 'amount'
  | 'currency'
  | 'status'
  | 'paymentKind'
  | 'paymentProvider'
  | 'paymentMethodProvider'
  | 'providerStatus'
  | 'providerMessage'
  | 'recurringAgreementId'
  | 'recurringTokenLast4'
  | 'isAutoRenewal'
  | 'triggerSource'
  | 'createdAt'
  | 'updatedAt'
> & {
  id: string;
};

type CardPaymentsPayload = {
  summary: {
    monthLabel: string;
    monthAmount: number;
    completedAmount: number;
    completedCount: number;
    pendingCount: number;
    failedCount: number;
  };
  payments: CardPayment[];
};

const EMPTY_PAYLOAD: CardPaymentsPayload = {
  summary: {
    monthLabel: '',
    monthAmount: 0,
    completedAmount: 0,
    completedCount: 0,
    pendingCount: 0,
    failedCount: 0,
  },
  payments: [],
};

function getStatusClass(status: string) {
  if (status === 'completed') {
    return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100';
  }

  if (['failed', 'cancelled', 'not_found'].includes(status)) {
    return 'border-red-400/25 bg-red-400/10 text-red-100';
  }

  return 'border-amber-400/25 bg-amber-400/10 text-amber-100';
}

function getPaymentKindLabel(payment: CardPayment) {
  if (payment.isAutoRenewal || payment.paymentKind === 'recurring_renewal') {
    return 'Auto renewal';
  }

  if (payment.paymentKind === 'recurring_enrollment') {
    return 'Card setup';
  }

  return 'Card payment';
}

function formatMoney(amount: number, currency = 'ZAR') {
  return `${currency} ${Number(amount || 0).toLocaleString()}`;
}

export default function CardPaymentsAdminPage() {
  const [payload, setPayload] = useState<CardPaymentsPayload>(EMPTY_PAYLOAD);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const latestPayments = useMemo(() => payload.payments.slice(0, 100), [payload.payments]);

  const loadCardPayments = async (force = false) => {
    try {
      if (force) {
        setRefreshing(true);
      }

      setError('');
      const response = await fetch('/api/admin/card-payments', {
        credentials: 'include',
        cache: 'no-store',
      });
      const nextPayload = (await response.json().catch(() => ({}))) as
        | CardPaymentsPayload
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          'error' in nextPayload && nextPayload.error
            ? nextPayload.error
            : 'Failed to load card payments.'
        );
      }

      const data = nextPayload as CardPaymentsPayload;
      setPayload({
        summary: data.summary || EMPTY_PAYLOAD.summary,
        payments: data.payments || [],
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load card payments.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadCardPayments(true);
  }, []);

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-24 text-white md:px-8 md:pb-14 md:pt-10 lg:px-10">
      <MobilePageHeader title="Card Payments" fallbackHref="/admin/revenue" />

      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[28px] border border-white/10 bg-[#11141C] px-5 py-5 shadow-[0_24px_60px_rgba(0,0,0,0.34)] md:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.26em] text-white/45">
                PayFast Card Payments
              </div>
              <h1 className="mt-3 text-2xl font-black uppercase tracking-[0.12em] text-white md:text-3xl">
                Card Payments
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
                Card and auto-renew transactions live here separately from mobile money revenue.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void loadCardPayments(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-white transition-colors hover:bg-white/10"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                Refresh
              </button>
              <Link
                href="/admin/revenue"
                className="inline-flex items-center gap-2 rounded-full border border-[#D90429]/20 bg-[#D90429]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-[#FFD7DF] transition-colors hover:bg-[#D90429]/18"
              >
                <ShieldCheck size={14} />
                Revenue
              </Link>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center rounded-[28px] border border-white/10 bg-[#11141C]/70 py-16">
            <div className="h-10 w-10 rounded-full border-4 border-[#1F2833] border-t-[#D90429] animate-spin" />
          </div>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[22px] border border-white/10 bg-[#11141C] px-4 py-4">
                <div className="flex items-center gap-3 text-white/52">
                  <CreditCard size={18} />
                  <span className="text-[10px] font-black uppercase tracking-[0.22em]">This Month</span>
                </div>
                <div className="mt-3 text-xl font-black text-white">
                  {formatMoney(payload.summary.monthAmount)}
                </div>
                <div className="mt-1 text-xs text-white/45">{payload.summary.monthLabel}</div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-[#11141C] px-4 py-4">
                <div className="flex items-center gap-3 text-white/52">
                  <CheckCircle2 size={18} />
                  <span className="text-[10px] font-black uppercase tracking-[0.22em]">Completed</span>
                </div>
                <div className="mt-3 text-xl font-black text-white">
                  {payload.summary.completedCount}
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {formatMoney(payload.summary.completedAmount)}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-[#11141C] px-4 py-4">
                <div className="flex items-center gap-3 text-white/52">
                  <Clock3 size={18} />
                  <span className="text-[10px] font-black uppercase tracking-[0.22em]">Pending</span>
                </div>
                <div className="mt-3 text-xl font-black text-white">
                  {payload.summary.pendingCount}
                </div>
                <div className="mt-1 text-xs text-white/45">Needs confirmation or setup</div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-[#11141C] px-4 py-4">
                <div className="flex items-center gap-3 text-white/52">
                  <AlertTriangle size={18} />
                  <span className="text-[10px] font-black uppercase tracking-[0.22em]">Failed</span>
                </div>
                <div className="mt-3 text-xl font-black text-white">
                  {payload.summary.failedCount}
                </div>
                <div className="mt-1 text-xs text-white/45">Failed, cancelled, or not found</div>
              </div>
            </section>

            {latestPayments.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-[#11141C]/50 px-4 py-10 text-center text-sm text-white/55">
                No card payments have been recorded yet.
              </div>
            ) : (
              <section className="rounded-[28px] border border-white/10 bg-[#11141C] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.26)] md:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-black uppercase tracking-[0.16em] text-white">
                      Latest Card Transactions
                    </h2>
                    <p className="mt-1 text-xs text-white/45">
                      PayFast card payments are intentionally separate from mobile money revenue.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 md:hidden">
                  {latestPayments.map((payment) => (
                    <article
                      key={payment.id}
                      className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold text-white">{payment.planName}</h3>
                          <p className="mt-1 text-xs text-white/50">{getPaymentKindLabel(payment)}</p>
                        </div>
                        <span
                          className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${getStatusClass(
                            payment.status
                          )}`}
                        >
                          {payment.status}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
                            Amount
                          </span>
                          <span className="text-sm font-bold text-white">
                            {formatMoney(payment.amount, payment.currency)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
                            Created
                          </span>
                          <span className="text-right text-xs text-white/65">
                            {formatDate(payment.createdAt)}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                      <tr>
                        <th className="px-3 py-3">Plan</th>
                        <th className="px-3 py-3">Amount</th>
                        <th className="px-3 py-3">Type</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Provider</th>
                        <th className="px-3 py-3">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestPayments.map((payment) => (
                        <tr key={payment.id} className="border-t border-white/10">
                          <td className="px-3 py-4 text-white">
                            <div className="font-semibold">{payment.planName}</div>
                            <div className="mt-1 text-xs text-white/45">{payment.userId}</div>
                          </td>
                          <td className="px-3 py-4 text-white/75">
                            {formatMoney(payment.amount, payment.currency)}
                          </td>
                          <td className="px-3 py-4 text-white/75">{getPaymentKindLabel(payment)}</td>
                          <td className="px-3 py-4">
                            <span
                              className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${getStatusClass(
                                payment.status
                              )}`}
                            >
                              {payment.status}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-white/75">
                            {payment.providerStatus || payment.paymentMethodProvider || 'PayFast'}
                          </td>
                          <td className="px-3 py-4 text-white/75">{formatDate(payment.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
