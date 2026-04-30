import { buildPageMetadata } from '@/lib/seo';
import { isAppInReview } from '@/lib/appReview';

export const metadata = buildPageMetadata({
  title: isAppInReview
    ? 'Movie Trailer Genres - Action, Comedy, Drama & VJ Catalogs'
    : 'Movie Genres - Action, Comedy, Drama & Luganda Translated Movies',
  description: isAppInReview
    ? 'Explore action, comedy, drama, horror, romance, series, and VJ trailer catalog entries by genre on UG Movies 247.'
    : 'Explore action, comedy, drama, horror, romance, series, and Luganda translated movies by genre on UG Movies 247.',
  path: '/genres',
  keywords: isAppInReview
    ? ['uganda movie trailer genres', 'VJ trailer categories', 'Luganda translated trailer catalog']
    : ['uganda action movies streaming', 'uganda comedy movies online', 'luganda translated action movies'],
});

export default function GenresLayout({ children }: { children: React.ReactNode }) {
  return children;
}
