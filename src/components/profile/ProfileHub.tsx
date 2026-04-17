'use client';

import Link from 'next/link';
import { type ComponentType, useEffect, useState } from 'react';
import {
  Bell,
  Bookmark,
  ChevronRight,
  CreditCard,
  Download,
  Heart,
  HelpCircle,
  Loader2,
  LogOut,
  PencilLine,
  ReceiptText,
  Shield,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  fetchAccountProfile,
  formatAccountDate,
  getAccountAccessLabel,
  getAccountBadge,
  getAccountInitials,
  type AccountProfile,
} from '@/lib/accountProfile';
import { logoutCurrentUser } from '@/lib/auth/client';

function getTimeLeftLabel(profile: AccountProfile) {
  if (profile.role === 'admin') {
    return {
      label: 'Admin',
      className: 'border border-amber-500/25 bg-amber-500/10 text-amber-200',
    };
  }

  if (!profile.subscription?.isActive) {
    return {
      label: 'Free',
      className: 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    };
  }

  const expiresAtMs = new Date(profile.subscription.expiresAt || '').getTime();

  if (!Number.isFinite(expiresAtMs)) {
    return {
      label: 'Active',
      className: 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    };
  }

  const differenceMs = expiresAtMs - Date.now();

  if (differenceMs <= 0) {
    return {
      label: 'Ending soon',
      className: 'border border-amber-500/25 bg-amber-500/10 text-amber-100',
    };
  }

  const hourMs = 1000 * 60 * 60;
  const dayMs = hourMs * 24;

  if (differenceMs < dayMs) {
    const hoursLeft = Math.max(1, Math.ceil(differenceMs / hourMs));

    return {
      label: `${hoursLeft} ${hoursLeft === 1 ? 'hour' : 'hours'} left`,
      className: 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    };
  }

  const daysLeft = Math.max(1, Math.ceil(differenceMs / dayMs));

  return {
    label: `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`,
    className: 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
  };
}

function SummarySkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="rounded-[28px] border border-white/10 bg-[#11141C]/80 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 rounded-full bg-white/10" />
            <div className="h-3 w-48 rounded-full bg-white/10" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="h-16 rounded-2xl bg-white/5" />
          <div className="h-16 rounded-2xl bg-white/5" />
        </div>
        <div className="mt-4 h-14 rounded-2xl bg-white/5" />
      </div>
      <div className="rounded-[24px] border border-white/10 bg-[#11141C]/70 p-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-[68px] rounded-2xl bg-white/5" />
        ))}
      </div>
    </div>
  );
}

function ProfileSummary({
  profile,
}: {
  profile: AccountProfile;
}) {
  const badge = getAccountBadge(profile);
  const accessLabel = getAccountAccessLabel(profile);
  const accessDescription = profile.subscription?.isActive
    ? 'Manage, extend, or switch your premium plan.'
    : 'Upgrade or purchase a plan.';
  const accessMeta = getTimeLeftLabel(profile);

  return (
    <section className="rounded-[28px] border border-white/10 bg-[#11141C]/85 p-5 shadow-[0_22px_50px_rgba(0,0,0,0.35)]">
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#1B2230] text-lg font-black uppercase tracking-[0.18em] text-white">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.name}
              className="h-full w-full object-cover"
            />
          ) : (
            getAccountInitials(profile.name, profile.email)
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-black tracking-[-0.03em] text-white">
              {profile.name}
            </h1>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.24em] ${
                badge === 'Premium'
                  ? 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                  : badge === 'Admin'
                    ? 'border border-amber-500/25 bg-amber-500/10 text-amber-200'
                    : 'border border-white/10 bg-white/5 text-white/70'
              }`}
            >
              {badge}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-white/68">{profile.email}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">
            Joined
          </div>
          <div className="mt-1.5 text-base font-semibold text-white">
            {formatAccountDate(profile.createdAt)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">
            Last Login
          </div>
          <div className="mt-1.5 text-base font-semibold text-white">
            {formatAccountDate(profile.lastLoginAt, { includeTime: true })}
          </div>
        </div>
      </div>

      <Link
        href="/subscribe"
        className="mt-4 block rounded-[24px] border border-[#D90429]/18 bg-[linear-gradient(135deg,rgba(217,4,41,0.16),rgba(22,27,38,0.92))] px-4 py-5 shadow-[0_18px_42px_rgba(0,0,0,0.22)] transition-colors hover:border-[#D90429]/38 hover:bg-[linear-gradient(135deg,rgba(217,4,41,0.2),rgba(26,34,50,0.96))]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-[11px] font-black uppercase tracking-[0.22em] text-white/45">
            Current Access
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] ${accessMeta.className}`}
          >
            {accessMeta.label}
          </span>
        </div>

        <div className="min-w-0">
          <div className="mt-2.5 text-lg font-semibold text-white">{accessLabel}</div>
          <div className="mt-2 text-sm leading-6 text-white/62">{accessDescription}</div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-[#D90429]">
          <span className="text-xs font-black uppercase tracking-[0.22em] text-[#FFB3C1]">Open</span>
          <ChevronRight size={16} />
        </div>
      </Link>
    </section>
  );
}

