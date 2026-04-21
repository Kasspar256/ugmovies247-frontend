import { AUTO_HOME_ROW_CONFIG, HOME_PAGE_CATEGORY_CONFIG } from '@/lib/homeCategories';
import { dedupeSeriesMovies } from '@/lib/moviePresentation';
import type { Movie } from '@/types/movie';

export type HomePageCategoryRecord = {
  id: string;
  name: string;
  displayLabel: string;
  homeOrder: number;
  isVisible: boolean;
};

export type HomeRowRecord = {
  title: string;
  categoryKey: string;
  usesSeriesBackdropCards: boolean;
  sortOrder: number;
  movies: Movie[];
};

export const DEFAULT_HOME_PAGE_CATEGORIES: HomePageCategoryRecord[] = HOME_PAGE_CATEGORY_CONFIG.map(
  (category) => ({
    id: slugifyHomeSection(category.name),
    name: category.name,
    displayLabel: category.displayLabel,
    homeOrder: category.homeOrder,
    isVisible: true,
  })
);

export function slugifyHomeSection(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function normalizeCatalogLabel(value: string) {
  return slugifyHomeSection(String(value || '').trim()).replace(/^-+|-+$/g, '');
}

function hasCategory(movie: Movie, category: string) {
  const normalizedCategory = normalizeCatalogLabel(category);
  return (movie.category || []).some(
    (entry) => normalizeCatalogLabel(entry) === normalizedCategory
  );
}

function hasVj(movie: Movie, ...names: string[]) {
  const normalizedVj = (movie.vj || '').toLowerCase();
  return names.some((name) => normalizedVj.includes(name.toLowerCase()));
}

function getMovieMetadataLabels(movie: Movie) {
  return new Set(
    [...(movie.category || []), ...(movie.genres || [])]
      .map((entry) => normalizeCatalogLabel(entry))
      .filter(Boolean)
  );
}

function hasMetadataLabel(movie: Movie, ...aliases: string[]) {
  const labels = getMovieMetadataLabels(movie);
  return aliases.some((alias) => labels.has(normalizeCatalogLabel(alias)));
}

function matchesAutoHomeRow(movie: Movie, rowKey: string) {
  switch (rowKey) {
    case 'vj-junior':
      return hasVj(movie, 'junior');
    case 'vj-emmy':
      return hasVj(movie, 'emmy');
    case 'vj-ulio':
      return hasVj(movie, 'ulio');
    case 'vj-soul':
      return hasVj(movie, 'soul');
    case 'vj-jingo':
      return hasVj(movie, 'jingo');
    case 'omutaka-ice-p':
      return hasVj(movie, 'ice p', 'omutaka ice p');
    case 'animations':
      return hasMetadataLabel(movie, 'animation', 'animations');
    case 'action-thriller':
      return hasMetadataLabel(movie, 'action', 'thriller', 'crime', 'detective', 'mystery');
    case 'romance':
      return hasMetadataLabel(movie, 'romance');
    case 'comedy':
      return hasMetadataLabel(movie, 'comedy');
    case 'horror':
      return hasMetadataLabel(movie, 'horror');
    case 'adventure':
      return hasMetadataLabel(movie, 'adventure');
    case 'indian-movies':
      return (
        normalizeCatalogLabel(movie.country || '') === 'india' ||
        hasMetadataLabel(movie, 'indian', 'india', 'indian movies')
      );
    default:
      return false;
  }
}

function isStrictFallbackMovie(movie: Movie) {
  // Keep "More Movies" as a true fallback bucket for uncategorized titles only.
  return getMovieMetadataLabels(movie).size === 0 && !movie.is_trending_tiktok;
}

function matchesActiveCategoryFilter(movie: Movie, activeCategory: string) {
  switch (normalizeCatalogLabel(activeCategory)) {
    case 'action':
      return hasMetadataLabel(movie, 'action', 'action & thriller');
    case 'sci-fi':
      return hasMetadataLabel(movie, 'sci-fi', 'science fiction', 'sci fi');
    case 'drama':
      return hasMetadataLabel(movie, 'drama');
    case 'romance':
      return hasMetadataLabel(movie, 'romance');
    case 'adventure':
      return hasMetadataLabel(movie, 'adventure');
    default:
      return hasMetadataLabel(movie, activeCategory);
  }
}

function usesSeriesBackdropCards(name: string) {
  return ['ongoing series', 'latest series', 'asian series', 'western series'].includes(
    name.toLowerCase()
  );
}

export function filterMoviesByActiveCategory(movies: Movie[], activeCategory: string) {
  if (activeCategory === 'ALL') {
    return movies;
  }

  return movies.filter((movie) => matchesActiveCategoryFilter(movie, activeCategory));
}

export function buildHomeCollections(options: {
  movies: Movie[];
  homePageCategories?: HomePageCategoryRecord[];
  activeCategory?: string;
}) {
  const homePageCategories = options.homePageCategories || DEFAULT_HOME_PAGE_CATEGORIES;
  const filteredMovies = filterMoviesByActiveCategory(options.movies, options.activeCategory || 'ALL');

  const manualHomeRows: HomeRowRecord[] = homePageCategories
    .filter((category) => category.isVisible !== false)
    .map((category) => ({
      title: category.displayLabel,
      categoryKey: slugifyHomeSection(category.name),
      usesSeriesBackdropCards: usesSeriesBackdropCards(category.name),
      sortOrder: category.homeOrder,
      movies:
        category.name.toLowerCase() === 'trending on tiktok'
          ? filteredMovies.filter(
              (movie) => movie.is_trending_tiktok || hasCategory(movie, category.name)
            )
          : filteredMovies.filter((movie) => hasCategory(movie, category.name)),
    }));

  const autoRows: HomeRowRecord[] = AUTO_HOME_ROW_CONFIG.map((row) => ({
    title: row.title,
    categoryKey: slugifyHomeSection(row.title),
    usesSeriesBackdropCards: false,
    sortOrder: row.order,
    movies: filteredMovies.filter((movie) =>
      matchesAutoHomeRow(movie, slugifyHomeSection(row.title))
    ),
  }));

  const homeRows = [...manualHomeRows, ...autoRows]
    .map((row) => ({
      ...row,
      movies: dedupeSeriesMovies(row.movies),
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder);

  const configuredRowMovieIds = new Set(homeRows.flatMap((row) => row.movies).map((movie) => movie.id));
  const unmatchedMovies = dedupeSeriesMovies(
    filteredMovies.filter(
      (movie) => !configuredRowMovieIds.has(movie.id) && isStrictFallbackMovie(movie)
    )
  );

  return {
    filteredMovies,
    homeRows,
    unmatchedMovies,
  };
}

export function getHomeCollectionByKey(options: {
  movies: Movie[];
  homePageCategories?: HomePageCategoryRecord[];
  sectionKey: string;
}) {
  const { homeRows, unmatchedMovies } = buildHomeCollections({
    movies: options.movies,
    homePageCategories: options.homePageCategories,
    activeCategory: 'ALL',
  });

  if (options.sectionKey === 'more-movies') {
    return unmatchedMovies.length
      ? {
          title: 'More Movies',
          categoryKey: 'more-movies',
          usesSeriesBackdropCards: false,
          sortOrder: Number.MAX_SAFE_INTEGER,
          movies: unmatchedMovies,
        }
      : null;
  }

  return homeRows.find((row) => row.categoryKey === options.sectionKey) || null;
}
