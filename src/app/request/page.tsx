'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Clapperboard, MailCheck, Mic2, Send, X } from 'lucide-react';
import { VJ_DIRECTORY } from '@/config/constants';
import MobilePageHeader from '@/components/MobilePageHeader';
import { fetchAuthStatus, type ClientAuthStatus } from '@/lib/auth/status-client';
import { resendVerificationEmail } from '@/lib/auth/client';
import { readStoredFcmToken } from '@/lib/pushToken';

export default function RequestPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [requestSucceeded, setRequestSucceeded] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [authStatus, setAuthStatus] = useState<ClientAuthStatus | null>(null);
  const [formData, setFormData] = useState({ title: '', vj: '', notes: '' });

  useEffect(() => {
    let cancelled = false;

    fetchAuthStatus({ force: true })
      .then((status) => {
        if (!cancelled) {
          setAuthStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthStatus({ authenticated: false, reason: 'session_missing' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const requireVerifiedEmail = async () => {
    const status = authStatus?.authenticated
      ? authStatus
      : await fetchAuthStatus({ force: true }).catch(
          (): ClientAuthStatus => ({
            authenticated: false,
            reason: 'session_missing',
          })
        );

    setAuthStatus(status);

    if (!status.authenticated) {
      setErrorMessage('Please sign in before requesting a movie.');
      return false;
    }

    if (status.user?.emailVerified !== true) {
      setShowVerificationModal(true);
      return false;
    }

    return true;
  };

  const handleVerifyNow = async () => {
    setIsSendingVerification(true);
    setVerificationMessage('');

    try {
      const result = (await resendVerificationEmail()) as { message?: string; error?: string };
      setVerificationMessage(
        result.message ||
          result.error ||
          'We sent a verification link to your email. Open it, then come back and submit again.'
      );
    } catch (error) {
      setVerificationMessage(
        error instanceof Error ? error.message : 'Could not send the verification email right now.'
      );
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formData.title) return;
    if (!(await requireVerifiedEmail())) return;

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          movieTitle: formData.title,
          preferredVj: formData.vj,
          notes: formData.notes,
          fcmToken: readStoredFcmToken(),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (payload.code === 'email_not_verified') {
          setShowVerificationModal(true);
        }

        throw new Error(payload.error || 'Failed to submit movie request.');
      }

      setIsSubmitting(false);
      setRequestSucceeded(true);
      setFormData({ title: '', vj: '', notes: '' });
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to submit movie request.');
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] font-sans md:px-8 md:pb-14 lg:px-10">
      <MobilePageHeader title="Request a Movie" fallbackHref="/browse" />

      <div className="px-4 pt-24 md:mx-auto md:max-w-3xl md:px-0 md:pt-[138px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D90429]/30 bg-[#1F2833]/50 shadow-[0_0_15px_rgba(217,4,41,0.2)] md:h-20 md:w-20">
            <Clapperboard className="text-[#D90429]" size={32} />
          </div>
          <h1 className="mb-3 text-3xl font-black uppercase tracking-widest text-white md:text-4xl">
            Request A Movie
          </h1>
          <div className="mx-auto mt-5 max-w-2xl rounded-[22px] border border-white/10 bg-amber-500/[0.05] px-5 py-4 text-left shadow-[0_18px_42px_rgba(0,0,0,0.22)] backdrop-blur-md">
            <p className="text-sm leading-7 text-amber-50/88 md:text-base">
              Your request goes straight to our Priority Desk. Our team works around the clock to have your favorite titles live in under 5 hours.
            </p>
          </div>
        </div>

        {requestSucceeded ? (
          <section className="rounded-[28px] border border-emerald-300/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(14,165,233,0.08),rgba(31,40,51,0.22))] p-7 text-center shadow-[0_22px_55px_rgba(0,0,0,0.28)] backdrop-blur-md md:p-9">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200/20 bg-emerald-400/12 text-emerald-200 shadow-[0_0_34px_rgba(16,185,129,0.2)]">
              <CheckCircle2 size={34} strokeWidth={2.2} />
            </div>
            <h2 className="mt-5 text-2xl font-black uppercase tracking-[0.16em] text-white md:text-3xl">
              Request Received!
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-8 text-white/72 md:text-lg">
              We're on it. Your movie will be uploaded in under 5 hours, and you'll receive a confirmation as soon as it's ready for you to watch.
            </p>
          </section>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-xl border border-white/5 bg-[#1F2833]/20 p-6 shadow-xl md:p-8"
          >
            {errorMessage && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {errorMessage}
              </div>
            )}

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-[#888888]">
                Movie Title / Year *
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. Spider-Man: Brand New Day (2026)"
                className="w-full rounded-lg border border-white/5 bg-[#1F2833]/80 p-4 text-white placeholder-[#888888]/50 transition-all focus:border-[#D90429] focus:outline-none focus:ring-1 focus:ring-[#D90429]"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-[#888888]">
                Preferred VJ
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <Mic2 className="text-[#888888]/50" size={18} />
                </div>
                <select
                  value={formData.vj}
                  onChange={(e) => setFormData({ ...formData, vj: e.target.value })}
                  className="w-full appearance-none rounded-lg border border-white/5 bg-[#1F2833]/80 p-4 pl-11 text-white transition-all focus:border-[#D90429] focus:outline-none focus:ring-1 focus:ring-[#D90429]"
                >
                  <option value="" className="text-[#888888]">
                    Any Available VJ
                  </option>
                  {VJ_DIRECTORY.map((vj) => (
                    <option key={vj.id} value={vj.name}>
                      {vj.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-[#888888]">
                Additional Information
              </label>
              <textarea
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="You may include the lead actor, alternate title, release year, or any other helpful details."
                className="w-full resize-none rounded-lg border border-white/5 bg-[#1F2833]/80 p-4 text-white placeholder-[#888888]/50 transition-all focus:border-[#D90429] focus:outline-none focus:ring-1 focus:ring-[#D90429]"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className={`mt-4 flex w-full items-center justify-center gap-3 rounded-lg bg-[#D90429] p-4 text-lg font-black uppercase tracking-widest text-white shadow-[0_0_20px_rgba(217,4,41,0.4)] transition-all hover:bg-[#B00320] ${isSubmitting ? 'cursor-not-allowed opacity-80' : ''}`}
            >
              {isSubmitting ? (
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  <Send size={20} /> Submit Request
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {showVerificationModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4"
        >
          <div className="w-full max-w-md rounded-[28px] border border-amber-300/25 bg-[#11141C] p-6 shadow-[0_28px_70px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-100">
                  <MailCheck size={22} />
                </div>
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-100/70">
                    Email Verification Required
                  </div>
                  <h2 className="mt-2 text-xl font-black text-white">Verify your email first</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowVerificationModal(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/70"
                aria-label="Close verification modal"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-5 text-sm leading-7 text-white/70">
              We need your email verified before you request a movie so we can send upload alerts and ready notifications to the correct account.
            </p>
            {verificationMessage && (
              <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm leading-6 text-emerald-50">
                {verificationMessage}
              </div>
            )}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleVerifyNow}
                disabled={isSendingVerification}
                className="inline-flex items-center justify-center rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
              >
                {isSendingVerification ? 'Sending...' : 'Verify Now'}
              </button>
              <Link
                href="/profile/security"
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white/80"
              >
                My Account
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
