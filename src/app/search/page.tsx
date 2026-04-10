'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search as SearchIcon, X, Play, Film } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies } from '@/lib/publicMovies';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [allMovies, setAllMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    <div className="min-h-screen bg-[#0B0C10] pb-24 pt-16 md:pt-28 px-4 md:px-12 font-sans">
      
      {/* Desktop Header */}
      <header className="hidden md:flex absolute top-0 w-full z-50 justify-between items-center p-6 bg-gradient-to-b from-black/90 to-transparent left-0">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center justify-center p-1 w-64 hover:scale-105 transition-transform z-50">
             <img src="/images/ugmovieslogo_transparent.png" alt="UG Movies 247" className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_2px_20px_rgba(217,4,41,0.9)]" />
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/" className="text-[#888888] hover:text-[#D90429] transition-colors">Home</Link>
            <Link href="/vjs" className="text-[#888888] hover:text-[#D90429] transition-colors">VJ Directory</Link>
            <Link href="/search" className="text-white hover:text-[#D90429] transition-colors">Search</Link>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/profile" className="w-10 h-10 rounded-md bg-[#1F2833] overflow-hidden border border-[#D90429] hover:border-white transition-colors cursor-pointer shadow-[0_0_10px_rgba(217,4,41,0.5)]">
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=AdminBossy&colors=D90429,0B0C10" alt="Profile" className="w-full h-full object-cover scale-110" />
          </Link>
        </div>
      </header>

      {/* Search Bar Container (Mobile) */}
      <div className="md:hidden fixed top-0 left-0 w-full z-40 bg-[#0B0C10]/95 backdrop-blur-md border-b border-[#1F2833] p-4 shadow-xl">
        <div className="relative flex items-center bg-[#1F2833] rounded-full border border-[#D90429]/30 focus-within:border-[#D90429] focus-within:ring-2 focus-within:ring-[#D90429]/20 transition-all p-1">
          <div className="pl-3 text-[#888888] flex-shrink-0">
             <SearchIcon size={20} />
          </div>
          <input 
            type="text" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search VJs, Movies, Genres..." 
            className="w-full bg-transparent text-white py-2 pl-3 pr-10 focus:outline-none placeholder-[#888888]/60 text-base appearance-none"
            autoFocus
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 text-[#888888] hover:text-white p-1 rounded-full bg-black/50">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Desktop Search Bar */}
      <div className="hidden md:block max-w-4xl mx-auto mb-10 relative">
        <SearchIcon className="absolute left-6 top-1/2 -translate-y-1/2 text-[#888888]" size={28} />
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search specific VJs (e.g. VJ Ice P), Action Movies, or K-Drama..." 
          className="w-full bg-[#1F2833]/50 text-white rounded-full py-5 pl-16 pr-16 text-lg focus:outline-none focus:ring-2 focus:ring-[#D90429]/40 placeholder-[#888888]/60 border border-white/5 focus:border-[#D90429] transition-all shadow-[0_0_20px_rgba(0,0,0,0.5)] backdrop-blur-xl"
          autoFocus
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-6 top-1/2 -translate-y-1/2 text-white bg-black/60 hover:bg-[#D90429] p-2 rounded-full transition-colors">
            <X size={20} />
          </button>
        )}
      </div>

      {/* Results Area */}
      <div className="mt-2 md:mt-8 max-w-7xl mx-auto">
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
              {filteredMovies.map(movie => (
                <Link href={`/movie/${movie.id}`} key={movie.id} className="flex gap-4 md:gap-5 bg-[#1F2833]/30 p-2 md:p-4 rounded-lg hover:bg-[#1F2833] transition-colors group border border-transparent hover:border-white/5 shadow-sm">
                  <div className="w-24 md:w-28 rounded-md overflow-hidden relative flex-shrink-0 aspect-[2/3] shadow-md">
                    <img src={movie.poster} alt={movie.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
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
      
      {/* Shared Bottom Nav */}
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
        <Link href="/search" className="flex flex-col items-center gap-1 text-[#D90429] w-16 transition-colors">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
           <span className="text-[10px] font-bold">Search</span>
        </Link>
        <Link href="/profile" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
           <span className="text-[10px] font-bold">Profile</span>
        </Link>
      </div>

    </div>
  );
}
