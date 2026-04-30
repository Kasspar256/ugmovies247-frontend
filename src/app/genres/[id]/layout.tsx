import type { Metadata } from 'next';
import { isAppInReview } from '@/lib/appReview';
import { buildPageMetadata, cleanText } from '@/lib/seo';

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const genreName = cleanText(decodeURIComponent(params.id || ''), 'Movies');

  return buildPageMetadata({
    title: isAppInReview
      ? `${genreName} Movie Trailers - UG Movies 247`
      : `${genreName} Movies Online - UG Movies 247`,
    description: isAppInReview
      ? `Discover ${genreName.toLowerCase()} movie trailers, VJ catalog entries, and movie details on UG Movies 247.`
      : `Watch ${genreName.toLowerCase()} movies online on UG Movies 247, including Luganda translated movies, Uganda translated films, and VJ movies.`,
    path: `/genres/${encodeURIComponent(params.id)}`,
    keywords: isAppInReview
      ? [`${genreName} movie trailers`, `${genreName} trailer catalog`, 'Uganda movie discovery']
      : [
          `${genreName} movies Uganda`,
          `${genreName} movies online`,
          'watch Uganda translated movies online',
        ],
  });
}

export default function GenreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
