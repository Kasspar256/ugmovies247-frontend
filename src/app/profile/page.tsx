'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Bell,
  Bookmark,
  Download,
  LogOut,
  Mail,
  Save,
  Shield,
  User as UserIcon,
} from 'lucide-react';
import { logoutCurrentUser } from '@/lib/auth/client';

type ProfileUser = {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
  lastLoginAt: string;
  avatarUrl?: string;
  subscription?: {
    planName: string;
    isActive: boolean;
    expiresAt: string;
  };
};

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      try {
        const response = await fetch('/api/auth/me');
        const payload = await response.json();

        if (!mounted) {
          return;
        }

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load your profile.');
        }

        setUser(payload.user);
        setName(payload.user.name || '');
        setAvatarUrl(payload.user.avatarUrl || '');
      } catch (profileError) {
        if (mounted) {
          setError(profileError instanceof Error ? profileError.message : 'Failed to load your account.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);

    try {
      const response = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          avatarUrl: avatarUrl.trim(),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update your profile.');
      }

      setUser((current) =>
        current
          ? {
              ...current,
              name: name.trim(),
              avatarUrl: avatarUrl.trim(),
            }
          : current
      );
      setMessage('Profile updated successfully.');
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : 'Failed to update your profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);

    try {
      await logoutCurrentUser();
      router.replace('/login');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-28 pt-16 md:pt-24 px-4 font-sans">
      <header className="md:hidden fixed top-0 left-0 w-full z-40 bg-[#0B0C10]/95 backdrop-blur-md border-b border-[#1F2833] flex items-center p-4 shadow-xl">
        <button
          onClick={() => router.back()}
          className="text-white hover:text-[#D90429] transition-colors absolute left-4 bg-[#1F2833] p-1.5 rounded-full flex items-center justify-center"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-black text-white tracking-widest uppercase w-full text-center">My Account</h1>
      </header>

      <div className="max-w-4xl mx-auto md:grid md:grid-cols-[0.9fr_1.1fr] md:gap-8 mt-4 md:mt-10">
        <div className="rounded-3xl border border-white/10 bg-[#11141C]/80 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <div className="flex flex-col items-center text-center">
            <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-[#D90429] bg-[#1F2833] shadow-[0_0_20px_rgba(217,4,41,0.2)]">
              <img
                src={avatarUrl || user?.avatarUrl || 'https://api.dicebear.com/7.x/bottts/svg?seed=ugmovies'}
                alt={user?.name || 'User'}
                className="w-full h-full object-cover"
              />
            </div>
            <h1 className="mt-4 text-2xl font-black text-white uppercase">{user?.name || 'User'}</h1>
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300">
              {user?.role === 'admin' ? 'Admin' : 'Member'}
            </p>
          </div>

          <div className="mt-6 space-y-4 text-sm text-white/80">
            <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
              <Mail size={16} className="text-[#D90429]" />
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-white/45">Email</div>
                <div className="font-semibold">{user?.email}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
              <Shield size={16} className="text-[#D90429]" />
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-white/45">Joined</div>
                <div className="font-semibold">
                  {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
              <Bell size={16} className="text-[#D90429]" />
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-white/45">Last Login</div>
                <div className="font-semibold">
                  {user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Link href="/watchlist" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-white hover:border-[#D90429] flex items-center gap-2">
              <Bookmark size={16} />
              My List
            </Link>
            <Link href="/downloads" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-white hover:border-[#D90429] flex items-center gap-2">
              <Download size={16} />
              Downloads
            </Link>
          </div>

          <Link
            href="/profile/billing"
            className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white hover:border-[#D90429]"
          >
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-white/45">Subscription</div>
              <div className="mt-1 font-bold">
                {user?.subscription?.isActive ? user.subscription.planName || 'Premium Active' : 'Premium Locked'}
              </div>
            </div>
            <div className="text-right text-xs text-white/55">
              {user?.subscription?.expiresAt ? `Expires ${new Date(user.subscription.expiresAt).toLocaleDateString()}` : 'View billing'}
            </div>
          </Link>

          {user?.role === 'admin' && (
            <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-amber-200">
                Admin Account
              </div>
              <p className="mt-2 text-sm text-amber-50/85">
                This account has elevated dashboard access and protected admin tools.
              </p>
              <Link
                href="/admin"
                className="mt-4 inline-flex items-center rounded-xl border border-amber-300/20 bg-black/20 px-4 py-3 text-xs font-black uppercase tracking-[0.28em] text-amber-100 hover:border-amber-200/40"
              >
                Open Admin Dashboard
              </Link>
            </div>
          )}
        </div>

        <div className="mt-6 md:mt-0 rounded-3xl border border-white/10 bg-[#11141C]/80 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <h2 className="text-lg font-black uppercase tracking-[0.25em] text-white">Account Settings</h2>

          <form onSubmit={handleSave} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.25em] text-white/60">
                Display Name
              </span>
              <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
                <UserIcon size={18} className="text-white/45" />
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
                  placeholder="Your name"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.25em] text-white/60">
                Avatar URL
              </span>
              <div className="flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 focus-within:border-[#D90429]">
                <UserIcon size={18} className="text-white/45" />
                <input
                  type="url"
                  value={avatarUrl}
                  onChange={(event) => setAvatarUrl(event.target.value)}
                  className="w-full bg-transparent px-3 py-4 text-white outline-none placeholder:text-white/30"
                  placeholder="https://..."
                />
              </div>
            </label>

            {error && (
              <div className="rounded-2xl border border-[#D90429]/40 bg-[#D90429]/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}

            {message && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-2xl bg-[#D90429] px-4 py-4 text-sm font-black uppercase tracking-[0.3em] text-white transition-colors hover:bg-[#b00320] disabled:cursor-not-allowed disabled:bg-[#5E1623] flex items-center justify-center gap-2"
            >
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            Password resets are available from the{' '}
            <Link href="/forgot-password" className="font-bold text-white hover:text-[#D90429]">
              reset password
            </Link>{' '}
            page.
          </div>

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="mt-6 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-sm font-black uppercase tracking-[0.3em] text-white transition-colors hover:border-[#D90429] hover:text-[#D90429] disabled:cursor-not-allowed disabled:text-white/40 flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            {loggingOut ? 'Signing Out...' : 'Sign Out'}
          </button>
        </div>
      </div>
    </div>
  );
}
