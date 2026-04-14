'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { AUTO_HOME_ROW_CONFIG, HOME_PAGE_CATEGORY_CONFIG } from '@/lib/homeCategories';
import { Bell, Cast, ChevronLeft, ChevronRight, Clapperboard, Download } from 'lucide-react';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import { fetchAuthStatus, readCachedAuthStatus } from '@/lib/auth/status-client';
import { APP_ENV_LABEL, FIREBASE_PROJECT_LABEL, IS_PRODUCTION_APP } from '@/lib/appEnv';
import { countUnreadLatestUploads } from '@/lib/latestUploadNotifications';

type SessionUser = {
  role: 'user' | 'admin';
  name: string;
};

type HomePageCategory = {
  id: string;
  name: string;
  displayLabel: string;
  homeOrder: number;
  isVisible: boolean;
};

const DEFAULT_HOME_PAGE_CATEGORIES: HomePageCategory[] = HOME_PAGE_CATEGORY_CONFIG.map((category) => ({
  id: category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name: category.name,
  displayLabel: category.displayLabel,
  homeOrder: category.homeOrder,
  isVisible: true,
}));

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

function getMovieVjLabel(movie: Movie) {
  return movie.vj && movie.vj !== 'Unknown' ? `VJ ${movie.vj}` : 'VJ HD';
}

