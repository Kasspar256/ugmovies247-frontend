'use client';

import Link from 'next/link';
import { VJ_DIRECTORY } from '@/config/constants';
import { ChevronRight, Search as SearchIcon } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';

export default function VJsDirectory() {
  return (
    <div className="min-h-screen bg-[#05070B] text-white pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[84px] md:px-8 md:pb-14 md:pt-[118px] lg:px-10">
      <MobilePageHeader
        title="VJs"
        subtitle="Browse translators"
        fallbackHref="/browse"
        actionHref="/search"
        actionIcon={<SearchIcon size={18} />}
        actionAriaLabel="Search movies"
      />

      <main className="mx-auto max-w-[1180px] px-4 sm:px-5 md:px-0">
        <header className="hidden md:block">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white">
            VJs
          </h1>
          <p className="mt-2 text-sm text-white/54">
            Browse translators
          </p>
          <div className="mt-5 h-px w-full bg-white/8" />
        </header>

        <section className="mt-5 md:mt-8">
          <div className="rounded-[20px] border border-white/8 bg-[#0B0F15] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.28)] md:p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3 text-sm text-white/52">
                <span className="font-medium">{VJ_DIRECTORY.length} translators</span>
              </div>

              <div className="relative w-full md:max-w-[380px]">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-white/38">
                  <SearchIcon size={17} />
                </span>
                <input
                  type="text"
                  placeholder="Search VJs"
                  aria-label="Search VJs"
                  className="w-full rounded-[16px] border border-white/8 bg-white/[0.02] py-3 pl-11 pr-4 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-white/14 focus:bg-white/[0.03]"
                  onChange={(e) => {
                    const val = e.target.value.toLowerCase();
                    const cards = document.querySelectorAll('.vj-card');
                    cards.forEach((el: any) => {
                      const vjName = el.getAttribute('data-vjname')?.toLowerCase() || '';
                      if (vjName.includes(val)) {
                        el.style.display = 'block';
                      } else {
                        el.style.display = 'none';
                      }
                    });
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 pb-20 md:mt-6">
          {VJ_DIRECTORY.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
              {VJ_DIRECTORY.map((vj) => (
                <Link
                  href={`/vjs/${vj.id}`}
                  key={vj.id}
                  data-vjname={vj.name}
                  className="vj-card group block"
                >
                  <article className="flex items-center justify-between rounded-[18px] border border-white/8 bg-[#0A0E14] px-4 py-4 transition-colors duration-200 hover:border-white/12 hover:bg-white/[0.035]">
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-white sm:text-base">
                        {vj.name}
                      </h2>
                      <p className="mt-1 text-xs text-white/42 sm:text-sm">
                        Browse collection
                      </p>
                    </div>

                    <div className="ml-4 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] text-white/42 transition-all duration-200 group-hover:border-white/14 group-hover:text-white/68">
                      <ChevronRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[260px] items-center justify-center rounded-[20px] border border-dashed border-white/10 bg-[#0A0E14] px-6 text-center">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.02em] text-white">
                  No VJs available
                </h2>
                <p className="mt-2 text-sm text-white/48">
                  Translators will appear here when they are added.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
