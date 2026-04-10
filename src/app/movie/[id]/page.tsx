'use client';
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { db } from '@/lib/firebase';
import { deleteDoc, doc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getUserDownloadByMovieId, saveMovieDownload } from '@/lib/downloads';
import type { FirebaseError } from 'firebase/app';
import { normalizeMovie, type Movie } from '@/types/movie';
import { getUserWatchlistMovie, removeMovieFromWatchlist, saveMovieToWatchlist } from '@/lib/watchlist';
import { getUserLikedMovie, removeMovieLike, saveMovieLike } from '@/lib/likes';
import { dedupeSeriesMovies, getMovieListingKey, isSeriesMovie, mergeSeriesMovies } from '@/lib/moviePresentation';
import { Bookmark, Cast, Heart, Share2 } from 'lucide-react';
import { fetchPublicMovies } from '@/lib/publicMovies';

export default function MoviePlayerPage({ params }: { params: { id: string } }) {
const [movie, setMovie] = useState<Movie | null>(null);
const [loading, setLoading] = useState(true);
const [isVideoError, setIsVideoError] = useState(false);
const [isDownloading, setIsDownloading] = useState(false);
const [isSavingToList, setIsSavingToList] = useState(false);
const [isLiking, setIsLiking] = useState(false);
const [isSavedToDownloads, setIsSavedToDownloads] = useState(false);
const [isSavedToWatchlist, setIsSavedToWatchlist] = useState(false);
const [isLiked, setIsLiked] = useState(false);
const [actionMessage, setActionMessage] = useState('');
const [movieSource, setMovieSource] = useState<'movies' | 'downloads'>('movies');
const [relatedMovies, setRelatedMovies] = useState<Movie[]>([]);
const [selectedSeasonIndex, setSelectedSeasonIndex] = useState(0);
const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState(0);
const videoRef = useRef<HTMLVideoElement | null>(null);
const router = useRouter();

useEffect(() => {
const fetchMovie = async () => {
try {
const allMovies = await fetchPublicMovies();

const loadMergedSeriesMovie = async (initialMovie: Movie) => {
  if (!isSeriesMovie(initialMovie)) {
    return initialMovie;
  }

  const relatedSeriesEntries = allMovies
    .filter((candidate) => getMovieListingKey(candidate) === getMovieListingKey(initialMovie));

  const mergedSeriesMovie = mergeSeriesMovies(relatedSeriesEntries);

  if (!mergedSeriesMovie) {
    return initialMovie;
  }

  return {
    ...mergedSeriesMovie,
    id: initialMovie.id,
    movieId: initialMovie.movieId || initialMovie.id,
  };
};

const matchedMovie = allMovies.find((candidate) => candidate.id === params.id);

if (matchedMovie) {
setMovie(await loadMergedSeriesMovie(matchedMovie));
setMovieSource('movies');
return;
}

const downloadRecord = await getUserDownloadByMovieId(params.id);

if (downloadRecord) {
const normalizedDownloadMovie = normalizeMovie(downloadRecord.movieId, downloadRecord);
setMovie(await loadMergedSeriesMovie(normalizedDownloadMovie));
setMovieSource('downloads');
setIsSavedToDownloads(true);
}
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
  if (movie?.contentType === 'series' && movie.seasons?.length) {
    setSelectedSeasonIndex(0);
    setSelectedEpisodeIndex(0);
    return;
  }

  setSelectedSeasonIndex(0);
  setSelectedEpisodeIndex(0);
}, [movie]);

const selectedSeason = movie?.contentType === 'series' ? movie.seasons?.[selectedSeasonIndex] : undefined;
const selectedEpisode = selectedSeason?.episodes?.[selectedEpisodeIndex];
const playbackType =
  selectedEpisode?.playbackType ||
  movie?.playbackType ||
  (selectedEpisode?.masterPlaylistUrl ? 'hls' : undefined) ||
  (movie?.masterPlaylistUrl ? 'hls' : undefined) ||
  (selectedEpisode?.video_url || selectedEpisode?.sourceUrl || movie?.video_url || movie?.sourceUrl ? 'mp4' : undefined) ||
  'mp4';
const playbackVideoUrl =
  playbackType === 'hls'
    ? (
        selectedEpisode?.masterPlaylistUrl ||
        movie?.masterPlaylistUrl ||
        selectedEpisode?.video_url ||
        selectedEpisode?.sourceUrl ||
        movie?.video_url ||
        movie?.sourceUrl ||
        ''
      )
    : (
        selectedEpisode?.video_url ||
        selectedEpisode?.sourceUrl ||
        movie?.video_url ||
        movie?.sourceUrl ||
        selectedEpisode?.masterPlaylistUrl ||
        movie?.masterPlaylistUrl ||
        ''
      );
const playbackFallbackUrl =
  selectedEpisode?.video_url ||
  selectedEpisode?.sourceUrl ||
  movie?.video_url ||
  movie?.sourceUrl ||
  '';
const playbackPoster = selectedEpisode?.poster || selectedEpisode?.thumbnail || movie?.poster || '';
const playbackDescription = selectedEpisode?.description || movie?.description || '';
const isPlaybackLocked = Boolean(selectedEpisode?.isLocked || movie?.isLocked);
const getEpisodeLabel = (episodeNumber: number) => `EP ${episodeNumber}`;
const getEpisodeDisplayTitle = (episodeNumber: number, episodeTitle: string) => {
  const normalizedTitle = episodeTitle.trim();

  if (/^episode\s+\d+$/i.test(normalizedTitle) || /^ep\s*\d+$/i.test(normalizedTitle)) {
    return getEpisodeLabel(episodeNumber);
  }

  return normalizedTitle;
};
const playbackTitle = selectedEpisode
  ? `${movie?.title || movie?.name} - ${selectedEpisode.title}`
  : (movie?.title || movie?.name || '');

useEffect(() => {
  const videoElement = videoRef.current;

  if (!videoElement) {
    return;
  }

  setIsVideoError(false);

  if (!playbackVideoUrl) {
    videoElement.removeAttribute('src');
    videoElement.load();
    return;
  }

  if (playbackType === 'hls' && playbackVideoUrl.endsWith('.m3u8')) {
    if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = playbackVideoUrl;
      videoElement.load();
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[movie-page] hls error', {
          playbackVideoUrl,
          type: data.type,
          details: data.details,
          fatal: data.fatal,
        });

        if (data.fatal) {
          hls.destroy();

          if (playbackFallbackUrl && playbackFallbackUrl !== playbackVideoUrl) {
            videoElement.src = playbackFallbackUrl;
            videoElement.load();
            return;
          }

          setIsVideoError(true);
        }
      });
      hls.loadSource(playbackVideoUrl);
      hls.attachMedia(videoElement);
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        console.log('[movie-page] hls manifest parsed', {
          playbackVideoUrl,
          levels: data.levels?.length || 0,
        });
      });

      return () => {
        hls.destroy();
      };
    }

    if (playbackFallbackUrl && playbackFallbackUrl !== playbackVideoUrl) {
      videoElement.src = playbackFallbackUrl;
      videoElement.load();
      return;
    }
  }

  videoElement.src = playbackVideoUrl;
  videoElement.load();
}, [playbackType, playbackVideoUrl, playbackFallbackUrl]);

