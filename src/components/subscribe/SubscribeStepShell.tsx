'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import EmailVerificationWarning from '@/components/EmailVerificationWarning';
import { useSubscribeFlow } from '@/components/subscribe/SubscribeFlowProvider';

type SubscribeStepShellProps = {
  title: string;
  subtitle?: string;
  backHref: string;
  returnTo?: string;
  actionHref?: string;
  actionLabel?: string;
  tone?: 'dark' | 'light';
  maxWidthClassName?: string;
  children: ReactNode;
};

export default function SubscribeStepShell({
  title,
  subtitle,
  backHref,
  returnTo,
  actionHref,
  actionLabel,
  tone = 'dark',
  maxWidthClassName = 'max-w-5xl',
  children,
}: SubscribeStepShellProps) {
  const isLight = tone === 'light';
  const { emailVerified } = useSubscribeFlow();

  return (
    <div
      className={`min-h-screen px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-16 md:px-8 md:pb-16 md:pt-[118px] lg:px-10 ${
        isLight ? 'bg-[#DDE3E8] text-[#10131A]' : 'bg-[#0B0C10] text-white'
      }`}
    >
      <MobilePageHeader
        title={title}
        subtitle={subtitle}
        fallbackHref={backHref}
        returnTo={returnTo}
        actionHref={actionHref}
        actionLabel={actionLabel}
        tone={tone}
      />

      <div className={`mx-auto ${maxWidthClassName}`}>
        <div className="hidden items-center justify-between gap-3 md:flex">
          <Link
            href={backHref}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition-all active:scale-[0.97] ${
              isLight
                ? 'border-slate-300/80 bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)]'
                : 'border-white/10 bg-white/5 text-white'
            }`}
          >
            <ChevronLeft size={16} />
            Back
          </Link>

          {actionHref && actionLabel ? (
            <Link
              href={actionHref}
              className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.22em] transition-all active:scale-[0.97] ${
                isLight
                  ? 'border-slate-300/80 bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)]'
                  : 'border-[#D90429]/30 bg-[#D90429]/10 text-[#FFB3C1]'
              }`}
            >
              {actionLabel}
            </Link>
          ) : (
            <div />
          )}
        </div>

        <div className="mt-6 space-y-6">
          <EmailVerificationWarning emailVerified={emailVerified} />
          {children}
        </div>
      </div>
    </div>
  );
}