export default function Home() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [homePageCategories, setHomePageCategories] = useState<HomePageCategory[]>(
    DEFAULT_HOME_PAGE_CATEGORIES
  );
  const [loading, setLoading] = useState(true);
  const [heroIndex, setHeroIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [showHeroDetails, setShowHeroDetails] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [headerActionMessage, setHeaderActionMessage] = useState('');
  const homeCastVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const cachedMovies = dedupeSeriesMovies(readCachedPublicMovies());

    if (cachedMovies.length) {
      setMovies(cachedMovies);
      setLoading(false);
    }

    const fetchMovies = async () => {
      try {
        const data = dedupeSeriesMovies(await fetchPublicMovies());
        setMovies(data);
      } catch (err) {
        console.error("Error fetching movies:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMovies();
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadHomePageCategories = async () => {
      try {
        const response = await fetch('/api/categories/home', {
          cache: 'no-store',
        });
        const payload = (await response.json().catch(() => ({}))) as {
          categories?: HomePageCategory[];
        };

        if (!mounted || !response.ok || !Array.isArray(payload.categories)) {
          return;
        }

        setHomePageCategories(
          payload.categories.length ? payload.categories : DEFAULT_HOME_PAGE_CATEGORIES
        );
      } catch {
        if (mounted) {
          setHomePageCategories(DEFAULT_HOME_PAGE_CATEGORIES);
        }
      }
    };

    void loadHomePageCategories();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadSessionUser = async () => {
      const cachedStatus = readCachedAuthStatus();

      if (mounted && cachedStatus?.authenticated) {
        setSessionUser({
          role: cachedStatus.user?.role === 'admin' ? 'admin' : 'user',
          name: cachedStatus.user?.name || 'User',
        });
      }

      try {
        const status = await fetchAuthStatus();

        if (!mounted || !status.authenticated) {
          return;
        }

        if (!mounted) {
          return;
        }

        setSessionUser({
          role: status.user?.role === 'admin' ? 'admin' : 'user',
          name: status.user?.name || 'User',
        });
      } catch (error) {
        if (mounted) {
          setSessionUser(null);
        }
      }
    };

    loadSessionUser();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredMovies = activeCategory === 'ALL' 
    ? movies 
    : movies.filter(m => m.genres?.map((g) => g.toLowerCase()).includes(activeCategory.toLowerCase()));

  const hasCategory = (movie: Movie, category: string) =>
    (movie.category || []).some((entry) => entry.toLowerCase() === category.toLowerCase());

  const hasVj = (movie: Movie, ...names: string[]) => {
    const normalizedVj = (movie.vj || '').toLowerCase();
    return names.some((name) => normalizedVj.includes(name.toLowerCase()));
  };

  const latestForHero = movies.slice(0, 5);

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

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </main>
    );
  }

  const manualHomeRows = homePageCategories
    .filter((category) => category.isVisible !== false)
    .map((category) => ({
      title: category.displayLabel,
      categoryKey: category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      usesSeriesBackdropCards: ['ongoing series', 'latest series', 'asian series', 'western series'].includes(
        category.name.toLowerCase()
      ),
      sortOrder: category.homeOrder,
      movies:
        category.name.toLowerCase() === 'trending on tiktok'
          ? filteredMovies.filter(
              (movie) => movie.is_trending_tiktok || hasCategory(movie, category.name)
            )
          : filteredMovies.filter((movie) => hasCategory(movie, category.name)),
    }));

  const autoRows = AUTO_HOME_ROW_CONFIG.map((row) => ({
    title: row.title,
    categoryKey: row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
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

  const homeRows = [...manualHomeRows, ...autoRows].sort(
    (left, right) => left.sortOrder - right.sortOrder
  );

  const configuredRowMovieIds = new Set(homeRows.flatMap((row) => row.movies).map((movie) => movie.id));
  const unmatchedMovies = filteredMovies.filter((movie) => !configuredRowMovieIds.has(movie.id));

  // Hero Movie
  const heroMovie = latestForHero.length > 0 ? latestForHero[heroIndex] : (movies[0] || null);
  const heroPlaybackUrl =
    heroMovie?.video_url ||
    heroMovie?.sourceUrl ||
    heroMovie?.masterPlaylistUrl ||
    '';
  const unreadLatestUploadCount = countUnreadLatestUploads(movies);

  const handleHeaderCast = async () => {
    const videoElement = homeCastVideoRef.current;

    if (!heroMovie) {
      setHeaderActionMessage('Pick a movie first before casting.');
      return;
    }

    if (heroMovie.isLocked) {
      setHeaderActionMessage('Unlock this movie first before casting it.');
      return;
    }

    if (!videoElement || !heroPlaybackUrl) {
      setHeaderActionMessage('Casting is available when the featured movie has a playable source.');
      return;
    }

    const castVideo = videoElement as HTMLVideoElement & {
      remote?: {
        prompt?: () => Promise<void>;
        watchAvailability?: (callback: (available: boolean) => void) => Promise<number>;
      };
      webkitShowPlaybackTargetPicker?: () => void;
      webkitCurrentPlaybackTargetIsWireless?: boolean;
    };

    try {
      if (videoElement.src !== heroPlaybackUrl) {
        videoElement.src = heroPlaybackUrl;
        videoElement.load();
      }

      if (castVideo.remote && typeof castVideo.remote.prompt === 'function') {
        if (typeof castVideo.remote.watchAvailability === 'function') {
          const isAvailable = await new Promise<boolean>((resolve) => {
            let settled = false;

            castVideo.remote!.watchAvailability!((available: boolean) => {
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

            window.setTimeout(() => {
              if (!settled) {
                settled = true;
                resolve(true);
              }
            }, 1200);
          });

          if (!isAvailable) {
            setHeaderActionMessage('No cast devices were found on this network right now.');
            return;
          }
        }

        await castVideo.remote.prompt();
        setHeaderActionMessage(`Casting picker opened for ${heroMovie.title}.`);
        return;
      }

      if (typeof castVideo.webkitShowPlaybackTargetPicker === 'function') {
        castVideo.webkitShowPlaybackTargetPicker();
        setHeaderActionMessage(
          castVideo.webkitCurrentPlaybackTargetIsWireless
            ? `Casting ${heroMovie.title} to your connected device.`
            : 'AirPlay device picker opened.'
        );
        return;
      }

      setHeaderActionMessage('Casting is not available in this browser. Open the movie page to cast from the player.');
    } catch (error) {
      console.error('[home] cast failed', error);
      setHeaderActionMessage('We could not start casting. Check that your cast device is ready on the same network.');
    }
  };

  return (
    <main className="min-h-screen bg-[#0B0C10] text-white font-sans overflow-x-hidden pb-24 md:pb-12">
      
      {/* Mobile Header (Two split floating pills) */}
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

          <div className="pointer-events-auto h-[46px] min-w-[138px] px-2.5 rounded-[24px] bg-[#1B2230]/62 backdrop-blur-xl border border-white/10 shadow-[0_6px_18px_rgba(0,0,0,0.30)] flex items-center justify-center gap-3">
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
          crossOrigin="anonymous"
        />
      </header>

      {/* Hero Section */}
      {heroMovie && (
        <>
        <section className="relative w-full h-[62vh] sm:h-[68vh] flex flex-col justify-end pb-10 px-4 pt-20 transition-all duration-1000 ease-in-out md:hidden">
          <div className="absolute inset-0 transition-opacity duration-1000 ease-in-out" key={heroMovie.id}>
            <img
              src={heroMovie.poster}
              alt="Hero Backdrop"
              className="w-full h-full object-cover object-top transition-opacity duration-1000"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/80 to-transparent h-[60%] bottom-0 mt-auto"></div>
            <div className="absolute inset-0 bg-black/30"></div>
          </div>

          <div className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center text-center">
            <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight w-full drop-shadow-2xl">
              {heroMovie.title}
            </h1>

            <div className="flex items-center justify-center gap-4 text-[11px] font-semibold text-gray-400 mb-8 tracking-widest w-full">
              <span>{heroMovie.release_date?.substring(0, 4) || '2026'}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-gray-600"></span>
              <span>2h 49m</span>
              <span className="w-1.5 h-1.5 rounded-full bg-gray-600"></span>
              {heroMovie.vj && heroMovie.vj !== 'Unknown' && (
                <span className="text-[#D90429] border-l-2 border-[#D90429] pl-4 uppercase font-bold tracking-[0.2em] relative">
                  VJ {heroMovie.vj}
                </span>
              )}
            </div>

            <div className="flex flex-row w-full gap-3 justify-center px-2">
              <Link
                href={`/movie/${heroMovie.id}`}
                className="bg-[#D90429] hover:bg-red-700 text-white font-extrabold flex-1 px-4 py-3 rounded-md flex items-center justify-center gap-2 transition-colors shadow-lg shadow-red-900/30"
              >
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                <span className="text-[11px]">{heroMovie.isLocked ? 'UNLOCK TO WATCH' : 'PLAY NOW'}</span>
              </Link>
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
              src={heroMovie.poster}
              alt="Hero Backdrop"
              className="absolute inset-0 h-full w-full object-cover object-[center_10%] transition-opacity duration-1000 [filter:brightness(1.12)_contrast(1.06)_saturate(1.08)]"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(90deg, rgba(5,7,12,0.88) 0%, rgba(5,7,12,0.58) 24%, rgba(5,7,12,0.22) 50%, rgba(5,7,12,0.16) 100%), linear-gradient(180deg, rgba(11,12,16,0.03) 0%, rgba(11,12,16,0.02) 42%, rgba(11,12,16,0.08) 62%, rgba(11,12,16,0.72) 100%)',
              }}
            />

            <div className="relative z-10 mx-auto flex min-h-[1040px] w-full max-w-[1440px] flex-col justify-between px-8 pb-12 pt-20 lg:px-10">
              <div className="max-w-[760px] pt-14">
                <div className="mb-4 inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/26 px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em] text-white/78 backdrop-blur-xl">
                  <span className="h-2 w-2 rounded-full bg-[#D90429]" />
                  Now Streaming
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
                  <Link
                    href={`/movie/${heroMovie.id}`}
                    className="flex h-14 min-w-[208px] items-center justify-center gap-2 rounded-md bg-[#E50914] px-6 text-[13px] font-extrabold text-white shadow-lg shadow-red-900/20 transition-colors hover:bg-[#F6121D]"
                  >
                    <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <span>{heroMovie.isLocked ? 'UNLOCK TO WATCH' : 'PLAY NOW'}</span>
                  </Link>
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
                  Pick a lane and keep watching
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
      <Link
        href="/request"
        className="fixed bottom-20 md:bottom-8 right-4 md:right-6 z-[60] group"
        aria-label="Request a movie"
      >
        <div className="w-11 h-[38px] md:w-12 md:h-12 rounded-full bg-gradient-to-br from-[#D90429] to-red-700 hover:scale-105 active:scale-95 flex items-center justify-center shadow-[0_10px_25px_rgba(217,4,41,0.45)] ring-1 ring-white/10 backdrop-blur-sm transition-all duration-300 animate-[float_3s_ease-in-out_infinite]">
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
        
        {homeRows.map((row) => (
          <MovieRow
            key={row.categoryKey}
            title={row.title}
            movies={row.movies}
            hasViewAll={row.movies.length > 0}
            categoryKey={row.categoryKey}
            usesSeriesBackdropCards={row.usesSeriesBackdropCards}
            expanded={!!expandedSections[row.categoryKey]}
            onToggle={() =>
              setExpandedSections((prev) => ({
                ...prev,
                [row.categoryKey]: !prev[row.categoryKey],
              }))
            }
          />
        ))}

        {unmatchedMovies.length > 0 && (
          <MovieRow
            title="MORE MOVIES"
            movies={unmatchedMovies}
            hasViewAll
            categoryKey="more-movies"
            expanded={!!expandedSections['more-movies']}
            onToggle={() =>
              setExpandedSections((prev) => ({
                ...prev,
                'more-movies': !prev['more-movies'],
              }))
            }
          />
        )}

      </div>
    </main>
  );
}

// Exactly formatted card row based on the Screenshot



function MovieRow({
  title,
  movies,
  hasViewAll = false,
  categoryKey,
  usesSeriesBackdropCards = false,
  expanded = false,
  onToggle
}: {
  title: string,
  movies: Movie[],
  hasViewAll?: boolean,
  categoryKey?: string,
  usesSeriesBackdropCards?: boolean,
  expanded?: boolean,
  onToggle?: () => void
}) {
  const rowMovies = dedupeSeriesMovies(movies || []);
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

  const renderPosterCard = (m: Movie) => (
    <Link href={`/movie/${m.id}`} key={m.id} className="w-[110px] cursor-pointer snap-start shrink-0 md:w-[220px] lg:w-[228px] xl:w-[236px]">
      <div className="group/card relative aspect-[2/3] overflow-hidden rounded-xl bg-[#1F2833] md:rounded-[8px] md:shadow-[0_18px_40px_rgba(0,0,0,0.24)] md:transition-transform md:duration-300 md:hover:-translate-y-1">
        <img
          src={m.poster || 'https://via.placeholder.com/300x450/1F2833/888888?text=NO+POSTER'}
          alt={m.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-110"
          loading="lazy"
        />

        {isSeriesMovie(m) && (
          <div className="absolute top-2 right-2 bg-white/95 text-[#0B0C10] text-[7px] md:text-[9px] font-black px-1.5 py-0.5 rounded-full z-10 tracking-widest shadow-[0_4px_12px_rgba(0,0,0,0.35)]">
            EPS
          </div>
        )}

        {m.isLocked && (
          <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[7px] md:text-[9px] font-black px-2 py-1 rounded-full z-10 tracking-widest border border-white/10">
            LOCKED
          </div>
        )}

        <div className="absolute top-0 left-0 bg-[#D90429] text-white text-[7px] md:text-[9px] font-bold px-1.5 py-0.5 rounded-br-lg z-10 shadow-[2px_2px_10px_rgba(0,0,0,0.5)]">
          {getMovieVjLabel(m)}
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none"></div>

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

  const renderSeriesBackdropCard = (m: Movie) => (
    <Link
      href={`/movie/${m.id}`}
      key={m.id}
      className="group/card w-[62vw] min-w-[244px] max-w-[320px] cursor-pointer snap-start shrink-0 sm:w-[48vw] sm:min-w-[270px] md:w-[430px] md:max-w-none lg:w-[480px] xl:w-[520px]"
    >
      <div className="relative aspect-[16/9] overflow-hidden rounded-[22px] border border-white/8 bg-[#11141C] shadow-[0_22px_48px_rgba(0,0,0,0.32)] transition-transform duration-300 md:hover:-translate-y-1.5">
        <img
          src={m.poster || 'https://via.placeholder.com/1280x720/1F2833/888888?text=NO+ART'}
          alt={m.title}
          className="h-full w-full object-cover object-center transition-transform duration-500 md:group-hover/card:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#06070B] via-[#06070B]/40 to-[#06070B]/10" />
        <div className="absolute inset-0 bg-black/10 transition-colors duration-300 md:group-hover/card:bg-black/0" />
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

  const renderCard = (movie: Movie) =>
    usesSeriesBackdropCards ? renderSeriesBackdropCard(movie) : renderPosterCard(movie);

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
          {hasViewAll && (
            <button
              onClick={onToggle}
              className="flex items-center gap-1 rounded-full border border-[#D90429]/25 bg-red-900/10 px-3 py-1.5 text-[8px] font-bold uppercase tracking-wider text-[#D90429] backdrop-blur-sm transition-colors hover:bg-red-900/30 md:text-[10px]"
            >
              {expanded ? 'VIEW LESS' : 'VIEW ALL'}
              <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="group relative">
        {rowMovies.length > 0 ? (
          <>
            <div
              ref={railRef}
              className={`flex overflow-x-auto pb-4 snap-x style-hide-scrollbar ${
                usesSeriesBackdropCards ? 'gap-4 md:gap-6' : 'gap-3 md:gap-5'
              }`}
            >
              {rowMovies.map((m) => renderCard(m))}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#11141C]/60 px-4 py-6 text-sm text-gray-500">
            No movies in this category yet.
          </div>
        )}
      </div>

      {expanded && rowMovies.length > 0 && (
        <div
          className={`mt-4 grid gap-3 md:gap-4 ${
            usesSeriesBackdropCards
              ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
              : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'
          }`}
        >
          {rowMovies.map((m) => renderCard(m))}
        </div>
      )}
    </section>
  );
}
