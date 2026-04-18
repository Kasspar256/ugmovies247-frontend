'use client';
import { useEffect, useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getUserDownloadByMovieId, saveMovieDownload } from '@/lib/downloads';
import type { FirebaseError } from 'firebase/app';
import { normalizeMovie, type Episode, type Movie } from '@/types/movie';
import { getUserWatchlistMovie, removeMovieFromWatchlist, saveMovieToWatchlist } from '@/lib/watchlist';
import { getUserLikedMovie, removeMovieLike, saveMovieLike } from '@/lib/likes';
import { dedupeSeriesMovies, getMovieListingKey, isSeriesMovie, mergeSeriesMovies } from '@/lib/moviePresentation';
import { Bookmark, Cast, Heart, Share2 } from 'lucide-react';
import { fetchPublicMovies } from '@/lib/publicMovies';
import MobileBackButton from '@/components/MobileBackButton';
import { startCasting } from '@/lib/cast';
import {
  PersistentPlaybackHost,
  usePlayback,
} from '@/components/player/PlaybackProvider';

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
    masterPlaylistUrl: '',
    poster: incoming.poster || existing?.poster || '',
    thumbnail: incoming.thumbnail || existing?.thumbnail || '',
    playbackType: 'mp4',
    isLocked: incoming.isLocked ?? existing?.isLocked,
  };
}

