import { buildPageMetadata } from '@/lib/seo';

export const metadata = buildPageMetadata({
  title: 'Movie Genres - Action, Comedy, Drama & Luganda Translated Movies',
  description:
    'Explore action, comedy, drama, horror, romance, series, and Luganda translated movies by genre on UG Movies 247.',
  path: '/genres',
  keywords: ['uganda action movies streaming', 'uganda comedy movies online', 'luganda translated action movies'],
});

export default function GenresLayout({ children }: { children: React.ReactNode }) {
  return children;
}
