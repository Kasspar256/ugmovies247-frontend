import { buildPageMetadata } from '@/lib/seo';

export const metadata = buildPageMetadata({
  title: 'Search Ugandan Movies, Luganda Translated Movies & VJ Movies',
  description:
    'Search UG Movies 247 for Ugandan movies, Luganda translated movies, Uganda translated films, VJ movies, series, genres, and latest entertainment.',
  path: '/search',
  keywords: ['search ugandan movies', 'where to watch ugandan movies', 'VJ translated movies Uganda'],
});

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
