'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthDevHelper from '@/components/AuthDevHelper';
import GoogleAuthButton from '@/components/GoogleAuthButton';
import { APP_REVIEW_SESSION_COOKIE, isAppInReview } from '@/lib/appReview';
import {
  completeGoogleRedirectSignIn,
  continueWithGoogle,
  getAuthDevDiagnostics,
  getFirebaseAuthErrorMessage,
  hasPendingGoogleRedirectSignIn,
  loginWithEmailPassword,
  restoreServerSessionFromClientAuth,
} from '@/lib/auth/client';
import { fetchAuthStatus, readCachedAuthStatus } from '@/lib/auth/status-client';
import { isNativeAndroidApp } from '@/lib/mobile/nativeApp';

function getSessionNoticeFromReason(reason: string) {
  if (reason === 'session-replaced') {
    return 'Your session has ended because this account was signed in on another device.';
  }

  if (reason === 'session-revoked') {
    return 'Your session has ended. Please sign in again to continue.';
  }

  if (reason === 'session-missing') {
    return 'Please sign in again. Your secure session could not be restored on this device.';
  }

  return '';
}

function hasReviewSessionCookie() {
  if (typeof document === 'undefined') {
    return false;
  }

  return document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .some((entry) => entry === `${APP_REVIEW_SESSION_COOKIE}=1`);
}

