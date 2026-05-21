import { getPublicMovieRouteBootstrap } from '@/lib/server/publicMovieRouteBootstrap';
import MovieClientPage from './MovieClientPage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function MoviePlayerRoute({ params }: { params: { id: string } }) {
  const bootstrap = await getPublicMovieRouteBootstrap(params.id);

  return (
    <MovieClientPage
      params={params}
      initialCatalogCachedAt={bootstrap.cachedAt}
      initialCatalogMovies={bootstrap.catalogMovies}
      initialMovie={bootstrap.movie}
    />
  );
}
