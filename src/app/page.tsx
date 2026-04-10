'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { HOME_ROW_ORDER } from '@/lib/homeCategories';
import { Clapperboard } from 'lucide-react';
import { fetchPublicMovies } from '@/lib/publicMovies';
import { APP_ENV_LABEL, FIREBASE_PROJECT_LABEL, IS_PRODUCTION_APP } from '@/lib/appEnv';

type SessionUser = {
  role: 'user' | 'admin';
  name: string;
};

export default function Home() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [heroIndex, setHeroIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [showHeroDetails, setShowHeroDetails] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  useEffect(() => {
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

    const loadSessionUser = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!mounted || !response.ok) {
          return;
        }

        const payload = await response.json();

        if (!mounted) {
          return;
        }

        setSessionUser({
          role: payload.user?.role === 'admin' ? 'admin' : 'user',
          name: payload.user?.name || 'User',
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

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
        <p className="text-[#D90429] font-bold tracking-widest animate-pulse">BOOTING UG MOVIES 247...</p>
      </main>
    );
  }

  const rowsByTitle: Record<(typeof HOME_ROW_ORDER)[number], Movie[]> = {
    'LATEST MOVIES ON UGMOVIES24_7': filteredMovies.filter((movie) => hasCategory(movie, 'Latest movies on Ugmovies24_7')),
    'Ongoing Series': filteredMovies.filter((movie) => hasCategory(movie, 'Ongoing Series')),
    'RECENTLY ADDED MOVIES': filteredMovies.filter((movie) => hasCategory(movie, 'Recently added')),
    'LATEST SERIES': filteredMovies.filter((movie) => hasCategory(movie, 'Latest series')),
    'TRENDING ON TIKTOK': filteredMovies.filter((movie) => movie.is_trending_tiktok || hasCategory(movie, 'Trending on tiktok')),
    'VJ JUNIOR': filteredMovies.filter((movie) => hasVj(movie, 'junior')),
    'VJ EMMY': filteredMovies.filter((movie) => hasVj(movie, 'emmy')),
    'VJ ULIO': filteredMovies.filter((movie) => hasVj(movie, 'ulio')),
    'VJ SOUL': filteredMovies.filter((movie) => hasVj(movie, 'soul')),
    'VJ JINGO': filteredMovies.filter((movie) => hasVj(movie, 'jingo')),
    'OMUTAKA ICE P': filteredMovies.filter((movie) => hasVj(movie, 'ice p', 'omutaka ice p')),
    'ANIMATIONS': filteredMovies.filter((movie) => movie.genres?.includes('Animation')),
    'VJ JUNIOR SERIES': filteredMovies.filter((movie) => hasCategory(movie, 'VJ JUNIOR SERIES')),
    'ACTION & THRILLER': filteredMovies.filter((movie) => movie.genres?.some((genre) => ['Action', 'Thriller', 'Crime', 'Detective', 'Mystery'].includes(genre))),
    'ROMANCE': filteredMovies.filter((movie) => movie.genres?.includes('Romance')),
    'COMEDY': filteredMovies.filter((movie) => movie.genres?.includes('Comedy')),
    'ASIAN SERIES': filteredMovies.filter((movie) => hasCategory(movie, 'Asian series')),
    'HORROR': filteredMovies.filter((movie) => movie.genres?.includes('Horror')),
    "OTHER VJ's": filteredMovies.filter((movie) => hasCategory(movie, 'Other vjs')),
    'ADVENTURE': filteredMovies.filter((movie) => movie.genres?.includes('Adventure')),
    'WESTERN SERIES': filteredMovies.filter((movie) => hasCategory(movie, 'Western series')),
    'INDIAN MOVIES': filteredMovies.filter((movie) => movie.country === 'India' || movie.genres?.includes('Indian')),
  };

  const configuredRowMovieIds = new Set(
    Object.values(rowsByTitle)
      .flat()
      .map((movie) => movie.id)
  );
  const unmatchedMovies = filteredMovies.filter((movie) => !configuredRowMovieIds.has(movie.id));

  // Hero Movie
  const heroMovie = latestForHero.length > 0 ? latestForHero[heroIndex] : (movies[0] || null);

  return (
    <main className="min-h-screen bg-[#0B0C10] text-white font-sans overflow-x-hidden pb-24 md:pb-8">
      
      {/* Mobile Header (Two split floating pills) */}
      <header className="fixed top-4 left-4 right-4 z-50 md:hidden">
        <div className="flex items-center justify-between gap-3 gap-3">
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

          <div className="pointer-events-auto h-[34px] w-[96px] px-1 rounded-[20px] bg-[#1B2230]/62 backdrop-blur-xl border border-white/10 shadow-[0_6px_18px_rgba(0,0,0,0.30)] flex items-center justify-center gap-1.5">
            <button className="text-white/90 hover:text-white transition-colors" aria-label="Cast">
              <svg className="w-[20px] h-[20px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm18-6H5c-1.1 0-2 .9-2 2v3h2V6h14v12h-5v2h5c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/>
              </svg>
            </button>

            <Link href="/downloads" className="text-white/90 hover:text-white transition-colors" aria-label="Download">
              <svg className="w-[20px] h-[20px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14"/>
              </svg>
            </Link>

            <Link href="/notifications" className="relative text-white/90 hover:text-white transition-colors" aria-label="Notifications">
              <svg className="w-[20px] h-[20px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
              </svg>
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border border-[#1B2230]"></span>
            </Link>
          </div>
        </div>
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
           {sessionUser?.role === 'admin' && (
             <Link
               href="/admin"
               className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.28em] text-amber-200 shadow-[0_10px_20px_rgba(0,0,0,0.2)]"
             >
               Admin Mode
             </Link>
           )}
           <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
             <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path>
             <line x1="2" y1="20" x2="2.01" y2="20"></line>
           </svg>
           <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
           <div className="relative flex items-center">
             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
             </svg>
             <span className="absolute top-0 right-0 w-2 h-2 bg-[#D90429] rounded-full"></span>
           </div>
        </div>
      </header>

      {/* Hero Section */}
      {heroMovie && (
        <div className="relative w-full h-[54vh] md:h-[64vh] flex flex-col justify-end pb-10 md:pb-16 px-4 md:px-12 pt-20 transition-all duration-1000 ease-in-out">
          <div className="absolute inset-0 transition-opacity duration-1000 ease-in-out" key={heroMovie.id}>
            <img 
              src={heroMovie.poster} 
              alt="Hero Backdrop" 
              className="w-full h-full object-cover transition-opacity duration-1000"
            />
            {/* Exactly recreating the shadow gradients from screenshot */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/80 to-transparent h-[60%] bottom-0 mt-auto"></div>
            <div className="absolute inset-0 bg-black/30"></div> 
          </div>
          
          <div className="relative z-10 w-full max-w-4xl mx-auto md:mx-0 flex flex-col items-center md:items-start text-center md:text-left">
            <h1 className="text-4xl md:text-7xl font-extrabold text-white mb-4 tracking-tight leading-tight w-full drop-shadow-2xl">
              {heroMovie.title}
            </h1>
            
            {/* Metadata Row */}
            <div className="flex items-center justify-center md:justify-start gap-4 text-[11px] font-semibold text-gray-400 mb-8 tracking-widest w-full">
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
            
            {/* Action Buttons */}
            <div className="flex flex-row w-full sm:w-auto gap-3 justify-center md:justify-start px-2 md:px-0">
              <Link href={`/movie/${heroMovie.id}`} className="bg-[#D90429] hover:bg-red-700 text-white font-extrabold flex-1 sm:flex-none px-4 py-3 md:py-4 rounded-md flex items-center justify-center gap-2 transition-colors shadow-lg shadow-red-900/30 sm:w-[220px]">
                <svg className="w-5 h-5 md:w-6 md:h-6 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                <span className="text-[11px] md:text-xs">{heroMovie.isLocked ? 'UNLOCK TO WATCH' : 'PLAY NOW'}</span>
              </Link>
              <button onClick={() => setShowHeroDetails((prev) => !prev)} className="bg-[#1F2833] hover:bg-gray-800 text-white font-bold flex-1 sm:flex-none px-4 py-3 md:py-4 rounded-md flex items-center justify-center gap-2 transition-colors border border-white/5 sm:w-[220px]">
                <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span className="text-[11px] md:text-xs">{showHeroDetails ? "HIDE DETAILS" : "DETAILS"}</span>
              </button>
            </div>

            {showHeroDetails && (
              <div className="mt-4 w-full max-w-2xl rounded-xl border border-white/10 bg-black/60 backdrop-blur-md p-4 md:p-5 shadow-2xl">
                <h3 className="text-[11px] md:text-xs font-bold text-white mb-2 uppercase tracking-wide">
                  About this movie
                </h3>
                <p className="text-[11px] md:text-xs leading-6 text-gray-200">
                  {heroMovie?.overview || heroMovie?.description || "No description available for this movie yet."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Category Filter Pills (Horizontal Scroll) */}
    <div className="relative z-20 px-4 md:px-12 -mt-4 md:-mt-8 mb-4">
         <div className="flex gap-2 overflow-x-auto pb-3 style-hide-scrollbar snap-x">
           <button
  onClick={() => setActiveCategory('ALL')}
  className={`${activeCategory === 'ALL' ? 'bg-white text-black' : 'bg-yellow-600/80 text-white hover:bg-yellow-500'} px-2 py-1.5 rounded-full text-[10px] sm:text-xs font-bold shrink-0 flex items-center gap-1.5 snap-start transition-colors border border-white/5`}
>
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <div className="relative z-20 space-y-5 md:space-y-6">
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
        
        {HOME_ROW_ORDER.map((rowTitle) => {
          const categoryKey = rowTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const rowMovies = rowsByTitle[rowTitle] || [];

          return (
            <MovieRow
              key={rowTitle}
              title={rowTitle}
              movies={rowMovies}
              hasViewAll={rowMovies.length > 0}
              categoryKey={categoryKey}
              expanded={!!expandedSections[categoryKey]}
              onToggle={() => setExpandedSections((prev) => ({ ...prev, [categoryKey]: !prev[categoryKey] }))}
            />
          );
        })}

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

      {/* Mobile Bottom Navigation - Exact match to screenshot */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-[#0B0C10] border-t border-white/5 flex items-center justify-around px-2 z-50 md:hidden pb-safe">
        <Link href="/" className="flex flex-col items-center gap-1 text-[#D90429] w-16">
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

// Exactly formatted card row based on the Screenshot



function MovieRow({
  title,
  movies,
  hasViewAll = false,
  categoryKey,
  expanded = false,
  onToggle
}: {
  title: string,
  movies: Movie[],
  hasViewAll?: boolean,
  categoryKey?: string,
  expanded?: boolean,
  onToggle?: () => void
}) {
  const rowMovies = dedupeSeriesMovies(movies || []);

  const renderCard = (m: Movie) => (
    <Link href={`/movie/${m.id}`} key={m.id} className="w-[110px] md:w-[260px] cursor-pointer snap-start shrink-0">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-[#1F2833] group/card">
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
          {m.vj && m.vj !== 'Unknown' ? `VJ ${m.vj}` : 'VJ HD'}
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none"></div>

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 z-20 pointer-events-none">
          <div className="w-12 h-12 bg-[#D90429]/90 backdrop-blur rounded-full flex items-center justify-center pl-1 shadow-[0_0_15px_rgba(217,4,41,1)]">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M4 4l12 6-12 6z"/>
            </svg>
          </div>
        </div>
      </div>
      <p className="mt-2 min-h-[2.5rem] text-xs font-semibold text-white leading-5 line-clamp-2">
        {`${m.title || m.name} - ${m.vj && m.vj !== 'Unknown' ? `VJ ${m.vj}` : 'VJ HD'}`}
      </p>
    </Link>
  );

  return (
    <section className="px-4 md:px-12 w-full relative">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[16px] md:text-[11px] font-bold text-white tracking-wide">
          {title}
        </h2>
        {hasViewAll && (
          <button
            onClick={onToggle}
            className="text-[#D90429] text-[8px] md:text-[10px] font-bold px-2 py-1 border border-[#D90429]/30 rounded flex items-center gap-1 uppercase tracking-wider backdrop-blur-sm bg-red-900/10 flex hover:bg-red-900/30 transition-colors"
          >
            {expanded ? 'VIEW LESS' : 'VIEW ALL'}
            <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
            </svg>
          </button>
        )}
      </div>

      <div className="group relative">
        {rowMovies.length > 0 && (
          <button className="absolute left-0 top-1/2 -translate-y-2/2 z-30 w-12 h-full bg-black/60 opacity-0 group-hover:opacity-100 hidden md:flex items-center justify-center transition-opacity text-white hover:bg-black/80">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7"></path>
            </svg>
          </button>
        )}

        {rowMovies.length > 0 ? (
          <>
            <div className="flex gap-3 md:gap-4 overflow-x-auto pb-4 snap-x style-hide-scrollbar">
              {rowMovies.map((m) => renderCard(m))}
            </div>

            <button className="absolute right-0 top-1/2 -translate-y-2/2 z-30 w-12 h-full bg-black/60 opacity-0 group-hover:opacity-100 hidden md:flex items-center justify-center transition-opacity text-white hover:bg-black/80">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path>
              </svg>
            </button>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#11141C]/60 px-4 py-6 text-sm text-gray-500">
            No movies in this category yet.
          </div>
        )}
      </div>

      {expanded && rowMovies.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4 mt-4">
          {rowMovies.map((m) => renderCard(m))}
        </div>
      )}
    </section>
  );
}
