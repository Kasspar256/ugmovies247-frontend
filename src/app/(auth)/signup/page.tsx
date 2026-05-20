'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthDevHelper from '@/components/AuthDevHelper';
import GoogleAuthButton from '@/components/GoogleAuthButton';
import {
  completeGoogleRedirectSignIn,
  continueWithGoogle,
  getAuthDevDiagnostics,
  getFirebaseAuthErrorMessage,
  hasPendingGoogleRedirectSignIn,
  restoreServerSessionFromClientAuth,
  signupWithEmailPassword,
} from '@/lib/auth/client';
import { fetchAuthStatus } from '@/lib/auth/status-client';
import { APP_REVIEW_SESSION_COOKIE, isAppInReview } from '@/lib/appReview';

function hasReviewSessionCookie() {
  if (typeof document === 'undefined') {
    return false;
  }

  return document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .some((entry) => entry === `${APP_REVIEW_SESSION_COOKIE}=1`);
}

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = useMemo(() => searchParams.get('redirect') || '/browse', [searchParams]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [devDiagnostics, setDevDiagnostics] = useState<string[]>([]);

  const finishSignupNavigation = useCallback((target: string, accountEmail = '') => {
    const destination = target || '/browse';
    const needsReviewModeReload =
      isAppInReview ||
      hasReviewSessionCookie() ||
      accountEmail.trim().toLowerCase() === 'test@ugmovies247.com';

    if (needsReviewModeReload) {
      window.location.replace(destination);
      return;
    }

    router.replace(destination);
  }, [router]);

  const clearFeedback = () => {
    if (error) {
      setError('');
    }

    if (devDiagnostics.length) {
      setDevDiagnostics([]);
    }
  };

  useEffect(() => {
    let active = true;

    const finishRedirectSignup = async () => {
      const status = await fetchAuthStatus({ force: true }).catch(() => null);

      if (!active) {
        return;
      }

      if (status?.authenticated) {
        finishSignupNavigation(redirectTarget || '/browse', status.user?.email || '');
        return;
      }

      const restoredSession = await restoreServerSessionFromClientAuth().catch(() => null);

      if (!active) {
        return;
      }

      if (restoredSession) {
        finishSignupNavigation(redirectTarget || restoredSession.redirectTo || '/browse', '');
        return;
      }

      if (!hasPendingGoogleRedirectSignIn()) {
        return;
      }

      setGoogleLoading(true);

      try {
        const result = await completeGoogleRedirectSignIn();

        if (!active || !result?.session) {
          return;
        }

        finishSignupNavigation(redirectTarget || result.session.redirectTo || '/', '');
      } catch (authError) {
        if (!active) {
          return;
        }

        setError(getFirebaseAuthErrorMessage(authError));
        setDevDiagnostics(getAuthDevDiagnostics(authError));
      } finally {
        if (active) {
          setGoogleLoading(false);
        }
      }
    };

    void finishRedirectSignup();

    return () => {
      active = false;
    };
  }, [finishSignupNavigation, redirectTarget]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
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
      const result = await signupWithEmailPassword({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      finishSignupNavigation(redirectTarget || result.session.redirectTo || '/', email);
    } catch (authError) {
      setError(getFirebaseAuthErrorMessage(authError));
      setDevDiagnostics(getAuthDevDiagnostics(authError));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    clearFeedback();
    setError('');
    setDevDiagnostics([]);
    setGoogleLoading(true);

    try {
      const result = await continueWithGoogle({ rememberMe: true });

      if (!('session' in result)) {
        return;
      }

      finishSignupNavigation(redirectTarget || result.session.redirectTo || '/', '');
    } catch (authError) {
      setError(getFirebaseAuthErrorMessage(authError));
      setDevDiagnostics(getAuthDevDiagnostics(authError));
      setGoogleLoading(false);
    }
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#0B0C10]">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-[0.13] blur-sm scale-105"
        style={{ backgroundImage: 'url(https://image.tmdb.org/t/p/original/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg)' }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,16,0.9),rgba(11,12,16,0.82)_28%,rgba(11,12,16,0.88)_58%,rgba(11,12,16,0.95))]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(11,12,16,0.2)_58%,rgba(11,12,16,0.38)_100%)]" />

      <div className="relative z-10 flex min-h-svh flex-col px-3 py-4 min-[390px]:px-4 min-[390px]:py-6 md:px-8">
        <div className="flex items-center justify-between">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors hover:text-[#D90429] min-[390px]:px-4 min-[390px]:text-sm min-[390px]:tracking-wider"
          >
            <ArrowLeft size={16} />
            Login
          </Link>
          <div className="hidden md:block text-xs uppercase tracking-[0.3em] text-white/50">
            Create Account
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-4 min-[390px]:py-8">
          <div className="w-full max-w-lg rounded-[24px] border border-white/10 bg-[#11141C]/86 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl min-[390px]:rounded-3xl min-[390px]:p-6 md:p-8">
            <div className="mb-4 text-center min-[390px]:mb-5">
              <div className="m-0 flex h-[86px] items-center justify-center overflow-hidden py-1 min-[390px]:h-[120px] sm:h-[138px]">
                <img
                  src="/logow.png"
                  alt="UGMOVIES247"
                  className="h-[84px] w-auto max-w-none scale-[1.9] object-contain drop-shadow-[0_0_42px_rgba(217,4,41,0.42)] min-[390px]:h-[116px] min-[390px]:scale-[2.1] sm:h-[136px] sm:scale-[2.25]"
                />
              </div>
              <h1 className="mt-1 text-[clamp(1.55rem,7vw,1.9rem)] font-black uppercase leading-tight tracking-[-0.02em] text-white min-[390px]:mt-2 min-[390px]:text-3xl min-[390px]:tracking-tight">
                Create Your Account
              </h1>
              <p className="mt-1.5 text-xs leading-5 text-[#9AA4B2] min-[390px]:mt-2 min-[390px]:text-sm">
                Get secure access to movies, series, watchlists, and your personal profile.
              </p>
            </div>

            <div className="space-y-3 min-[390px]:space-y-4">
              <GoogleAuthButton
                onClick={handleGoogleSignup}
                disabled={loading}
                loading={googleLoading}
                idleLabel="Sign up with Google"
                loadingLabel="Connecting with Google..."
              />

              <div className="flex items-center gap-2 text-center text-[8px] font-black uppercase tracking-[0.16em] text-white/35 min-[390px]:gap-3 min-[390px]:text-[10px] min-[390px]:tracking-[0.26em]">
                <div className="h-px flex-1 bg-white/10" />
                <span>Or create with email</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-3 space-y-3 min-[390px]:mt-4 min-[390px]:space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 min-[390px]:mb-2 min-[390px]:text-xs min-[390px]:tracking-[0.25em]">
                  Name
                </span>
                <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 focus-within:border-[#D90429] min-[390px]:px-4">
                  <User size={17} className="text-white/45" />
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => {
                      clearFeedback();
                      setName(event.target.value);
                    }}
                    className="w-full bg-transparent px-2.5 py-3 text-sm text-white outline-none placeholder:text-white/30 min-[390px]:px-3 min-[390px]:py-4 min-[390px]:text-base"
                    placeholder="Your full name"
                    autoComplete="name"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 min-[390px]:mb-2 min-[390px]:text-xs min-[390px]:tracking-[0.25em]">
                  Email
                </span>
                <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 focus-within:border-[#D90429] min-[390px]:px-4">
                  <Mail size={17} className="text-white/45" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => {
                      clearFeedback();
                      setEmail(event.target.value);
                    }}
                    className="w-full bg-transparent px-2.5 py-3 text-sm text-white outline-none placeholder:text-white/30 min-[390px]:px-3 min-[390px]:py-4 min-[390px]:text-base"
                    placeholder="name@example.com"
                    autoComplete="email"
                  />
                </div>
              </label>

              <div className="grid gap-3 min-[390px]:gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 min-[390px]:mb-2 min-[390px]:text-xs min-[390px]:tracking-[0.25em]">
                    Password
                  </span>
                  <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 focus-within:border-[#D90429] min-[390px]:px-4">
                    <Lock size={17} className="text-white/45" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => {
                        clearFeedback();
                        setPassword(event.target.value);
                      }}
                      className="w-full bg-transparent px-2.5 py-3 text-sm text-white outline-none placeholder:text-white/30 min-[390px]:px-3 min-[390px]:py-4 min-[390px]:text-base"
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
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 min-[390px]:mb-2 min-[390px]:text-xs min-[390px]:tracking-[0.25em]">
                    Confirm
                  </span>
                  <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 focus-within:border-[#D90429] min-[390px]:px-4">
                    <Lock size={17} className="text-white/45" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => {
                        clearFeedback();
                        setConfirmPassword(event.target.value);
                      }}
                      className="w-full bg-transparent px-2.5 py-3 text-sm text-white outline-none placeholder:text-white/30 min-[390px]:px-3 min-[390px]:py-4 min-[390px]:text-base"
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
                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-100 shadow-[0_10px_24px_rgba(120,72,10,0.18)] min-[390px]:px-4 min-[390px]:py-3 min-[390px]:text-sm">
                  {error}
                </div>
              )}

              <AuthDevHelper items={devDiagnostics} />

              <button
                type="submit"
                disabled={loading || googleLoading}
                className="w-full rounded-2xl bg-[#D90429] px-4 py-3.5 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-[#b00320] disabled:cursor-not-allowed disabled:bg-[#5E1623] min-[390px]:py-4 min-[390px]:text-sm min-[390px]:tracking-[0.3em]"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            <p className="mt-4 text-center text-xs leading-5 text-white/55 min-[390px]:mt-6 min-[390px]:text-sm">
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
