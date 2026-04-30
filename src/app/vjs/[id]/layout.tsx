import type { Metadata } from 'next';
import { VJ_DIRECTORY } from '@/config/constants';
import { isAppInReview } from '@/lib/appReview';
import { buildPageMetadata } from '@/lib/seo';

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const vj = VJ_DIRECTORY.find((entry) => entry.id === params.id);
  const vjName = vj?.name || 'Ugandan VJ';

  return buildPageMetadata({
    title: isAppInReview
      ? `${vjName} Trailer Catalog - UG Movies 247`
      : `${vjName} Movies - Watch Luganda VJ Translated Movies Online`,
    description: isAppInReview
      ? `Discover ${vjName} trailer catalog entries, movie details, genres, and VJ information on UG Movies 247.`
      : `Watch ${vjName} movies online on UG Movies 247, including Luganda translated movies, Uganda translated action movies, Hollywood films, and series.`,
    path: `/vjs/${encodeURIComponent(params.id)}`,
    keywords: isAppInReview
      ? [`${vjName} trailers`, `${vjName} trailer catalog`, 'Ugandan VJ movie discovery']
      : [`${vjName} movies`, `${vjName} translated movies`, 'Ugandan VJ movies online'],
  });
}

export default function VjLayout({ children }: { children: React.ReactNode }) {
  return children;
}
