'use client';

import { useEffect, useState } from 'react';

export default function Loading() {
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setShowFallback(true);
    }, 8000);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-[#0B0C10] px-6 text-center">
      <div className="flex max-w-sm flex-col items-center">
        <div className="animate-pulse">
          <div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-b-[#D90429] border-l-transparent border-r-transparent border-t-[#D90429]" />
          <p className="mt-4 text-sm font-medium tracking-widest text-[#888888]">UGMOVIES247</p>
        </div>

        {showFallback ? (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
            <p className="text-sm font-semibold leading-6 text-white/72">
              This is taking longer than expected. You can continue safely from here.
            </p>
            <div className="mt-4 grid gap-3">
              <a
                href="/login?redirect=%2Fbrowse"
                className="rounded-2xl bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white"
              >
                Open Login
              </a>
              <a
                href="/browse"
                className="rounded-2xl border border-white/10 bg-white/[0.08] px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white"
              >
                Try Home
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
