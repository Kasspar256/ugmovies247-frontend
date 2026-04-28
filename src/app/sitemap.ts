import type { MetadataRoute } from 'next';
import { VJ_DIRECTORY } from '@/config/constants';
import { getSeoMovieCatalog } from '@/lib/server/seoMovies';
import { canonicalUrl } from '@/lib/seo';

const publicStaticRoutes = [
  '/',
  '/browse',
  '/series',
  '/genres',
  '/vjs',
  '/category/latest',
  '/category/uganda-movies',
  '/category/luganda-translated-movies',
  '/category/uganda-translated-movies',
  '/category/vj-movies',
  '/category/action',
  '/category/comedy',
  '/category/trending',
  '/privacy',
  '/terms',
  '/help',
  '/dmca',
];

const genreRoutes = [
  'Action',
  'Comedy',
  'Drama',
  'Horror',
  'Indian',
  'K-Drama',
  'Romance',
  'Sci-Fi',
  'Thriller',
].map((genre) => `/genres/${encodeURIComponent(genre)}`);

function sitemapEntry(
  path: string,
  options: {
    lastModified: Date | string;
    changeFrequency?: MetadataRoute.Sitemap[number]['changeFrequency'];
    priority?: number;
  }
): MetadataRoute.Sitemap[number] {
  return {
    url: canonicalUrl(path),
    lastModified: options.lastModified,
    changeFrequency: options.changeFrequency || 'weekly',
    priority: options.priority || 0.7,
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const movies = await getSeoMovieCatalog(1000);

  const staticEntries = publicStaticRoutes.map((route) =>
    sitemapEntry(route, {
      lastModified: now,
      changeFrequency: route === '/' || route === '/browse' ? 'daily' : 'weekly',
      priority: route === '/' ? 1 : route === '/browse' ? 0.9 : 0.72,
    })
  );

  const genreEntries = genreRoutes.map((route) =>
    sitemapEntry(route, {
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.72,
    })
  );

  const vjEntries = VJ_DIRECTORY.map((vj) =>
    sitemapEntry(`/vjs/${vj.id}`, {
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    })
  );

  const movieEntries = movies
    .filter((movie) => movie.id)
    .map((movie) =>
      sitemapEntry(`/movie/${encodeURIComponent(movie.id)}`, {
        lastModified: movie.updatedAt || movie.date_added || movie.createdAt || now,
        changeFrequency: 'weekly',
        priority: 0.82,
      })
    );

  return [...staticEntries, ...genreEntries, ...vjEntries, ...movieEntries];
}
