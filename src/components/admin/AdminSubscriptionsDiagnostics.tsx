'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type AdminPayment = {
  id: string;
  userId: string;
  planName: string;
  amount: number;
  currency: string;
  status: string;
  providerStatus: string;
  phoneNumber: string;
  createdAt: string;
  updatedAt: string;
};

type AdminSubscription = {
  userId: string;
  planName: string;
  status: string;
  isActive: boolean;
  startsAt: string;
  expiresAt: string;
  updatedAt: string;
};

export function AdminSubscriptionsDiagnostics() {
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const response = await fetch('/api/admin/subscriptions', {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await response.json();

        if (!mounted) {
          return;
        }

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load subscription diagnostics.');
        }

        setPayments(payload.payments || []);
        setSubscriptions(payload.subscriptions || []);
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load subscription diagnostics.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0C10] px-4 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/45">
              Admin Diagnostics
            </div>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.12em] text-white">
              Subscriptions
            </h1>
          </div>
          <Link
            href="/admin"
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-white"
          >
            Back To Admin
          </Link>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <section className="rounded-3xl border border-white/10 bg-[#11141C]/80 p-6">
          <h2 className="text-lg font-black uppercase tracking-[0.16em] text-white">Active / Recent Subscriptions</h2>
          <div className="mt-5 space-y-3">
            {loading ? (
              <div className="text-sm text-white/55">Loading subscription diagnostics...</div>
            ) : subscriptions.length === 0 ? (
              <div className="text-sm text-white/55">No subscriptions found yet.</div>
            ) : (
              subscriptions.map((subscription) => (
                <div key={subscription.userId} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-white">{subscription.planName || 'No plan'}</div>
                      <div className="mt-1 text-xs text-white/45">{subscription.userId}</div>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] ${
                      subscription.isActive
                        ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border border-amber-500/30 bg-amber-500/10 text-amber-200'
                    }`}>
                      {subscription.status}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-white/70 md:grid-cols-3">
                    <p>Starts: <span className="font-bold text-white">{subscription.startsAt ? new Date(subscription.startsAt).toLocaleString() : '—'}</span></p>
                    <p>Expires: <span className="font-bold text-white">{subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleString() : '—'}</span></p>
                    <p>Updated: <span className="font-bold text-white">{subscription.updatedAt ? new Date(subscription.updatedAt).toLocaleString() : '—'}</span></p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-[#11141C]/80 p-6">
          <h2 className="text-lg font-black uppercase tracking-[0.16em] text-white">Mobile Money Payment Attempts</h2>
          <div className="mt-5 space-y-3">
            {loading ? (
              <div className="text-sm text-white/55">Loading payment attempts...</div>
            ) : payments.length === 0 ? (
              <div className="text-sm text-white/55">No payment attempts found yet.</div>
            ) : (
              payments.map((payment) => (
                <div key={payment.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-white">
                        {payment.planName} • {payment.currency} {payment.amount.toLocaleString()}
                      </div>
                      <div className="mt-1 text-xs text-white/45">{payment.phoneNumber} • {payment.userId}</div>
                    </div>
                    <div className="text-right text-xs uppercase tracking-[0.22em]">
                      <div className="font-black text-white">{payment.status}</div>
                      <div className="mt-1 text-white/45">{payment.providerStatus || 'pending'}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-white/70 md:grid-cols-2">
                    <p>Created: <span className="font-bold text-white">{payment.createdAt ? new Date(payment.createdAt).toLocaleString() : '—'}</span></p>
                    <p>Updated: <span className="font-bold text-white">{payment.updatedAt ? new Date(payment.updatedAt).toLocaleString() : '—'}</span></p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
