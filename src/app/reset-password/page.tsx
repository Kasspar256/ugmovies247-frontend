'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { confirmPasswordReset } from '@/lib/auth/client';

export default function ResetPasswordPage() {
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
    <main className="flex min-h-screen items-center justify-center bg-[#0B0C10] px-4 py-12 text-white">
      <section className="w-full max-w-md rounded-[32px] border border-white/10 bg-[#11141C]/90 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
        <h1 className="text-3xl font-black tracking-[-0.04em]">Create new password</h1>
        <p className="mt-2 text-sm leading-7 text-white/60">
          Enter a new password for your UG Movies 247 account.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-white/45">
              New Password
            </span>
            <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
              <Lock size={18} className="text-white/45" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full bg-transparent px-3 py-4 text-white outline-none"
                autoComplete="new-password"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-white/45">
              Confirm Password
            </span>
            <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
              <Lock size={18} className="text-white/45" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full bg-transparent px-3 py-4 text-white outline-none"
                autoComplete="new-password"
              />
            </div>
          </label>

          {(error || message) && (
            <div
              className={`rounded-2xl px-4 py-3 text-sm ${
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
            className="w-full rounded-2xl bg-[#D90429] px-4 py-4 text-sm font-black uppercase tracking-[0.24em] text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Saving...' : 'Save Password'}
          </button>
        </form>

        <Link href="/login" className="mt-5 block text-center text-sm font-bold text-white/62">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}

