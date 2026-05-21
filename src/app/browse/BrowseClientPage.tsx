'use client';
import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import {
  buildHomeCollections,
  DEFAULT_HOME_PAGE_CATEGORIES,
  type HomePageCategoryRecord,
} from '@/lib/homeRows';
import {
  fetchHomePageCategories,
  readCachedHomePageCategories,
  warmHomePageArtwork,
} from '@/lib/homePageClient';
import { Bell, Cast, ChevronLeft, ChevronRight, Clapperboard, Download, Lock } from 'lucide-react';
import {
  fetchPublicMovies,
  hasAuthoritativePublicMovieCatalog,
  hasPartialPublicMovieCatalog,
  primePublicMovieCatalog,
  readCachedPublicMovies,
} from '@/lib/publicMovies';
import { usePublicMovieCatalogUpdates } from '@/hooks/usePublicMovieCatalogUpdates';
import {
  fetchPlaybackProgressRecords,
  readCachedContinueWatching,
} from '@/lib/playbackProgress';
import {
  fetchAuthStatus,
  readCachedAuthStatus,
  type ClientAuthStatus,
} from '@/lib/auth/status-client';
import type { CachedPlaybackProgressRecord } from '@/types/playbackProgress';
import { APP_ENV_LABEL, FIREBASE_PROJECT_LABEL, IS_PRODUCTION_APP } from '@/lib/appEnv';
import { countUnreadLatestUploads } from '@/lib/latestUploadNotifications';
import { startCasting } from '@/lib/cast';
import {
  getArtworkImageProps,
  getOptimizedArtworkUrl,
  hasLoadedArtworkUrl,
  markArtworkUrlLoaded,
  type ArtworkVariant,
} from '@/lib/artwork';
import { isAppInReview } from '@/lib/appReview';
import { getReviewTrailerUrl } from '@/lib/reviewTrailers';
import TrailerEmbedPlayer from '@/components/TrailerEmbedPlayer';

type SessionUser = {
  role: 'user' | 'admin';
  name: string;
};

type ContinueWatchingMovie = Movie & {
  continueProgressPercent?: number;
  continueWatchHref?: string;
  continueLastPosition?: number;
  continueTotalDuration?: number;
};

const PENDING_MOVIE_NAVIGATION_KEY = 'ugmovies247.pending-movie-navigation.v1';

function rememberPendingMovieNavigation(movie: Movie) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(
      PENDING_MOVIE_NAVIGATION_KEY,
      JSON.stringify({
        movie: {
          id: movie.id,
          movieId: movie.movieId || movie.id,
          title: movie.title || movie.name || '',
          name: movie.name || '',
          poster: movie.poster || '',
          backdrop: movie.overriddenBackdrop || movie.overriddenPlayerBackdrop || movie.playerBackdrop || '',
          contentType: movie.contentType || 'movie',
          vj: movie.vj || '',
          genres: movie.genres || [],
        },
        cachedAt: Date.now(),
      })
    );
  } catch {
    // A failed transition hint should never block navigation.
  }
}

type BrowseClientPageProps = {
  initialMovies?: Movie[];
  initialHomePageCategories?: HomePageCategoryRecord[];
  initialCatalogCachedAt?: string;
  initialCatalogIsPartial?: boolean;
};

const DESKTOP_CATEGORY_PILLS = [
  {
    label: 'ALL',
    value: 'ALL',
    activeClass: 'bg-white text-[#0B0C10]',
    idleClass: 'bg-[#3B3118] text-[#F2D7A1] hover:bg-[#4A3B1C]',
  },
  {
    label: 'ACTION',
    value: 'Action',
    activeClass: 'bg-[#D90429] text-white',
    idleClass: 'bg-[#3A0D14] text-red-200 hover:bg-[#4A121C]',
  },
  {
    label: 'SCI-FI',
    value: 'Sci-Fi',
    activeClass: 'bg-cyan-400 text-[#081217]',
    idleClass: 'bg-cyan-900/40 text-cyan-200 hover:bg-cyan-800/50',
  },
  {
    label: 'DRAMA',
    value: 'Drama',
    activeClass: 'bg-violet-500 text-white',
    idleClass: 'bg-violet-900/40 text-violet-200 hover:bg-violet-800/50',
  },
  {
    label: 'ROMANCE',
    value: 'Romance',
    activeClass: 'bg-pink-500 text-white',
    idleClass: 'bg-pink-900/40 text-pink-200 hover:bg-pink-800/50',
  },
  {
    label: 'ADVENTURE',
    value: 'Adventure',
    activeClass: 'bg-emerald-400 text-[#09130E]',
    idleClass: 'bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/50',
  },
] as const;

const HOME_ROW_RENDER_LIMIT_DESKTOP = 30;
const HOME_ROW_RENDER_LIMIT_MOBILE = 18;
const CONTINUE_WATCHING_RENDER_LIMIT = 20;

function getMovieVjLabel(movie: Movie) {
  return movie.vj && movie.vj !== 'Unknown' ? `VJ ${movie.vj}` : 'VJ HD';
}

