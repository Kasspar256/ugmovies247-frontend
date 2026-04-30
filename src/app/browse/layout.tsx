import { buildPageMetadata } from '@/lib/seo';
import { isAppInReview } from '@/lib/appReview';

export const metadata = buildPageMetadata({
  title: isAppInReview ? 'Browse Movie Trailers - UG Movies 247' : 'Browse Movies & Series - UG Movies 247',
  description: isAppInReview
    ? 'Browse latest movie trailers, VJ catalog entries, genres, and discovery lists on UG Movies 247.'
    : 'Browse latest movies, Uganda translated movies, Luganda translated films, VJ movies, series, and trending entertainment on UG Movies 247.',
  path: '/browse',
  keywords: isAppInReview
    ? ['latest movie trailers Uganda', 'VJ trailer catalog', 'Uganda movie discovery']
    : ['latest movies Uganda', 'trending ugandan movies', 'uganda translated movies', 'VJ movies Uganda'],
});

export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
