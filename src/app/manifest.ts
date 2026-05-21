import type { MetadataRoute } from 'next';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: 'UGMOVIES247',
    description: SITE_DESCRIPTION,
    start_url: '/browse',
    scope: '/',
    display: 'standalone',
    background_color: '#08090D',
    theme_color: '#0B0C10',
    orientation: 'portrait',
    categories: ['entertainment', 'movies', 'video'],
    icons: [
      {
        src: '/siteicon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/siteicon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
