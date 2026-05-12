'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search as SearchIcon, X, Play, Film } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import { getOptimizedArtworkUrl } from '@/lib/artwork';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [allMovies, setAllMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cachedMovies = dedupeSeriesMovies(readCachedPublicMovies());

    if (cachedMovies.length) {
      setAllMovies(cachedMovies);
      setLoading(false);
    }

    const fetchMovies = async () => {
      try {
        const data = dedupeSeriesMovies(await fetchPublicMovies());
        setAllMovies(data);
      } catch (err) {
        console.error("Error fetching movies for search:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMovies();
  }, []);

  const filteredMovies = query.length > 0 
    ? allMovies.filter(m => 
        (m.title && m.title.toLowerCase().includes(query.toLowerCase())) || 
        (m.vj && m.vj.toLowerCase().includes(query.toLowerCase())) ||
        (m.genres && m.genres.some((g) => g.toLowerCase().includes(query.toLowerCase())))
      ).slice(0, 18)
    : [];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-16 md:px-8 md:pb-16 md:pt-[118px] lg:px-10 font-sans">
      <style jsx global>{`
        @keyframes ai-border-orbit {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        @keyframes ai-border-pulse {
          0%,
          100% {
            box-shadow:
              0 0 16px rgba(85, 140, 255, 0.28),
              0 0 24px rgba(236, 72, 153, 0.18);
          }
          50% {
            box-shadow:
              0 0 22px rgba(147, 51, 234, 0.36),
              0 0 34px rgba(59, 130, 246, 0.28),
              0 0 38px rgba(236, 72, 153, 0.22);
          }
        }

        .ai-mode-button::before {
          content: '';
          position: absolute;
          inset: -80%;
          background: conic-gradient(
            from 0deg,
            #8b5cf6,
            #38bdf8,
            #60a5fa,
            #ec4899,
            #f472b6,
            #8b5cf6
          );
          animation: ai-border-orbit 4.5s linear infinite;
        }

        .ai-mode-button {
          animation: ai-border-pulse 2.8s ease-in-out infinite;
        }
      `}</style>

      {/* Search Bar Container (Mobile) */}
      <div className="md:hidden fixed top-4 left-4 right-4 z-50">
        <div className="flex items-center gap-3">
          <Link
            href="/browse"
            className="flex h-[46px] w-[68px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-[#1B2230]/62 shadow-[0_6px_18px_rgba(0,0,0,0.30)] backdrop-blur-xl"
            aria-label="Go home"
          >
            <img
              src="/logow.png"
              alt="UG Movies 247"
              className="h-14 w-14 object-cover scale-125 translate-y-2"
            />
          </Link>

          <div className="relative flex flex-1 items-center rounded-[26px] border border-white/10 bg-[#1B2230]/62 px-2 py-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.30)] backdrop-blur-xl transition-all focus-within:border-[#7AA2D6]/45">
            <div className="pl-2 text-white/55 flex-shrink-0">
              <SearchIcon size={18} />
            </div>
            <input 
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search VJs, Movies, Genres..." 
              className="w-full bg-transparent py-2 pl-3 pr-[5.8rem] text-sm text-white focus:outline-none placeholder:text-white/45"
              autoFocus
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-[5.25rem] flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
            <Link
              href="/search/ai-chat"
              className="ai-mode-button absolute right-2 flex h-8 min-w-[4.35rem] items-center justify-center overflow-hidden rounded-full p-[1px] text-[10px] font-black uppercase tracking-[0.16em] text-white"
              aria-label="Ask AI"
            >
              <span className="relative z-10 flex h-full w-full items-center justify-center rounded-full bg-[#0B0F18]/94 px-3 text-white shadow-[inset_0_0_18px_rgba(255,255,255,0.05)]">
                Ask AI
              </span>
            </Link>
          </div>
        </div>
      </div>

      {/* Desktop Search Bar */}
      <div className="hidden md:block max-w-5xl mx-auto mb-12 relative">
        <SearchIcon className="absolute left-6 top-1/2 -translate-y-1/2 text-[#888888]" size={28} />
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search specific VJs (e.g. VJ Ice P), Action Movies, or K-Drama..." 
          className="w-full bg-[#1F2833]/50 text-white rounded-full py-5 pl-16 pr-36 text-lg focus:outline-none focus:ring-2 focus:ring-[#D90429]/40 placeholder-[#888888]/60 border border-white/5 focus:border-[#D90429] transition-all shadow-[0_0_20px_rgba(0,0,0,0.5)] backdrop-blur-xl"
          autoFocus
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-[7.8rem] top-1/2 -translate-y-1/2 text-white bg-black/60 hover:bg-[#D90429] p-2 rounded-full transition-colors">
            <X size={20} />
          </button>
        )}
        <Link
          href="/search/ai-chat"
          className="ai-mode-button absolute right-5 top-1/2 flex h-11 min-w-[6.1rem] -translate-y-1/2 items-center justify-center overflow-hidden rounded-full p-[1px] text-xs font-black uppercase tracking-[0.18em] text-white"
          aria-label="Ask AI"
        >
          <span className="relative z-10 flex h-full w-full items-center justify-center rounded-full bg-[#0B0F18]/94 px-4 text-white shadow-[inset_0_0_18px_rgba(255,255,255,0.05)]">
            Ask AI
          </span>
        </Link>
      </div>

      {/* Results Area */}
      <div className="mt-2 md:mt-10 max-w-[1380px] mx-auto">
        {query === '' ? (
          <div className="text-center mt-24 md:mt-32 flex flex-col items-center">
            <div className="w-20 h-20 bg-[#1F2833]/40 rounded-full flex items-center justify-center mb-6 border border-white/5 shadow-inner">
               <SearchIcon size={40} className="text-[#D90429] opacity-80" />
            </div>
            {/* Updated the Arsenal text to the Brand Name */}
            <p className="text-lg md:text-xl font-black tracking-widest text-white uppercase drop-shadow-md">
               SEARCH UGMOVIES 24_7
            </p>
            <p className="text-[#888888] text-sm mt-2 font-medium px-4">Find unlimited VJ Dubs, blockbusters, and action hits.</p>
            
            <div className="flex flex-wrap items-center justify-center gap-2 mt-8 px-4">
               <span className="bg-[#1F2833] text-white px-4 py-1.5 rounded-full text-xs font-bold cursor-pointer hover:bg-[#D90429] transition-colors shadow-sm" onClick={() => setQuery('Action')}>Action</span>
               <span className="bg-[#1F2833] text-white px-4 py-1.5 rounded-full text-xs font-bold cursor-pointer hover:bg-[#D90429] transition-colors shadow-sm" onClick={() => setQuery('VJ Junior')}>VJ Junior</span>
               <span className="bg-[#1F2833] text-white px-4 py-1.5 rounded-full text-xs font-bold cursor-pointer hover:bg-[#D90429] transition-colors shadow-sm" onClick={() => setQuery('Extraction')}>Extraction</span>
               <span className="bg-[#1F2833] text-white px-4 py-1.5 rounded-full text-xs font-bold cursor-pointer hover:bg-[#D90429] transition-colors shadow-sm" onClick={() => setQuery('Sci-Fi')}>Sci-Fi</span>
            </div>
          </div>
        ) : filteredMovies.length === 0 ? (
          <div className="text-center text-[#888888] mt-24">
            <div className="w-16 h-16 bg-[#1F2833]/30 rounded-full flex items-center justify-center mb-4 mx-auto">
               <X size={24} className="text-[#D90429]" />
            </div>
            <p className="text-lg font-bold text-white mb-1">No matches found</p>
            <p className="text-sm">We couldn't find anything for "{query}"</p>
          </div>
        ) : (
          <div>
            <h2 className="text-white font-black text-sm md:text-xl mb-4 md:mb-6 tracking-widest uppercase border-l-4 border-[#D90429] pl-3">Results ({filteredMovies.length})</h2>
            
            {/* Desktop Grid Layout / Mobile List Layout */}
            <div className="flex flex-col gap-3 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-6">
              {filteredMovies.map((movie, index) => (
                <Link href={`/movie/${movie.id}`} key={movie.id} className="flex gap-4 md:gap-5 bg-[#1F2833]/30 p-2 md:p-4 rounded-lg hover:bg-[#1F2833] transition-colors group border border-transparent hover:border-white/5 shadow-sm">
                  <div className="w-24 md:w-28 rounded-md overflow-hidden relative flex-shrink-0 aspect-[2/3] shadow-md">
                    <img
                      src={getOptimizedArtworkUrl(movie.poster, 'card')}
                      alt={movie.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading={index < 4 ? 'eager' : 'lazy'}
                      decoding="async"
                    />
                    {isSeriesMovie(movie) && (
                      <div className="absolute top-2 right-2 bg-white/95 text-[#0B0C10] text-[7px] md:text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full z-10 shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
                        EPS
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                       <Play size={24} className="text-[#D90429] fill-[#D90429]" />
                    </div>
                  </div>
                  <div className="py-1 flex flex-col justify-center flex-1">
                    <h3 className="text-white text-sm md:text-lg font-bold line-clamp-2 leading-tight mb-2 group-hover:text-[#D90429] transition-colors">{movie.title}</h3>
                    
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <p className="text-[#D90429] text-[10px] md:text-xs font-black uppercase border border-[#D90429]/50 px-1.5 py-0.5 rounded bg-[#D90429]/10 shadow-[0_0_10px_rgba(217,4,41,0.1)]">
                        {movie.vj && movie.vj !== 'Unknown' ? `VJ ${movie.vj}` : 'VJ HD'}
                      </p>
                      <p className="text-[#888888] text-[10px] md:text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                        <Film size={10} /> {movie.genres?.[0] || 'Movie'}
                      </p>
                    </div>
                    
                    <p className="text-[#888888] text-xs font-mono">{movie.release_date?.substring(0, 4) || '2026'}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
