import GenreClientPage from './GenreClientPage';
import { getPublicCatalogBootstrapPayload } from '@/lib/server/publicCatalogBootstrapLoader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function GenrePage({ params }: { params: { id: string } }) {
  const bootstrap = await getPublicCatalogBootstrapPayload();

  return <GenreClientPage params={params} initialMovies={bootstrap.movies} />;
}