function formatRuntimeLabel(movie: Movie | null) {
  if (!movie || typeof movie.durationSeconds !== 'number' || movie.durationSeconds <= 0) {
    return null;
  }

  const totalMinutes = Math.floor(movie.durationSeconds / 60);

  if (totalMinutes <= 0) {
    return null;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes}m`;
  }

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function getSeriesBackdropCardImage(movie: Movie) {
  const firstSeason = movie.seasons?.[0];
  const firstEpisode = firstSeason?.episodes?.[0];

  return (
    movie.overriddenBackdrop ||
    firstEpisode?.overriddenBackdrop ||
    movie.poster ||
    firstSeason?.poster ||
    firstEpisode?.thumbnail ||
    firstEpisode?.poster ||
    ''
  );
}

function buildPriorityArtworkMovies(options: {
  heroMovie: Movie | null;
  homeRows: Array<{
    movies: Movie[];
    usesSeriesBackdropCards: boolean;
  }>;
  fallbackMovies: Movie[];
}) {
  const prioritizedMovies: Movie[] = [];

  if (options.heroMovie) {
    prioritizedMovies.push(options.heroMovie);
  }

  options.homeRows.slice(0, 3).forEach((row) => {
    prioritizedMovies.push(
      ...row.movies.slice(0, row.usesSeriesBackdropCards ? 3 : 6)
    );
  });

  if (!prioritizedMovies.length) {
    prioritizedMovies.push(...options.fallbackMovies.slice(0, 12));
  }

  return dedupeSeriesMovies(prioritizedMovies);
}

const HomeCardImage = memo(function HomeCardImage({
  src,
  alt,
  imageClassName,
  logoClassName = 'h-16 w-16 scale-[1.9] object-contain opacity-95 drop-shadow-[0_10px_24px_rgba(217,4,41,0.18)] md:h-20 md:w-20',
  priority = false,
  variant = 'card',
}: {
  src?: string;
  alt: string;
  imageClassName: string;
  logoClassName?: string;
  priority?: boolean;
  variant?: ArtworkVariant;
}) {
  const normalizedSrc = getOptimizedArtworkUrl(src, variant);
  const imageProps = getArtworkImageProps(src, variant);
  const [isLoaded, setIsLoaded] = useState(() => hasLoadedArtworkUrl(normalizedSrc));
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (hasLoadedArtworkUrl(normalizedSrc)) {
      setIsLoaded(true);
      setHasError(false);
      return;
    }

    setIsLoaded(false);
    setHasError(false);

    if (!normalizedSrc || typeof window === 'undefined') {
      return;
    }

    let active = true;
    const image = new window.Image();
    image.decoding = 'async';
    image.src = normalizedSrc;

    if (image.complete && image.naturalWidth > 0) {
      markArtworkUrlLoaded(normalizedSrc);

      if (active) {
        setIsLoaded(true);
      }

      return () => {
        active = false;
      };
    }

    image.onload = () => {
      markArtworkUrlLoaded(normalizedSrc);

      if (active) {
        setHasError(false);
        setIsLoaded(true);
      }
    };

    image.onerror = () => {
      if (active) {
        setHasError(true);
        setIsLoaded(false);
      }
    };

    return () => {
      active = false;
    };
  }, [normalizedSrc]);

  const showPlaceholder = !normalizedSrc || !isLoaded || hasError;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_center,rgba(34,41,54,0.98)_0%,rgba(20,24,34,0.98)_56%,rgba(11,12,16,1)_100%)]">
      {showPlaceholder && (
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="/logow.png"
            alt=""
            aria-hidden="true"
            className={logoClassName}
          />
        </div>
      )}

      {normalizedSrc ? (
        <img
          src={imageProps.src}
          srcSet={imageProps.srcSet}
          sizes={imageProps.sizes}
          alt={alt}
          className={`${imageClassName} ${isLoaded && !hasError ? 'opacity-100' : 'opacity-0'}`}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onLoad={() => {
            markArtworkUrlLoaded(normalizedSrc);
            setHasError(false);
            setIsLoaded(true);
          }}
          onError={() => {
            setHasError(true);
            setIsLoaded(false);
          }}
        />
      ) : null}
    </div>
  );
});

export default function BrowseClientPage({
  initialMovies = [],
  initialHomePageCategories = DEFAULT_HOME_PAGE_CATEGORIES,
  initialCatalogCachedAt = '',
  initialCatalogIsPartial = false,
}: BrowseClientPageProps) {
  const normalizedInitialMovies = useMemo(() => dedupeSeriesMovies(initialMovies), [initialMovies]);
  const [movies, setMovies] = useState<Movie[]>(() => normalizedInitialMovies);
  const [homePageCategories, setHomePageCategories] = useState<HomePageCategoryRecord[]>(
    initialHomePageCategories.length ? initialHomePageCategories : DEFAULT_HOME_PAGE_CATEGORIES
  );
  const [, setLoading] = useState(() => normalizedInitialMovies.length === 0);
  const [hasResolvedCatalog, setHasResolvedCatalog] = useState(
    () => normalizedInitialMovies.length > 0
  );
  const [isUsingPartialBootstrap, setIsUsingPartialBootstrap] = useState(
    () => initialCatalogIsPartial && normalizedInitialMovies.length > 0
  );
  const [heroIndex, setHeroIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [showHeroDetails, setShowHeroDetails] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [headerActionMessage, setHeaderActionMessage] = useState('');
  const [activeTrailer, setActiveTrailer] = useState<{ url: string; title: string } | null>(null);
  const [continueWatchingRecords, setContinueWatchingRecords] = useState<CachedPlaybackProgressRecord[]>(
    () => readCachedContinueWatching()
  );
  const [isAndroidMobile, setIsAndroidMobile] = useState(false);
  const homeCastVideoRef = useRef<HTMLVideoElement | null>(null);
  const homeLoadRequestRef = useRef(0);

  usePublicMovieCatalogUpdates((catalog) => {
    const nextMovies = dedupeSeriesMovies(catalog);

    if (!nextMovies.length && movies.length > 0) {
      return;
    }

    setMovies(nextMovies);
    setHasResolvedCatalog(true);
    setIsUsingPartialBootstrap(false);
  });

  useEffect(() => {
    let mounted = true;
    const requestId = ++homeLoadRequestRef.current;
    const initialMoviesVisible = normalizedInitialMovies.length > 0;
    const cachedMovies = dedupeSeriesMovies(readCachedPublicMovies());
    const cachedCategories = readCachedHomePageCategories();
    const cachedStatus = readCachedAuthStatus();
    const hasCachedMovies = cachedMovies.length > 0;
    const hasAuthoritativeCachedMovies = hasAuthoritativePublicMovieCatalog();
    const hasPartialCachedMovies = hasPartialPublicMovieCatalog();
    const hasCachedCategories = cachedCategories.length > 0;

    if (initialMoviesVisible) {
      primePublicMovieCatalog(normalizedInitialMovies, {
        cachedAt: initialCatalogCachedAt,
        partial: initialCatalogIsPartial,
      });
      setLoading(false);
    }

    if (hasCachedMovies) {
      setMovies(cachedMovies);
      setHasResolvedCatalog(true);
      setIsUsingPartialBootstrap(hasPartialCachedMovies && !hasAuthoritativeCachedMovies);
      setLoading(false);
    }

    if (hasCachedCategories) {
      setHomePageCategories(cachedCategories);
    }

    if (cachedStatus?.authenticated) {
      setSessionUser({
        role: cachedStatus.user?.role === 'admin' ? 'admin' : 'user',
        name: cachedStatus.user?.name || 'User',
      });
      setContinueWatchingRecords(readCachedContinueWatching());
    } else if (cachedStatus) {
      setContinueWatchingRecords([]);
    }

    const bootstrapHomePage = async () => {
      try {
        const statusPromise: Promise<ClientAuthStatus> = cachedStatus
          ? Promise.resolve(cachedStatus)
          : fetchAuthStatus({ force: true }).catch(() => ({
              authenticated: false,
            } satisfies ClientAuthStatus));

        const moviesPromise = fetchPublicMovies({
          force: !hasAuthoritativeCachedMovies,
          refreshEntitlement: !hasAuthoritativeCachedMovies,
        }).then((movieData) => dedupeSeriesMovies(movieData));

        const categoriesPromise = fetchHomePageCategories({
          force: !hasCachedCategories,
        });

        const [status, movieData, categories] = await Promise.all([
          statusPromise,
          moviesPromise,
          categoriesPromise,
        ]);

        if (!mounted || requestId !== homeLoadRequestRef.current) {
          return;
        }

        setSessionUser(
          status.authenticated
            ? {
                role: status.user?.role === 'admin' ? 'admin' : 'user',
                name: status.user?.name || 'User',
              }
            : null
        );

        if (status.authenticated) {
          void fetchPlaybackProgressRecords()
            .then((records) => {
              if (mounted && requestId === homeLoadRequestRef.current) {
                setContinueWatchingRecords(records);
              }
            })
            .catch(() => {
              if (mounted && requestId === homeLoadRequestRef.current) {
                setContinueWatchingRecords(readCachedContinueWatching());
              }
            });
        } else {
          setContinueWatchingRecords([]);
        }

        if (movieData.length || !initialMoviesVisible) {
          setMovies(movieData);
        }
        const catalogStillPartial =
          hasPartialPublicMovieCatalog() && !hasAuthoritativePublicMovieCatalog();
        setHasResolvedCatalog(true);
        setIsUsingPartialBootstrap(catalogStillPartial);
        setHomePageCategories(
          categories.length ? categories : DEFAULT_HOME_PAGE_CATEGORIES
        );
      } catch (error) {
        console.error('[home] failed to bootstrap home page', error);
      } finally {
        if (mounted && requestId === homeLoadRequestRef.current) {
          setHasResolvedCatalog(true);
          setLoading(false);
        }
      }
    };

    void bootstrapHomePage();

    return () => {
      mounted = false;
    };
  }, [initialCatalogCachedAt, initialCatalogIsPartial, normalizedInitialMovies]);

  useEffect(() => {
    const updateAndroidMobileState = () => {
      if (typeof window === 'undefined') {
        return;
      }

      const userAgent = navigator.userAgent.toLowerCase();
      setIsAndroidMobile(/android/.test(userAgent) && window.innerWidth < 768);
    };

    updateAndroidMobileState();
    window.addEventListener('resize', updateAndroidMobileState);

    return () => {
      window.removeEventListener('resize', updateAndroidMobileState);
    };
  }, []);

  useEffect(() => {
    if (!sessionUser || typeof window === 'undefined') {
      return;
    }

    const refreshCachedProgress = () => {
      setContinueWatchingRecords(readCachedContinueWatching());
    };

    window.addEventListener('focus', refreshCachedProgress);
    window.addEventListener('pageshow', refreshCachedProgress);

    return () => {
      window.removeEventListener('focus', refreshCachedProgress);
      window.removeEventListener('pageshow', refreshCachedProgress);
    };
  }, [sessionUser]);

  const latestForHero = useMemo(() => movies.slice(0, 5), [movies]);

  useEffect(() => {
    if (latestForHero.length <= 1) return;
    const interval = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % latestForHero.length);
    }, 9000);
    return () => clearInterval(interval);
  }, [latestForHero.length]);

  useEffect(() => {
    if (!headerActionMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setHeaderActionMessage('');
    }, 3200);

    return () => window.clearTimeout(timeout);
  }, [headerActionMessage]);

  const { homeRows, unmatchedMovies } = useMemo(() => buildHomeCollections({
    movies,
    homePageCategories,
    activeCategory,
  }), [movies, homePageCategories, activeCategory]);
  const shouldSuppressEmptyRows = !hasResolvedCatalog || isUsingPartialBootstrap;
  const visibleHomeRows = useMemo(
    () =>
      shouldSuppressEmptyRows
        ? homeRows.filter((row) => row.movies.length > 0)
        : homeRows,
    [homeRows, shouldSuppressEmptyRows]
  );

  const continueWatchingMovies = useMemo<ContinueWatchingMovie[]>(() => {
    if (!continueWatchingRecords.length) {
      return [];
    }

    const moviesById = new Map<string, Movie>();

    movies.forEach((movie) => {
      moviesById.set(movie.id, movie);

      if (movie.movieId) {
        moviesById.set(movie.movieId, movie);
      }
    });

    return continueWatchingRecords
      .filter((record) => !record.isFinished)
      .map((record) => {
        const catalogMovie = moviesById.get(record.movieId);
        const fallbackMovie: Movie = {
          id: record.movieId,
          movieId: record.movieId,
          title: record.title || 'Untitled movie',
          poster: record.poster || '',
          genres: [],
          category: [],
        };
        const progressPercent =
          record.progressPercent ||
          (record.totalDuration > 0
            ? Math.round((record.lastPosition / record.totalDuration) * 100)
            : 0);

        return {
          ...(catalogMovie || fallbackMovie),
          movieId: record.movieId,
          title: catalogMovie?.title || record.title || 'Untitled movie',
          poster: catalogMovie?.poster || record.poster || '',
          continueProgressPercent: Math.min(Math.max(progressPercent, 0), 100),
          continueWatchHref: record.watchHref || `/movie/${catalogMovie?.id || record.movieId}`,
          continueLastPosition: record.lastPosition,
          continueTotalDuration: record.totalDuration,
        } satisfies ContinueWatchingMovie;
      });
  }, [continueWatchingRecords, movies]);

  // Hero Movie
  const heroMovie = useMemo(
    () => (latestForHero.length > 0 ? latestForHero[heroIndex] : movies[0] || null),
    [heroIndex, latestForHero, movies]
  );
  const heroPlaybackUrl =
    heroMovie?.video_url ||
    heroMovie?.sourceUrl ||
    '';
  const heroCastUrl =
    heroMovie?.masterPlaylistUrl ||
    heroPlaybackUrl;
  const heroPlaybackType =
    heroMovie?.masterPlaylistUrl && heroMovie?.playbackType === 'hls' ? 'hls' : 'mp4';
  const heroRuntimeLabel = formatRuntimeLabel(heroMovie);
  const heroPlayHref = heroMovie
    ? isAppInReview
      ? `/movie/${heroMovie.id}`
      : heroMovie.isLocked
        ? `/subscribe?returnTo=${encodeURIComponent(`/movie/${heroMovie.id}`)}`
        : `/movie/${heroMovie.id}?autoplay=1`
    : '/browse';
  const unreadLatestUploadCount = useMemo(() => countUnreadLatestUploads(movies), [movies]);
  const heroPosterImageProps = useMemo(
    () => getArtworkImageProps(heroMovie?.poster, 'hero'),
    [heroMovie?.poster]
  );
  const priorityArtworkMovies = useMemo(
    () =>
      buildPriorityArtworkMovies({
        heroMovie,
        homeRows,
        fallbackMovies: movies,
      }),
    [heroMovie, homeRows, movies]
  );

  useEffect(() => {
    if (priorityArtworkMovies.length) {
      warmHomePageArtwork(priorityArtworkMovies, isAndroidMobile ? 8 : 12);
    }
  }, [isAndroidMobile, priorityArtworkMovies]);

  const handleHeroTrailerClick = () => {
    if (!heroMovie) {
      setHeaderActionMessage('Pick a title first before opening a trailer.');
      return;
    }

    const trailerUrl = getReviewTrailerUrl(heroMovie);

    if (!trailerUrl) {
      setHeaderActionMessage('No trailer is available right now.');
      return;
    }

    setActiveTrailer({
      url: trailerUrl,
      title: `${heroMovie.title || heroMovie.name || 'UGMOVIES247'} trailer`,
    });
  };

  const handleHeaderCast = async () => {
    const videoElement = homeCastVideoRef.current;

    if (isAppInReview) {
      setHeaderActionMessage('Trailers play directly in the app.');
      return;
    }

    if (!heroMovie) {
      setHeaderActionMessage('Pick a movie first before casting.');
      return;
    }

    if (heroMovie.isLocked) {
      setHeaderActionMessage('Unlock this movie first before casting it.');
      return;
    }

    if (!videoElement || !heroCastUrl) {
      setHeaderActionMessage('Casting is available when the featured movie has a playable source.');
      return;
    }

    try {
      if (videoElement.src !== heroPlaybackUrl && heroPlaybackUrl) {
        videoElement.src = heroPlaybackUrl;
        videoElement.load();
      }

      const message = await startCasting({
        videoElement,
        playbackUrl: heroCastUrl,
        title: heroMovie.title,
        poster: heroMovie.poster,
        playbackType: heroPlaybackType,
        currentTime: 0,
        autoplay: true,
      });
      setHeaderActionMessage(message);
    } catch (error) {
      console.error('[home] cast failed', error);
      setHeaderActionMessage(
        error instanceof Error
          ? error.message
          : 'We could not start casting. Check that your cast device is ready on the same network.'
      );
    }
  };

  return (
    <main className="min-h-screen bg-[#0B0C10] text-white font-sans overflow-x-hidden pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:pb-12">
      {activeTrailer && (
        <div
          className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/86 px-4 py-8 backdrop-blur-sm"
          onClick={() => setActiveTrailer(null)}
        >
          <section
            className="w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-[#05070C] shadow-[0_28px_90px_rgba(0,0,0,0.62)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 md:px-5">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#FFB3C1]">
                  Trailer
                </div>
                <h2 className="truncate text-sm font-black text-white md:text-base">
                  {activeTrailer.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveTrailer(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xl font-bold text-white transition-colors hover:bg-white/10"
                aria-label="Close trailer"
              >
                x
              </button>
            </div>
            <TrailerEmbedPlayer
              trailerUrl={activeTrailer.url}
              title={activeTrailer.title}
              autoplay
              className="rounded-none"
            />
          </section>
        </div>
      )}
      
      {/* Mobile Header (Two split floating pills) */}
      <header className="fixed top-4 left-4 right-4 z-50 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/browse"
            className="pointer-events-auto h-[38px] w-[68px] rounded-[22px] bg-[#1B2230]/62 backdrop-blur-xl border border-white/10 shadow-[0_6px_18px_rgba(0,0,0,0.30)] flex items-center justify-center overflow-hidden"
          >
            <img
              src="/logow.png"
              alt="UGMOVIES247"
              className="w-14 h-14 object-cover scale-125 translate-y-2"
            />
          </Link>

          <div className="pointer-events-auto h-[46px] min-w-[138px] px-2.5 rounded-[24px] bg-[#1B2230]/62 backdrop-blur-xl border border-white/10 shadow-[0_6px_18px_rgba(0,0,0,0.30)] flex items-center justify-center gap-3">
            {!isAppInReview && (
              <>
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/92 transition-colors hover:bg-white/8 hover:text-white"
                  aria-label="Cast"
                  onClick={handleHeaderCast}
                >
                  <Cast size={20} strokeWidth={2.2} />
                </button>

                <Link
                  href="/downloads"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/92 transition-colors hover:bg-white/8 hover:text-white"
                  aria-label="Download"
                >
                  <Download size={20} strokeWidth={2.2} />
                </Link>
              </>
            )}

            <Link
              href="/notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-white/92 transition-colors hover:bg-white/8 hover:text-white"
              aria-label="Notifications"
            >
              <Bell size={20} strokeWidth={2.2} />
              {unreadLatestUploadCount > 0 && (
                <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full border border-[#1B2230] bg-red-500 px-1 py-[1px] text-center text-[9px] font-black leading-none text-white">
                  {unreadLatestUploadCount > 9 ? '9+' : unreadLatestUploadCount}
                </span>
              )}
            </Link>
          </div>
        </div>
        {headerActionMessage && (
          <div className="mt-2 flex justify-end">
            <div className="pointer-events-none max-w-[78vw] rounded-[18px] bg-[#1B2230]/62 px-3.5 py-2 text-right text-[10px] font-black uppercase tracking-[0.18em] text-white/85 backdrop-blur-xl border border-white/10 shadow-[0_6px_18px_rgba(0,0,0,0.30)]">
              {headerActionMessage}
            </div>
          </div>
        )}
        {sessionUser?.role === 'admin' && (
          <div className="mt-2 flex justify-end">
            <Link
              href="/admin"
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] text-amber-200 shadow-[0_6px_18px_rgba(0,0,0,0.25)]"
            >
              Admin Mode
            </Link>
          </div>
        )}
        <video
          ref={homeCastVideoRef}
          className="hidden"
          playsInline
          preload="metadata"
          x-webkit-airplay="allow"
        />
      </header>

      {/* Hero Section */}
      {heroMovie && (
        <>
        <section className="relative w-full h-[62vh] sm:h-[68vh] flex flex-col justify-end pb-10 px-4 pt-20 transition-all duration-1000 ease-in-out md:hidden">
          <div className="absolute inset-0 transition-opacity duration-1000 ease-in-out" key={heroMovie.id}>
            <img
              src={heroPosterImageProps.src}
              srcSet={heroPosterImageProps.srcSet}
              sizes={heroPosterImageProps.sizes}
              alt="Hero Backdrop"
              className="w-full h-full object-cover object-top transition-opacity duration-1000"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/70 to-transparent h-[60%] bottom-0 mt-auto"></div>
            <div className="absolute inset-0 bg-black/20"></div>
          </div>

          <div className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center text-center">
            <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight w-full drop-shadow-2xl">
              {heroMovie.title}
            </h1>

            <div className="flex items-center justify-center gap-4 text-[11px] font-semibold text-gray-400 mb-8 tracking-widest w-full">
              <span>{heroMovie.release_date?.substring(0, 4) || '2026'}</span>
              {heroRuntimeLabel && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-600"></span>
                  <span>{heroRuntimeLabel}</span>
                </>
              )}
              {heroMovie.vj && heroMovie.vj !== 'Unknown' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-600"></span>
                  <span className="text-[#D90429] uppercase font-bold tracking-[0.2em] relative">
                    VJ {heroMovie.vj}
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-row w-full gap-3 justify-center px-2">
              {isAppInReview ? (
                <button
                  type="button"
                  onClick={handleHeroTrailerClick}
                  className="bg-[#D90429] hover:bg-red-700 text-white font-extrabold flex-1 px-4 py-3 rounded-md flex items-center justify-center gap-2 transition-colors shadow-lg shadow-red-900/30"
                >
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  <span className="text-[11px]">WATCH TRAILER</span>
                </button>
              ) : (
                <Link
                  href={heroPlayHref}
                  className="bg-[#D90429] hover:bg-red-700 text-white font-extrabold flex-1 px-4 py-3 rounded-md flex items-center justify-center gap-2 transition-colors shadow-lg shadow-red-900/30"
                >
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  <span className="text-[11px]">PLAY NOW</span>
                </Link>
              )}
              <button
                onClick={() => setShowHeroDetails((prev) => !prev)}
                className="bg-[#1F2833] hover:bg-gray-800 text-white font-bold flex-1 px-4 py-3 rounded-md flex items-center justify-center gap-2 transition-colors border border-white/5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span className="text-[11px]">{showHeroDetails ? 'HIDE DETAILS' : 'DETAILS'}</span>
              </button>
            </div>

            {showHeroDetails && (
              <div className="mt-4 w-full max-w-2xl rounded-xl border border-white/10 bg-black/60 backdrop-blur-md p-4 shadow-2xl">
                <h3 className="text-[11px] font-bold text-white mb-2 uppercase tracking-wide">
                  About this movie
                </h3>
                <p className="text-[11px] leading-6 text-gray-200">
                  {heroMovie?.overview || heroMovie?.description || 'No description available for this movie yet.'}
                </p>
              </div>
            )}
          </div>
        </section>
        <section className="relative hidden overflow-hidden md:block md:pt-[88px]">
          <div className="relative min-h-[1040px] overflow-hidden bg-[#05070C]">
            <img
              src={heroPosterImageProps.src}
              srcSet={heroPosterImageProps.srcSet}
              sizes={heroPosterImageProps.sizes}
              alt="Hero Backdrop"
              className="absolute inset-0 h-full w-full object-cover object-[center_10%] transition-opacity duration-1000 [filter:brightness(1.12)_contrast(1.06)_saturate(1.08)]"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(90deg, rgba(5,7,12,0.8) 0%, rgba(5,7,12,0.46) 24%, rgba(5,7,12,0.14) 50%, rgba(5,7,12,0.1) 100%), linear-gradient(180deg, rgba(11,12,16,0.02) 0%, rgba(11,12,16,0.02) 42%, rgba(11,12,16,0.06) 62%, rgba(11,12,16,0.6) 100%)',
              }}
            />

            <div className="relative z-10 mx-auto flex min-h-[1040px] w-full max-w-[1440px] flex-col justify-between px-8 pb-12 pt-20 lg:px-10">
              <div className="max-w-[760px] pt-14">
                <div className="mb-4 inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/26 px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em] text-white/78 backdrop-blur-xl">
                  <span className="h-2 w-2 rounded-full bg-[#D90429]" />
                  {isAppInReview ? 'Now Discovering' : 'Now Streaming'}
                  {sessionUser?.role === 'admin' && (
                    <Link
                      href="/admin"
                      className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[9px] text-amber-200"
                    >
                      Admin Mode
                    </Link>
                  )}
                </div>

                <h1 className="max-w-[760px] text-[84px] font-extrabold leading-[0.92] tracking-[-0.04em] text-white drop-shadow-2xl">
                  {heroMovie.title}
                </h1>

                <div className="mb-5 mt-5 flex flex-wrap items-center gap-4 text-[12px] font-semibold tracking-[0.22em] text-gray-200">
                  <span>{heroMovie.release_date?.substring(0, 4) || '2026'}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
                  <span>{isSeriesMovie(heroMovie) ? 'Series' : 'Movie'}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
                  {heroMovie.vj && heroMovie.vj !== 'Unknown' && (
                    <span className="border-l-2 border-[#D90429] pl-4 font-bold uppercase tracking-[0.2em] text-[#D90429]">
                      VJ {heroMovie.vj}
                    </span>
                  )}
                </div>

                <p className="max-w-[650px] text-[18px] leading-8 text-white/86">
                  {heroMovie?.overview || heroMovie?.description || 'No description available for this movie yet.'}
                </p>

                <div className="mt-10 flex items-center gap-4">
                  {isAppInReview ? (
                    <button
                      type="button"
                      onClick={handleHeroTrailerClick}
                      className="flex h-14 min-w-[208px] items-center justify-center gap-2 rounded-md bg-[#E50914] px-6 text-[13px] font-extrabold text-white shadow-lg shadow-red-900/20 transition-colors hover:bg-[#F6121D]"
                    >
                      <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      <span>WATCH TRAILER</span>
                    </button>
                  ) : (
                    <Link
                      href={heroPlayHref}
                      className="flex h-14 min-w-[208px] items-center justify-center gap-2 rounded-md bg-[#E50914] px-6 text-[13px] font-extrabold text-white shadow-lg shadow-red-900/20 transition-colors hover:bg-[#F6121D]"
                    >
                      <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      <span>PLAY NOW</span>
                    </Link>
                  )}
                  <button
                    onClick={() => setShowHeroDetails((prev) => !prev)}
                    className="flex h-14 min-w-[190px] items-center justify-center gap-2 rounded-md bg-[#3A4558] px-6 text-[13px] font-bold text-white transition-colors hover:bg-[#4C5A72]"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span>{showHeroDetails ? 'HIDE DETAILS' : 'DETAILS'}</span>
                  </button>
                </div>

                {showHeroDetails && (
                  <div className="mt-7 w-full max-w-2xl rounded-[24px] border border-white/10 bg-black/34 p-6 shadow-2xl backdrop-blur-md">
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-white">
                      About this movie
                    </h3>
                    <p className="text-[13px] leading-7 text-gray-200">
                      {heroMovie?.overview || heroMovie?.description || 'No description available for this movie yet.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="pt-16">
                <div className="text-[11px] font-black uppercase tracking-[0.28em] text-white/42">
                  Browse
                </div>
                <h2 className="mt-2 text-[24px] font-black tracking-[-0.03em] text-white">
                  {isAppInReview ? 'Pick a trailer lane' : 'Pick a lane and keep watching'}
                </h2>

                <div className="relative mt-5">
                  <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-[#0B0C10] to-transparent" />
                  <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-[#0B0C10] to-transparent" />
                  <div className="flex gap-3 overflow-x-auto pb-3 pr-12 style-hide-scrollbar">
                    {DESKTOP_CATEGORY_PILLS.map((category) => {
                      const isActive = activeCategory === category.value;

                      return (
                        <button
                          key={category.value}
                          onClick={() => setActiveCategory(category.value)}
                          className={`${
                            isActive
                              ? 'bg-white text-[#0B0C10]'
                              : 'bg-white/[0.08] text-white/76 hover:bg-white/[0.12] hover:text-white'
                          } shrink-0 rounded-full px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.2em] transition-colors`}
                        >
                          {category.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        </>
      )}

      <div className="relative z-20 px-4 -mt-4 mb-4 md:hidden">
         <div className="flex gap-2 overflow-x-auto pb-3 style-hide-scrollbar snap-x">
           <button
  onClick={() => setActiveCategory('ALL')}
  className={`${activeCategory === 'ALL' ? 'bg-white text-black' : 'bg-yellow-600/80 text-white hover:bg-yellow-500'} px-2 py-1.5 rounded-full text-[10px] sm:text-xs font-bold shrink-0 flex items-center gap-1.5 snap-start transition-colors border border-white/5`}
>
  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path>
  </svg>
  ALL
</button>

<button
  onClick={() => setActiveCategory('Action')}
  className={`${activeCategory === 'Action' ? 'bg-[#D90429] text-white' : 'bg-[#3A0D14] text-red-200 hover:bg-[#4A121C]'} px-2 py-1.5 rounded-full text-[10px] sm:text-xs font-bold shrink-0 flex items-center gap-1.5 snap-start transition-colors border border-white/5`}
>
  ACTION
</button>

<button
  onClick={() => setActiveCategory('Sci-Fi')}
  className={`${activeCategory === 'Sci-Fi' ? 'bg-cyan-500 text-black' : 'bg-cyan-900/40 text-cyan-200 hover:bg-cyan-800/50'} px-2 py-1.5 rounded-full text-[10px] sm:text-xs font-bold shrink-0 flex items-center gap-1.5 snap-start transition-colors border border-white/5`}
>
  SCI-FI
</button>

<button
  onClick={() => setActiveCategory('Drama')}
  className={`${activeCategory === 'Drama' ? 'bg-purple-600 text-white' : 'bg-purple-900/40 text-purple-200 hover:bg-purple-800/50'} px-2 py-1.5 rounded-full text-[10px] sm:text-xs font-bold shrink-0 flex items-center gap-1.5 snap-start transition-colors border border-white/5`}
>
  DRAMA
</button>

<button
  onClick={() => setActiveCategory('Romance')}
  className={`${activeCategory === 'Romance' ? 'bg-pink-500 text-white' : 'bg-pink-900/40 text-pink-200 hover:bg-pink-800/50'} px-2 py-1.5 rounded-full text-[10px] sm:text-xs font-bold shrink-0 flex items-center gap-1.5 snap-start transition-colors border border-white/5`}
>
  ROMANCE
</button>

<button
  onClick={() => setActiveCategory('Adventure')}
  className={`${activeCategory === 'Adventure' ? 'bg-emerald-500 text-black' : 'bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/50'} px-2 py-1.5 rounded-full text-[10px] sm:text-xs font-bold shrink-0 flex items-center gap-1.5 snap-start transition-colors border border-white/5`}
>
  ADVENTURE
</button>
        </div>
      </div>

      {/* Floating Request Movie Button */}
      <style jsx global>{`
        @keyframes request-movie-fab-ripple {
          0% {
            opacity: 0.72;
            transform: scale(0.66);
          }

          62% {
            opacity: 0.24;
          }

          100% {
            opacity: 0;
            transform: scale(1.72);
          }
        }

        @keyframes request-movie-fab-breathe {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(var(--request-fab-scale, 1));
          }

          50% {
            transform: translate3d(0, -4px, 0) scale(var(--request-fab-scale, 1));
          }
        }

        .request-movie-fab {
          isolation: isolate;
          -webkit-tap-highlight-color: transparent;
        }

        .request-movie-fab::before,
        .request-movie-fab::after {
          content: '';
          position: absolute;
          inset: -8px;
          z-index: -1;
          border-radius: 9999px;
          pointer-events: none;
          background:
            radial-gradient(circle, rgba(255, 61, 92, 0.52) 0%, rgba(217, 4, 41, 0.3) 38%, rgba(217, 4, 41, 0.1) 62%, rgba(217, 4, 41, 0) 78%),
            radial-gradient(circle, rgba(255, 122, 145, 0.34) 0%, rgba(255, 48, 88, 0.16) 48%, rgba(255, 48, 88, 0) 72%);
          box-shadow:
            0 0 22px rgba(255, 31, 72, 0.46),
            0 0 42px rgba(217, 4, 41, 0.32),
            0 0 64px rgba(217, 4, 41, 0.14);
          transform: scale(0.66);
          animation: request-movie-fab-ripple 2.8s cubic-bezier(0.22, 0.61, 0.36, 1) infinite;
          will-change: transform, opacity;
        }

        .request-movie-fab::after {
          animation-delay: 1.4s;
        }

        .request-movie-fab-core {
          --request-fab-scale: 1;
          animation: request-movie-fab-breathe 3.2s ease-in-out infinite;
          transform: translate3d(0, 0, 0) scale(var(--request-fab-scale, 1));
          will-change: transform, box-shadow;
        }

        .request-movie-fab:hover::before,
        .request-movie-fab:hover::after,
        .request-movie-fab:focus-visible::before,
        .request-movie-fab:focus-visible::after {
          background:
            radial-gradient(circle, rgba(255, 78, 112, 0.62) 0%, rgba(217, 4, 41, 0.36) 38%, rgba(217, 4, 41, 0.14) 62%, rgba(217, 4, 41, 0) 78%),
            radial-gradient(circle, rgba(255, 139, 160, 0.42) 0%, rgba(255, 48, 88, 0.2) 48%, rgba(255, 48, 88, 0) 72%);
          box-shadow:
            0 0 28px rgba(255, 31, 72, 0.64),
            0 0 54px rgba(217, 4, 41, 0.38),
            0 0 76px rgba(217, 4, 41, 0.18);
        }

        .request-movie-fab:hover .request-movie-fab-core,
        .request-movie-fab:focus-visible .request-movie-fab-core {
          --request-fab-scale: 1.06;
          box-shadow:
            0 12px 30px rgba(217, 4, 41, 0.68),
            0 0 24px rgba(255, 91, 122, 0.4),
            0 0 42px rgba(217, 4, 41, 0.24);
        }

        .request-movie-fab:active .request-movie-fab-core {
          --request-fab-scale: 0.96;
        }

        @media (prefers-reduced-motion: reduce) {
          .request-movie-fab::before,
          .request-movie-fab::after,
          .request-movie-fab-core {
            animation: none;
          }
        }
      `}</style>
      <Link
        href="/request"
        className="request-movie-fab fixed bottom-[calc(7.5rem+env(safe-area-inset-bottom)+0.75rem)] right-4 z-[10000] inline-flex rounded-full group md:bottom-8 md:right-6"
        aria-label="Request a movie"
      >
        <div className="request-movie-fab-core relative z-10 w-11 h-[38px] md:w-12 md:h-12 rounded-full bg-gradient-to-br from-[#D90429] to-red-700 flex items-center justify-center shadow-[0_12px_30px_rgba(217,4,41,0.62),0_0_26px_rgba(255,48,88,0.32)] ring-1 ring-white/10 backdrop-blur-sm transition-[box-shadow,transform] duration-300">
          <Clapperboard
            className="w-[22px] h-[22px] md:w-[26px] md:h-[26px] text-white"
            strokeWidth={2.2}
            aria-hidden="true"
          />
        </div>
      </Link>

      {/* Main Content Rows Container */}
      <div className="relative z-20 space-y-5 md:space-y-12 md:pt-2">
        {!movies.length && !IS_PRODUCTION_APP && (
          <section className="px-4 md:px-12">
            <div className="rounded-2xl border border-sky-500/25 bg-sky-500/10 p-5 md:p-6 text-sky-100 shadow-[0_12px_28px_rgba(0,0,0,0.25)]">
              <div className="text-[11px] font-black uppercase tracking-[0.28em] text-sky-200">
                {APP_ENV_LABEL} Catalog Empty
              </div>
              <p className="mt-3 text-sm leading-6 text-sky-50/90">
                This app is connected to <span className="font-bold">{FIREBASE_PROJECT_LABEL}</span>. Login is working, but this DEV Firestore currently has no movie documents yet.
              </p>
              <div className="mt-4 space-y-2 text-sm text-sky-100/90">
                <p>To see movies here, upload titles into the DEV project from the admin dashboard, or seed/copy movie data into the DEV Firestore.</p>
                <p>Your production catalog is separate and stays unaffected.</p>
              </div>
            </div>
          </section>
        )}
        
        {visibleHomeRows.map((row, rowIndex) => {
          const shouldShowContinueWatching =
            continueWatchingMovies.length > 0 &&
            (row.title === 'LATEST ON UGMOVIES247' ||
              (!visibleHomeRows.some((homeRow) => homeRow.title === 'LATEST ON UGMOVIES247') &&
                rowIndex === 0));

          return (
            <Fragment key={row.categoryKey}>
              <MovieRow
                title={row.title}
                movies={row.movies}
                categoryKey={row.categoryKey}
                usesSeriesBackdropCards={row.usesSeriesBackdropCards}
                androidMobileLayout={isAndroidMobile}
                priorityImageCount={
                  rowIndex < 3 ? (row.usesSeriesBackdropCards ? 3 : 6) : 0
                }
                suppressEmptyState={shouldSuppressEmptyRows}
              />

              {shouldShowContinueWatching && (
                <MovieRow
                  title="CONTINUE WATCHING"
                  movies={continueWatchingMovies}
                  androidMobileLayout={isAndroidMobile}
                  priorityImageCount={6}
                  showProgressBars
                />
              )}
            </Fragment>
          );
        })}

        {unmatchedMovies.length > 0 && (
          <MovieRow
            title="MORE MOVIES"
            movies={unmatchedMovies}
            categoryKey="more-movies"
            androidMobileLayout={isAndroidMobile}
            priorityImageCount={0}
          />
        )}

      </div>
    </main>
  );
}

// Exactly formatted card row based on the Screenshot



const MovieRow = memo(function MovieRow({
  title,
  movies,
  categoryKey,
  usesSeriesBackdropCards = false,
  androidMobileLayout = false,
  priorityImageCount = 0,
  showProgressBars = false,
  suppressEmptyState = false,
}: {
  title: string,
  movies: Movie[],
  categoryKey?: string,
  usesSeriesBackdropCards?: boolean,
  androidMobileLayout?: boolean,
  priorityImageCount?: number,
  showProgressBars?: boolean,
  suppressEmptyState?: boolean,
}) {
  const rowRenderLimit = showProgressBars
    ? CONTINUE_WATCHING_RENDER_LIMIT
    : androidMobileLayout
      ? HOME_ROW_RENDER_LIMIT_MOBILE
      : HOME_ROW_RENDER_LIMIT_DESKTOP;
  const rowMovies = useMemo(
    () => dedupeSeriesMovies(movies || []).slice(0, rowRenderLimit),
    [movies, rowRenderLimit]
  );
  const railRef = useRef<HTMLDivElement | null>(null);

  const scrollRail = (direction: 'left' | 'right') => {
    const container = railRef.current;

    if (!container) {
      return;
    }

    const amount = Math.max(
      usesSeriesBackdropCards ? 420 : 320,
      Math.floor(container.clientWidth * (usesSeriesBackdropCards ? 0.82 : 0.72))
    );
    container.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  const renderPosterCard = (m: Movie, index: number) => {
    const progressMovie = m as ContinueWatchingMovie;
    const progressPercent = Math.min(Math.max(progressMovie.continueProgressPercent || 0, 0), 100);
    const cardHref =
      showProgressBars && progressMovie.continueWatchHref
        ? progressMovie.continueWatchHref
        : `/movie/${m.id}`;

    return (
    <Link
      href={cardHref}
      key={m.id}
      onClick={() => rememberPendingMovieNavigation(m)}
      className="w-[110px] cursor-pointer snap-start shrink-0 md:w-[220px] lg:w-[228px] xl:w-[236px]"
      style={
        androidMobileLayout
          ? {
              width: 'clamp(98px, calc((100vw - 3rem) / 3.25), 104px)',
              minWidth: 'clamp(98px, calc((100vw - 3rem) / 3.25), 104px)',
            }
          : undefined
      }
    >
        <div className="group/card relative aspect-[2/3] overflow-hidden rounded-xl bg-[#1F2833] md:rounded-[8px] md:shadow-[0_18px_40px_rgba(0,0,0,0.24)] md:transition-transform md:duration-300 md:hover:-translate-y-1">
          <HomeCardImage
            src={m.poster}
            alt={m.title}
            imageClassName="h-full w-full object-cover transition-transform duration-500 group-hover/card:scale-110"
            priority={index < priorityImageCount}
            variant="card"
          />

        {isSeriesMovie(m) && (
          <div className="absolute top-2 right-2 bg-white/95 text-[#0B0C10] text-[7px] md:text-[9px] font-black px-1.5 py-0.5 rounded-full z-10 tracking-widest shadow-[0_4px_12px_rgba(0,0,0,0.35)]">
            EPS
          </div>
        )}

        {m.isLocked && (
          <Lock
            size={18}
            strokeWidth={1.9}
            className="absolute bottom-2 right-2 z-10 h-[18px] w-[18px] text-[#C0C0C0] opacity-90 drop-shadow-[0_0_6px_rgba(255,255,255,0.14)] md:bottom-3 md:right-3 md:h-5 md:w-5"
            aria-label="Locked movie"
          />
        )}

        <div className="absolute top-0 left-0 bg-[#D90429] text-white text-[7px] md:text-[9px] font-bold px-1.5 py-0.5 rounded-br-lg z-10 shadow-[2px_2px_10px_rgba(0,0,0,0.5)]">
          {getMovieVjLabel(m)}
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none"></div>

        {showProgressBars && progressPercent > 0 && (
          <div className="absolute inset-x-0 bottom-0 z-30 h-1 bg-black/70">
            <div
              className="h-full rounded-r-full bg-[#D90429] shadow-[0_0_10px_rgba(217,4,41,0.72)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        <div className="absolute inset-0 z-20 flex items-center justify-center opacity-0 transition-opacity duration-300 pointer-events-none group-hover/card:opacity-100">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-300/25 bg-[#D90429]/90 pl-1 backdrop-blur-md shadow-[0_0_22px_rgba(217,4,41,0.72)] md:h-14 md:w-14 md:shadow-[0_0_28px_rgba(217,4,41,0.85)]">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M4 4l12 6-12 6z"/>
            </svg>
          </div>
        </div>
      </div>
      <p className="mt-2 min-h-[2.5rem] text-xs font-semibold leading-5 text-white line-clamp-2 md:mt-3 md:min-h-[3rem] md:text-[14px] md:leading-6 md:text-white/90">
        {`${m.title || m.name} - ${getMovieVjLabel(m)}`}
      </p>
    </Link>
    );
  };

  const renderSeriesBackdropCard = (m: Movie, index: number) => (
    <Link
      href={`/movie/${m.id}`}
      key={m.id}
      onClick={() => rememberPendingMovieNavigation(m)}
      className="group/card w-[62vw] min-w-[244px] max-w-[320px] cursor-pointer snap-start shrink-0 sm:w-[48vw] sm:min-w-[270px] md:w-[430px] md:max-w-none lg:w-[480px] xl:w-[520px]"
    >
        <div className="relative aspect-[16/9] overflow-hidden rounded-[22px] border border-white/8 bg-[#11141C] shadow-[0_22px_48px_rgba(0,0,0,0.32)] transition-transform duration-300 md:hover:-translate-y-1.5">
          <HomeCardImage
            src={getSeriesBackdropCardImage(m)}
            alt={m.title}
            imageClassName="h-full w-full object-cover object-center transition-transform duration-500 md:group-hover/card:scale-105"
            logoClassName="h-14 w-14 scale-[1.95] object-contain opacity-95 drop-shadow-[0_10px_24px_rgba(217,4,41,0.18)] md:h-20 md:w-20"
            priority={index < priorityImageCount}
            variant="backdrop"
          />
        <div className="absolute inset-0 bg-gradient-to-t from-[#06070B] via-[#06070B]/40 to-[#06070B]/10" />
        <div className="absolute inset-0 bg-black/10 transition-colors duration-300 md:group-hover/card:bg-black/0" />
        {m.isLocked && (
          <Lock
            size={20}
            strokeWidth={1.9}
            className="absolute bottom-3 right-3 z-20 h-5 w-5 text-[#C0C0C0] opacity-90 drop-shadow-[0_0_6px_rgba(255,255,255,0.14)] md:bottom-4 md:right-4 md:h-[22px] md:w-[22px]"
            aria-label="Locked movie"
          />
        )}
        <div className="absolute inset-0 z-20 flex items-center justify-center opacity-0 transition-opacity duration-300 pointer-events-none group-hover/card:opacity-100">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-300/25 bg-[#D90429]/90 pl-1 backdrop-blur-md shadow-[0_0_22px_rgba(217,4,41,0.72)] md:h-14 md:w-14 md:shadow-[0_0_28px_rgba(217,4,41,0.85)]">
            <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 4l12 6-12 6z" />
            </svg>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
          <div className="flex items-end justify-between gap-3">
            <p className="max-w-[90%] text-[13px] font-black leading-5 text-white drop-shadow-[0_10px_18px_rgba(0,0,0,0.55)] line-clamp-2 md:text-[18px] md:leading-6">
              {`${m.title || m.name} - ${getMovieVjLabel(m)}`}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );

  const renderCard = (movie: Movie, index: number) =>
    usesSeriesBackdropCards
      ? renderSeriesBackdropCard(movie, index)
      : renderPosterCard(movie, index);

  return (
    <section className="relative mx-auto w-full max-w-[1440px] px-4 md:px-8 lg:px-10">
      <div className="mb-4 flex items-center justify-between gap-4 md:mb-5">
        <div>
          <div className="mb-2 hidden h-[2px] w-10 bg-white/16 md:block" />
          <h2 className="text-[16px] font-bold tracking-wide text-white md:text-[22px] md:font-black md:tracking-[-0.02em]">
          {title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {rowMovies.length > 0 && (
            <div className="hidden items-center gap-2 md:flex">
              <button
                onClick={() => scrollRail('left')}
                aria-label={`Scroll ${title} left`}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft size={18} strokeWidth={2.2} />
              </button>
              <button
                onClick={() => scrollRail('right')}
                aria-label={`Scroll ${title} right`}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronRight size={18} strokeWidth={2.2} />
              </button>
            </div>
          )}
          {categoryKey && rowMovies.length > 0 ? (
            <Link
              href={`/browse/${categoryKey}`}
              className="flex items-center gap-1 rounded-full border border-[#D90429]/25 bg-red-900/10 px-3 py-1.5 text-[8px] font-bold uppercase tracking-wider text-[#D90429] backdrop-blur-sm transition-colors hover:bg-red-900/30 md:text-[10px]"
            >
              View All
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
              </svg>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="group relative">
        {rowMovies.length > 0 ? (
          <>
            <div
              ref={railRef}
              className={`flex overflow-x-auto overscroll-x-contain pb-4 snap-x style-hide-scrollbar ${
                usesSeriesBackdropCards
                  ? 'gap-4 md:gap-6'
                  : androidMobileLayout
                    ? 'gap-2 md:gap-5'
                    : 'gap-3 md:gap-5'
              }`}
            >
              {rowMovies.map((m, index) => renderCard(m, index))}
            </div>
          </>
        ) : suppressEmptyState ? null : (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#11141C]/60 px-4 py-6 text-sm text-gray-500">
            No movies in this category yet.
          </div>
        )}
      </div>
    </section>
  );
});
