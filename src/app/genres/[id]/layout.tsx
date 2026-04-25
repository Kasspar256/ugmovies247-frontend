import type { Metadata } from 'next';
import { buildPageMetadata, cleanText } from '@/lib/seo';

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const genreName = cleanText(decodeURIComponent(params.id || ''), 'Movies');

  return buildPageMetadata({
    title: `${genreName} Movies Online - UG Movies 247`,
    description: `Watch ${genreName.toLowerCase()} movies online on UG Movies 247, including Luganda translated movies, Uganda translated films, and VJ movies.`,
    path: `/genres/${encodeURIComponent(params.id)}`,
    keywords: [
      `${genreName} movies Uganda`,
      `${genreName} movies online`,
      'watch Uganda translated movies online',
    ],
  });
}

export default function GenreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
