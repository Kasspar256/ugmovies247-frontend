'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isAppInReview } from '@/lib/appReview';
import { isLegalRoute } from '@/lib/legalRoutes';

const HIDDEN_PREFIXES = ['/admin'];

function shouldHideFooter(pathname: string) {
  return (
    pathname === '/' ||
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
        <div className="space-y-4">
          <div className="text-sm font-black uppercase tracking-[0.24em] text-white">UG Movies 247</div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/42">
              Contact Details
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-white/72">
              {isAppInReview ? (
                <span>info@ugmovies247.com</span>
              ) : (
                <>
                  <a href="mailto:info@ugmovies247.com" className="transition-colors hover:text-white">
                    info@ugmovies247.com
                  </a>
                  <a
                    href="https://wa.me/256727261375"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-white"
                  >
                    WhatsApp: +256 727 261375
                  </a>
                </>
              )}
            </div>
          </div>
          <div className="text-xs font-semibold text-white/45">2026 (c) All Rights Reserved.</div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold text-white/72 md:justify-end">
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
