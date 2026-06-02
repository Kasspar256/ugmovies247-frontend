'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, BellRing, Loader2, Send } from 'lucide-react';

type SendResult = {
  success?: boolean;
  sent?: boolean;
  successCount?: number;
  failureCount?: number;
  recipientCount?: number;
  invalidTokenCount?: number;
  inboxCount?: number;
  error?: string;
};

type TargetMode = 'all' | 'email' | 'userId' | 'token';

async function readJsonResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw Object.assign(new Error(payload.error || 'Request failed.'), { payload });
  }

  return payload;
}

export default function AdminNotificationsPage() {
  const [targetMode, setTargetMode] = useState<TargetMode>('all');
  const [targetValue, setTargetValue] = useState('');
  const [title, setTitle] = useState('UGMOVIES247');
  const [message, setMessage] = useState('');
  const [path, setPath] = useState('/notifications');
  const [imageUrl, setImageUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState('');

  const sendNotification = async () => {
    try {
      setSubmitting(true);
      setError('');
      setResult(null);

      const body: Record<string, unknown> = {
        target: targetMode === 'all' ? 'all' : 'targeted',
        title,
        body: message,
        path,
        image: imageUrl,
      };

      if (targetMode === 'email') {
        body.email = targetValue;
      } else if (targetMode === 'userId') {
        body.userId = targetValue;
      } else if (targetMode === 'token') {
        body.token = targetValue;
      }

      const response = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const payload = await readJsonResponse<SendResult>(response);

      setResult(payload);
    } catch (sendError) {
      const payload = (sendError as { payload?: SendResult }).payload;
      setResult(payload || null);
      setError(sendError instanceof Error ? sendError.message : 'Notification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] px-4 pb-20 pt-24 text-white md:px-8 md:pt-[118px] lg:px-10">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-[#11141C] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.28)]">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/75 transition-colors hover:bg-white/5 hover:text-white"
              aria-label="Back to admin"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/45">
                Admin Notifications
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-[-0.03em]">Push Center</h1>
            </div>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#D90429]/25 bg-[#D90429]/12 text-[#FFB3C1]">
            <BellRing size={20} />
          </div>
        </div>

        <section className="rounded-[28px] border border-white/10 bg-[#11141C]/85 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] md:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-white/65">
                Target
              </label>
              <select
                value={targetMode}
                onChange={(event) => setTargetMode(event.target.value as TargetMode)}
                className="w-full rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white outline-none focus:border-[#D90429]"
              >
                <option value="all">All registered devices</option>
                <option value="email">One user email</option>
                <option value="userId">One user ID</option>
                <option value="token">One FCM token</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-white/65">
                Target Value
              </label>
              <input
                value={targetValue}
                onChange={(event) => setTargetValue(event.target.value)}
                disabled={targetMode === 'all'}
                placeholder={targetMode === 'all' ? 'Broadcast selected' : 'Email, user ID, or token'}
                className="w-full rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 disabled:opacity-45 focus:border-[#D90429]"
              />
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-white/65">
                Title
              </label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#D90429]"
              />
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-white/65">
                Open Path
              </label>
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/notifications"
                className="w-full rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#D90429]"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-white/65">
                Expanded Image URL
              </label>
              <input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="Optional. /movie/{id} paths use movie artwork automatically"
                className="w-full rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#D90429]"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-white/65">
              Message
            </label>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              className="w-full rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#D90429]"
            />
          </div>

          <button
            type="button"
            onClick={() => void sendNotification()}
            disabled={submitting || !message.trim() || (targetMode !== 'all' && !targetValue.trim())}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#D90429] px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-[#F2173D] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
            Send
          </button>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {result ? (
          <section className="grid gap-3 rounded-[24px] border border-white/10 bg-black/20 p-4 text-sm text-white/72 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Recipients</div>
              <div className="mt-1 text-xl font-black text-white">{result.recipientCount || 0}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Accepted</div>
              <div className="mt-1 text-xl font-black text-emerald-200">{result.successCount || 0}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Failed</div>
              <div className="mt-1 text-xl font-black text-red-200">{result.failureCount || 0}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Inbox</div>
              <div className="mt-1 text-xl font-black text-white">{result.inboxCount || 0}</div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
