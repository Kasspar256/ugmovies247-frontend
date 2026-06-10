import { buildPageMetadata } from '@/lib/seo';
import { isAppInReview } from '@/lib/appReview';

export const metadata = buildPageMetadata({
  title: isAppInReview
    ? 'Request Movie Information - UGMOVIES247'
    : 'Request Movies & Series - UGMOVIES247',
  description: isAppInReview
    ? 'Send UGMOVIES247 movie and series discovery requests, VJ catalog suggestions, and title information requests.'
    : 'Request movies and series on UGMOVIES247, including Luganda translated movies, Uganda translated movies, VJ movies, and full episodes.',
  path: '/request',
  keywords: isAppInReview
    ? ['request movie trailers Uganda', 'movie catalog request Uganda', 'VJ trailer request']
    : [
        'request movies Uganda',
        'request Luganda translated movies',
        'request VJ movies',
        'request Uganda translated series',
      ],
});

export default function RequestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
