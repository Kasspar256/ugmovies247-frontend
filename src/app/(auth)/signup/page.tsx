'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthDevHelper from '@/components/AuthDevHelper';
import { getAuthDevDiagnostics, getFirebaseAuthErrorMessage, signupWithEmailPassword } from '@/lib/auth/client';

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = useMemo(() => searchParams.get('redirect') || '/', [searchParams]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devDiagnostics, setDevDiagnostics] = useState<string[]>([]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setDevDiagnostics([]);

    if (!name.trim()) {
      setError('Enter your name.');
      return;
    }

    if (!email.trim()) {
      setError('Enter your email address.');
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
      await signupWithEmailPassword({
        name: name.trim(),
        email: email.trim(),
        password,
      });

      router.replace(redirectTarget);
      router.refresh();
    } catch (authError) {
      setError(getFirebaseAuthErrorMessage(authError));
      setDevDiagnostics(getAuthDevDiagnostics(authError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-15 blur-md scale-105"
        style={{ backgroundImage: 'url(https://image.tmdb.org/t/p/original/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg)' }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0B0C10]/90 via-[#0B0C10] to-[#0B0C10]" />

      <div className="relative z-10 min-h-screen flex flex-col px-4 py-6 md:px-8">
        <div className="flex items-center justify-between">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:text-[#D90429]"
          >
            <ArrowLeft size={18} />
            Login
          </Link>
          <div className="hidden md:block text-xs uppercase tracking-[0.3em] text-white/50">
            Create Account
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#11141C]/85 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl md:p-8">
            <div className="mb-8 text-center">
              <img
                src="/logow.png"
                alt="UG Movies 247"
                className="mx-auto h-28 w-auto object-contain drop-shadow-[0_0_35px_rgba(217,4,41,0.45)]"
              />
              <h1 className="mt-4 text-3xl font-black uppercase tracking-tight text-white">
                Create Your Account
              </h1>
              <p className="mt-2 text-sm text-[#9AA4B2]">
                Get secure access to movies, series, watchlists, downloads, and your personal profile.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.25em] text-white/60">
                  Name
                </span>
                <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
                  <User size={18} className="text-white/45" />
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
                    placeholder="Your full name"
                    autoComplete="name"
                  />
                </div>
              </label>

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

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-[0.25em] text-white/60">
                    Password
                  </span>
                  <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
                    <Lock size={18} className="text-white/45" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
                      placeholder="Create password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="text-white/50 transition-colors hover:text-white"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-[0.25em] text-white/60">
                    Confirm
                  </span>
                  <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
                    <Lock size={18} className="text-white/45" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
                      placeholder="Confirm password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((current) => !current)}
                      className="text-white/50 transition-colors hover:text-white"
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </label>
              </div>

              {error && (
                <div className="rounded-2xl border border-[#D90429]/40 bg-[#D90429]/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              )}

              <AuthDevHelper items={devDiagnostics} />

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#D90429] px-4 py-4 text-sm font-black uppercase tracking-[0.3em] text-white transition-colors hover:bg-[#b00320] disabled:cursor-not-allowed disabled:bg-[#5E1623]"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-white/55">
              Already have an account?{' '}
              <Link
                href={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
                className="font-bold text-white hover:text-[#D90429]"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
