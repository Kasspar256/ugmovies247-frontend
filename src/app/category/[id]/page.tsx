'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Play, ArrowLeft, Film, Home, Search as SearchIcon } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies } from '@/lib/publicMovies';

export default function CategoryDetail({ params }: { params: { id: string } }) {
  const categorySlug = decodeURIComponent(params.id);
  const displayTitle = categorySlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMovies = async () => {
      try {
        const data = await fetchPublicMovies();
        
        let filtered: Movie[] = [];
        if (categorySlug === 'latest') {
          filtered = data.slice(0, 24);
        } else if (categorySlug === 'tiktok-trending') {
          filtered = data.filter(m => m.is_trending_tiktok);
        } else if (categorySlug === 'most-liked') {
          filtered = data.slice(2, 22);
        } else {
          filtered = data; // Fallback
        }
        
        setMovies(dedupeSeriesMovies(filtered));
      } catch (err) {
        console.error("Error fetching category movies:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMovies();
  }, [categorySlug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-24 md:pb-12 pt-16 md:pt-28 px-4 md:px-12 font-sans">
      
      {/* Desktop Header */}
      <header className="hidden md:flex absolute top-0 w-full z-50 justify-between items-center p-6 bg-gradient-to-b from-black/90 to-transparent left-0">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center justify-center p-1 w-64 hover:scale-105 transition-transform z-50">
             <img src="/logo2_perfect.png" alt="UG Movies 247" className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_2px_20px_rgba(217,4,41,0.9)]" />
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/" className="text-white hover:text-[#D90429] transition-colors">Home</Link>
            <Link href="/vjs" className="text-[#888888] hover:text-[#D90429] transition-colors">VJ Directory</Link>
            <Link href="/genres" className="text-[#888888] hover:text-[#D90429] transition-colors">Genres</Link>
            <Link href="/search" className="text-[#888888] hover:text-[#D90429] transition-colors">Search</Link>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/profile" className="w-10 h-10 rounded-md bg-[#1F2833] overflow-hidden border border-[#D90429] hover:border-white transition-colors cursor-pointer shadow-[0_0_10px_rgba(217,4,41,0.5)]">
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=AdminBossy&colors=D90429,0B0C10" alt="Profile" className="w-full h-full object-cover scale-110" />
          </Link>
        </div>
      </header>

      {/* Mobile Header fixed */}
      <header className="fixed top-0 left-0 w-full z-40 bg-[#0B0C10]/95 backdrop-blur-md border-b border-[#1F2833] p-4 flex items-center gap-4 shadow-xl md:hidden">
        <Link href="/" className="text-white hover:text-[#D90429] transition-colors bg-[#1F2833] p-1.5 rounded-full flex items-center justify-center">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 w-0">
          <h1 className="text-lg font-black text-white uppercase tracking-wider truncate">{displayTitle}</h1>
        </div>
      </header>

      {/* Desktop Info */}
      <div className="hidden md:flex items-center gap-6 mb-10 w-full max-w-7xl mx-auto">
        <Link href="/" className="w-12 h-12 rounded-full bg-[#1F2833]/50 flex items-center justify-center text-white hover:bg-[#D90429] transition-colors group border border-white/5 shadow-md">
          <ArrowLeft size={24} className="group-hover:-translate-x-1 transition-transform" />
        </Link>
        <div>
           <h1 className="text-4xl lg:text-5xl font-black text-white uppercase tracking-widest drop-shadow-md">{displayTitle}</h1>
           <p className="text-[#D90429] font-bold uppercase tracking-widest mt-2">{movies.length} Vaulted Files</p>
        </div>
      </div>

      {/* Massive Cinematic Grid of Category Movies */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3 md:gap-5 mt-4 md:mt-0 max-w-7xl mx-auto">
        {movies.map((movie) => (
          <Link href={`/movie/${movie.id}`} key={movie.id} className="relative group bg-[#1F2833]/10 md:bg-[#1F2833]/30 p-1 md:p-3 rounded-lg md:rounded-xl border border-transparent hover:border-white/10 transition-colors shadow-lg flex flex-col h-full">
            <div className="aspect-[2/3] w-full rounded-md bg-[#1F2833] overflow-hidden mb-2 md:mb-3 relative flex-shrink-0">
              
              {/* VJ Badge Top Left Corner (All screens) */}
              {isSeriesMovie(movie) && (
                <div className="absolute top-1 right-1 md:top-2 md:right-2 bg-white/95 text-[#0B0C10] text-[7px] md:text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full z-20 shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
                  EPS
                </div>
              )}

              <div className="absolute top-1 left-1 md:top-2 md:left-2 bg-[#D90429] text-white text-[8px] md:text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 md:px-2 md:py-1 rounded-sm z-20 shadow-[0_2px_10px_rgba(217,4,41,0.5)] max-w-[90%] truncate leading-none">
                {movie.vj && movie.vj !== 'Unknown' ? `VJ ${movie.vj}` : 'VJ HD'}
              </div>

              <img src={movie.poster} alt={movie.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center z-10">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-[#D90429] rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(217,4,41,0.8)] scale-75 group-hover:scale-100 transition-transform">
                  <Play className="text-white fill-[white] ml-0.5 md:ml-1 w-4 h-4 md:w-6 md:h-6" />
                </div>
              </div>
            </div>
            
            <div className="flex flex-col flex-1 justify-between px-0.5">
               <div>
                  <h3 className="text-white text-[11px] md:text-[14px] font-bold leading-tight mb-0.5 line-clamp-2 md:truncate group-hover:text-[#D90429] transition-colors">{movie.title}</h3>
               </div>
               <div className="flex flex-col gap-0.5 md:gap-1 mt-1">
                  {/* DESKTOP ONLY: VJ Name underneath the image */}
                  <p className="hidden md:block text-[#D90429] text-[10px] md:text-[11px] font-black uppercase tracking-widest truncate">{movie.vj && movie.vj !== 'Unknown' ? `VJ ${movie.vj}` : 'VJ HD'}</p>
                  <p className="text-white/50 text-[7px] md:text-[10px] font-bold uppercase flex items-center gap-1"><Film size={8} className="md:w-[10px] md:h-[10px]" /> {movie.genres?.[0] || 'Movie'}</p>
               </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-12 md:mt-16 text-center max-w-2xl mx-auto border-t border-[#1F2833] pt-8 md:pt-10">
        <div className="w-10 h-10 md:w-14 md:h-14 bg-[#1F2833]/30 rounded-full mx-auto flex items-center justify-center mb-4">
           <span className="text-[#D90429] font-black text-xs md:text-base">END</span>
        </div>
        <p className="text-[#888888] font-mono text-[10px] md:text-xs uppercase tracking-widest">End of encrypted cluster.</p>
      </div>

      {/* Shared Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-[#0B0C10] border-t border-white/5 flex items-center justify-around px-2 z-50 md:hidden pb-safe">
        <Link href="/" className="flex flex-col items-center gap-1 text-[#D90429] w-16 transition-colors">
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

    </div>
  );
}
