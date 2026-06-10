import MoviesClientPage from './MoviesClientPage';
import { getPublicCatalogBootstrapPayload } from '@/lib/server/publicCatalogBootstrapLoader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function MoviesPage() {
  const bootstrap = await getPublicCatalogBootstrapPayload();

  return <MoviesClientPage initialMovies={bootstrap.movies} />;
}
