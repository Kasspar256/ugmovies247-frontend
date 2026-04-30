import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/browse',
          '/genres',
          '/series',
          '/search',
          '/vjs',
          '/category',
          '/movie',
          '/privacy',
          '/terms',
          '/account-deletion',
          '/help',
          '/dmca',
        ],
        disallow: [
          '/admin',
          '/api',
          '/downloads',
          '/likes',
          '/notifications',
          '/profile',
          '/subscribe',
          '/watchlist',
          '/login',
          '/signup',
          '/forgot-password',
          '/reset-password',
          '/verify-email',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