useEffect(() => {
  if (!playbackVideoUrl) {
    console.error('[movie-page] no playback URL found', {
      movieId: movie?.id,
      movieMasterPlaylistUrl: movie?.masterPlaylistUrl,
      movieVideoUrl: movie?.video_url,
      movieSourceUrl: movie?.sourceUrl,
      episodeMasterPlaylistUrl: selectedEpisode?.masterPlaylistUrl,
      episodeVideoUrl: selectedEpisode?.video_url,
      episodeSourceUrl: selectedEpisode?.sourceUrl,
    });
    return;
  }

  console.log('[movie-page] resolved playback source', {
    movieId: movie?.id,
    playbackType,
    playbackVideoUrl,
  });
}, [
  movie?.id,
  movie?.masterPlaylistUrl,
  movie?.video_url,
  movie?.sourceUrl,
  selectedEpisode?.masterPlaylistUrl,
  selectedEpisode?.video_url,
  selectedEpisode?.sourceUrl,
  playbackType,
  playbackVideoUrl,
]);

const handleDelete = async () => {
if (!movie || movieSource !== 'movies') {
return;
}

if (confirm("Are you absolutely sure you want to permanently delete this payload from the database?")) {
try {
await deleteDoc(doc(db, 'movies', movie.id));
router.push('/');
} catch (err) {
alert("Failed to delete record.");
}
}
};

