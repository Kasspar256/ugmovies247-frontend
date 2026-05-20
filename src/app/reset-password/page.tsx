'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { confirmPasswordReset } from '@/lib/auth/client';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError('This password reset link is invalid or has expired.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      await confirmPasswordReset({ token, password });
      setMessage('Your password has been changed successfully.');
      setPassword('');
      setConfirmPassword('');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Password reset could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#0B0C10] px-3 py-8 text-white min-[390px]:px-4 min-[390px]:py-12">
      <section className="w-full max-w-md rounded-[24px] border border-white/10 bg-[#11141C]/90 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.5)] min-[390px]:rounded-[32px] min-[390px]:p-6">
        <h1 className="text-[clamp(1.55rem,7vw,1.9rem)] font-black leading-tight tracking-[-0.03em] min-[390px]:text-3xl min-[390px]:tracking-[-0.04em]">Create new password</h1>
        <p className="mt-1.5 text-xs leading-5 text-white/60 min-[390px]:mt-2 min-[390px]:text-sm min-[390px]:leading-7">
          Enter a new password for your UGMOVIES247 account.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3 min-[390px]:mt-6 min-[390px]:space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.17em] text-white/45 min-[390px]:mb-2 min-[390px]:text-xs min-[390px]:tracking-[0.24em]">
              New Password
            </span>
            <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 focus-within:border-[#D90429] min-[390px]:px-4">
              <Lock size={17} className="text-white/45" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full bg-transparent px-2.5 py-3 text-sm text-white outline-none min-[390px]:px-3 min-[390px]:py-4 min-[390px]:text-base"
                autoComplete="new-password"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.17em] text-white/45 min-[390px]:mb-2 min-[390px]:text-xs min-[390px]:tracking-[0.24em]">
              Confirm Password
            </span>
            <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 focus-within:border-[#D90429] min-[390px]:px-4">
              <Lock size={17} className="text-white/45" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full bg-transparent px-2.5 py-3 text-sm text-white outline-none min-[390px]:px-3 min-[390px]:py-4 min-[390px]:text-base"
                autoComplete="new-password"
              />
            </div>
          </label>

          {(error || message) && (
            <div
              className={`rounded-2xl px-3 py-2.5 text-xs leading-5 min-[390px]:px-4 min-[390px]:py-3 min-[390px]:text-sm ${
                error
                  ? 'border border-red-500/25 bg-red-500/10 text-red-100'
                  : 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
              }`}
            >
              {error || message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-[#D90429] px-4 py-3.5 text-xs font-black uppercase tracking-[0.17em] text-white disabled:cursor-not-allowed disabled:opacity-60 min-[390px]:py-4 min-[390px]:text-sm min-[390px]:tracking-[0.24em]"
          >
            {loading ? 'Saving...' : 'Save Password'}
          </button>
        </form>

        <Link href="/login" className="mt-4 block text-center text-xs font-bold text-white/62 min-[390px]:mt-5 min-[390px]:text-sm">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center bg-[#0B0C10] px-3 py-8 text-white min-[390px]:px-4 min-[390px]:py-12">
          <section className="w-full max-w-md rounded-[24px] border border-white/10 bg-[#11141C]/90 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.5)] min-[390px]:rounded-[32px] min-[390px]:p-6">
            <p className="text-xs font-bold text-white/70 min-[390px]:text-sm">Loading secure reset form...</p>
          </section>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
