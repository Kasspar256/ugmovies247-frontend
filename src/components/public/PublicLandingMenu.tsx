'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export default function PublicLandingMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Open landing menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-black/28 text-white shadow-[0_14px_34px_rgba(0,0,0,0.28)] backdrop-blur-md transition-colors hover:bg-black/40"
      >
        <MoreVertical size={22} strokeWidth={2.5} />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] w-[11.5rem] overflow-hidden rounded-[28px] border border-white/14 bg-[rgba(19,17,24,0.78)] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-[22px]">
          <Link
            href="/privacy"
            onClick={() => setOpen(false)}
            className="block rounded-[20px] px-5 py-4 text-[1.02rem] font-semibold text-white/92 transition-colors hover:bg-white/6"
          >
            Privacy
          </Link>
          <Link
            href="/help"
            onClick={() => setOpen(false)}
            className="block rounded-[20px] px-5 py-4 text-[1.02rem] font-semibold text-white/92 transition-colors hover:bg-white/6"
          >
            Help
          </Link>
        </div>
      ) : null}
    </div>
  );
}
