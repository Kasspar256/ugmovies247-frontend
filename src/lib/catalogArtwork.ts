import type { Movie } from '@/types/movie';

function uniqueArtworkCandidates(candidates: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const cleanCandidates: string[] = [];

  candidates.forEach((candidate) => {
    const value = String(candidate || '').trim();

    if (!value || seen.has(value)) {
      return;
    }

    seen.add(value);
    cleanCandidates.push(value);
  });

  return cleanCandidates;
}

export function getCatalogPosterCandidates(movie: Movie) {
  const firstPart = movie.parts?.[0];
  const firstSeason = movie.seasons?.[0];
  const firstEpisode = firstSeason?.episodes?.[0];

  return uniqueArtworkCandidates([
    movie.poster,
    firstPart?.poster,
    firstSeason?.poster,
    firstEpisode?.poster,
    firstEpisode?.thumbnail,
    firstPart?.thumbnail,
    firstEpisode?.overriddenBackdrop,
    movie.overriddenBackdrop,
    movie.overriddenPlayerBackdrop,
    movie.playerBackdrop,
  ]);
}

export function getCatalogBackdropCandidates(movie: Movie) {
  const firstPart = movie.parts?.[0];
  const firstSeason = movie.seasons?.[0];
  const firstEpisode = firstSeason?.episodes?.[0];

  return uniqueArtworkCandidates([
    movie.overriddenBackdrop,
    firstSeason?.overriddenBackdrop,
    firstEpisode?.overriddenBackdrop,
    movie.overriddenPlayerBackdrop,
    movie.playerBackdrop,
    movie.poster,
    firstSeason?.poster,
    firstEpisode?.thumbnail,
    firstEpisode?.poster,
    firstPart?.thumbnail,
    firstPart?.poster,
  ]);
}

export function getCatalogHeroPosterCandidates(movie: Movie) {
  const firstPart = movie.parts?.[0];
  const firstSeason = movie.seasons?.[0];
  const firstEpisode = firstSeason?.episodes?.[0];

  return uniqueArtworkCandidates([
    movie.heroPoster,
    movie.poster,
    firstSeason?.poster,
    firstEpisode?.poster,
    firstEpisode?.thumbnail,
    firstPart?.poster,
    firstPart?.thumbnail,
    movie.overriddenBackdrop,
    firstSeason?.overriddenBackdrop,
    firstEpisode?.overriddenBackdrop,
    movie.overriddenPlayerBackdrop,
    movie.playerBackdrop,
  ]);
}
