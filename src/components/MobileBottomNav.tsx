'use client';

import Link from 'next/link';
import { Film, Home, Search, Tv2, User } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { isLegalRoute } from '@/lib/legalRoutes';
import { isAppInReview } from '@/lib/appReview';

const MOBILE_NAV_HEIGHT_PX = 64;
const MOBILE_NAV_PREFETCH_ROUTES = [
  '/browse',
  '/movies',
  '/series',
  '/search',
  '/profile',
  '/notifications',
  ...(isAppInReview ? [] : ['/downloads']),
];

function shouldShowMobileNav(pathname: string) {
  if (!pathname) return false;
  if (pathname === '/') return false;

  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/forgot-password' ||
    pathname.startsWith('/mobile-checkout')
  ) {
    return false;
  }

  if (pathname.startsWith('/admin')) return false;
  if (isLegalRoute(pathname)) return false;

  return true;
}

function getActiveTab(pathname: string) {
  if (pathname.startsWith('/movies')) return 'movies';
  if (pathname.startsWith('/series')) return 'series';
  if (pathname.startsWith('/search')) return 'search';

  if (
    pathname.startsWith('/profile') ||
    pathname.startsWith('/subscribe') ||
    pathname.startsWith('/watchlist') ||
    pathname.startsWith('/downloads') ||
    pathname.startsWith('/likes') ||
    pathname.startsWith('/notifications') ||
    pathname.startsWith('/request')
  ) {
    return 'profile';
  }

  return 'home';
}

function NavItem({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  const itemColor = active ? 'text-[#D90429]' : 'text-white/62 hover:text-white';
  const iconColor = active ? '[&_svg]:text-[#D90429]' : '[&_svg]:text-white/62';

  return (
    <Link
      href={href}
      className={`flex w-16 flex-col items-center gap-1 transition-colors active:scale-95 ${itemColor}`}
    >
      <span className={iconColor}>{children}</span>
      <span className={`text-[10px] font-semibold ${itemColor}`}>{label}</span>
    </Link>
  );
}

export default function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const shouldShow = shouldShowMobileNav(pathname);
  const activeTab = getActiveTab(pathname);

  useEffect(() => {
    if (!shouldShow) return;

    MOBILE_NAV_PREFETCH_ROUTES.forEach((href) => {
      router.prefetch(href);
    });
  }, [router, shouldShow]);

  if (!shouldShow) {
    return null;
  }

  return (
    <nav
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-[9999] flex w-full items-center justify-around border-t border-white/5 bg-[#0B0C10] px-2 md:hidden"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        width: '100%',
        zIndex: 9999,
        height: `calc(${MOBILE_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom))`,
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxSizing: 'border-box',
        backgroundColor: '#0B0C10',
      }}
      aria-label="Mobile navigation"
    >
      <NavItem href="/browse" label="Home" active={activeTab === 'home'}>
        <Home className="h-6 w-6" strokeWidth={2.8} />
      </NavItem>
      <NavItem href="/movies" label="Movies" active={activeTab === 'movies'}>
        <Film className="h-6 w-6" strokeWidth={2.8} />
      </NavItem>
      <NavItem href="/series" label="Series" active={activeTab === 'series'}>
        <Tv2 className="h-6 w-6" strokeWidth={2.8} />
      </NavItem>
      <NavItem href="/search" label="Search" active={activeTab === 'search'}>
        <Search className="h-6 w-6" strokeWidth={2.8} />
      </NavItem>
      <NavItem href="/profile" label="Profile" active={activeTab === 'profile'}>
        <User className="h-6 w-6" strokeWidth={2.8} />
      </NavItem>
    </nav>
  );
}
