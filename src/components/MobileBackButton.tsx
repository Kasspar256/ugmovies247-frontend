'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

type MobileBackButtonProps = {
  fallbackHref: string;
  returnTo?: string | null;
  className?: string;
  iconSize?: number;
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

  return (
    <button
      type="button"
      onClick={handleBack}
      aria-label="Go back"
      className={`text-white hover:text-[#D90429] transition-colors bg-[#1F2833] p-1.5 rounded-full flex items-center justify-center ${className}`.trim()}
    >
      <ArrowLeft size={iconSize} />
    </button>
  );
}
