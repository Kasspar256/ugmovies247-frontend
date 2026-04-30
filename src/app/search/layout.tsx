import { buildPageMetadata } from '@/lib/seo';
import { isAppInReview } from '@/lib/appReview';

export const metadata = buildPageMetadata({
  title: isAppInReview
    ? 'Search Movie Trailers, Genres & VJ Catalogs'
    : 'Search Ugandan Movies, Luganda Translated Movies & VJ Movies',
  description: isAppInReview
    ? 'Search UG Movies 247 for movie trailers, VJ catalog entries, genres, series details, and latest discovery lists.'
    : 'Search UG Movies 247 for Ugandan movies, Luganda translated movies, Uganda translated films, VJ movies, series, genres, and latest entertainment.',
  path: '/search',
  keywords: isAppInReview
    ? ['search movie trailers Uganda', 'VJ trailer catalog', 'movie discovery Uganda']
    : ['search ugandan movies', 'where to watch ugandan movies', 'VJ translated movies Uganda'],
});

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
