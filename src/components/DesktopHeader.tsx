'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Bell, Clock3, Download, Search, UserCircle2 } from 'lucide-react';
import { isLegalRoute } from '@/lib/legalRoutes';

function shouldShowDesktopHeader(pathname: string) {
  if (!pathname) {
    return false;
  }

  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/forgot-password'
  ) {
    return false;
  }

  if (pathname.startsWith('/admin')) {
    return false;
  }

  if (isLegalRoute(pathname)) {
    return false;
  }

  return true;
}

function isActivePath(pathname: string, href: string) {
  if (href === '/') {
    return pathname === '/';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

const PRIMARY_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/vjs', label: 'VJs' },
  { href: '/genres', label: 'Genres' },
  { href: '/search', label: 'Search' },
];

const QUICK_ACTIONS = [
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/downloads', label: 'Downloads', icon: Download },
];
const DESKTOP_PREFETCH_ROUTES = ['/', '/vjs', '/genres', '/search', '/profile', '/notifications', '/downloads'];

type SubscriptionSnapshot = {
  status?: string;
  expiresAt?: string;
};

function getTimeLeftLabel(subscription: SubscriptionSnapshot | null) {
  if (!subscription || subscription.status !== 'active' || !subscription.expiresAt) {
    return '';
  }

  const expiresAtMs = new Date(subscription.expiresAt).getTime();

  if (!Number.isFinite(expiresAtMs)) {
    return '';
  }

  const diffMs = expiresAtMs - Date.now();

  if (diffMs <= 0) {
    return 'Expired';
  }

  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const monthMs = 30 * dayMs;

  if (diffMs >= monthMs) {
    const months = Math.ceil(diffMs / monthMs);
    return `${months} month${months === 1 ? '' : 's'} left`;
  }

  if (diffMs >= dayMs) {
    const days = Math.ceil(diffMs / dayMs);
    return `${days} day${days === 1 ? '' : 's'} left`;
  }

  const hours = Math.max(1, Math.ceil(diffMs / hourMs));
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
}

export default function DesktopHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [subscription, setSubscription] = useState<SubscriptionSnapshot | null>(null);
  const shouldShow = shouldShowDesktopHeader(pathname);

  useEffect(() => {
    if (!shouldShow) {
      return;
    }

    DESKTOP_PREFETCH_ROUTES.forEach((href) => {
      router.prefetch(href);
    });
  }, [router, shouldShow]);

  useEffect(() => {
    let cancelled = false;

    const loadSubscription = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          if (!cancelled) {
            setSubscription(null);
          }
          return;
        }

        const data = await response.json();

        if (!cancelled) {
          setSubscription(data?.user?.subscription ?? null);
        }
      } catch {
        if (!cancelled) {
          setSubscription(null);
        }
      }
    };

    loadSubscription();

    return () => {
      cancelled = true;
    };
  }, []);

  const timeLeftLabel = useMemo(() => getTimeLeftLabel(subscription), [subscription]);

  if (!shouldShow) {
    return null;
  }

  return (
    <header className="fixed inset-x-0 top-0 z-[70] hidden border-b border-white/8 bg-[#0A0D13] shadow-[0_18px_45px_rgba(0,0,0,0.34)] md:block">
      <div className="mx-auto max-w-[1440px] px-6 lg:px-10">
        <div className="flex h-[88px] items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3 lg:gap-6">
            <Link
              href="/"
              className="flex h-12 items-center justify-center overflow-hidden rounded-full bg-[#111723] px-1 transition-transform duration-200 hover:scale-[1.02]"
            >
              <img
                src="/logow.png"
                alt="UG Movies 247"
                className="h-[132px] w-auto max-w-none translate-y-[8px] object-contain"
              />
            </Link>

            <nav className="flex items-center gap-2 rounded-full bg-[#121926] px-2 py-1.5">
              {PRIMARY_LINKS.map((link) => {
                const active = isActivePath(pathname, link.href);

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-full px-4 py-2 text-[12px] font-black uppercase tracking-[0.24em] transition-colors ${
                      active
                        ? 'bg-white text-[#0B0C10]'
                        : 'text-white/65 hover:bg-white/6 hover:text-white'
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full bg-[#121926] p-1.5">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                const active = isActivePath(pathname, action.href);

                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    aria-label={action.label}
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                      active
                        ? 'bg-[#D90429] text-white'
                        : 'text-white/72 hover:bg-white/6 hover:text-white'
                    }`}
                  >
                    <Icon size={18} strokeWidth={2.15} />
                  </Link>
                );
              })}

              <Link
                href="/search"
                aria-label="Search"
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                  isActivePath(pathname, '/search')
                    ? 'bg-[#D90429] text-white'
                    : 'text-white/72 hover:bg-white/6 hover:text-white'
                }`}
              >
                <Search size={18} strokeWidth={2.15} />
              </Link>
            </div>

            <Link
              href="/profile"
              className={`flex items-center gap-3 rounded-full border border-transparent px-3 py-1.5 transition-colors ${
                isActivePath(pathname, '/profile')
                  ? 'border-[#D90429]/40 bg-[#D90429]/12 text-white'
                  : 'bg-[#121926] text-white/80 hover:text-white'
              }`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/6 text-white">
                <UserCircle2 size={20} strokeWidth={2.1} />
              </div>
              <span className="pr-2 text-xs font-black uppercase tracking-[0.22em]">Profile</span>
            </Link>

            {timeLeftLabel ? (
              <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-100">
                <Clock3 size={15} strokeWidth={2.2} className="text-emerald-300" />
                <span>{timeLeftLabel}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
