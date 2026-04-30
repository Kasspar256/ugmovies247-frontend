import type { Metadata } from 'next';
import { isAppInReview } from '@/lib/appReview';
import { getSeoMovieById } from '@/lib/server/seoMovies';
import {
  breadcrumbJsonLd,
  buildPageMetadata,
  getMovieDescription,
  getMovieTitle,
  getMovieVjLabel,
  movieJsonLd,
} from '@/lib/seo';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const movie = await getSeoMovieById(params.id);

  if (!movie) {
    return buildPageMetadata({
      title: 'Movie Not Found - UG Movies 247',
      description: isAppInReview
        ? 'Find movie trailers, VJ catalog entries, genres, and discovery lists on UG Movies 247.'
        : 'Find Ugandan movies, Luganda translated movies, VJ movies, and series on UG Movies 247.',
      path: `/movie/${encodeURIComponent(params.id)}`,
      noIndex: true,
    });
  }

  const title = getMovieTitle(movie);
  const vjLabel = getMovieVjLabel(movie);
  const typeLabel = movie.contentType === 'series' ? 'Series' : 'Movie';

  return buildPageMetadata({
    title: isAppInReview
      ? `${title}${vjLabel ? ` - ${vjLabel}` : ''} | Watch Trailer`
      : `${title}${vjLabel ? ` - ${vjLabel}` : ''} | Watch ${typeLabel} Online`,
    description: getMovieDescription(movie),
    path: `/movie/${encodeURIComponent(movie.id)}`,
    image: movie.poster || undefined,
    type: 'article',
    keywords: [
      title,
      vjLabel,
      `${title} Luganda translated movie`,
      `${title} Uganda translated movie`,
      ...(movie.genres || []),
      ...(movie.category || []),
      ...(movie.tags || []),
    ].filter(Boolean),
  });
}

export default async function MovieLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const movie = await getSeoMovieById(params.id);
  const schemas = movie
    ? [
        movieJsonLd(movie, `/movie/${encodeURIComponent(movie.id)}`),
        breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Browse', path: '/browse' },
          { name: getMovieTitle(movie), path: `/movie/${encodeURIComponent(movie.id)}` },
        ]),
      ]
    : [];

  return (
    <>
      {schemas.length ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schemas) }}
        />
      ) : null}
      {children}
    </>
  );
}