const handleVideoError = () => {
const videoElement = videoRef.current;

console.error(`HTML5 Player crashed attempting to load: ${playbackVideoUrl}`);

if (
  videoElement &&
  playbackFallbackUrl &&
  playbackFallbackUrl !== playbackVideoUrl &&
  videoElement.currentSrc !== playbackFallbackUrl
) {
  videoElement.src = playbackFallbackUrl;
  videoElement.load();
  return;
}

setIsVideoError(true);
};

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
    alert("No in-app download data found for this movie.");
    return;
  }

  setIsDownloading(true);

  try {
    const result = await saveMovieDownload({
      movieId: movie.movieId || movie.id,
      title: selectedEpisode ? `${movie.title || movie.name || 'Untitled movie'} - ${selectedEpisode.title}` : (movie.title || movie.name || 'Untitled movie'),
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
    alert("Failed to save this movie to downloads.");
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
    alert('Failed to save this movie to My List.');
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
      setActionMessage('Movie removed from liked data.');
      return;
    }

    await saveMovieLike({
      movieId: movie.movieId || movie.id,
      title: movie.title || movie.name || 'Untitled movie',
      poster: movie.poster || '',
    });

    setIsLiked(true);
    setActionMessage('Movie liked.');
  } catch (err) {
    const firebaseError = err as FirebaseError;
    console.error('[movie-page] like save failed', {
      movieId: movie.movieId || movie.id,
      title: movie.title || movie.name || 'Untitled movie',
      code: firebaseError?.code || 'unknown',
      message: firebaseError?.message || String(err),
      fullError: err,
    });
    alert('Failed to like this movie.');
  } finally {
    setIsLiking(false);
  }
};

const handleShare = async () => {
  if (!movie || typeof window === 'undefined') {
    return;
  }

  const shareUrl = `${window.location.origin}/movie/${movie.movieId || movie.id}`;
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
  const videoElement = videoRef.current;

  if (!videoElement) {
    setActionMessage('No active player available for casting.');
    return;
  }

  const remotePlayback = (videoElement as HTMLVideoElement & {
    remote?: { prompt?: () => Promise<void>; watchAvailability?: (callback: (available: boolean) => void) => Promise<number> };
    webkitShowPlaybackTargetPicker?: () => void;
    webkitCurrentPlaybackTargetIsWireless?: boolean;
  }).remote;

  try {
    if (!playbackVideoUrl) {
      setActionMessage('This movie is not ready for casting.');
      return;
    }

    if (remotePlayback && typeof remotePlayback.prompt === 'function') {
      if (typeof remotePlayback.watchAvailability === 'function') {
        try {
          const isAvailable = await new Promise<boolean>((resolve) => {
            let settled = false;

            remotePlayback.watchAvailability!((available: boolean) => {
              if (!settled) {
                settled = true;
                resolve(available);
              }
            }).catch(() => {
              if (!settled) {
                settled = true;
                resolve(true);
              }
            });

            setTimeout(() => {
              if (!settled) {
                settled = true;
                resolve(true);
              }
            }, 1200);
          });

          if (!isAvailable) {
            setActionMessage('No cast devices were found for this browser right now. Check that a compatible device is on the same network.');
            return;
          }
        } catch (availabilityError) {
          console.error('Cast availability check failed:', availabilityError);
        }
      }

      await remotePlayback.prompt();
      setActionMessage('Casting device picker opened.');
      return;
    }

    if (typeof (videoElement as HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void; webkitCurrentPlaybackTargetIsWireless?: boolean }).webkitShowPlaybackTargetPicker === 'function') {
      (videoElement as HTMLVideoElement & { webkitShowPlaybackTargetPicker: () => void }).webkitShowPlaybackTargetPicker();
      const isWirelessTarget = Boolean((videoElement as HTMLVideoElement & { webkitCurrentPlaybackTargetIsWireless?: boolean }).webkitCurrentPlaybackTargetIsWireless);
      setActionMessage(isWirelessTarget ? 'AirPlay target selected.' : 'AirPlay device picker opened.');
      return;
    }

    setActionMessage('Casting is not available in this browser. Try Chrome with a Cast device or Safari with AirPlay.');
  } catch (err) {
    console.error('Cast failed:', err);
    setActionMessage('A casting target could not be started. Make sure a Cast or AirPlay device is available on the same network.');
  }
};

