'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { canonicalUrl } from '@/lib/seo';

export default function CanonicalLink() {
  const pathname = usePathname();

  useEffect(() => {
    const href = canonicalUrl(pathname || '/');
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');

    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }

    link.href = href;
  }, [pathname]);

  return null;
}
