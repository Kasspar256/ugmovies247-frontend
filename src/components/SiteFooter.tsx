'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isLegalRoute } from '@/lib/legalRoutes';

const HIDDEN_PREFIXES = ['/admin'];

function shouldHideFooter(pathname: string) {
  return (
    isLegalRoute(pathname) ||
    HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

export default function SiteFooter() {
  const pathname = usePathname();

  if (shouldHideFooter(pathname)) {
    return null;
  }

  return (
    <footer className="hidden border-t border-white/8 bg-[#0B0C10] md:block">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 pb-8 pt-6 text-white/70 md:flex-row md:items-center md:justify-between md:px-8 lg:px-10">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.24em] text-white">UG Movies 247</div>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">
            Premium VJ-translated entertainment with clear legal access links for users, rights
            holders, and platform support.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold text-white/72">
          <Link href="/terms" className="transition-colors hover:text-white">
            Terms &amp; Conditions
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-white">
            Privacy Policy
          </Link>
          <Link href="/dmca" className="transition-colors hover:text-white">
            DMCA
          </Link>
        </div>
      </div>
    </footer>
  );
}
