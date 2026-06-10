import { buildPageMetadata } from '@/lib/seo';
import { isAppInReview } from '@/lib/appReview';

export const metadata = buildPageMetadata({
  title: isAppInReview
    ? 'Movie Trailer Catalog - UGMOVIES247'
    : 'Movies Online - Watch Ugandan, Luganda & VJ Movies on UGMOVIES247',
  description: isAppInReview
    ? 'Browse movie trailers, genres, VJ catalog entries, and latest discovery lists on UGMOVIES247.'
    : 'Watch movies online on UGMOVIES247, including Ugandan movies, Luganda translated movies, VJ translated movies, action, comedy, drama, Indian movies, and latest releases.',
  path: '/movies',
  keywords: isAppInReview
    ? ['movie trailer catalog Uganda', 'Uganda movie trailers', 'VJ trailer discovery']
    : [
        'movies online Uganda',
        'watch movies online Uganda',
        'Luganda translated movies online',
        'VJ translated movies Uganda',
        'latest movies on UGMOVIES247',
      ],
});

export default function MoviesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
