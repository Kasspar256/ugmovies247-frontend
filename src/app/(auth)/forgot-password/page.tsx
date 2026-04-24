'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import AuthDevHelper from '@/components/AuthDevHelper';
import { getAuthDevDiagnostics, getFirebaseAuthErrorMessage, sendResetPasswordEmail } from '@/lib/auth/client';

export default function ForgotPasswordPage() {
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || '/browse';
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [devDiagnostics, setDevDiagnostics] = useState<string[]>([]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setDevDiagnostics([]);

    if (!email.trim()) {
      setError('Enter the email address linked to your account.');
      return;
    }

    setLoading(true);

    try {
      await sendResetPasswordEmail(email.trim());
      setMessage('Password reset email sent. Check your inbox and spam folder.');
    } catch (resetError) {
      setError(getFirebaseAuthErrorMessage(resetError));
      setDevDiagnostics(getAuthDevDiagnostics(resetError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0B0C10]/90 via-[#0B0C10] to-[#0B0C10]" />

      <div className="relative z-10 min-h-screen flex flex-col px-4 py-6 md:px-8">
        <Link
          href={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:text-[#D90429]"
        >
          <ArrowLeft size={18} />
          Login
        </Link>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#11141C]/85 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl md:p-8">
            <h1 className="text-3xl font-black uppercase tracking-tight text-white">
              Reset Password
            </h1>
            <p className="mt-2 text-sm text-[#9AA4B2]">
              Enter your email and we&apos;ll send you a secure reset link.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.25em] text-white/60">
                  Email
                </span>
                <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
                  <Mail size={18} className="text-white/45" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
                    placeholder="name@example.com"
                    autoComplete="email"
                  />
                </div>
              </label>

              {error && (
                <div className="rounded-2xl border border-[#D90429]/40 bg-[#D90429]/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              )}

              <AuthDevHelper items={devDiagnostics} />

              {message && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#D90429] px-4 py-4 text-sm font-black uppercase tracking-[0.3em] text-white transition-colors hover:bg-[#b00320] disabled:cursor-not-allowed disabled:bg-[#5E1623]"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
