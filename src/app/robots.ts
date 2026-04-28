import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/_next/static/',
          '/browse',
          '/category',
          '/genres',
          '/movie',
          '/series',
          '/vjs',
          '/privacy',
          '/terms',
          '/help',
          '/dmca',
          '/favicon.png',
          '/siteicon.png',
          '/logow.png',
          '/manifest.webmanifest',
        ],
        disallow: [
          '/admin',
          '/api',
          '/auth',
          '/billing',
          '/downloads',
          '/forgot-password',
          '/likes',
          '/login',
          '/mobile-checkout',
          '/notifications',
          '/profile',
          '/request',
          '/reset-password',
          '/signup',
          '/subscribe',
          '/verify-email',
          '/watchlist',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
