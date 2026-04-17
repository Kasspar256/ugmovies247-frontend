'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import MobileBackButton from './MobileBackButton';

type MobilePageHeaderProps = {
  title: string;
  fallbackHref: string;
  subtitle?: string;
  returnTo?: string | null;
  actionHref?: string;
  actionLabel?: string;
  actionIcon?: ReactNode;
  actionAriaLabel?: string;
  tone?: 'dark' | 'light';
};

export default function MobilePageHeader({
  title,
  fallbackHref,
  subtitle,
  returnTo,
  actionHref,
  actionLabel,
  actionIcon,
  actionAriaLabel,
  tone = 'dark',
}: MobilePageHeaderProps) {
  const isLight = tone === 'light';

  return (
    <header className="fixed top-4 left-4 right-4 z-50 md:hidden">
      <div className="flex items-center justify-between gap-3">
        <div
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-[26px] px-3 py-2 shadow-[0_6px_18px_rgba(0,0,0,0.18)] backdrop-blur-xl ${
            isLight
              ? 'border border-slate-300/80 bg-[#ECF0F4]/92'
              : 'border border-white/10 bg-[#1B2230]/62'
          }`}
        >
          <MobileBackButton
            fallbackHref={fallbackHref}
            returnTo={returnTo}
            tone={tone}
            className="h-[38px] w-[38px] rounded-full p-0"
          />
          <div className="min-w-0 flex-1">
            <h1
              className={`truncate text-sm font-black uppercase tracking-[0.24em] ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              {title}
            </h1>
            {subtitle ? (
              <p
                className={`mt-0.5 truncate text-[10px] font-black uppercase tracking-[0.2em] ${
                  isLight ? 'text-slate-500' : 'text-white/55'
                }`}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {actionHref && (actionLabel || actionIcon) ? (
          <Link
            href={actionHref}
            aria-label={actionAriaLabel || actionLabel || 'Open action'}
            className={`flex flex-shrink-0 items-center justify-center rounded-[24px] shadow-[0_6px_18px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-colors ${
              isLight
                ? 'border border-slate-300/80 bg-[#ECF0F4]/92 text-slate-900 hover:bg-white'
                : 'border border-white/10 bg-[#1B2230]/62 text-white hover:bg-[#24344A]/75 hover:text-white'
            } ${
              actionLabel ? 'min-w-[74px] px-3.5 py-3' : 'h-[46px] w-[46px]'
            }`}
          >
            {actionIcon ? (
              <span className={actionLabel ? 'mr-2' : ''}>{actionIcon}</span>
            ) : null}
            {actionLabel ? (
              <span
                className={`text-[10px] font-black uppercase tracking-[0.22em] ${
                  isLight ? 'text-slate-900' : 'text-white/92'
                }`}
              >
                {actionLabel}
              </span>
            ) : null}
          </Link>
        ) : (
          <Link
            href="/"
            aria-label="Go home"
            className="flex h-[46px] w-[68px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-[#1B2230]/62 shadow-[0_6px_18px_rgba(0,0,0,0.30)] backdrop-blur-xl"
          >
            <img
              src="/logow.png"
              alt="UG Movies 247"
              className="h-14 w-14 object-cover scale-125 translate-y-2"
            />
          </Link>
        )}
      </div>
    </header>
  );
}
