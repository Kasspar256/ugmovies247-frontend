import type { MetadataRoute } from 'next';
import { GENRE_DIRECTORY, VJ_DIRECTORY } from '@/config/constants';
import { getSeoMovieCatalog } from '@/lib/server/seoMovies';
import { absoluteUrl } from '@/lib/seo';

const staticRoutes = [
  '/',
  '/browse',
  '/movies',
  '/genres',
  '/series',
  '/search',
  '/vjs',
  '/request',
  '/category/latest',
  '/category/uganda-movies',
  '/category/luganda-translated-movies',
  '/category/uganda-translated-movies',
  '/category/vj-movies',
  '/category/action',
  '/category/comedy',
  '/category/trending',
  '/category/romance',
  '/category/drama',
  '/category/horror',
  '/category/indian-movies',
  '/category/vj-junior',
  '/category/vj-emmy',
  '/category/vj-jingo',
  '/category/omutaka-ice-p',
  '/privacy',
  '/terms',
  '/account-deletion',
  '/help',
  '/dmca',
];

const genreRoutes = GENRE_DIRECTORY.map((genre) => `/genres/${encodeURIComponent(genre)}`);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const movies = await getSeoMovieCatalog(5000);
  const movieRoutes = movies.map((movie) => ({
    url: absoluteUrl(`/movie/${encodeURIComponent(movie.id)}`),
    lastModified: movie.updatedAt || movie.date_added || movie.createdAt || now,
    changeFrequency: 'weekly' as const,
    priority: 0.72,
  }));
  const vjRoutes = VJ_DIRECTORY.map((vj) => ({
    url: absoluteUrl(`/vjs/${vj.id}`),
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  return [
    ...staticRoutes.map((route) => ({
      url: absoluteUrl(route),
      lastModified: now,
      changeFrequency: route === '/' ? 'daily' as const : 'weekly' as const,
      priority: route === '/' ? 1 : 0.78,
    })),
    ...genreRoutes.map((route) => ({
      url: absoluteUrl(route),
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.72,
    })),
    ...vjRoutes,
    ...movieRoutes,
  ];
}
