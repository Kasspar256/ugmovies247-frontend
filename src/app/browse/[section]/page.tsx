import type { Metadata } from 'next';
import BrowseSectionClientPage from './BrowseSectionClientPage';
import { isAppInReview } from '@/lib/appReview';
import { AUTO_HOME_ROW_CONFIG } from '@/lib/homeCategories';
import {
  DEFAULT_HOME_PAGE_CATEGORIES,
  getHomeCollectionByKey,
  slugifyHomeSection,
} from '@/lib/homeRows';
import { buildPageMetadata, cleanText } from '@/lib/seo';
import { getPublicCatalogBootstrapPayload } from '@/lib/server/publicCatalogBootstrapLoader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function decodeSectionParam(section: string) {
  try {
    return decodeURIComponent(section || '');
  } catch {
    return section || '';
  }
}

function formatSectionTitle(section: string) {
  const decodedSection = decodeSectionParam(section);
  const manualCategory = DEFAULT_HOME_PAGE_CATEGORIES.find(
    (category) => category.id === decodedSection || slugifyHomeSection(category.name) === decodedSection
  );
  const automaticCategory = AUTO_HOME_ROW_CONFIG.find(
    (category) => slugifyHomeSection(category.title) === decodedSection
  );

  return cleanText(
    manualCategory?.displayLabel ||
      manualCategory?.name ||
      automaticCategory?.title ||
      decodedSection
        .split('-')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    'Browse Movies'
  );
}

export function generateMetadata({ params }: { params: { section: string } }): Metadata {
  const sectionKey = decodeSectionParam(params.section);
  const sectionTitle = formatSectionTitle(sectionKey);

  return buildPageMetadata({
    title: isAppInReview
      ? `${sectionTitle} Trailers - UGMOVIES247`
      : `${sectionTitle} Movies & Series - UGMOVIES247`,
    description: isAppInReview
      ? `Discover ${sectionTitle.toLowerCase()} trailers, VJ catalog entries, movie details, and discovery lists on UGMOVIES247.`
      : `Watch ${sectionTitle.toLowerCase()} on UGMOVIES247, including Uganda movies, Luganda translated movies, VJ translated movies, series, and trending entertainment.`,
    path: `/browse/${encodeURIComponent(sectionKey)}`,
    keywords: isAppInReview
      ? [`${sectionTitle} trailers`, `${sectionTitle} movie catalog`, 'Uganda movie discovery']
      : [
          `${sectionTitle} movies Uganda`,
          `${sectionTitle} online`,
          'Uganda translated movies',
          'Luganda translated movies',
          'VJ translated movies Uganda',
        ],
  });
}

export default async function BrowseSectionPage({ params }: { params: { section: string } }) {
  const bootstrap = await getPublicCatalogBootstrapPayload();
  const sectionKey = decodeSectionParam(params.section);
  const collection = getHomeCollectionByKey({
    movies: bootstrap.movies,
    homePageCategories: bootstrap.homePageCategories,
    sectionKey,
  });

  return (
    <BrowseSectionClientPage
      sectionKey={sectionKey}
      initialMovies={collection?.movies?.length ? bootstrap.movies : []}
      initialCategories={bootstrap.homePageCategories}
    />
  );
}
