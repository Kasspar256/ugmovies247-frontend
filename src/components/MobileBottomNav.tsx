'use client';

import Link from 'next/link';
import { Home, Search, User, Mic2, Film } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const MOBILE_NAV_HEIGHT_PX = 64;

function shouldShowMobileNav(pathname: string) {
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

  return true;
}

function getActiveTab(pathname: string) {
  if (pathname.startsWith('/vjs')) {
    return 'vjs';
  }

  if (pathname.startsWith('/genres')) {
    return 'genres';
  }

  if (pathname.startsWith('/search')) {
    return 'search';
  }

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
  return (
    <Link
      href={href}
      className={`flex w-16 flex-col items-center gap-1 transition-colors ${
        active ? 'text-[#D90429]' : 'text-gray-500 hover:text-[#D90429]'
      }`}
    >
      {children}
      <span className="text-[10px] font-bold">{label}</span>
    </Link>
  );
}

export default function MobileBottomNav() {
  const pathname = usePathname();

  if (!shouldShowMobileNav(pathname)) {
    return null;
  }

  const activeTab = getActiveTab(pathname);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[9999] flex w-full items-center justify-around border-t border-white/5 bg-[#0B0C10] px-2 md:hidden"
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
      <NavItem href="/" label="Home" active={activeTab === 'home'}>
        <Home className="h-6 w-6" />
      </NavItem>
      <NavItem href="/vjs" label="VJs" active={activeTab === 'vjs'}>
        <Mic2 className="h-6 w-6" />
      </NavItem>
      <NavItem href="/genres" label="Genres" active={activeTab === 'genres'}>
        <Film className="h-6 w-6" />
      </NavItem>
      <NavItem href="/search" label="Search" active={activeTab === 'search'}>
        <Search className="h-6 w-6" />
      </NavItem>
      <NavItem href="/profile" label="Profile" active={activeTab === 'profile'}>
        <User className="h-6 w-6" />
      </NavItem>
    </nav>
  );
}