function shouldHideLoginWhileRestoring() {
  return (
    isNativeAndroidApp() ||
    readCachedAuthStatus()?.authenticated === true ||
    hasPendingGoogleRedirectSignIn()
  );
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = useMemo(() => searchParams.get('redirect') || '/browse', [searchParams]);
  const sessionReason = useMemo(() => searchParams.get('reason') || '', [searchParams]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [checkingExistingSession, setCheckingExistingSession] = useState(() =>
    shouldHideLoginWhileRestoring()
  );
  const [sessionNotice, setSessionNotice] = useState('');
  const [error, setError] = useState('');
  const [devDiagnostics, setDevDiagnostics] = useState<string[]>([]);

  const finishLoginNavigation = useCallback((target: string, accountEmail = '') => {
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

  useEffect(() => {
    setSessionNotice(getSessionNoticeFromReason(sessionReason));
  }, [sessionReason]);

  const clearFeedback = () => {
    if (sessionNotice) {
      setSessionNotice('');
    }

    if (error) {
      setError('');
    }

    if (devDiagnostics.length) {
      setDevDiagnostics([]);
    }
  };

  useEffect(() => {
    let active = true;

    const finishRedirectLogin = async () => {
      let navigatingAway = false;

      try {
        const status = await fetchAuthStatus({ force: true }).catch(() => null);

        if (!active) {
          return;
        }

        if (status?.authenticated) {
          navigatingAway = true;
          finishLoginNavigation(redirectTarget || '/browse', status.user?.email || '');
          return;
        }

        const restoredSession = await restoreServerSessionFromClientAuth().catch(() => null);

        if (!active) {
          return;
        }

        if (restoredSession) {
          navigatingAway = true;
          finishLoginNavigation(redirectTarget || restoredSession.redirectTo || '/browse', '');
          return;
        }

        if (!hasPendingGoogleRedirectSignIn()) {
          return;
        }

        setGoogleLoading(true);
        const result = await completeGoogleRedirectSignIn();

        if (!active || !result?.session) {
          return;
        }

        navigatingAway = true;
        finishLoginNavigation(redirectTarget || result.session.redirectTo || '/', '');
      } catch (authError) {
        if (!active) {
          return;
        }

        setError(getFirebaseAuthErrorMessage(authError));
        setDevDiagnostics(getAuthDevDiagnostics(authError));
      } finally {
        if (active) {
          setGoogleLoading(false);

          if (!navigatingAway) {
            setCheckingExistingSession(false);
          }
        }
      }
    };

    void finishRedirectLogin();

    return () => {
      active = false;
    };
  }, [finishLoginNavigation, redirectTarget]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSessionNotice('');
    setError('');
    setDevDiagnostics([]);

    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password.');
      return;
    }

    setLoading(true);

    try {
      const result = await loginWithEmailPassword(email.trim(), password, { rememberMe });
      finishLoginNavigation(redirectTarget || result.session.redirectTo || '/', email);
    } catch (authError) {
      setError(getFirebaseAuthErrorMessage(authError));
      setDevDiagnostics(getAuthDevDiagnostics(authError));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setSessionNotice('');
    setError('');
    setDevDiagnostics([]);
    setGoogleLoading(true);

    try {
      const result = await continueWithGoogle({ rememberMe });

      if (!('session' in result)) {
        return;
      }

      finishLoginNavigation(redirectTarget || result.session.redirectTo || '/', '');
    } catch (authError) {
      setError(getFirebaseAuthErrorMessage(authError));
      setDevDiagnostics(getAuthDevDiagnostics(authError));
      setGoogleLoading(false);
    }
  };

  if (checkingExistingSession) {
    return (
      <div
        className="min-h-screen bg-[#0B0C10]"
        aria-label="Opening UGMOVIES247"
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-[0.14] blur-sm scale-105"
        style={{ backgroundImage: 'url(https://image.tmdb.org/t/p/original/1E5baAaEse26fej7uHcjOgEE2t2.jpg)' }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,16,0.9),rgba(11,12,16,0.82)_28%,rgba(11,12,16,0.88)_58%,rgba(11,12,16,0.95))]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(11,12,16,0.2)_58%,rgba(11,12,16,0.38)_100%)]" />

      <div className="relative z-10 min-h-screen flex flex-col px-4 py-6 md:px-8">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:text-[#D90429]"
          >
            <ArrowLeft size={18} />
            Back
          </Link>
          <div className="hidden md:block text-xs uppercase tracking-[0.3em] text-white/50">
            Secure Login
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#11141C]/86 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl md:p-8">
            <div className="mb-5 text-center">
              <div className="m-0 flex h-[120px] items-center justify-center overflow-hidden py-1 sm:h-[138px]">
                <img
                  src="/logow.png"
                  alt="UGMOVIES247"
                  className="h-[116px] w-auto max-w-none scale-[2.1] object-contain drop-shadow-[0_0_42px_rgba(217,4,41,0.42)] sm:h-[136px] sm:scale-[2.25]"
                />
              </div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white">
                Welcome Back
              </h1>
              <p className="mt-2 text-sm text-[#9AA4B2]">
                Sign in to keep browsing movies, series, watchlists, and your account.
              </p>
            </div>

            <div className="space-y-4">
              <GoogleAuthButton
                onClick={handleGoogleLogin}
                disabled={loading}
                loading={googleLoading}
                idleLabel="Continue with Google"
                loadingLabel="Connecting with Google..."
              />

              <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.26em] text-white/35">
                <div className="h-px flex-1 bg-white/10" />
                <span>Or continue with email</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {sessionNotice && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {sessionNotice}
                </div>
              )}

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.25em] text-white/60">
                  Email
                </span>
                <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
                  <Mail size={18} className="text-white/45" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => {
                      clearFeedback();
                      setEmail(event.target.value);
                    }}
                    className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
                    placeholder="name@example.com"
                    autoComplete="email"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.25em] text-white/60">
                  Password
                </span>
                <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
                  <Lock size={18} className="text-white/45" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => {
                      clearFeedback();
                      setPassword(event.target.value);
                    }}
                    className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
                    placeholder="Enter your password"
                    autoComplete="current-password"
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

              <div className="flex items-center justify-between gap-4 pt-1">
                <label className="flex items-center gap-3 text-sm text-white/80">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    className="h-5 w-5 rounded border-white/15 bg-white/5 accent-[#D90429]"
                  />
                  <span>Remember me</span>
                </label>
                <Link
                  href={`/forgot-password?redirect=${encodeURIComponent(redirectTarget)}`}
                  className="text-sm font-semibold text-[#D90429] hover:text-white"
                >
                  Forgot password?
                </Link>
              </div>

              {error && (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 shadow-[0_10px_24px_rgba(120,72,10,0.18)]">
                  {error}
                </div>
              )}

              <AuthDevHelper items={devDiagnostics} />

              <button
                type="submit"
                disabled={loading || googleLoading}
                className="w-full rounded-2xl bg-[#D90429] px-4 py-4 text-sm font-black uppercase tracking-[0.3em] text-white transition-colors hover:bg-[#b00320] disabled:cursor-not-allowed disabled:bg-[#5E1623]"
              >
                {loading ? 'Signing In...' : 'Sign In'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-white/55">
              New here?{' '}
              <Link
                href={`/signup?redirect=${encodeURIComponent(redirectTarget)}`}
                className="font-bold text-white hover:text-[#D90429]"
              >
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
