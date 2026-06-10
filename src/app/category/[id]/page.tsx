import CategoryClientPage from './CategoryClientPage';
import { getPublicCatalogBootstrapPayload } from '@/lib/server/publicCatalogBootstrapLoader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CategoryPage({ params }: { params: { id: string } }) {
  const bootstrap = await getPublicCatalogBootstrapPayload();

  return <CategoryClientPage params={params} initialMovies={bootstrap.movies} />;
}
