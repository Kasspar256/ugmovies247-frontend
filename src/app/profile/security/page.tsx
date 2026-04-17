'use client';

import { useEffect, useState } from 'react';
import { Loader2, Mail, Shield } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { fetchAccountProfile, formatAccountDate, type AccountProfile } from '@/lib/accountProfile';
import { sendResetPasswordEmail } from '@/lib/auth/client';

export default function SecurityPage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      try {
        const nextProfile = await fetchAccountProfile();

        if (!mounted) {
          return;
        }

        setProfile(nextProfile);
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Security settings could not be loaded.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, []);

  const handlePasswordReset = async () => {
    if (!profile?.email) {
      return;
    }

    setResetting(true);
    setError('');
    setMessage('');

    try {
      await sendResetPasswordEmail(profile.email);
      setMessage(`A password reset link has been sent to ${profile.email}.`);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Password reset could not be started.');
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center">
        <div className="h-12 w-12 rounded-full border-4 border-[#1F2833] border-t-[#D90429] animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-16 text-white md:px-8 md:pb-16 md:pt-[118px] lg:px-10">
      <MobilePageHeader title="Security" fallbackHref="/profile" />

      <div className="mx-auto max-w-3xl">
        <div className="hidden md:block">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
            Profile
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">Security</h1>
        </div>

        {error && !profile ? (
          <div className="mt-6 rounded-[24px] border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-100">
            {error}
          </div>
        ) : profile ? (
          <div className="mt-6 space-y-4">
            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/82 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.32)]">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
                  <Shield size={20} />
                </div>
                <div>
                  <div className="text-base font-semibold text-white">{profile.email}</div>
                  <div className="mt-1.5 text-sm text-white/54">
                    Last login {formatAccountDate(profile.lastLoginAt, { includeTime: true })}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/75 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                Actions
              </div>
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={resetting}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition-colors hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <div>
                    <div className="text-base font-semibold text-white">Send password reset link</div>
                    <div className="mt-1.5 text-sm leading-6 text-white/54">
                      We will email a secure reset link to your account address.
                    </div>
                  </div>
                  {resetting ? <Loader2 size={18} className="animate-spin text-white/60" /> : <Mail size={18} className="text-[#D90429]" />}
                </button>
              </div>
            </section>
            {(message || error) && (
              <div
                className={`rounded-2xl px-4 py-3 text-sm ${
                  error
                    ? 'border border-red-500/20 bg-red-500/10 text-red-100'
                    : 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                }`}
              >
                {error || message}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
