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
          '/movies',
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
          '/login',
          '/signup',
          '/forgot-password',
          '/reset-password',
          '/verify-email',
          '/subscribe',
        ],
        disallow: [
          '/admin',
          '/api',
          '/downloads',
          '/likes',
          '/notifications',
          '/profile',
          '/watchlist',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
