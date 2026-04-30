import type { Metadata } from 'next';
import { isAppInReview } from '@/lib/appReview';
import { buildPageMetadata, cleanText } from '@/lib/seo';

function formatCategoryTitle(categoryId: string) {
  return decodeURIComponent(categoryId || '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const categoryTitle = cleanText(formatCategoryTitle(params.id), 'Movies');

  return buildPageMetadata({
    title: isAppInReview
      ? `${categoryTitle} Trailers - UG Movies 247`
      : `${categoryTitle} Online - UG Movies 247`,
    description: isAppInReview
      ? `Discover ${categoryTitle.toLowerCase()} trailers, VJ catalog entries, movie details, and trending discovery lists on UG Movies 247.`
      : `Watch ${categoryTitle.toLowerCase()} online on UG Movies 247, including Uganda movies, Luganda translated movies, VJ translated movies, and trending series.`,
    path: `/category/${encodeURIComponent(params.id)}`,
    keywords: isAppInReview
      ? [`${categoryTitle} trailers`, `${categoryTitle} discovery`, 'Uganda movie trailer catalog']
      : [
          `${categoryTitle} Uganda`,
          `${categoryTitle} online`,
          'Uganda translated movies',
          'Luganda translated movies',
        ],
  });
}

export default function CategoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
