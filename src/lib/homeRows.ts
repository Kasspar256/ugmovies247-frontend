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

function hasCategory(movie: Movie, category: string) {
  return (movie.category || []).some((entry) => entry.toLowerCase() === category.toLowerCase());
}

function hasVj(movie: Movie, ...names: string[]) {
  const normalizedVj = (movie.vj || '').toLowerCase();
  return names.some((name) => normalizedVj.includes(name.toLowerCase()));
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

  return movies.filter((movie) =>
    movie.genres?.map((genre) => genre.toLowerCase()).includes(activeCategory.toLowerCase())
  );
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
    movies:
      row.title === 'VJ JUNIOR'
        ? filteredMovies.filter((movie) => hasVj(movie, 'junior'))
        : row.title === 'VJ EMMY'
          ? filteredMovies.filter((movie) => hasVj(movie, 'emmy'))
          : row.title === 'VJ ULIO'
            ? filteredMovies.filter((movie) => hasVj(movie, 'ulio'))
            : row.title === 'VJ SOUL'
              ? filteredMovies.filter((movie) => hasVj(movie, 'soul'))
              : row.title === 'VJ JINGO'
                ? filteredMovies.filter((movie) => hasVj(movie, 'jingo'))
                : row.title === 'OMUTAKA ICE P'
                  ? filteredMovies.filter((movie) => hasVj(movie, 'ice p', 'omutaka ice p'))
                  : row.title === 'ANIMATIONS'
                    ? filteredMovies.filter((movie) => movie.genres?.includes('Animation'))
                    : row.title === 'ACTION & THRILLER'
                      ? filteredMovies.filter((movie) =>
                          movie.genres?.some((genre) =>
                            ['Action', 'Thriller', 'Crime', 'Detective', 'Mystery'].includes(genre)
                          )
                        )
                      : row.title === 'ROMANCE'
                        ? filteredMovies.filter((movie) => movie.genres?.includes('Romance'))
                        : row.title === 'COMEDY'
                          ? filteredMovies.filter((movie) => movie.genres?.includes('Comedy'))
                          : row.title === 'HORROR'
                            ? filteredMovies.filter((movie) => movie.genres?.includes('Horror'))
                            : row.title === 'ADVENTURE'
                              ? filteredMovies.filter((movie) => movie.genres?.includes('Adventure'))
                              : filteredMovies.filter(
                                  (movie) =>
                                    movie.country === 'India' || movie.genres?.includes('Indian')
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
    filteredMovies.filter((movie) => !configuredRowMovieIds.has(movie.id))
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
