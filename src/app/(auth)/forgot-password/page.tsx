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
      const result = (await sendResetPasswordEmail(email.trim())) as { message?: string };
      setMessage(result.message || 'Password reset email sent. Check your inbox and spam folder.');
    } catch (resetError) {
      setError(getFirebaseAuthErrorMessage(resetError));
      setDevDiagnostics(getAuthDevDiagnostics(resetError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#0B0C10]">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0B0C10]/90 via-[#0B0C10] to-[#0B0C10]" />

      <div className="relative z-10 flex min-h-svh flex-col px-3 py-4 min-[390px]:px-4 min-[390px]:py-6 md:px-8">
        <Link
          href={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors hover:text-[#D90429] min-[390px]:px-4 min-[390px]:text-sm min-[390px]:tracking-wider"
        >
          <ArrowLeft size={16} />
          Login
        </Link>

        <div className="flex flex-1 items-center justify-center py-4 min-[390px]:py-8">
          <div className="w-full max-w-md rounded-[24px] border border-white/10 bg-[#11141C]/85 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl min-[390px]:rounded-3xl min-[390px]:p-6 md:p-8">
            <h1 className="text-[clamp(1.55rem,7vw,1.9rem)] font-black uppercase leading-tight tracking-[-0.02em] text-white min-[390px]:text-3xl min-[390px]:tracking-tight">
              Reset Password
            </h1>
            <p className="mt-1.5 text-xs leading-5 text-[#9AA4B2] min-[390px]:mt-2 min-[390px]:text-sm">
              Enter your email and we&apos;ll send you a secure reset link.
            </p>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3 min-[390px]:mt-6 min-[390px]:space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 min-[390px]:mb-2 min-[390px]:text-xs min-[390px]:tracking-[0.25em]">
                  Email
                </span>
                <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 focus-within:border-[#D90429] min-[390px]:px-4">
                  <Mail size={17} className="text-white/45" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full bg-transparent px-2.5 py-3 text-sm text-white outline-none placeholder:text-white/30 min-[390px]:px-3 min-[390px]:py-4 min-[390px]:text-base"
                    placeholder="name@example.com"
                    autoComplete="email"
                  />
                </div>
              </label>

              {error && (
                <div className="rounded-2xl border border-[#D90429]/40 bg-[#D90429]/10 px-3 py-2.5 text-xs leading-5 text-red-100 min-[390px]:px-4 min-[390px]:py-3 min-[390px]:text-sm">
                  {error}
                </div>
              )}

              <AuthDevHelper items={devDiagnostics} />

              {message && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs leading-5 text-emerald-100 min-[390px]:px-4 min-[390px]:py-3 min-[390px]:text-sm">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#D90429] px-4 py-3.5 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-[#b00320] disabled:cursor-not-allowed disabled:bg-[#5E1623] min-[390px]:py-4 min-[390px]:text-sm min-[390px]:tracking-[0.3em]"
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
