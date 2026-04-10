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
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-3xl border border-red-900/60 bg-neutral-950 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-red-800/60 bg-red-900/20">
            <ShieldAlert className="text-red-500" size={28} />
          </div>
          <h1 className="text-2xl font-black uppercase tracking-[0.25em] text-red-500">
            Restricted Area
          </h1>
          <p className="mt-3 text-sm text-gray-400">
            Admin access is role-protected. Sign in with an authorized account.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-red-500">
            <Mail size={18} className="text-white/45" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
              placeholder="Admin email"
              autoComplete="email"
            />
          </div>

          <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-red-500">
            <Lock size={18} className="text-white/45" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
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
          <div className="mt-4 rounded-2xl border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <AuthDevHelper items={devDiagnostics} />

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-2xl bg-red-700 px-4 py-4 text-sm font-black uppercase tracking-[0.3em] text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-neutral-700"
        >
          {loading ? 'Verifying...' : 'Decrypt & Enter'}
        </button>
      </form>
    </div>
  );
}
