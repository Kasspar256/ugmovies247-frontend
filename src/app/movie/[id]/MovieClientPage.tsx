'use client';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getUserDownloadByMovieId, saveMovieDownload } from '@/lib/downloads';
import { readCachedAccountProfile } from '@/lib/accountProfile';
import { readCachedAuthStatus } from '@/lib/auth/status-client';
import {
  cancelOfflineDownload,
  createOfflineDownloadKey,
  downloadMovieOffline,
  findOfflineDownload,
  formatDownloadProgressLabel,
  getActiveOfflineDownload,
  getDownloadPercent,
  isOfflineDownloadActive,
  subscribeOfflineDownloads,
  supportsNativeOfflineDownloads,
  type ActiveOfflineDownload,
} from '@/lib/mobile/offlineDownloads';
import type { FirebaseError } from 'firebase/app';
import { normalizeMovie, type Episode, type Movie } from '@/types/movie';
import { getUserWatchlistMovie, removeMovieFromWatchlist, saveMovieToWatchlist } from '@/lib/watchlist';
import { getUserLikedMovie, removeMovieLike, saveMovieLike } from '@/lib/likes';
import { dedupeSeriesMovies, getMovieListingKey, isSeriesMovie, mergeSeriesMovies } from '@/lib/moviePresentation';
import { Bookmark, Cast, Film, Heart, Lock, Share2 } from 'lucide-react';
import {
  fetchPublicMovieById,
  fetchPublicMovies,
  primePublicMovieCatalog,
  readCachedPublicMovies,
} from '@/lib/publicMovies';
import { startCasting } from '@/lib/cast';
import {
  PersistentPlaybackHost,
  usePlayback,
} from '@/components/player/PlaybackProvider';
import TrailerEmbedPlayer from '@/components/TrailerEmbedPlayer';
import { isAppInReview } from '@/lib/appReview';
import { getReviewTrailerUrl } from '@/lib/reviewTrailers';

function inferSeasonEpisodeFromSeriesEntry(
  entry: Movie,
  fallbackSeasonNumber: number | null = null
) {
  if (entry.seasons?.length === 1 && entry.seasons[0].episodes?.length === 1) {
    return {
      seasonNumber: entry.seasons[0].seasonNumber,
      episodeNumber: entry.seasons[0].episodes[0].episodeNumber,
    };
  }

  const sourceText = `${entry.title || ''} ${entry.original_title || ''} ${entry.name || ''}`;
  const compactMatch = sourceText.match(/\bs\s*(\d{1,2})\s*e\s*(\d{1,3})\b/i);

  if (compactMatch) {
    return {
      seasonNumber: Number(compactMatch[1]) || null,
      episodeNumber: Number(compactMatch[2]) || null,
    };
  }

  const seasonMatch = sourceText.match(/\bseason\s*(\d{1,2})\b/i) || sourceText.match(/\bs\s*(\d{1,2})\b/i);
  const episodeMatch = sourceText.match(/\bepisode\s*(\d{1,3})\b/i) || sourceText.match(/\bep\s*(\d{1,3})\b/i) || sourceText.match(/\be\s*(\d{1,3})\b/i);
  const inferredFallbackSeasonNumber =
    entry.seasons?.length === 1 ? entry.seasons[0].seasonNumber : fallbackSeasonNumber;

  return {
    seasonNumber: seasonMatch ? Number(seasonMatch[1]) || inferredFallbackSeasonNumber : inferredFallbackSeasonNumber,
    episodeNumber: episodeMatch ? Number(episodeMatch[1]) || null : null,
  };
}

function mergeEpisodePlaybackCandidate(
  existing: Partial<Episode> | undefined,
  incoming: Partial<Episode>
): Partial<Episode> {
  return {
    title: incoming.title || existing?.title || '',
    description: incoming.description || existing?.description || '',
    overview: incoming.overview || existing?.overview || '',
    video_url: incoming.video_url || existing?.video_url || '',
    sourceUrl: incoming.sourceUrl || existing?.sourceUrl || '',
    masterPlaylistUrl: incoming.masterPlaylistUrl || existing?.masterPlaylistUrl || '',
    overriddenBackdrop: incoming.overriddenBackdrop || existing?.overriddenBackdrop || '',
    episodeTrailerUrl: incoming.episodeTrailerUrl || existing?.episodeTrailerUrl || '',
    poster: incoming.poster || existing?.poster || '',
    thumbnail: incoming.thumbnail || existing?.thumbnail || '',
    playbackType: incoming.playbackType || existing?.playbackType || 'mp4',
    durationSeconds: incoming.durationSeconds || existing?.durationSeconds || 0,
    isLocked: incoming.isLocked ?? existing?.isLocked,
  };
}

function hasPlaybackSource(asset?: {
  video_url?: string;
  sourceUrl?: string;
  masterPlaylistUrl?: string;
  availableRenditions?: Array<{ playlistUrl?: string }>;
}) {
  return Boolean(
    asset?.video_url ||
    asset?.sourceUrl ||
    asset?.masterPlaylistUrl ||
    asset?.availableRenditions?.some((rendition) => rendition.playlistUrl)
  );
}

function movieHasAnyPlaybackSource(movie: Movie) {
  if (movie.contentType === 'series') {
    return Boolean(
      movie.seasons?.some((season) =>
        season.episodes.some((episode) => hasPlaybackSource(episode))
      )
    );
  }

  if (movie.parts?.length) {
    return movie.parts.some((part) => hasPlaybackSource(part));
  }

  return hasPlaybackSource(movie);
}

function hasCachedPremiumAccess() {
  if (typeof window === 'undefined') {
    return false;
  }

  const cachedProfile = readCachedAccountProfile();

  if (cachedProfile?.role === 'admin' || cachedProfile?.subscription?.isActive === true) {
    return true;
  }

  const cachedAuthStatus = readCachedAuthStatus();

  if (cachedAuthStatus?.authenticated && cachedAuthStatus.user?.role === 'admin') {
    return true;
  }

  try {
    const rawSubscriptionCache = window.localStorage.getItem('ugmovies247.subscribe-data.v1');

    if (!rawSubscriptionCache) {
      return false;
    }

    const parsed = JSON.parse(rawSubscriptionCache) as {
      value?: {
        entitlement?: { hasPremiumAccess?: boolean; subscription?: { isActive?: boolean } };
      };
    };

    return (
      parsed.value?.entitlement?.hasPremiumAccess === true ||
      parsed.value?.entitlement?.subscription?.isActive === true
    );
  } catch {
    return false;
  }
}