export default function MoviePlayerPage({ params }: { params: { id: string } }) {
const [movie, setMovie] = useState<Movie | null>(null);
const [loading, setLoading] = useState(true);
const [isDownloading, setIsDownloading] = useState(false);
const [isSavingToList, setIsSavingToList] = useState(false);
const [isLiking, setIsLiking] = useState(false);
const [isSavedToDownloads, setIsSavedToDownloads] = useState(false);
const [isSavedToWatchlist, setIsSavedToWatchlist] = useState(false);
const [isLiked, setIsLiked] = useState(false);
const [actionMessage, setActionMessage] = useState('');
const [relatedMovies, setRelatedMovies] = useState<Movie[]>([]);
const [seriesSourceEntries, setSeriesSourceEntries] = useState<Movie[]>([]);
const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number | null>(null);
const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number | null>(null);
const [selectedPartIndex, setSelectedPartIndex] = useState(0);
const router = useRouter();
const pathname = usePathname();
const searchParams = useSearchParams();
const searchQueryString = searchParams.toString();
const { setPlaybackSource, videoElement } = usePlayback();

useEffect(() => {
const fetchMovie = async () => {
try {
const allMovies = await fetchPublicMovies({ force: true });

const loadMergedSeriesMovie = async (initialMovie: Movie) => {
  if (!isSeriesMovie(initialMovie)) {
    return {
      resolvedMovie: initialMovie,
      sourceEntries: [] as Movie[],
    };
  }

  const relatedSeriesEntries = allMovies
    .filter((candidate) => getMovieListingKey(candidate) === getMovieListingKey(initialMovie));

  const mergedSeriesMovie = mergeSeriesMovies(relatedSeriesEntries);

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
};

const matchedMovie = allMovies.find((candidate) => candidate.id === params.id);

if (matchedMovie) {
const { resolvedMovie, sourceEntries } = await loadMergedSeriesMovie(matchedMovie);
setMovie(resolvedMovie);
setSeriesSourceEntries(sourceEntries);
return;
}

const downloadRecord = await getUserDownloadByMovieId(params.id);

if (downloadRecord) {
const normalizedDownloadMovie = normalizeMovie(downloadRecord.movieId, downloadRecord);
const { resolvedMovie, sourceEntries } = await loadMergedSeriesMovie(normalizedDownloadMovie);
setMovie(resolvedMovie);
setSeriesSourceEntries(sourceEntries);
setIsSavedToDownloads(true);
return;
}

setSeriesSourceEntries([]);
} catch (err) {
console.error(err);
} finally {
setLoading(false);
}
};
fetchMovie();
}, [params.id]);

useEffect(() => {
const loadUserMovieState = async () => {
if (!movie?.id) {
setIsSavedToDownloads(false);
setIsSavedToWatchlist(false);
setIsLiked(false);
return;
}

try {
setIsSavedToDownloads(Boolean(await getUserDownloadByMovieId(movie.movieId || movie.id)));
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
}, [movie?.id, movie?.movieId]);

useEffect(() => {
const fetchRelatedMovies = async () => {
if (!movie?.id) {
setRelatedMovies([]);
return;
}

try {
const allMovies = await fetchPublicMovies();
const currentListingKey = getMovieListingKey(movie);

const currentGenres = new Set((movie.genres || []).map((genre) => genre.toLowerCase()));
const currentCategories = new Set((movie.category || []).map((category) => category.toLowerCase()));
const currentCountry = movie.country?.toLowerCase() || '';

  const scoredMovies = allMovies
  .filter((candidate) => candidate.id !== movie.id)
  .filter((candidate) => getMovieListingKey(candidate) !== currentListingKey)
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
} catch (err) {
console.error('Failed to fetch related movies:', err);
setRelatedMovies([]);
}
};

fetchRelatedMovies();
}, [movie]);

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
      poster: entry.poster || '',
      thumbnail: entry.poster || '',
      playbackType: entry.playbackType,
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
      poster: selectedEpisodePlaybackCandidate?.poster || selectedEpisode.poster || '',
      thumbnail: selectedEpisodePlaybackCandidate?.thumbnail || selectedEpisode.thumbnail || '',
      playbackType: selectedEpisodePlaybackCandidate?.playbackType || selectedEpisode.playbackType,
      isLocked: selectedEpisode.isLocked ?? selectedEpisodePlaybackCandidate?.isLocked ?? false,
    }
  : undefined;
const selectedPart =
  movie?.contentType !== 'series' && movie?.parts?.length
    ? movie.parts[selectedPartIndex]
    : undefined;
const playbackType = 'mp4';
const seriesPlaybackVideoUrl = activeEpisode?.video_url || activeEpisode?.sourceUrl || '';
const seriesPlaybackFallbackUrl =
  activeEpisode?.sourceUrl && activeEpisode.sourceUrl !== seriesPlaybackVideoUrl
    ? activeEpisode.sourceUrl
    : '';
const moviePlaybackVideoUrl =
  selectedPart?.video_url || selectedPart?.sourceUrl || movie?.video_url || movie?.sourceUrl || '';
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
const playbackPoster =
  selectedPart?.poster ||
  selectedPart?.thumbnail ||
  activeEpisode?.poster ||
  activeEpisode?.thumbnail ||
  selectedSeason?.poster ||
  movie?.poster ||
  '';
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
const isPlaybackLocked = Boolean(selectedPart?.isLocked || activeEpisode?.isLocked || movie?.isLocked);
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

  const nextParams = new URLSearchParams(searchQueryString);
  nextParams.set('part', String(partIndex + 1));

  if (nextParams.toString() !== searchQueryString) {
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }
};
const syncSeriesSelection = (seasonNumber: number, episodeNumber: number) => {
  setSelectedSeasonNumber(seasonNumber);
  setSelectedEpisodeNumber(episodeNumber);

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
const playbackSessionKey = activeEpisode
  ? `series-${selectedSeason?.seasonNumber}-${activeEpisode.episodeNumber}-${playbackVideoUrl || 'no-source'}`
  : selectedPart
    ? `part-${selectedPartIndex}-${playbackVideoUrl || 'no-source'}`
    : `${movie?.id || 'movie'}-${playbackVideoUrl || 'no-source'}`;

const currentMovieHref = movie
  ? movie.contentType === 'series' && selectedSeason && selectedEpisode
    ? `/movie/${movie.id}?season=${selectedSeason.seasonNumber}&episode=${selectedEpisode.episodeNumber}`
    : movie.parts && movie.parts.length > 0
      ? `/movie/${movie.id}?part=${selectedPartIndex + 1}`
      : `/movie/${movie.id}`
  : '/';

useLayoutEffect(() => {
  if (!movie) {
    return;
  }

  if (isPlaybackLocked || !playbackVideoUrl) {
    setPlaybackSource(null);
    return;
  }

  setPlaybackSource({
    sessionKey: playbackSessionKey,
    movieId: movie.movieId || movie.id,
    sourceUrl: playbackVideoUrl,
    fallbackUrl: playbackFallbackUrl || '',
    poster: playbackPoster,
    title: playbackTitle || movie.title || movie.name || 'UG Movies 247',
    description: playbackDescription,
    watchHref: currentMovieHref,
  });
}, [
  currentMovieHref,
  isPlaybackLocked,
  movie,
  playbackDescription,
  playbackFallbackUrl,
  playbackPoster,
  playbackSessionKey,
  playbackTitle,
  playbackVideoUrl,
  setPlaybackSource,
]);

const handleDownload = async () => {
  if (!movie) {
    return;
  }

  if (isPlaybackLocked) {
    setActionMessage('Subscribe to unlock downloads for this movie.');
    return;
  }

  if (isSavedToDownloads) {
    setActionMessage('Already saved to your downloads.');
    return;
  }

  if (!playbackVideoUrl) {
    setActionMessage('No in-app download data was found for this movie yet.');
    return;
  }

  setIsDownloading(true);

  try {
    const result = await saveMovieDownload({
      movieId: movie.movieId || movie.id,
      title:
        activeEpisode
          ? `${movie.title || movie.name || 'Untitled movie'} - ${activeEpisode.title}`
          : selectedPart
            ? `${movie.title || movie.name || 'Untitled movie'} - ${selectedPart.title || selectedPart.label}`
            : (movie.title || movie.name || 'Untitled movie'),
      video_url: playbackVideoUrl,
      poster: playbackPoster,
    });

    if (result.alreadyExists) {
      setIsSavedToDownloads(true);
      setActionMessage('Already saved to your downloads.');
      return;
    }

    setIsSavedToDownloads(true);
    setActionMessage('Movie saved to your downloads.');
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
    title: movie.title || movie.name || 'UGMovies247',
    text: `Watch ${movie.title || movie.name || 'this movie'} on UGMovies247`,
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

const handleCast = async () => {
  if (isPlaybackLocked) {
    setActionMessage('Unlock this movie first before casting it.');
    return;
  }

  if (!playbackVideoUrl) {
    setActionMessage('This movie is not ready for casting yet.');
    return;
  }

  setActionMessage('Looking for cast devices...');

  try {
    const message = await startCasting({
      videoElement,
      playbackUrl: playbackVideoUrl,
      title: playbackTitle || movie?.title || movie?.name || 'UG Movies 247',
      poster: playbackPoster,
      playbackType,
    });
    setActionMessage(message);
  } catch (err) {
    console.error('Cast failed:', err);
    setActionMessage(err instanceof Error ? err.message : 'A casting target could not be started right now.');
  }
};

if (loading) return ( <main className="min-h-screen bg-[#0B0C10] flex items-center justify-center"> <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin"></div> </main>
);

if (!movie) return ( <main className="min-h-screen bg-[#0B0C10] text-[#D90429] flex items-center justify-center font-bold">
404 PAYLOAD NOT FOUND </main>
);

const subscribeHref = `/subscribe?returnTo=${encodeURIComponent(currentMovieHref)}`;
const hasPlaybackSource = Boolean(playbackVideoUrl);

return ( <main className="min-h-screen bg-[#0B0C10] text-white font-sans pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10 lg:px-10">

  {/* Mobile Header */}
  <header className="fixed top-4 left-4 right-4 z-50 md:hidden">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <MobileBackButton
          fallbackHref="/"
          className="pointer-events-auto h-[38px] w-[38px] rounded-[22px] border border-white/10 bg-[#1B2230]/62 p-0 shadow-[0_6px_18px_rgba(0,0,0,0.30)] backdrop-blur-xl"
        />
        <Link
          href="/"
          className="pointer-events-auto h-[38px] w-[68px] rounded-[22px] bg-[#1B2230]/62 backdrop-blur-xl border border-white/10 shadow-[0_6px_18px_rgba(0,0,0,0.30)] flex items-center justify-center overflow-hidden"
        >
          <img
            src="/logow.png"
            alt="UG Movies 247"
            className="w-14 h-14 object-cover scale-125 translate-y-2"
          />
        </Link>
      </div>

      <div className="pointer-events-auto h-[34px] px-2 rounded-[20px] bg-[#1B2230]/62 backdrop-blur-xl border border-white/10 shadow-[0_6px_18px_rgba(0,0,0,0.30)] flex items-center justify-center gap-2">
        <Link href="/watchlist" className="text-white/90 hover:text-white transition-colors" aria-label="My List">
          <Bookmark size={18} />
        </Link>
        <Link href="/profile" className="text-white/90 hover:text-white transition-colors" aria-label="Profile">
          <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
          </svg>
        </Link>
      </div>
    </div>
  </header>

  {/* Video Player */}
  <div className="relative w-full h-[40vh] bg-black mt-20 md:mx-auto md:mt-[118px] md:h-[72vh] md:max-w-[1380px] md:overflow-hidden md:rounded-[28px] md:border md:border-white/8 md:shadow-[0_28px_80px_rgba(0,0,0,0.4)]">
    {isPlaybackLocked ? (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-black/70 to-black px-6 text-center">
        <div className="rounded-full border border-[#D90429]/30 bg-[#D90429]/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.26em] text-[#FFB3C1]">
          Premium Locked
        </div>
        <h2 className="mt-5 text-2xl md:text-4xl font-black uppercase tracking-[0.16em] text-white">
          Subscribe To Watch
        </h2>
        <p className="mt-4 max-w-xl text-sm md:text-base leading-7 text-white/70">
          This title is part of the premium catalog. Choose a Ugandan Mobile Money plan to unlock playback.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={subscribeHref}
            className="rounded-xl bg-[#D90429] px-6 py-3 text-sm font-black uppercase tracking-[0.24em] text-white"
          >
            Unlock Now
          </Link>
            <Link
              href={subscribeHref}
              className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-black uppercase tracking-[0.24em] text-white"
            >
              View Plans
          </Link>
        </div>
      </div>
    ) : (
      hasPlaybackSource ? (
        <PersistentPlaybackHost active className="h-full w-full" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/58 px-6 text-center">
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
        <button
          onClick={handleDownload}
          disabled={isPlaybackLocked || isDownloading || isSavedToDownloads}
          className="relative flex w-full max-w-[620px] items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-r from-[#24344A] via-[#1E2A3B] to-[#131B28] px-5 py-4 text-sm font-black tracking-[0.18em] text-white shadow-[0_18px_35px_rgba(0,0,0,0.28)] transition-colors duration-200 hover:from-[#2D4059] hover:to-[#182334] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-[#2B2F38] disabled:text-white/45"
        >
          <span className="text-center">
            {isPlaybackLocked ? 'Subscription Required' : isDownloading ? 'Working...' : isSavedToDownloads ? 'Saved to Downloads' : 'Download'}
          </span>
          <span className="pointer-events-none absolute right-5">
            <DownloadIcon />
          </span>
        </button>

        {actionMessage && (
          <div className="w-full max-w-[620px] rounded-2xl border border-[#7AA2D6]/20 bg-[#182334]/88 px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[#D9E7FF] shadow-[0_16px_28px_rgba(0,0,0,0.24)]">
            {actionMessage}
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={handleWatchlist}
            disabled={isSavingToList}
            className="rounded-xl border border-white/10 bg-[#131B28] px-4 py-2.5 text-sm font-bold text-gray-200 inline-flex items-center gap-2 transition-colors hover:border-[#7AA2D6] hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-gray-500"
          >
            <Bookmark size={16} />
            {isSavingToList ? 'Working...' : isSavedToWatchlist ? 'Remove from My List' : 'Add to My List'}
          </button>

          <Link
            href="/watchlist"
            className="border border-gray-600 hover:border-white text-gray-300 px-4 py-2 rounded-lg text-sm font-bold bg-white/5"
          >
            My List
          </Link>

          <button
            onClick={handleLike}
            disabled={isLiking}
            className="rounded-xl border border-white/10 bg-[#131B28] px-4 py-2.5 text-sm font-bold text-gray-200 inline-flex items-center gap-2 transition-colors hover:border-[#7AA2D6] hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-gray-500"
          >
            <Heart size={16} className={isLiked ? 'fill-[#D90429] text-[#D90429]' : ''} />
            {isLiking ? 'Working...' : isLiked ? 'Unlike' : 'Like'}
          </button>

          <button
            onClick={handleCast}
            className="rounded-xl border border-white/10 bg-[#131B28] px-4 py-2.5 text-sm font-bold text-gray-200 inline-flex items-center gap-2 transition-colors hover:border-[#7AA2D6] hover:text-white"
          >
            <Cast size={16} />
            Cast
          </button>

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
    <h1 className="text-2xl md:text-4xl font-bold mb-4">
      {playbackTitle}
    </h1>

    <p className="text-gray-300 mb-6">
      {playbackDescription}
    </p>

    {isPlaybackLocked && (
      <div className="mb-6 rounded-2xl border border-[#D90429]/25 bg-[#D90429]/10 p-4 text-sm text-[#FFD7DF]">
        Premium access is required to play this movie or series. Your account can still browse the catalog, but playback unlocks only after a confirmed subscription payment.
      </div>
    )}

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

        <div className="flex gap-2.5 overflow-x-auto pb-2 md:grid md:grid-cols-3 xl:grid-cols-4 md:overflow-visible [scrollbar-color:#D90429_#1F2833]">
          {selectedSeasonEpisodes.map((episode) => (
            <button
              key={`${movie.id}-season-${selectedSeason?.seasonNumber}-episode-${episode.episodeNumber}`}
              onClick={() => {
                if (!selectedSeason) {
                  return;
                }

                syncSeriesSelection(selectedSeason.seasonNumber, episode.episodeNumber);
              }}
              className={`min-w-[118px] md:min-w-0 text-left flex items-start gap-2 rounded-xl border p-2.5 transition-colors ${
                selectedEpisode?.episodeNumber === episode.episodeNumber
                  ? 'border-[#D90429] bg-[#D90429]/12 shadow-[0_0_0_1px_rgba(217,4,41,0.3)]'
                  : 'border-white/10 bg-[#1F2833]/20 hover:border-white/30'
              }`}
            >
              <div className="w-11 h-11 rounded-lg bg-[#1F2833] overflow-hidden flex-shrink-0">
                {(episode.thumbnail || episode.poster || movie.poster) ? (
                  <img
                    src={episode.thumbnail || episode.poster || movie.poster}
                    alt={episode.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#D90429] text-lg font-black">
                    {getEpisodeLabel(episode.episodeNumber)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex flex-1 items-center">
                <p className="text-[11px] md:text-xs font-black text-[#D90429] leading-none">
                  {getEpisodeLabel(episode.episodeNumber)}
                </p>
                {getEpisodeDisplayTitle(episode.episodeNumber, episode.title) !== getEpisodeLabel(episode.episodeNumber) && (
                  <p className="ml-2 text-[11px] md:text-sm font-bold text-white line-clamp-2 leading-tight">
                    {getEpisodeDisplayTitle(episode.episodeNumber, episode.title)}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>
    )}
  </div>

  <section className="px-4 md:px-0 max-w-6xl mx-auto mt-2">
    <div className="border-t border-white/10 pt-8">
      <h2 className="text-xl md:text-2xl font-bold mb-5">Related Movies</h2>

      {!relatedMovies.length ? (
        <div className="bg-[#1F2833]/20 border border-white/10 rounded-lg p-5 text-gray-400 text-sm">
          No related movies available right now.
        </div>
      ) : (
        <div className="flex gap-2 md:gap-3 overflow-x-auto pb-3 snap-x snap-mandatory [scrollbar-color:#D90429_#1F2833]">
          {relatedMovies.map((relatedMovie) => (
            <Link
              key={relatedMovie.id}
              href={`/movie/${relatedMovie.id}`}
              className="group min-w-[104px] max-w-[104px] md:min-w-[180px] md:max-w-[180px] bg-[#1F2833]/20 border border-white/5 hover:border-[#D90429]/50 rounded-lg overflow-hidden transition-colors snap-start flex-shrink-0"
            >
              <div className="relative aspect-[3/4] md:aspect-[16/9] bg-[#1F2833] overflow-hidden">
                {isSeriesMovie(relatedMovie) && (
                  <div className="absolute top-2 right-2 bg-white/95 text-[#0B0C10] text-[7px] md:text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full z-10 shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
                    EPS
                  </div>
                )}
                <img
                  src={relatedMovie.poster}
                  alt={relatedMovie.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="p-2.5">
                <h3 className="text-[10px] md:text-sm text-white font-bold line-clamp-2 group-hover:text-[#D90429] transition-colors">
                  {relatedMovie.title}
                </h3>
                <p className="text-[#888888] text-[9px] md:text-[10px] mt-1.5 uppercase tracking-wider">
                  {(relatedMovie.genres && relatedMovie.genres[0]) || relatedMovie.country || 'Recommended'}
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
