'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

type MobileBackButtonProps = {
  fallbackHref: string;
  returnTo?: string | null;
  className?: string;
  iconSize?: number;
  tone?: 'dark' | 'light';
};

function getSafeInternalPath(value?: string | null) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  if (!value.startsWith('/') || value.startsWith('//')) {
    return '';
  }

  return value;
}

export default function MobileBackButton({
  fallbackHref,
  returnTo,
  className = '',
  iconSize = 20,
  tone = 'dark',
}: MobileBackButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const safeFallbackHref = getSafeInternalPath(fallbackHref) || '/';
  const safeReturnTo =
    getSafeInternalPath(returnTo) || getSafeInternalPath(searchParams.get('returnTo')) || '';

  const handleBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }

    const destination =
      safeReturnTo && safeReturnTo !== pathname ? safeReturnTo : safeFallbackHref;

    router.replace(destination);
  }, [pathname, router, safeFallbackHref, safeReturnTo]);

  const toneClasses =
    tone === 'light'
      ? 'text-slate-800 hover:text-slate-950 bg-white/80 border border-slate-300/80 hover:bg-white'
      : 'text-white hover:text-[#D90429] bg-[#1F2833]';

  return (
    <button
      type="button"
      onClick={handleBack}
      aria-label="Go back"
      className={`transition-colors p-1.5 rounded-full flex items-center justify-center ${toneClasses} ${className}`.trim()}
    >
      <ArrowLeft size={iconSize} />
    </button>
  );
}
