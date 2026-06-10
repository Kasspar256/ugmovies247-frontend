import SeriesClientPage from './SeriesClientPage';
import { getPublicCatalogBootstrapPayload } from '@/lib/server/publicCatalogBootstrapLoader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function SeriesPage() {
  const bootstrap = await getPublicCatalogBootstrapPayload();

  return <SeriesClientPage initialMovies={bootstrap.movies} />;
}
