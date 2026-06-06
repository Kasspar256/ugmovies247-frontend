'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Clapperboard,
  CreditCard,
  DollarSign,
  Film,
  Loader2,
  RefreshCw,
  ServerCog,
  Ticket,
  Users,
} from 'lucide-react';
import { fetchAdminJson } from '@/lib/admin/fetchAdminJson';
import { Card, StatTile } from '@/components/admin/controlCenterFields';
import type { ExecutiveSummaryPayload } from '@/types/executiveSummary';

type MetricCard = {
  title: string;
  value: string;
  icon: ReactNode;
  subcopy?: string;
};

function formatNumber(value: number | null) {
  return typeof value === 'number' ? value.toLocaleString() : 'N/A';
}

function formatMoney(value: number | null, currency: string) {
  return typeof value === 'number' ? `${currency} ${value.toLocaleString()}` : 'N/A';
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not loaded yet' : parsed.toLocaleString();
}

export default function AdminExecutiveSummaryPage() {
  const [summary, setSummary] = useState<ExecutiveSummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadSummary = async (force = false) => {
    if (force) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const payload = await fetchAdminJson<ExecutiveSummaryPayload>('/api/admin/executive-summary', {
        force,
        ttlMs: 1000 * 30,
      });
      setSummary(payload);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load executive summary.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadSummary(false);
  }, []);

  const metricCards = useMemo<MetricCard[]>(
    () => [
      {
        title: 'Users Total',
        value: formatNumber(summary?.usersTotal ?? null),
        icon: <Users size={18} />,
      },
      {
        title: 'Active Subscribers',
        value: formatNumber(summary?.activeSubscribers ?? null),
        icon: <Ticket size={18} />,
      },
      {
        title: 'Active Subscription Value',
        value: formatMoney(summary?.activeSubscriptionValue ?? null, summary?.activeSubscriptionValueCurrency || 'UGX'),
        icon: <DollarSign size={18} />,
      },
      {
        title: 'Mobile Money This Month',
        value: formatMoney(summary?.mobileMoneyRevenueThisMonth ?? null, summary?.mobileMoneyCurrency || 'UGX'),
        icon: <Banknote size={18} />,
      },
      {
        title: 'Card Revenue This Month',
        value: formatMoney(summary?.cardRevenueThisMonth ?? null, summary?.cardCurrency || 'ZAR'),
        icon: <CreditCard size={18} />,
      },
      {
        title: 'Combined Revenue This Month',
        value: formatNumber(summary?.revenueThisMonth ?? null),
        subcopy: 'Null until a currency conversion source exists.',
        icon: <DollarSign size={18} />,
      },
      {
        title: 'Movies',
        value: formatNumber(summary?.movieCount ?? null),
        icon: <Film size={18} />,
      },
      {
        title: 'Series',
        value: formatNumber(summary?.seriesCount ?? null),
        icon: <Clapperboard size={18} />,
      },
      {
        title: 'Requests',
        value: formatNumber(summary?.requestCount ?? null),
        icon: <Ticket size={18} />,
      },
      {
        title: 'Pending Requests',
        value: formatNumber(summary?.pendingRequests ?? null),
        icon: <AlertTriangle size={18} />,
      },
      {
        title: 'Failed Request Jobs',
        value: formatNumber(summary?.failedRequestJobs ?? null),
        icon: <ServerCog size={18} />,
      },
      {
        title: 'Active Video Jobs',
        value: formatNumber(summary?.activeVideoJobs ?? null),
        icon: <ServerCog size={18} />,
      },
      {
        title: 'Failed Video Jobs',
        value: formatNumber(summary?.failedVideoJobs ?? null),
        icon: <AlertTriangle size={18} />,
      },
    ],
    [summary]
  );

  return (
    <main className="min-h-screen bg-[#080A0F] px-4 py-6 text-white md:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-[28px] border border-white/10 bg-[#11141C] px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.24)] md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link
                href="/admin"
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/78 transition-colors hover:bg-white/5 hover:text-white"
                aria-label="Back to admin sections"
              >
                <ArrowLeft size={18} />
              </Link>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.26em] text-white/45">
                  Internal Monitoring
                </div>
                <h1 className="mt-1 text-2xl font-black text-white md:text-3xl">
                  Executive Summary
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
                  Read-only summary from the existing admin APIs. No private user rows are shown.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void loadSummary(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refreshing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              Refresh
            </button>
          </div>
        </header>

        {errorMessage && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {errorMessage}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-[28px] border border-white/10 bg-[#11141C]">
            <div className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.24em] text-white/55">
              <Loader2 className="animate-spin" size={20} />
              Loading summary
            </div>
          </div>
        ) : (
          <>
            <Card
              title="Executive Metrics"
              description={`Last refreshed: ${formatTimestamp(summary?.timestamp || '')}`}
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {metricCards.map((card) => (
                  <StatTile
                    key={card.title}
                    title={card.title}
                    value={card.value}
                    icon={card.icon}
                    subcopy={card.subcopy}
                  />
                ))}
              </div>
            </Card>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card title="Top Operational Warnings" description="Generated from existing job and request counts.">
                <div className="space-y-3">
                  {(summary?.topOperationalWarnings || []).length > 0 ? (
                    summary?.topOperationalWarnings.map((warning) => (
                      <div
                        key={warning}
                        className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm font-semibold leading-6 text-amber-50"
                      >
                        {warning}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-50">
                      No operational warnings from the current summary.
                    </div>
                  )}
                </div>
              </Card>

              <Card title="Missing Metrics" description="Fields intentionally returned as null or unavailable.">
                <div className="space-y-3">
                  {(summary?.missingMetrics || []).length > 0 ? (
                    summary?.missingMetrics.map((metric) => (
                      <div
                        key={metric.metric}
                        className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                      >
                        <div className="text-sm font-black text-white">{metric.metric}</div>
                        <div className="mt-1 text-sm leading-6 text-white/58">{metric.reason}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/60">
                      No missing metrics reported by this endpoint.
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
