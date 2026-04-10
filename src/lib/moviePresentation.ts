import type { Movie } from '@/types/movie';

const EPISODIC_TITLE_PATTERN = /\b(s\d{1,2}\s*e\d{1,2}|season\s+\d+|episode\s+\d+|ep\s*\d+)\b/i;

function normalizeSpacing(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function extractSeasonNumber(movie: Movie) {
  if (movie.contentType === 'series' && movie.seasons?.length) {
    const firstSeasonNumber = movie.seasons
      .map((season) => season.seasonNumber)
      .filter((seasonNumber) => typeof seasonNumber === 'number')
      .sort((first, second) => first - second)[0];

    if (typeof firstSeasonNumber === 'number') {
      return firstSeasonNumber;
    }
  }

  const title = movie.title || movie.original_title || movie.name || '';
  const seasonMatch = title.match(/\bseason\s+(\d+)\b/i) || title.match(/\bs(\d{1,2})\b/i);

  if (!seasonMatch) {
    return Number.POSITIVE_INFINITY;
  }

  return Number(seasonMatch[1]) || Number.POSITIVE_INFINITY;
}

export function isSeriesMovie(movie: Movie) {
  const title = movie.title || movie.original_title || movie.name || '';

  return (
    movie.contentType === 'series' ||
    Boolean(movie.seasons?.length) ||
    EPISODIC_TITLE_PATTERN.test(title)
  );
}

function getSeriesBaseTitle(movie: Movie) {
  const sourceTitle = movie.original_title || movie.title || movie.name || '';
  const cleaned = normalizeSpacing(
    sourceTitle
      .replace(EPISODIC_TITLE_PATTERN, '')
      .replace(/[-_|:]+$/g, '')
  );

  return cleaned.toLowerCase() || sourceTitle.toLowerCase() || movie.id;
}

export function getMovieListingKey(movie: Movie) {
  if (!isSeriesMovie(movie)) {
    return `movie:${movie.id}`;
  }

  if (movie.tmdb_id) {
    return `series:tmdb:${movie.tmdb_id}`;
  }

  return `series:${getSeriesBaseTitle(movie)}`;
}

export function dedupeSeriesMovies<T extends Movie>(movies: T[]) {
  const groupedMovies = new Map<string, T>();

  movies.forEach((movie) => {
    const key = getMovieListingKey(movie);
    const existingMovie = groupedMovies.get(key);

    if (!existingMovie) {
      groupedMovies.set(key, movie);
      return;
    }

    const currentSeasonNumber = extractSeasonNumber(movie);
    const existingSeasonNumber = extractSeasonNumber(existingMovie);
    const currentIsFullSeries = movie.contentType === 'series' && Boolean(movie.seasons?.length);
    const existingIsFullSeries =
      existingMovie.contentType === 'series' && Boolean(existingMovie.seasons?.length);

    if (currentIsFullSeries && !existingIsFullSeries) {
      groupedMovies.set(key, movie);
      return;
    }

    if (!currentIsFullSeries && existingIsFullSeries) {
      return;
    }

    if (currentSeasonNumber < existingSeasonNumber) {
      groupedMovies.set(key, movie);
    }
  });

  return Array.from(groupedMovies.values());
}

export function mergeSeriesMovies<T extends Movie>(movies: T[]) {
  if (!movies.length) {
    return null;
  }

  const baseMovie = [...movies].sort((first, second) => {
    const firstSeason = extractSeasonNumber(first);
    const secondSeason = extractSeasonNumber(second);

    if (firstSeason !== secondSeason) {
      return firstSeason - secondSeason;
    }

    return first.id.localeCompare(second.id);
  })[0];

  const seasonsByNumber = new Map<number, NonNullable<Movie['seasons']>[number]>();

  movies.forEach((movie) => {
    (movie.seasons || []).forEach((season) => {
      const existingSeason = seasonsByNumber.get(season.seasonNumber);

      if (!existingSeason) {
        seasonsByNumber.set(season.seasonNumber, {
          seasonNumber: season.seasonNumber,
          title: season.title,
          episodes: [...season.episodes].sort((first, second) => first.episodeNumber - second.episodeNumber),
        });
        return;
      }

      const episodesByNumber = new Map<number, typeof existingSeason.episodes[number]>();

      [...existingSeason.episodes, ...season.episodes].forEach((episode) => {
        if (!episodesByNumber.has(episode.episodeNumber)) {
          episodesByNumber.set(episode.episodeNumber, episode);
        }
      });

      seasonsByNumber.set(season.seasonNumber, {
        seasonNumber: season.seasonNumber,
        title: existingSeason.title || season.title,
        episodes: Array.from(episodesByNumber.values()).sort(
          (first, second) => first.episodeNumber - second.episodeNumber
        ),
      });
    });
  });

  return {
    ...baseMovie,
    contentType: 'series' as const,
    seasons: Array.from(seasonsByNumber.values()).sort(
      (first, second) => first.seasonNumber - second.seasonNumber
    ),
  };
}
