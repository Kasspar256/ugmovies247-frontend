'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Lock, Mail, ShieldAlert } from 'lucide-react';
import AuthDevHelper from '@/components/AuthDevHelper';
import { getAuthDevDiagnostics, getFirebaseAuthErrorMessage, loginWithEmailPassword, logoutCurrentUser } from '@/lib/auth/client';

export default function AdminLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devDiagnostics, setDevDiagnostics] = useState<string[]>([]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setDevDiagnostics([]);
    setLoading(true);

    try {
      const { session } = await loginWithEmailPassword(email.trim(), password);

      if (session.role !== 'admin') {
        await logoutCurrentUser();
        throw new Error('This account is not allowed to access the admin dashboard.');
      }

      router.replace(redirectTarget);
      router.refresh();
    } catch (authError) {
      setError(
        authError instanceof Error && authError.message.includes('not allowed')
          ? authError.message
          : getFirebaseAuthErrorMessage(authError)
      );
      setDevDiagnostics(getAuthDevDiagnostics(authError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-black px-3 py-6 text-white min-[390px]:px-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-[24px] border border-red-900/60 bg-neutral-950 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.55)] min-[390px]:rounded-3xl min-[390px]:p-8"
      >
        <div className="mb-5 text-center min-[390px]:mb-8">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-red-800/60 bg-red-900/20 min-[390px]:mb-4 min-[390px]:h-16 min-[390px]:w-16">
            <ShieldAlert className="text-red-500" size={24} />
          </div>
          <h1 className="text-xl font-black uppercase tracking-[0.16em] text-red-500 min-[390px]:text-2xl min-[390px]:tracking-[0.25em]">
            Restricted Area
          </h1>
          <p className="mt-2 text-xs leading-5 text-gray-400 min-[390px]:mt-3 min-[390px]:text-sm">
            Admin access is role-protected. Sign in with an authorized account.
          </p>
        </div>

        <div className="space-y-3 min-[390px]:space-y-4">
          <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 focus-within:border-red-500 min-[390px]:px-4">
            <Mail size={17} className="text-white/45" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full bg-transparent px-2.5 py-3 text-sm text-white outline-none placeholder:text-white/30 min-[390px]:px-3 min-[390px]:py-4 min-[390px]:text-base"
              placeholder="Admin email"
              autoComplete="email"
            />
          </div>

          <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 focus-within:border-red-500 min-[390px]:px-4">
            <Lock size={17} className="text-white/45" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full bg-transparent px-2.5 py-3 text-sm text-white outline-none placeholder:text-white/30 min-[390px]:px-3 min-[390px]:py-4 min-[390px]:text-base"
              placeholder="Password"
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
        </div>

        {error && (
          <div className="mt-3 rounded-2xl border border-red-800/50 bg-red-900/20 px-3 py-2.5 text-xs leading-5 text-red-100 min-[390px]:mt-4 min-[390px]:px-4 min-[390px]:py-3 min-[390px]:text-sm">
            {error}
          </div>
        )}

        <AuthDevHelper items={devDiagnostics} />

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-2xl bg-red-700 px-4 py-3.5 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-neutral-700 min-[390px]:mt-6 min-[390px]:py-4 min-[390px]:text-sm min-[390px]:tracking-[0.3em]"
        >
          {loading ? 'Verifying...' : 'Decrypt & Enter'}
        </button>
      </form>
    </div>
  );
}