function NavigationGroup({
  title,
  items,
}: {
  title: string;
  items: Array<{
    href: string;
    icon: ComponentType<{ className?: string; size?: number }>;
    label: string;
    description: string;
  }>;
}) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-[#11141C]/72 p-2 shadow-[0_16px_34px_rgba(0,0,0,0.24)]">
      <div className="px-3 pb-2 pt-1 text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
        {title}
      </div>
      <div className="space-y-[14px]">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-4 rounded-[20px] px-3 py-3.5 transition-colors hover:bg-white/5"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/5 text-[#D90429]">
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-white">{item.label}</div>
                <div className="mt-1 text-sm leading-6 text-white/56">{item.description}</div>
              </div>
              <ChevronRight className="shrink-0 text-white/35" size={18} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function ProfileHub() {
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      try {
        const nextProfile = await fetchAccountProfile();

        if (!mounted) {
          return;
        }

        setProfile(nextProfile);
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Your profile could not be loaded.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError('');

    try {
      await logoutCurrentUser();
      router.replace('/login');
    } catch (signOutError) {
      setSignOutError(signOutError instanceof Error ? signOutError.message : 'Sign out failed.');
      setSigningOut(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)] pt-8 text-white md:px-8 md:pb-16 md:pt-[112px] lg:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
            Profile
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white md:text-4xl">
            Your account
          </h1>
        </div>

        {loading ? (
          <SummarySkeleton />
        ) : error || !profile ? (
          <div className="rounded-[28px] border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-100">
            {error || 'Your profile could not be loaded right now.'}
          </div>
        ) : (
          <div className="space-y-4">
            <ProfileSummary profile={profile} />

            <NavigationGroup
              title="Account"
              items={[
                {
                  href: '/profile/settings',
                  icon: PencilLine,
                  label: 'Edit Profile',
                  description: 'Update your name and account preferences.',
                },
                {
                  href: '/watchlist',
                  icon: Bookmark,
                  label: 'My List',
                  description: 'Saved titles you want to come back to.',
                },
                {
                  href: '/likes',
                  icon: Heart,
                  label: 'Liked Movies',
                  description: 'Movies you have liked across the app.',
                },
                {
                  href: '/downloads',
                  icon: Download,
                  label: 'Downloads',
                  description: 'See titles saved to your account history.',
                },
                {
                  href: '/subscribe',
                  icon: CreditCard,
                  label: 'Premium Plans',
                  description: 'Choose, extend, or switch your plan.',
                },
                {
                  href: '/profile/payments',
                  icon: ReceiptText,
                  label: 'Payment History',
                  description: 'See your recent premium payments clearly.',
                },
                {
                  href: '/notifications',
                  icon: Bell,
                  label: 'Notifications',
                  description: 'Open your app updates and latest upload alerts.',
                },
                {
                  href: '/profile/security',
                  icon: Shield,
                  label: 'Security',
                  description: 'Password help and account protection tools.',
                },
              ]}
            />

            <NavigationGroup
              title="Support"
              items={[
                {
                  href: '/profile/help',
                  icon: HelpCircle,
                  label: 'Support & Contact',
                  description: 'Support email, developer WhatsApp, and community links.',
                },
              ]}
            />

            <section className="rounded-[24px] border border-white/10 bg-[#11141C]/72 p-5 shadow-[0_16px_34px_rgba(0,0,0,0.24)]">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                Session
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="mt-4 flex w-full items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-4 text-left transition-colors hover:border-red-500/35 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <div>
                  <div className="text-base font-semibold text-white">Sign out</div>
                  <div className="mt-1.5 text-sm leading-6 text-white/54">
                    End your current session on this device.
                  </div>
                </div>
                {signingOut ? (
                  <Loader2 size={18} className="animate-spin text-white/60" />
                ) : (
                  <LogOut size={18} className="text-red-200" />
                )}
              </button>

              {signOutError ? (
                <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {signOutError}
                </div>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
