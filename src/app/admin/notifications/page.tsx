'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BellRing, Loader2, Send } from 'lucide-react';

type SendResult = {
  recipientCount?: number;
  attemptedPushes?: number;
  sentPushes?: number;
  failedPushes?: number;
};

export default function AdminNotificationsPage() {
  const [title, setTitle] = useState('UG Movies 247');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'all' | 'user'>('all');
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [path, setPath] = useState('/notifications');
  const [movieId, setMovieId] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const sendNotification = async () => {
    setSending(true);
    setStatus('');
    setError('');

    try {
      const response = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          body,
          audience,
          email,
          userId,
          path,
          movieId,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as SendResult & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Notification could not be sent.');
      }

      setStatus(
        `Saved for ${payload.recipientCount || 0} user(s). Sent ${payload.sentPushes || 0}/${payload.attemptedPushes || 0} push notification(s).`
      );
      setBody('');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Notification could not be sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#071017] px-4 py-8 text-white md:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin/overview"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white/70 transition hover:text-white"
        >
          <ArrowLeft size={16} />
          Back to admin
        </Link>

        <section className="mt-6 overflow-hidden rounded-[32px] border border-white/10 bg-[#101923] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
          <div className="border-b border-white/10 bg-gradient-to-br from-[#172635] to-[#0B0C10] p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D90429]/15 text-[#FFB3C1]">
                <BellRing size={24} />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-white/40">
                  Admin Broadcast
                </p>
                <h1 className="mt-1 text-2xl font-black tracking-[-0.03em] text-white">
                  Send notification
                </h1>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/60">
              This saves the full message inside the app inbox and sends a push notification to active Android devices.
            </p>
          </div>

          <div className="space-y-5 p-6">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
                Audience
              </span>
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value as 'all' | 'user')}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#D90429]/50"
              >
                <option value="all">All active app users</option>
                <option value="user">Single user</option>
              </select>
            </label>

            {audience === 'user' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
                    User email
                  </span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="user@example.com"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#D90429]/50"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
                    Or user ID
                  </span>
                  <input
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                    placeholder="Firebase uid"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#D90429]/50"
                  />
                </label>
              </div>
            ) : null}

            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
                Title
              </span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#D90429]/50"
              />
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
                Full message
              </span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={8}
                maxLength={4000}
                placeholder="Write the notification message users can open and read fully inside the app..."
                className="mt-2 w-full resize-y rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm leading-6 text-white outline-none focus:border-[#D90429]/50"
              />
              <span className="mt-2 block text-right text-xs text-white/35">
                {body.length}/4000
              </span>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
                  Open path
                </span>
                <input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="/notifications"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#D90429]/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
                  Movie ID optional
                </span>
                <input
                  value={movieId}
                  onChange={(event) => setMovieId(event.target.value)}
                  placeholder="Overrides path to /movie/[id]"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#D90429]/50"
                />
              </label>
            </div>

            {error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            ) : null}

            {status ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {status}
              </div>
            ) : null}

            <button
              type="button"
              onClick={sendNotification}
              disabled={sending || !title.trim() || !body.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-[#F21B3F] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              Send notification
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
