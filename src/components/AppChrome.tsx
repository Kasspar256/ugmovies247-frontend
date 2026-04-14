'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import DesktopHeader from './DesktopHeader';
import MobileBottomNav from './MobileBottomNav';

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

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showMobileNav = useMemo(() => shouldShowMobileNav(pathname), [pathname]);

  return (
    <>
      <DesktopHeader />
      {children}
      {showMobileNav ? <MobileBottomNav /> : null}
    </>
  );
}
