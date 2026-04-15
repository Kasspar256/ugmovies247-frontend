'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Play, ArrowLeft, Film } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import MobilePageHeader from '@/components/MobilePageHeader';

function getCategoryMovies(categorySlug: string, catalog: Movie[]) {
  if (categorySlug === 'latest') {
    return catalog.slice(0, 24);
  }

  if (categorySlug === 'tiktok-trending') {
    return catalog.filter((movie) => movie.is_trending_tiktok);
  }

  if (categorySlug === 'most-liked') {
    return catalog.slice(2, 22);
  }

  return catalog;
}

export default function CategoryDetail({ params }: { params: { id: string } }) {
  const categorySlug = decodeURIComponent(params.id);
  const displayTitle = categorySlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cachedMovies = dedupeSeriesMovies(getCategoryMovies(categorySlug, readCachedPublicMovies()));

    if (cachedMovies.length) {
      setMovies(cachedMovies);
      setLoading(false);
    }

    const fetchMovies = async () => {
      try {
        const data = await fetchPublicMovies();

        setMovies(dedupeSeriesMovies(getCategoryMovies(categorySlug, data)));
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
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 md:pt-[118px] lg:px-10 font-sans">

      <MobilePageHeader title={displayTitle} fallbackHref="/" />

      {/* Desktop Info */}
      <div className="hidden md:flex items-center gap-6 mb-10 w-full max-w-[1380px] mx-auto">
        <Link href="/" className="w-12 h-12 rounded-full bg-[#1F2833]/50 flex items-center justify-center text-white hover:bg-[#D90429] transition-colors group border border-white/5 shadow-md">
          <ArrowLeft size={24} className="group-hover:-translate-x-1 transition-transform" />
        </Link>
        <div>
           <h1 className="text-4xl lg:text-5xl font-black text-white uppercase tracking-widest drop-shadow-md">{displayTitle}</h1>
           <p className="text-[#D90429] font-bold uppercase tracking-widest mt-2">{movies.length} Vaulted Files</p>
        </div>
      </div>

      {/* Massive Cinematic Grid of Category Movies */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3 md:gap-5 mt-4 md:mt-0 max-w-[1380px] mx-auto">
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
    </div>
  );
}