function formatPlaybackDuration(durationSeconds?: number) {
  if (!durationSeconds || durationSeconds <= 0) {
    return null;
  }

  const totalMinutes = Math.floor(durationSeconds / 60);

  if (totalMinutes <= 0) {
    return null;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes}m`;
  }

  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

function formatVjLabel(vj?: string) {
  const normalizedVj = vj?.trim();

  if (!normalizedVj) {
    return 'VJ HD';
  }

  return normalizedVj.toUpperCase().startsWith('VJ ') ? normalizedVj : `VJ ${normalizedVj}`;
}

function resolveMovieWithSeriesEntries(initialMovie: Movie, catalogMovies: Movie[]) {
  if (!isSeriesMovie(initialMovie)) {
    return {
      resolvedMovie: initialMovie,
      sourceEntries: [] as Movie[],
    };
  }

  const catalogWithInitial = catalogMovies.some((candidate) => candidate.id === initialMovie.id)
    ? catalogMovies
    : [initialMovie, ...catalogMovies];
  const relatedSeriesEntries = catalogWithInitial.filter(
    (candidate) => getMovieListingKey(candidate) === getMovieListingKey(initialMovie)
  );
  const mergedSeriesMovie = relatedSeriesEntries.length
    ? mergeSeriesMovies(relatedSeriesEntries)
    : null;

  if (!mergedSeriesMovie) {
    return {
      resolvedMovie: initialMovie,
      sourceEntries: relatedSeriesEntries,
    };
  }

  return {
    resolvedMovie: {
      ...mergedSeriesMovie,
      id: initialMovie.id,
      movieId: initialMovie.movieId || initialMovie.id,
    },
    sourceEntries: relatedSeriesEntries,
  };
}

type MoviePlayerPageProps = {
  params: { id: string };
  initialCatalogCachedAt?: string;
  initialCatalogMovies?: Movie[];
  initialMovie?: Movie | null;
};

export default function MoviePlayerPage({
  params,
  initialCatalogCachedAt = '',
  initialCatalogMovies = [],
  initialMovie = null,
}: MoviePlayerPageProps) {
const cachedInitialMovies = useMemo(() => {
  if (initialMovie || typeof window === 'undefined') {
    return [];
  }

  return readCachedPublicMovies();
}, [initialMovie, params.id]);
const routeInitialMovie = useMemo(
  () =>
    initialMovie ||
    cachedInitialMovies.find((candidate) =>
      candidate.id === params.id || candidate.movieId === params.id
    ) ||
    null,
  [cachedInitialMovies, initialMovie, params.id]
);
const routeInitialCatalogMovies = useMemo(
  () =>
    routeInitialMovie
      ? [
          routeInitialMovie,
          ...initialCatalogMovies.filter((candidate) => candidate.id !== routeInitialMovie.id),
          ...cachedInitialMovies.filter(
            (candidate) =>
              candidate.id !== routeInitialMovie.id &&
              !initialCatalogMovies.some(
                (initialCandidate) =>
                  initialCandidate.id === candidate.id ||
                  initialCandidate.movieId === candidate.movieId
              )
          ),
        ]
      : initialCatalogMovies,
  [cachedInitialMovies, initialCatalogMovies, routeInitialMovie]
);
const initialResolvedMovieState = useMemo(
  () =>
    routeInitialMovie
      ? resolveMovieWithSeriesEntries(
          routeInitialMovie,
          routeInitialCatalogMovies.length ? routeInitialCatalogMovies : [routeInitialMovie]
        )
      : null,
  [routeInitialCatalogMovies, routeInitialMovie]
);
const [movie, setMovie] = useState<Movie | null>(
  () => initialResolvedMovieState?.resolvedMovie || routeInitialMovie
);
const [loading, setLoading] = useState(() => !routeInitialMovie);
const [isDownloading, setIsDownloading] = useState(false);
const [isSavingToList, setIsSavingToList] = useState(false);
const [isLiking, setIsLiking] = useState(false);
const [isSavedToDownloads, setIsSavedToDownloads] = useState(false);
const [offlineDownloadJob, setOfflineDownloadJob] = useState<ActiveOfflineDownload | null>(null);
const [isSavedToWatchlist, setIsSavedToWatchlist] = useState(false);
const [isLiked, setIsLiked] = useState(false);
const [actionMessage, setActionMessage] = useState('');
const [showPremiumDownloadModal, setShowPremiumDownloadModal] = useState(false);
const [relatedMovies, setRelatedMovies] = useState<Movie[]>([]);
const [hasLocalPremiumAccess, setHasLocalPremiumAccess] = useState(() => hasCachedPremiumAccess());
const [seriesSourceEntries, setSeriesSourceEntries] = useState<Movie[]>(
  () => initialResolvedMovieState?.sourceEntries || []
);
const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number | null>(null);
const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number | null>(null);
const [selectedPartIndex, setSelectedPartIndex] = useState(0);
const [isTrailerPlaying, setIsTrailerPlaying] = useState(false);
const router = useRouter();
const pathname = usePathname();
const searchParams = useSearchParams();
const searchQueryString = searchParams.toString();
const { setPlaybackSource, videoElement } = usePlayback();
const shouldAutoplay = searchParams.get('autoplay') === '1';
const shouldBypassCatalogCache =
  searchParams.get('fresh') === '1' || searchParams.get('fromRequest') === '1';

useEffect(() => {
setIsTrailerPlaying(false);
setHasLocalPremiumAccess(hasCachedPremiumAccess());
}, [params.id]);

useEffect(() => {
let active = true;
const fetchMovie = async () => {
let renderedMovie = false;

const applyResolvedMovie = (nextMovie: Movie, catalogMovies: Movie[] = []) => {
  if (!active) {
    return;
  }

  const { resolvedMovie, sourceEntries } = resolveMovieWithSeriesEntries(nextMovie, catalogMovies);
  renderedMovie = true;
  setMovie(resolvedMovie);
  setSeriesSourceEntries(sourceEntries);
  setLoading(false);
};

try {
const initialCatalogForRoute = routeInitialMovie
  ? [
      routeInitialMovie,
      ...routeInitialCatalogMovies.filter((candidate) => candidate.id !== routeInitialMovie.id),
    ]
  : routeInitialCatalogMovies;

if (initialCatalogForRoute.length && !shouldBypassCatalogCache) {
  primePublicMovieCatalog(initialCatalogForRoute, {
    cachedAt: initialCatalogCachedAt,
    partial: true,
  });
}

if (routeInitialMovie) {
  applyResolvedMovie(routeInitialMovie, initialCatalogForRoute);

  if (!movieHasAnyPlaybackSource(routeInitialMovie)) {
    void fetchPublicMovieById(params.id)
      .then((freshMovie) => {
        if (!active) {
          return;
        }

        if (freshMovie) {
          applyResolvedMovie(freshMovie, [
            freshMovie,
            ...initialCatalogForRoute.filter((candidate) => candidate.id !== freshMovie.id),
          ]);
        }
      })
      .catch((error) => {
        console.warn('[movie-page] silent exact source refresh failed after bootstrap render', error);
      });
  } else if (!shouldBypassCatalogCache) {
    void fetchPublicMovies()
      .then((catalogMovies) => {
        if (!active) {
          return;
        }

        const refreshedMovie = catalogMovies.find((candidate) =>
          candidate.id === params.id || candidate.movieId === params.id
        );

        if (refreshedMovie && movieHasAnyPlaybackSource(refreshedMovie)) {
          applyResolvedMovie(refreshedMovie, catalogMovies);
        }
      })
      .catch((error) => {
        console.warn('[movie-page] silent catalog sync failed after bootstrap render', error);
      });
  }

  return;
}

if (!renderedMovie) {
  setLoading(true);
  setSeriesSourceEntries([]);
}

const cachedMovies = shouldBypassCatalogCache
  ? initialCatalogForRoute
  : [
      ...initialCatalogForRoute,
      ...readCachedPublicMovies().filter(
        (candidate) =>
          !initialCatalogForRoute.some(
            (initialCandidate) =>
              initialCandidate.id === candidate.id ||
              initialCandidate.movieId === candidate.movieId
          )
      ),
    ];
const cachedMovie = cachedMovies.find((candidate) =>
  candidate.id === params.id || candidate.movieId === params.id
);

if (cachedMovie && !renderedMovie) {
  applyResolvedMovie(cachedMovie, cachedMovies);
}

const freshMovie = await fetchPublicMovieById(params.id).catch((error) => {
  if (!renderedMovie) {
    throw error;
  }

  console.warn('[movie-page] fresh movie lookup failed after cached render', error);
  return null;
});

if (freshMovie) {
applyResolvedMovie(freshMovie, cachedMovies.length ? cachedMovies : [freshMovie]);
void fetchPublicMovies({ force: shouldBypassCatalogCache })
  .then((catalogMovies) => applyResolvedMovie(freshMovie, catalogMovies))
  .catch((error) => {
    console.warn('[movie-page] catalog refresh failed after movie render', error);
  });
return;
}

if (renderedMovie) {
  return;
}

const allMovies = await fetchPublicMovies({ force: shouldBypassCatalogCache });
const matchedMovie = allMovies.find((candidate) =>
  candidate.id === params.id || candidate.movieId === params.id
);

if (matchedMovie) {
applyResolvedMovie(matchedMovie, allMovies);
return;
}

if (!isAppInReview) {
const downloadRecord = await getUserDownloadByMovieId(params.id);

if (downloadRecord) {
const normalizedDownloadMovie = normalizeMovie(downloadRecord.movieId, downloadRecord);
applyResolvedMovie(normalizedDownloadMovie, allMovies);
setIsSavedToDownloads(true);
return;
}
}

if (!renderedMovie) {
  setSeriesSourceEntries([]);
  setMovie(null);
}
} catch (err) {
console.error(err);
} finally {
if (active && !renderedMovie) {
setLoading(false);
}
}
};
fetchMovie();
return () => {
active = false;
};
}, [
  initialCatalogCachedAt,
  params.id,
  routeInitialCatalogMovies,
  routeInitialMovie,
  shouldBypassCatalogCache,
]);

useEffect(() => {
if (!movie?.id) {
setRelatedMovies([]);
return;
}

let active = true;

const applyRelatedMovies = (allMovies: Movie[]) => {
if (!active || !allMovies.length) {
return;
}

const currentListingKey = getMovieListingKey(movie);
const currentIsSeries = isSeriesMovie(movie);

const currentGenres = new Set((movie.genres || []).map((genre) => genre.toLowerCase()));
const currentCategories = new Set((movie.category || []).map((category) => category.toLowerCase()));
const currentCountry = movie.country?.toLowerCase() || '';

  const scoredMovies = allMovies
  .filter((candidate) => candidate.id !== movie.id)
  .filter((candidate) => getMovieListingKey(candidate) !== currentListingKey)
  .filter((candidate) => isSeriesMovie(candidate) === currentIsSeries)
  .map((candidate) => {
    const sharedGenreCount = candidate.genres.filter((genre) => currentGenres.has(genre.toLowerCase())).length;
    const sharedCategoryCount = (candidate.category || []).filter((category) =>
      currentCategories.has(category.toLowerCase())
    ).length;
    const sameCountryScore = currentCountry && candidate.country?.toLowerCase() === currentCountry ? 1 : 0;
    const metadataScore =
      sharedGenreCount * 100 +
      sharedCategoryCount * 10 +
      sameCountryScore;

    return { candidate, metadataScore };
  })
    .sort((first, second) => {
      if (second.metadataScore !== first.metadataScore) {
        return second.metadataScore - first.metadataScore;
      }

      return (second.candidate.date_added || '').localeCompare(first.candidate.date_added || '');
    });

const uniqueScoredMovies = dedupeSeriesMovies(scoredMovies.map((entry) => entry.candidate)).map((candidate) => {
  const match = scoredMovies.find((entry) => entry.candidate.id === candidate.id);
  return {
    candidate,
    metadataScore: match?.metadataScore || 0,
  };
});

const strongMatches = uniqueScoredMovies
  .filter((entry) => entry.metadataScore > 0)
  .slice(0, 8)
  .map((entry) => entry.candidate);

if (strongMatches.length >= 6) {
  setRelatedMovies(strongMatches);
  return;
}

const fallbackMovies = uniqueScoredMovies
  .filter((entry) => !strongMatches.some((relatedMovie) => relatedMovie.id === entry.candidate.id))
  .slice(0, 8 - strongMatches.length)
  .map((entry) => entry.candidate);

setRelatedMovies([...strongMatches, ...fallbackMovies]);
};

const cachedRelatedSource = [
  ...routeInitialCatalogMovies,
  ...readCachedPublicMovies().filter(
    (candidate) =>
      !routeInitialCatalogMovies.some(
        (initialCandidate) =>
          initialCandidate.id === candidate.id || initialCandidate.movieId === candidate.movieId
      )
  ),
];

if (cachedRelatedSource.length) {
  applyRelatedMovies(cachedRelatedSource);
} else {
  setRelatedMovies([]);
}

return () => {
  active = false;
};
}, [movie, routeInitialCatalogMovies]);

useEffect(() => {
  if (!movie?.parts?.length) {
    setSelectedPartIndex(0);
    return;
  }

  const requestedPartNumber = Number(new URLSearchParams(searchQueryString).get('part'));
  const orderedParts = [...movie.parts].sort((left, right) => left.order - right.order);
  const matchedIndex = orderedParts.findIndex((part, partIndex) => {
    if (requestedPartNumber === part.order) {
      return true;
    }

    return requestedPartNumber === partIndex + 1;
  });

  setSelectedPartIndex(matchedIndex >= 0 ? matchedIndex : 0);
}, [movie?.id, movie?.parts, searchQueryString]);

useEffect(() => {
  if (movie?.contentType === 'series' && movie.seasons?.length) {
    const episodeSearchParams = new URLSearchParams(searchQueryString);
    const requestedSeasonNumber = Number(episodeSearchParams.get('season'));
    const requestedEpisodeNumber = Number(episodeSearchParams.get('episode'));
    const orderedSeasons = movie.seasons
      .map((season) => ({
        ...season,
        episodes: [...(season.episodes || [])].sort((left, right) => left.episodeNumber - right.episodeNumber),
      }))
      .sort((left, right) => left.seasonNumber - right.seasonNumber);
    const nextSeason =
      orderedSeasons.find((season) => season.seasonNumber === requestedSeasonNumber) ||
      orderedSeasons[0];
    const nextEpisode =
      nextSeason?.episodes.find((episode) => episode.episodeNumber === requestedEpisodeNumber) ||
      nextSeason?.episodes[0];

    setSelectedSeasonNumber(nextSeason?.seasonNumber ?? null);
    setSelectedEpisodeNumber(nextEpisode?.episodeNumber ?? null);
    return;
  }

  setSelectedSeasonNumber(null);
  setSelectedEpisodeNumber(null);
}, [movie, searchQueryString]);

const seriesSeasons =
  movie?.contentType === 'series'
    ? (movie.seasons || [])
        .map((season) => ({
          ...season,
          episodes: [...(season.episodes || [])].sort((left, right) => left.episodeNumber - right.episodeNumber),
        }))
        .sort((left, right) => left.seasonNumber - right.seasonNumber)
    : [];
const selectedSeason =
  seriesSeasons.find((season) => season.seasonNumber === selectedSeasonNumber) ||
  seriesSeasons[0];
const selectedSeasonEpisodes = selectedSeason?.episodes || [];
const selectedEpisode =
  selectedSeasonEpisodes.find((episode) => episode.episodeNumber === selectedEpisodeNumber) ||
  selectedSeasonEpisodes[0];
const defaultSeriesSeasonNumber = seriesSeasons.length === 1 ? seriesSeasons[0].seasonNumber : null;
const episodePlaybackCandidates = new Map<string, Partial<Episode>>();

seriesSourceEntries.forEach((entry) => {
  (entry.seasons || []).forEach((season) => {
    (season.episodes || []).forEach((episode) => {
      const episodeKey = `${season.seasonNumber}-${episode.episodeNumber}`;
      const nextCandidate = mergeEpisodePlaybackCandidate(
        episodePlaybackCandidates.get(episodeKey),
        {
          title: episode.title,
          description: episode.description,
          overview: episode.overview,
          video_url: episode.video_url,
          sourceUrl: episode.sourceUrl,
          masterPlaylistUrl: episode.masterPlaylistUrl,
          overriddenBackdrop: episode.overriddenBackdrop || entry.overriddenBackdrop,
          episodeTrailerUrl:
            episode.episodeTrailerUrl ||
            entry.mainSeriesTrailerUrl ||
            entry.trailerUrl ||
            '',
          poster: episode.poster || season.poster || entry.poster,
          thumbnail: episode.thumbnail || episode.poster || season.poster || entry.poster,
          playbackType: episode.playbackType,
          isLocked: episode.isLocked,
        }
      );

      episodePlaybackCandidates.set(episodeKey, nextCandidate);
    });
  });

  const inferredEpisode = inferSeasonEpisodeFromSeriesEntry(entry, defaultSeriesSeasonNumber);

  if (!inferredEpisode.seasonNumber || !inferredEpisode.episodeNumber) {
    return;
  }

  const inferredEpisodeKey = `${inferredEpisode.seasonNumber}-${inferredEpisode.episodeNumber}`;
  const nextCandidate = mergeEpisodePlaybackCandidate(
    episodePlaybackCandidates.get(inferredEpisodeKey),
    {
      title: entry.title || entry.name || '',
      description: entry.description || '',
      overview: entry.overview || '',
      video_url: entry.video_url || '',
      sourceUrl: entry.sourceUrl || '',
      masterPlaylistUrl: entry.masterPlaylistUrl || '',
      overriddenBackdrop: entry.overriddenBackdrop || '',
      episodeTrailerUrl: entry.mainSeriesTrailerUrl || entry.trailerUrl || '',
      poster: entry.poster || '',
      thumbnail: entry.poster || '',
      playbackType: entry.playbackType,
      durationSeconds: entry.durationSeconds,
      isLocked: entry.isLocked,
    }
  );

  episodePlaybackCandidates.set(inferredEpisodeKey, nextCandidate);
});

const selectedEpisodePlaybackCandidate =
  selectedSeason && selectedEpisode
    ? episodePlaybackCandidates.get(`${selectedSeason.seasonNumber}-${selectedEpisode.episodeNumber}`)
    : undefined;
const activeEpisode = selectedEpisode
  ? {
      ...selectedEpisode,
      title: selectedEpisode.title || selectedEpisodePlaybackCandidate?.title || '',
      description: selectedEpisode.description?.trim() || selectedEpisodePlaybackCandidate?.description || '',
      overview: selectedEpisode.overview?.trim() || selectedEpisodePlaybackCandidate?.overview || '',
      video_url: selectedEpisodePlaybackCandidate?.video_url || selectedEpisode.video_url || '',
      sourceUrl: selectedEpisodePlaybackCandidate?.sourceUrl || selectedEpisode.sourceUrl || '',
      masterPlaylistUrl:
        selectedEpisodePlaybackCandidate?.masterPlaylistUrl || selectedEpisode.masterPlaylistUrl || '',
      overriddenBackdrop:
        selectedEpisode.overriddenBackdrop ||
        selectedEpisodePlaybackCandidate?.overriddenBackdrop ||
        movie?.overriddenBackdrop ||
        '',
      episodeTrailerUrl:
        selectedEpisode.episodeTrailerUrl ||
        selectedEpisodePlaybackCandidate?.episodeTrailerUrl ||
        '',
      poster: selectedEpisodePlaybackCandidate?.poster || selectedEpisode.poster || '',
      thumbnail: selectedEpisodePlaybackCandidate?.thumbnail || selectedEpisode.thumbnail || '',
      playbackType: selectedEpisodePlaybackCandidate?.playbackType || selectedEpisode.playbackType,
      durationSeconds:
        selectedEpisodePlaybackCandidate?.durationSeconds || selectedEpisode.durationSeconds || 0,
      isLocked: selectedEpisode.isLocked ?? selectedEpisodePlaybackCandidate?.isLocked ?? false,
    }
  : undefined;
const selectedPart =
  movie?.contentType !== 'series' && movie?.parts?.length
    ? movie.parts[selectedPartIndex]
    : undefined;
const activeEpisodeRenditionUrl = activeEpisode?.availableRenditions?.[0]?.playlistUrl || '';
const selectedPartRenditionUrl = selectedPart?.availableRenditions?.[0]?.playlistUrl || '';
const movieRenditionUrl = movie?.availableRenditions?.[0]?.playlistUrl || '';
const seriesPlaybackType =
  activeEpisode?.masterPlaylistUrl || activeEpisodeRenditionUrl ? 'hls' : 'mp4';
const moviePlaybackType =
  selectedPart?.masterPlaylistUrl || movie?.masterPlaylistUrl || selectedPartRenditionUrl || movieRenditionUrl ? 'hls' : 'mp4';
const seriesPlaybackVideoUrl =
  seriesPlaybackType === 'hls'
    ? activeEpisode?.masterPlaylistUrl || activeEpisodeRenditionUrl || activeEpisode?.video_url || activeEpisode?.sourceUrl || ''
    : activeEpisode?.video_url || activeEpisode?.sourceUrl || activeEpisode?.masterPlaylistUrl || activeEpisodeRenditionUrl || '';
const seriesPlaybackFallbackUrl =
  activeEpisode?.sourceUrl && activeEpisode.sourceUrl !== seriesPlaybackVideoUrl
    ? activeEpisode.sourceUrl
    : '';
const moviePlaybackVideoUrl =
  moviePlaybackType === 'hls'
    ? selectedPart?.masterPlaylistUrl || movie?.masterPlaylistUrl || selectedPartRenditionUrl || movieRenditionUrl || selectedPart?.video_url || selectedPart?.sourceUrl || movie?.video_url || movie?.sourceUrl || ''
    : selectedPart?.video_url || selectedPart?.sourceUrl || movie?.video_url || movie?.sourceUrl || selectedPart?.masterPlaylistUrl || movie?.masterPlaylistUrl || selectedPartRenditionUrl || movieRenditionUrl || '';
const moviePlaybackFallbackUrl =
  selectedPart?.sourceUrl && selectedPart.sourceUrl !== moviePlaybackVideoUrl
    ? selectedPart.sourceUrl
    : movie?.sourceUrl && movie.sourceUrl !== moviePlaybackVideoUrl
      ? movie.sourceUrl
      : '';
const playbackVideoUrl =
  movie?.contentType === 'series'
    ? seriesPlaybackVideoUrl
    : moviePlaybackVideoUrl;
const playbackFallbackUrl =
  movie?.contentType === 'series'
    ? seriesPlaybackFallbackUrl
    : moviePlaybackFallbackUrl;
const playbackType =
  movie?.contentType === 'series'
    ? seriesPlaybackType
    : moviePlaybackType;
const castPlaybackUrl =
  movie?.contentType === 'series'
    ? activeEpisode?.masterPlaylistUrl || activeEpisodeRenditionUrl || seriesPlaybackVideoUrl
    : selectedPart?.masterPlaylistUrl || movie?.masterPlaylistUrl || selectedPartRenditionUrl || movieRenditionUrl || moviePlaybackVideoUrl;
const uploadedTrailerUrl =
  movie?.contentType === 'series'
    ? activeEpisode?.episodeTrailerUrl ||
      movie?.mainSeriesTrailerUrl ||
      movie?.trailerUrl ||
      movie?.trailer_url ||
      ''
    : movie?.trailerUrl || movie?.trailer_url || '';
const seriesPlaybackPoster =
  activeEpisode?.overriddenBackdrop ||
  movie?.overriddenBackdrop ||
  activeEpisode?.thumbnail ||
  activeEpisode?.poster ||
  selectedSeason?.poster ||
  movie?.poster ||
  '';
const moviePlayerBackdrop =
  movie?.contentType === 'series'
    ? ''
    : movie?.overriddenPlayerBackdrop || movie?.playerBackdrop || '';
const playbackPoster =
  movie?.contentType === 'series' ? seriesPlaybackPoster : moviePlayerBackdrop;
const playerBackdrop = playbackPoster;
const downloadArtwork =
  (movie?.contentType === 'series' ? playbackPoster : movie?.poster || playbackPoster) || '';
const playbackDescription =
  movie?.contentType === 'series'
    ? (
        activeEpisode?.description ||
        activeEpisode?.overview ||
        selectedSeason?.overview ||
        movie?.overview ||
        movie?.description ||
        ''
      )
    : (
        selectedPart?.description ||
        movie?.description ||
        ''
      );
const isPlaybackLocked = isAppInReview
  ? false
  : !hasLocalPremiumAccess && Boolean(selectedPart?.isLocked || activeEpisode?.isLocked || movie?.isLocked);
const playbackGenreLabel =
  movie?.genres?.find((genre) => genre.trim()) ||
  'Unknown';
const playbackVjLabel = formatVjLabel(movie?.vj);
const playbackDurationLabel = formatPlaybackDuration(
  activeEpisode?.durationSeconds ||
  selectedPart?.durationSeconds ||
  movie?.durationSeconds
);
const isCurrentSeries = Boolean(movie && isSeriesMovie(movie));
const relatedSectionTitle = isCurrentSeries ? 'Related Shows' : 'Related Movies';
const relatedEmptyLabel = isCurrentSeries
  ? 'No related shows available right now.'
  : 'No related movies available right now.';
const getEpisodeLabel = (episodeNumber: number) => `EP ${episodeNumber}`;
const getEpisodeDisplayTitle = (episodeNumber: number, episodeTitle: string) => {
  const normalizedTitle = episodeTitle.trim();

  if (/^episode\s+\d+$/i.test(normalizedTitle) || /^ep\s*\d+$/i.test(normalizedTitle)) {
    return getEpisodeLabel(episodeNumber);
  }

  return normalizedTitle;
};
const syncPartSelection = (partIndex: number) => {
  setSelectedPartIndex(partIndex);
  setIsTrailerPlaying(false);
  setIsSavedToDownloads(false);
  setActionMessage('');

  const nextParams = new URLSearchParams(searchQueryString);
  nextParams.set('part', String(partIndex + 1));

  if (nextParams.toString() !== searchQueryString) {
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }
};
const syncSeriesSelection = (seasonNumber: number, episodeNumber: number) => {
  setSelectedSeasonNumber(seasonNumber);
  setSelectedEpisodeNumber(episodeNumber);
  setIsTrailerPlaying(false);
  setIsSavedToDownloads(false);
  setActionMessage('');

  const nextParams = new URLSearchParams(searchQueryString);
  nextParams.set('season', String(seasonNumber));
  nextParams.set('episode', String(episodeNumber));
  nextParams.delete('part');

  if (nextParams.toString() !== searchQueryString) {
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }
};
const playbackTitle = activeEpisode
  ? `${movie?.title || movie?.name} - S${selectedSeason?.seasonNumber || 1} EP ${activeEpisode.episodeNumber}`
  : selectedPart
    ? `${movie?.title || movie?.name} - ${selectedPart.title || selectedPart.label}`
  : (movie?.title || movie?.name || '');
const downloadBaseInput = movie && playbackVideoUrl
  ? {
      movieId: movie.movieId || movie.id,
      title: playbackTitle || movie.title || movie.name || 'Untitled movie',
      video_url: playbackVideoUrl,
      poster: downloadArtwork,
      contentType: activeEpisode ? 'episode' as const : selectedPart ? 'part' as const : 'movie' as const,
      seriesId: activeEpisode ? movie.id || movie.movieId : undefined,
      seasonNumber: activeEpisode ? selectedSeason?.seasonNumber || 1 : null,
      episodeNumber: activeEpisode ? activeEpisode.episodeNumber : null,
      episodeId: activeEpisode
        ? String(
            (activeEpisode as { id?: string; episodeId?: string }).id ||
              (activeEpisode as { episodeId?: string }).episodeId ||
              ''
          )
        : null,
      episodeTitle: activeEpisode?.title || null,
      partIndex: selectedPart ? selectedPartIndex + 1 : null,
    }
  : null;
const downloadInput = downloadBaseInput
  ? {
      ...downloadBaseInput,
      downloadKey: createOfflineDownloadKey(downloadBaseInput),
    }
  : null;
const isNativeDownloadActive = isOfflineDownloadActive(offlineDownloadJob);
const activeDownloadPercent = offlineDownloadJob ? getDownloadPercent(offlineDownloadJob) : null;
const activeDownloadLabel = formatDownloadProgressLabel(offlineDownloadJob);

useEffect(() => {
const loadUserMovieState = async () => {
if (!movie?.id) {
setIsSavedToDownloads(false);
setIsSavedToWatchlist(false);
setIsLiked(false);
return;
}

try {
setIsSavedToDownloads(
isAppInReview
  ? false
  : supportsNativeOfflineDownloads() && downloadInput?.downloadKey
    ? Boolean(await findOfflineDownload(downloadInput.downloadKey))
    : Boolean(await getUserDownloadByMovieId(movie.movieId || movie.id))
);
} catch (downloadStateError) {
console.error('[movie-page] failed to load download state', downloadStateError);
setIsSavedToDownloads(false);
}

try {
setIsSavedToWatchlist(Boolean(await getUserWatchlistMovie(movie.movieId || movie.id)));
} catch (watchlistError) {
console.error('[movie-page] failed to load watchlist state', watchlistError);
setIsSavedToWatchlist(false);
}

try {
setIsLiked(Boolean(await getUserLikedMovie(movie.movieId || movie.id)));
} catch (likeError) {
console.error('[movie-page] failed to load like state', likeError);
setIsLiked(false);
}
};

loadUserMovieState();
}, [downloadInput?.downloadKey, movie?.id, movie?.movieId]);

useEffect(() => {
  if (!supportsNativeOfflineDownloads() || !downloadInput?.downloadKey) {
    setOfflineDownloadJob(null);
    return;
  }

  let active = true;

  const syncActiveDownload = () => {
    const job = getActiveOfflineDownload(downloadInput.downloadKey);

    if (!active) return;

    setOfflineDownloadJob(job);

    if (job) {
      setIsSavedToDownloads(false);
      return;
    }

    void findOfflineDownload(downloadInput.downloadKey).then((record) => {
      if (active) {
        setIsSavedToDownloads(Boolean(record));
      }
    });
  };

  syncActiveDownload();

  const unsubscribe = subscribeOfflineDownloads(syncActiveDownload);

  return () => {
    active = false;
    unsubscribe();
  };
}, [downloadInput?.downloadKey]);

const playbackSessionKey = activeEpisode
  ? `series-${selectedSeason?.seasonNumber}-${activeEpisode.episodeNumber}-${playbackVideoUrl || 'no-source'}${shouldAutoplay ? '-autoplay' : ''}`
  : selectedPart
    ? `part-${selectedPartIndex}-${playbackVideoUrl || 'no-source'}${shouldAutoplay ? '-autoplay' : ''}`
    : `${movie?.id || 'movie'}-${playbackVideoUrl || 'no-source'}${shouldAutoplay ? '-autoplay' : ''}`;

const currentMovieHref = movie
  ? movie.contentType === 'series' && selectedSeason && selectedEpisode
    ? `/movie/${movie.id}?season=${selectedSeason.seasonNumber}&episode=${selectedEpisode.episodeNumber}`
    : movie.parts && movie.parts.length > 0
      ? `/movie/${movie.id}?part=${selectedPartIndex + 1}`
      : `/movie/${movie.id}`
  : '/';
const reviewTrailerUrl = movie && isAppInReview ? getReviewTrailerUrl(movie) : '';
const availableTrailerUrl = isAppInReview ? reviewTrailerUrl : uploadedTrailerUrl;
const isMp4TrailerPlaying = !isAppInReview && isTrailerPlaying && Boolean(uploadedTrailerUrl);
const activePlaybackSessionKey = isMp4TrailerPlaying
  ? `trailer-${movie?.id || 'movie'}-${selectedSeason?.seasonNumber || 0}-${activeEpisode?.episodeNumber || selectedPartIndex + 1}-${uploadedTrailerUrl}`
  : playbackSessionKey;

useLayoutEffect(() => {
  if (!movie) {
    return;
  }

  if (isMp4TrailerPlaying) {
    setPlaybackSource({
      sessionKey: activePlaybackSessionKey,
      movieId: movie.movieId || movie.id,
      sourceUrl: uploadedTrailerUrl,
      fallbackUrl: '',
      castUrl: uploadedTrailerUrl,
      playbackType: 'mp4',
      autoplay: true,
      poster: playbackPoster,
      title: `${playbackTitle || movie.title || movie.name || 'UGMOVIES247'} trailer`,
      description: playbackDescription,
      watchHref: currentMovieHref,
    });
    return;
  }

  if (isAppInReview || isPlaybackLocked || !playbackVideoUrl) {
    setPlaybackSource(null);
    return;
  }

  setPlaybackSource({
    sessionKey: activePlaybackSessionKey,
    movieId: movie.movieId || movie.id,
    sourceUrl: playbackVideoUrl,
    fallbackUrl: playbackFallbackUrl || '',
    castUrl: castPlaybackUrl || playbackVideoUrl,
    playbackType,
    autoplay: shouldAutoplay,
    poster: playbackPoster,
    title: playbackTitle || movie.title || movie.name || 'UGMOVIES247',
    description: playbackDescription,
    watchHref: currentMovieHref,
  });
  }, [
    activePlaybackSessionKey,
    castPlaybackUrl,
    currentMovieHref,
    isPlaybackLocked,
    isMp4TrailerPlaying,
    movie,
    playbackDescription,
    playbackFallbackUrl,
    playbackPoster,
    playbackTitle,
    playbackType,
    playbackVideoUrl,
    shouldAutoplay,
    setPlaybackSource,
    uploadedTrailerUrl,
  ]);

const handleDownload = async () => {
  if (!movie) {
    return;
  }

  if (isAppInReview) {
      setActionMessage('Downloads are not available in this app version.');
    return;
  }

  if (isPlaybackLocked) {
    setShowPremiumDownloadModal(true);
    return;
  }

  if (isSavedToDownloads) {
    setActionMessage('Already saved to your downloads.');
    return;
  }

  if (isNativeDownloadActive) {
    setActionMessage('This download is already running.');
    return;
  }

  if (!playbackVideoUrl) {
    setActionMessage('No in-app download data was found for this movie yet.');
    return;
  }

  setIsDownloading(true);

  try {
    if (!downloadInput) {
      setActionMessage('No in-app download data was found for this movie yet.');
      return;
    }

    const result = supportsNativeOfflineDownloads()
      ? await downloadMovieOffline(downloadInput)
      : await saveMovieDownload(downloadInput);

    if (result.alreadyExists) {
      setIsSavedToDownloads(true);
      setActionMessage('Already saved to your downloads.');
      return;
    }

    setIsSavedToDownloads(true);
    setActionMessage(
      supportsNativeOfflineDownloads()
        ? 'Movie downloaded for offline playback.'
        : 'Movie saved to your downloads.'
    );
  } catch (err) {
    const firebaseError = err as FirebaseError;
    console.error('[movie-page] download save failed', {
      movieId: movie.movieId || movie.id,
      title: movie.title || movie.name || 'Untitled movie',
      code: firebaseError?.code || 'unknown',
      message: firebaseError?.message || String(err),
      fullError: err,
    });
    setActionMessage(firebaseError?.message || 'We could not save this movie to your downloads right now.');
  } finally {
    setIsDownloading(false);
  }
};

const handleCancelDownload = async () => {
  if (!downloadInput?.downloadKey) {
    return;
  }

  try {
    await cancelOfflineDownload(downloadInput.downloadKey);
    setOfflineDownloadJob(null);
    setIsDownloading(false);
    setIsSavedToDownloads(false);
    setActionMessage('Download cancelled.');
  } catch (error) {
    setActionMessage(error instanceof Error ? error.message : 'Download could not be cancelled.');
  }
};

const handleWatchlist = async () => {
  if (!movie) {
    return;
  }

  setIsSavingToList(true);

  try {
    if (isSavedToWatchlist) {
      await removeMovieFromWatchlist(movie.movieId || movie.id);
      setIsSavedToWatchlist(false);
      setActionMessage('Movie removed from My List.');
      return;
    }

    await saveMovieToWatchlist({
      movieId: movie.movieId || movie.id,
      title: movie.title || movie.name || 'Untitled movie',
      poster: movie.poster || '',
      video_url: playbackVideoUrl,
    });

    setIsSavedToWatchlist(true);
    setActionMessage('Movie added to My List.');
  } catch (err) {
    const firebaseError = err as FirebaseError;
    console.error('[movie-page] watchlist save failed', {
      movieId: movie.movieId || movie.id,
      title: movie.title || movie.name || 'Untitled movie',
      code: firebaseError?.code || 'unknown',
      message: firebaseError?.message || String(err),
      fullError: err,
    });
    setActionMessage(firebaseError?.message || 'We could not update My List right now.');
  } finally {
    setIsSavingToList(false);
  }
};

const handleLike = async () => {
  if (!movie) {
    return;
  }

  setIsLiking(true);

  try {
    if (isLiked) {
      await removeMovieLike(movie.movieId || movie.id);
      setIsLiked(false);
      setActionMessage('Movie removed from your Likes.');
      return;
    }

    await saveMovieLike({
      movieId: movie.movieId || movie.id,
      title: movie.title || movie.name || 'Untitled movie',
      poster: movie.poster || '',
    });

    setIsLiked(true);
    setActionMessage('Movie added to your Likes. Open Likes from your profile anytime.');
  } catch (err) {
    const firebaseError = err as FirebaseError;
    console.error('[movie-page] like save failed', {
      movieId: movie.movieId || movie.id,
      title: movie.title || movie.name || 'Untitled movie',
      code: firebaseError?.code || 'unknown',
      message: firebaseError?.message || String(err),
      fullError: err,
    });
    setActionMessage(firebaseError?.message || 'We could not update your likes right now.');
  } finally {
    setIsLiking(false);
  }
};

const handleShare = async () => {
  if (!movie || typeof window === 'undefined') {
    return;
  }

  const shareTarget =
    movie.contentType === 'series' && selectedSeason && selectedEpisode
      ? `/movie/${movie.id}?season=${selectedSeason.seasonNumber}&episode=${selectedEpisode.episodeNumber}`
      : movie.parts && movie.parts.length > 0
        ? `/movie/${movie.id}?part=${selectedPartIndex + 1}`
      : `/movie/${movie.movieId || movie.id}`;
  const shareUrl = `${window.location.origin}${shareTarget}`;
  const shareData = {
    title: movie.title || movie.name || 'UGMOVIES247',
    text: `${isAppInReview ? 'Discover' : 'Watch'} ${movie.title || movie.name || 'this movie'} on UGMOVIES247`,
    url: shareUrl,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      setActionMessage('Shared successfully.');
      return;
    }

    await navigator.clipboard.writeText(shareUrl);
    setActionMessage('Movie link copied to clipboard.');
  } catch (err) {
    console.error('Share failed:', err);
    setActionMessage('Unable to share this movie right now.');
  }
};

const handleWatchTrailer = () => {
  if (!movie) {
    return;
  }

  const trailerUrl = availableTrailerUrl;

  if (!trailerUrl) {
    setActionMessage('No trailer is available right now.');
    return;
  }

  setActionMessage('');
  if (isMp4TrailerPlaying) {
    setIsTrailerPlaying(false);
    return;
  }

  setIsTrailerPlaying(true);
};

const handleCast = async () => {
  if (isAppInReview) {
      setActionMessage('Casting is not available in this app version.');
    return;
  }

  if (isPlaybackLocked && !isMp4TrailerPlaying) {
    setActionMessage('Unlock this movie first before casting it.');
    return;
  }

  const castingUrl = isMp4TrailerPlaying ? uploadedTrailerUrl : castPlaybackUrl || playbackVideoUrl;

  if (!castingUrl) {
    setActionMessage('This movie is not ready for casting yet.');
    return;
  }

  setActionMessage('Looking for cast devices...');

  try {
    const message = await startCasting({
      videoElement,
      playbackUrl: castingUrl,
      title: playbackTitle || movie?.title || movie?.name || 'UGMOVIES247',
      poster: playbackPoster,
      playbackType: isMp4TrailerPlaying ? 'mp4' : playbackType,
    });
    setActionMessage(message);
  } catch (err) {
    console.error('Cast failed:', err);
    setActionMessage(err instanceof Error ? err.message : 'A casting target could not be started right now.');
  }
};

if (loading && !movie) {
  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-24 pt-6 text-white md:px-10 md:pt-[112px]">
      <div className="mx-auto max-w-[1360px]">
        <div className="aspect-video w-full rounded-[28px] border border-white/10 bg-[#05070B]" />
        <div className="mx-auto mt-8 max-w-2xl space-y-4 text-center">
          <div className="mx-auto h-9 w-64 rounded-full bg-white/8" />
          <div className="mx-auto h-4 w-44 rounded-full bg-white/6" />
          <div className="mx-auto h-14 w-full max-w-xl rounded-[22px] bg-white/8" />
        </div>
      </div>
    </main>
  );
}

if (!movie) return ( <main className="min-h-screen bg-[#0B0C10] text-[#D90429] flex items-center justify-center font-bold">
404 PAYLOAD NOT FOUND </main>
);

const subscribeHref = `/subscribe?returnTo=${encodeURIComponent(currentMovieHref)}`;
const hasPlaybackSource = !isAppInReview && (Boolean(playbackVideoUrl) || isMp4TrailerPlaying);
const showPlayerPreviewBackdrop =
  Boolean(playerBackdrop) && !isMp4TrailerPlaying && (isAppInReview || (!isPlaybackLocked && !hasPlaybackSource));

return ( <main className="min-h-screen bg-[#0B0C10] text-white font-sans pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10 md:pt-[88px] lg:px-10">

  {/* Video Player */}
  <div className="relative isolate mt-0 aspect-video w-full overflow-hidden bg-black md:mx-auto md:mt-6 md:w-[min(100%,1380px,calc((100svh-13rem)*16/9))] md:rounded-[28px] md:border md:border-white/8 md:shadow-[0_28px_80px_rgba(0,0,0,0.4)]">
    {showPlayerPreviewBackdrop && (
      <div className="absolute inset-0">
        <img
          src={playerBackdrop}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover scale-105 opacity-72"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/18 via-black/28 to-black/42" />
      </div>
    )}
    {isAppInReview && isTrailerPlaying ? (
      <div className="absolute inset-0 z-20 bg-black">
        <TrailerEmbedPlayer
          trailerUrl={reviewTrailerUrl}
          title={`${playbackTitle || movie.title || movie.name || 'UGMOVIES247'} trailer`}
          autoplay
          fill
        />
      </div>
    ) : isAppInReview ? (
      <button
        type="button"
        onClick={handleWatchTrailer}
        className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden bg-black/18 px-6 text-center transition-colors hover:bg-black/24"
        aria-label="Watch trailer"
      >
        <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full border border-white/18 bg-white/16 pl-1 shadow-[0_0_28px_rgba(255,255,255,0.20)] backdrop-blur-md md:h-20 md:w-20">
          <svg className="h-7 w-7 text-white md:h-9 md:w-9" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 4l12 6-12 6z" />
          </svg>
        </div>
        <div className="relative z-10 mt-4 rounded-full border border-white/12 bg-black/28 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-white/86 backdrop-blur-md">
          Watch Trailer
        </div>
      </button>
    ) : isPlaybackLocked && !isMp4TrailerPlaying ? (
      <button
        type="button"
        onClick={() => router.push(subscribeHref)}
        className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-black transition-colors hover:bg-black"
        aria-label="Open subscription plans"
      >
        {playbackPoster ? (
          <>
            <img
              src={playbackPoster}
              alt={`Watch ${playbackTitle || movie.title || movie.name || 'this movie'} on UGMOVIES247`}
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/18 to-black/36" />
          </>
        ) : null}
        <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full border border-red-300/25 bg-[#D90429]/90 pl-1 shadow-[0_0_24px_rgba(217,4,41,0.62)] backdrop-blur-md md:h-20 md:w-20">
          <svg className="h-7 w-7 text-white md:h-9 md:w-9" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 4l12 6-12 6z" />
          </svg>
        </div>
      </button>
    ) : (
      hasPlaybackSource ? (
        <div className="relative z-10 h-full w-full">
          <PersistentPlaybackHost active className="h-full w-full" />
        </div>
      ) : (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/34 px-6 text-center">
          <div className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-white/78">
            Video Unavailable
          </div>
          <p className="mt-4 text-sm font-bold uppercase tracking-[0.18em] text-white md:text-base">
            This episode has no playable source yet
          </p>
          <p className="mt-3 max-w-lg text-xs leading-6 text-white/70 md:text-sm">
            Try another episode or come back shortly after processing finishes.
          </p>
        </div>
      )
    )}
  </div>

  <section className="px-4 md:px-0 max-w-4xl mx-auto mt-4 md:mt-8">
      <div className="flex flex-col items-center gap-3">
        <div className="w-full max-w-[620px] text-center">
          <h1 className="text-[2rem] font-black tracking-[-0.03em] text-white md:text-4xl">
            {playbackTitle}
          </h1>

          <div className="mt-3 grid grid-cols-3 items-center gap-2 text-[12px] font-semibold text-white/78 md:mt-4 md:text-[15px]">
            <div className="text-left">
              <span className="text-white/50">Genre:</span>{' '}
              <span className="text-white/92">{playbackGenreLabel}</span>
            </div>
            <div className="text-center font-black tracking-[-0.02em] text-[#D90429]">
              {playbackVjLabel}
            </div>
            <div className="text-right">
              <span className="text-white/50">Duration:</span>{' '}
              <span className="text-white/92">{playbackDurationLabel || '--'}</span>
            </div>
          </div>
        </div>

        {!isAppInReview && (
          <>
            <button
              onClick={handleDownload}
              disabled={isDownloading || isNativeDownloadActive || isSavedToDownloads}
              className="relative flex w-full max-w-[620px] items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-r from-[#24344A] via-[#1E2A3B] to-[#131B28] px-5 py-4 text-sm font-black tracking-[0.12em] text-white shadow-[0_18px_35px_rgba(0,0,0,0.28)] transition-colors duration-200 hover:from-[#2D4059] hover:to-[#182334] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-[#2B2F38] disabled:text-white/45 sm:tracking-[0.18em]"
            >
              <span className="max-w-[calc(100%-2.5rem)] text-center leading-5">
                {isNativeDownloadActive
                  ? activeDownloadLabel
                  : isDownloading
                    ? supportsNativeOfflineDownloads()
                      ? 'Preparing download...'
                      : 'Working...'
                    : isSavedToDownloads
                      ? 'Saved to Downloads'
                      : offlineDownloadJob?.status === 'failed'
                        ? 'Download failed - Retry'
                        : 'Download'}
              </span>
              <span className="pointer-events-none absolute right-5">
                {isPlaybackLocked ? <LockedDownloadIcon /> : <DownloadIcon />}
              </span>
            </button>

            {isNativeDownloadActive ? (
              <button
                type="button"
                onClick={handleCancelDownload}
                className="w-full max-w-[620px] rounded-2xl border border-red-400/30 bg-red-500/10 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-red-100 transition-colors hover:border-red-300/60 hover:bg-red-500/18"
              >
                Cancel Download
              </button>
            ) : null}
          </>
        )}

        {actionMessage && (
          <div className="w-full max-w-[620px] rounded-2xl border border-[#7AA2D6]/20 bg-[#182334]/88 px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[#D9E7FF] shadow-[0_16px_28px_rgba(0,0,0,0.24)]">
            {actionMessage}
          </div>
        )}

        {!isAppInReview && showPremiumDownloadModal && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/72 px-4 backdrop-blur-sm"
            onClick={() => setShowPremiumDownloadModal(false)}
          >
            <div
              className="w-full max-w-[420px] rounded-[28px] border border-white/10 bg-[#0F1621] p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5">
                <Lock className="h-6 w-6 text-[#C0C0C0]" strokeWidth={1.9} aria-hidden="true" />
              </div>
              <p className="mt-5 text-sm leading-7 text-white/86 md:text-[15px]">
                Downloads are available exclusively to premium subscribers. Upgrade your subscription to download and watch offline.
              </p>
              <button
                type="button"
                onClick={() => {
                  setShowPremiumDownloadModal(false);
                  router.push(subscribeHref);
                }}
                className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#D90429] px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-[#ef163b]"
              >
                Subscribe Now
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          {availableTrailerUrl ? (
            <button
              type="button"
              onClick={handleWatchTrailer}
              className="rounded-xl border border-white/10 bg-[#131B28] px-4 py-2.5 text-sm font-bold text-gray-200 inline-flex items-center gap-2 transition-colors hover:border-[#7AA2D6] hover:text-white"
            >
              <Film size={16} strokeWidth={2.25} />
              {isMp4TrailerPlaying ? 'Watch Movie' : 'Watch Trailer'}
            </button>
          ) : null}

          <button
            onClick={handleWatchlist}
            disabled={isSavingToList}
            className="rounded-xl border border-white/10 bg-[#131B28] px-4 py-2.5 text-sm font-bold text-gray-200 inline-flex items-center gap-2 transition-colors hover:border-[#7AA2D6] hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-gray-500"
          >
            <Bookmark size={16} />
            {isSavingToList ? 'Working...' : isSavedToWatchlist ? 'Remove from My List' : 'Add to My List'}
          </button>

          <button
            onClick={handleLike}
            disabled={isLiking}
            className="rounded-xl border border-white/10 bg-[#131B28] px-4 py-2.5 text-sm font-bold text-gray-200 inline-flex items-center gap-2 transition-colors hover:border-[#7AA2D6] hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-gray-500"
          >
            <Heart size={16} className={isLiked ? 'fill-[#D90429] text-[#D90429]' : ''} />
            {isLiking ? 'Working...' : isLiked ? 'Unlike' : 'Like'}
          </button>

          {!isAppInReview && (
            <button
              onClick={handleCast}
              className="rounded-xl border border-white/10 bg-[#131B28] px-4 py-2.5 text-sm font-bold text-gray-200 inline-flex items-center gap-2 transition-colors hover:border-[#7AA2D6] hover:text-white"
            >
              <Cast size={16} />
              Cast
            </button>
          )}

          <button
            onClick={handleShare}
            className="rounded-xl border border-white/10 bg-[#131B28] px-4 py-2.5 text-sm font-bold text-gray-200 inline-flex items-center gap-2 transition-colors hover:border-[#7AA2D6] hover:text-white"
          >
            <Share2 size={16} />
            Share
          </button>

        </div>
      </div>
  </section>

  {/* Info */}
  <div className="p-4 md:px-0 md:py-8 max-w-4xl mx-auto">
    <p className="text-gray-300 mb-6">
      {playbackDescription}
    </p>

    <p className="mb-6 text-sm leading-7 text-white/62">
      {isAppInReview ? 'Discover' : 'Watch'} {playbackTitle} on UGMOVIES247, featuring {playbackGenreLabel} entertainment and {playbackVjLabel} translation for Uganda movie fans, Luganda translated movie lovers, and VJ movie audiences.
    </p>

    {movie.contentType !== 'series' && movie.parts && movie.parts.length > 0 && (
      <section className="mb-6 rounded-2xl border border-white/10 bg-[#11141C]/80 p-4 md:p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
        <div className="mb-3">
          <h2 className="text-sm md:text-base font-black uppercase tracking-[0.24em] text-white">
            Movie Parts
          </h2>
          <p className="mt-2 text-sm text-white/65">
            Long movie split into multiple MP4 parts. Play them in order.
          </p>
        </div>

        <div className="flex flex-nowrap gap-2 overflow-x-auto pb-3 [scrollbar-color:#D90429_#1F2833]">
          {movie.parts
            .slice()
            .sort((left, right) => left.order - right.order)
            .map((part, partIndex) => (
              <button
                key={`${movie.id}-part-${part.id}`}
                onClick={() => syncPartSelection(partIndex)}
                className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap border transition-colors ${
                  selectedPartIndex === partIndex
                    ? 'bg-[#D90429] border-[#D90429] text-white'
                    : 'bg-[#1F2833]/40 border-white/10 text-gray-300 hover:border-white'
                }`}
              >
                {part.label || `Part ${partIndex + 1}`}
              </button>
            ))}
        </div>
      </section>
    )}

    {movie.contentType === 'series' && seriesSeasons.length > 0 && (
      <section className="mb-6 rounded-2xl border border-white/10 bg-[#11141C]/80 p-4 md:p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
        <div className="mb-3">
          <h2 className="text-sm md:text-base font-black uppercase tracking-[0.24em] text-white">
            Seasons
          </h2>
        </div>

        <div className="flex flex-nowrap gap-2 overflow-x-auto pb-3 [scrollbar-color:#D90429_#1F2833]">
          {seriesSeasons.map((season) => (
            <button
              key={`${movie.id}-season-${season.seasonNumber}`}
              onClick={() => {
                const nextEpisodeNumber = season.episodes[0]?.episodeNumber ?? 1;
                syncSeriesSelection(season.seasonNumber, nextEpisodeNumber);
              }}
              className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap border transition-colors ${
                selectedSeason?.seasonNumber === season.seasonNumber
                  ? 'bg-[#D90429] border-[#D90429] text-white'
                  : 'bg-[#1F2833]/40 border-white/10 text-gray-300 hover:border-white'
              }`}
            >
              {season.title || `Season ${season.seasonNumber}`}
            </button>
          ))}
        </div>

        <div className="mt-2 mb-3">
          <h3 className="text-sm md:text-base font-black uppercase tracking-[0.24em] text-white">
            Episodes
          </h3>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 md:grid md:grid-cols-3 xl:grid-cols-4 md:overflow-visible [scrollbar-color:#D90429_#1F2833]">
          {selectedSeasonEpisodes.map((episode) => {
            const episodeLabel = getEpisodeLabel(episode.episodeNumber);
            const episodeDisplayTitle = getEpisodeDisplayTitle(episode.episodeNumber, episode.title);
            const episodePreview =
              episode.overriddenBackdrop ||
              movie.overriddenBackdrop ||
              episode.thumbnail ||
              episode.poster ||
              selectedSeason?.poster ||
              movie.poster;

            return (
              <button
                key={`${movie.id}-season-${selectedSeason?.seasonNumber}-episode-${episode.episodeNumber}`}
                onClick={() => {
                  if (!selectedSeason) {
                    return;
                  }

                  syncSeriesSelection(selectedSeason.seasonNumber, episode.episodeNumber);
                }}
                className={`relative min-w-[clamp(84px,calc((100vw-4rem)/3.6),104px)] sm:min-w-[clamp(88px,calc((100vw-4.5rem)/3.55),112px)] md:min-w-0 text-left overflow-hidden rounded-xl border transition-colors ${
                  selectedEpisode?.episodeNumber === episode.episodeNumber
                    ? 'border-[#D90429] bg-[#D90429]/12 shadow-[0_0_0_1px_rgba(217,4,41,0.3)]'
                    : 'border-white/10 bg-[#1F2833]/20 hover:border-white/30'
                }`}
                aria-label={`Play ${episodeDisplayTitle}`}
                type="button"
              >
                <div className="relative aspect-[1.85/1] w-full bg-[#11141C]">
                  {episodePreview ? (
                    <>
                      <img
                        src={episodePreview}
                        alt={episode.title}
                        className="absolute inset-0 h-full w-full object-cover object-center"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-black/18 via-black/12 to-black/38" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#1F2833] text-lg font-black text-[#D90429]">
                      {episodeLabel}
                    </div>
                  )}

                  <div className="absolute right-2.5 top-2.5 md:right-3 md:top-3">
                    <p className="text-[10px] md:text-xs font-black leading-none text-[#D90429] drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">
                      {episodeLabel}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    )}
  </div>

  <section className="px-4 md:px-0 max-w-6xl mx-auto mt-2">
    <div className="border-t border-white/10 pt-8">
      <h2 className="text-xl md:text-2xl font-bold mb-5">{relatedSectionTitle}</h2>

      {!relatedMovies.length ? (
        <div className="bg-[#1F2833]/20 border border-white/10 rounded-lg p-5 text-gray-400 text-sm">
          {relatedEmptyLabel}
        </div>
      ) : (
        <div className="flex gap-2 md:gap-3 overflow-x-auto pb-3 snap-x snap-mandatory [scrollbar-color:#D90429_#1F2833]">
          {relatedMovies.map((relatedMovie) => (
            <Link
              key={relatedMovie.id}
              href={`/movie/${relatedMovie.id}`}
              className="group min-w-[104px] max-w-[104px] md:min-w-[220px] md:max-w-[220px] lg:min-w-[236px] lg:max-w-[236px] xl:min-w-[248px] xl:max-w-[248px] bg-[#1F2833]/20 border border-white/5 hover:border-[#D90429]/50 rounded-lg overflow-hidden transition-colors snap-start flex-shrink-0"
            >
              <div className="relative aspect-[3/4] bg-[#1F2833] overflow-hidden">
                {isSeriesMovie(relatedMovie) && (
                  <div className="absolute top-2 right-2 bg-white/95 text-[#0B0C10] text-[7px] md:text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full z-10 shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
                    EPS
                  </div>
                )}
                <img
                  src={relatedMovie.poster}
                  alt={`${isAppInReview ? 'Discover' : 'Watch'} ${relatedMovie.title} on UGMOVIES247`}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="p-2.5 md:p-3.5">
                <h3 className="text-[10px] md:text-[15px] text-white font-bold line-clamp-2 group-hover:text-[#D90429] transition-colors">
                  {relatedMovie.title}
                </h3>
                <p className="text-[#888888] text-[9px] md:text-[11px] mt-1.5 uppercase tracking-wider">
                  {formatVjLabel(relatedMovie.vj)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  </section>

</main>

);
}

function DownloadIcon() {
  return (
    <svg className="h-[18px] w-[18px] text-white/90" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" />
    </svg>
  );
}

function LockedDownloadIcon() {
  return <Lock className="h-[18px] w-[18px] text-white/90" strokeWidth={2.1} aria-hidden="true" />;
}
