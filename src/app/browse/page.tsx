import BrowseClientPage from './BrowseClientPage';
import { getPublicCatalogBootstrapPayload } from '@/lib/server/publicCatalogBootstrapLoader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function BrowsePage() {
  const bootstrap = await getPublicCatalogBootstrapPayload();

  return (
    <BrowseClientPage
      initialMovies={bootstrap.movies}
      initialHomePageCategories={bootstrap.homePageCategories}
      initialCatalogCachedAt={bootstrap.cachedAt}
      initialCatalogIsPartial={bootstrap.partial}
    />
  );
}