if (loading) return ( <main className="min-h-screen bg-[#0B0C10] flex items-center justify-center"> <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin"></div> </main>
);

if (!movie) return ( <main className="min-h-screen bg-[#0B0C10] text-[#D90429] flex items-center justify-center font-bold">
404 PAYLOAD NOT FOUND </main>
);

return ( <main className="min-h-screen bg-[#0B0C10] text-white font-sans pb-24 md:pb-8">

  {/* Mobile Header */}
  <header className="fixed top-4 left-4 right-4 z-50 md:hidden">
    <div className="flex items-center justify-between gap-3">
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

  {/* Desktop Header */}
  <header className="fixed top-0 left-0 right-0 z-50 px-12 py-6 hidden md:flex items-center justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
     <div className="w-48 h-14 flex items-center justify-start overflow-hidden rounded-full pointer-events-auto">
      <img
        src="/logow.png"
        alt="UG Movies 247"
        className="w-auto h-[110px] object-contain flex-shrink-0"
      />
    </div>
    <div className="flex gap-8 text-[11px] font-semibold text-gray-300 pointer-events-auto">
      <Link href="/" className="text-white">Home</Link>
      <Link href="/vjs" className="hover:text-white transition-colors cursor-pointer">VJs</Link>
      <Link href="/genres" className="hover:text-white transition-colors cursor-pointer">Genres</Link>
      <Link href="/search" className="hover:text-white transition-colors cursor-pointer">Search</Link>
      <Link href="/profile" className="hover:text-white transition-colors cursor-pointer">Profile</Link>
    </div>
    <div className="flex items-center gap-6 text-white pointer-events-auto">
       <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
         <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path>
         <line x1="2" y1="20" x2="2.01" y2="20"></line>
       </svg>
       <Link href="/watchlist" className="text-white hover:text-[#D90429] transition-colors" aria-label="My List">
         <Bookmark size={20} />
       </Link>
       <div className="relative flex items-center">
         <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
         </svg>
         <span className="absolute top-0 right-0 w-2 h-2 bg-[#D90429] rounded-full"></span>
       </div>
    </div>
  </header>

  {/* Video Player */}
  <div className="relative w-full h-[40vh] md:h-[70vh] bg-black mt-20 md:mt-0">
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
            href="/subscribe"
            className="rounded-xl bg-[#D90429] px-6 py-3 text-sm font-black uppercase tracking-[0.24em] text-white"
          >
            Unlock Now
          </Link>
          <Link
            href="/profile/billing"
            className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-black uppercase tracking-[0.24em] text-white"
          >
            View Plans
          </Link>
        </div>
      </div>
    ) : isVideoError ? (
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-red-500 font-bold">VIDEO FAILED TO LOAD</p>
      </div>
    ) : (
      <video
        ref={videoRef}
        key={selectedEpisode ? `${selectedSeasonIndex}-${selectedEpisodeIndex}` : movie.id}
        poster={playbackPoster}
        controls
        preload="metadata"
        playsInline
        crossOrigin="anonymous"
        className="w-full h-full object-contain"
        onError={handleVideoError}
      />
    )}
  </div>

  <section className="px-4 md:px-8 max-w-4xl mx-auto mt-4 md:-mt-4">
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={handleDownload}
          disabled={isPlaybackLocked || isDownloading || isSavedToDownloads}
          className="min-w-[220px] sm:min-w-[260px] bg-white/5 hover:bg-[#D90429] active:bg-[#a50320] disabled:bg-[#2B2F38] disabled:border-white/5 disabled:cursor-not-allowed text-white px-6 py-3.5 rounded-xl text-sm font-black tracking-wide border border-white/10 hover:border-[#D90429] transition-colors duration-200"
        >
          {isPlaybackLocked ? 'Subscription Required' : isDownloading ? 'Working...' : isSavedToDownloads ? 'Saved to Downloads' : 'Download'}
        </button>

        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={handleWatchlist}
            disabled={isSavingToList}
            className="border border-gray-600 hover:border-white disabled:border-[#6B1020] disabled:text-gray-400 disabled:cursor-not-allowed text-gray-300 px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 bg-white/5"
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
            className="border border-gray-600 hover:border-white disabled:border-[#6B1020] disabled:text-gray-400 disabled:cursor-not-allowed text-gray-300 px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 bg-white/5"
          >
            <Heart size={16} className={isLiked ? 'fill-[#D90429] text-[#D90429]' : ''} />
            {isLiking ? 'Working...' : isLiked ? 'Unlike' : 'Like'}
          </button>

          <button
            onClick={handleCast}
            className="border border-gray-600 hover:border-white text-gray-300 px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 bg-white/5"
          >
            <Cast size={16} />
            Cast
          </button>

          <button
            onClick={handleShare}
            className="border border-gray-600 hover:border-white text-gray-300 px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 bg-white/5"
          >
            <Share2 size={16} />
            Share
          </button>

          {movieSource === 'movies' && (
            <button
              onClick={handleDelete}
              className="border border-gray-600 hover:border-[#D90429] text-gray-300 px-4 py-2 rounded-lg text-sm font-bold bg-white/5"
            >
              Delete
            </button>
          )}
        </div>
      </div>
  </section>

  {/* Info */}
  <div className="p-4 md:p-8 max-w-4xl mx-auto">
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

    {movie.contentType === 'series' && movie.seasons && movie.seasons.length > 0 && (
      <section className="mb-6 rounded-2xl border border-white/10 bg-[#11141C]/80 p-4 md:p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
        <div className="mb-3">
          <h2 className="text-sm md:text-base font-black uppercase tracking-[0.24em] text-white">
            Seasons
          </h2>
        </div>

        <div className="flex flex-nowrap gap-2 overflow-x-auto pb-3 [scrollbar-color:#D90429_#1F2833]">
          {movie.seasons.map((season, seasonIndex) => (
            <button
              key={`${movie.id}-season-${season.seasonNumber}`}
              onClick={() => {
                setSelectedSeasonIndex(seasonIndex);
                setSelectedEpisodeIndex(0);
              }}
              className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap border transition-colors ${
                selectedSeasonIndex === seasonIndex
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
          {(selectedSeason?.episodes || []).map((episode, episodeIndex) => (
            <button
              key={`${movie.id}-season-${selectedSeason?.seasonNumber}-episode-${episode.episodeNumber}`}
              onClick={() => setSelectedEpisodeIndex(episodeIndex)}
              className={`min-w-[118px] md:min-w-0 text-left flex items-start gap-2 rounded-xl border p-2.5 transition-colors ${
                selectedEpisodeIndex === episodeIndex
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

    {actionMessage && (
      <p className="text-sm text-[#888888] mt-4">{actionMessage}</p>
    )}
  </div>

  <section className="px-4 md:px-8 max-w-6xl mx-auto mt-2">
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

  <div className="fixed bottom-0 left-0 right-0 h-16 bg-[#0B0C10] border-t border-white/5 flex items-center justify-around px-2 z-50 md:hidden pb-safe">
    <Link href="/" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
      <span className="text-[10px] font-bold">Home</span>
    </Link>
    <Link href="/vjs" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
      <span className="text-[10px] font-bold">VJs</span>
    </Link>
    <Link href="/genres" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"></path></svg>
      <span className="text-[10px] font-bold">Genres</span>
    </Link>
    <Link href="/search" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
      <span className="text-[10px] font-bold">Search</span>
    </Link>
    <Link href="/profile" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
      <span className="text-[10px] font-bold">Profile</span>
    </Link>
  </div>

</main>

);
}
