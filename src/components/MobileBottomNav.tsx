'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clapperboard, Film, Home, Search, User } from 'lucide-react';

function NavItem({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 transition ${
        active ? 'text-[#D90429]' : 'text-white/48'
      }`}
    >
      <span className="relative">{children}</span>
      <span className="text-[11px] font-black leading-none">{label}</span>
    </Link>
  );
}

export default function MobileBottomNav() {
  const pathname = usePathname() || '';
  const shouldShow = !pathname.startsWith('/admin') && pathname !== '/login' && pathname !== '/signup';

  if (!shouldShow) {
    return null;
  }

  const activeTab = pathname === '/'
    ? 'home'
    : pathname.startsWith('/vjs')
      ? 'vjs'
      : pathname.startsWith('/genres') || pathname.startsWith('/category')
        ? 'genres'
        : pathname.startsWith('/search')
          ? 'search'
          : pathname.startsWith('/profile')
            ? 'profile'
            : 'home';

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/8 bg-[#07090F]/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-18px_45px_rgba(0,0,0,0.45)] backdrop-blur-xl md:hidden">
      <div className="mx-auto flex max-w-md items-center justify-between">
        <NavItem href="/" label="Home" active={activeTab === 'home'}>
          <Home className="h-6 w-6" />
        </NavItem>
        <NavItem href="/vjs" label="VJs" active={activeTab === 'vjs'}>
          <Clapperboard className="h-6 w-6" />
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
      </div>
    </nav>
  );
}
