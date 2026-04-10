'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { VJ_DIRECTORY } from '@/config/constants';
import { ArrowLeft, Play } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies } from '@/lib/publicMovies';

export default function VJDetail({ params }: { params: { id: string } }) {
  const vjId = params.id;
  const vjInfo = VJ_DIRECTORY.find(v => v.id === vjId) || { name: 'Unknown VJ' };
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMovies = async () => {
      try {
        const vjName = vjInfo.name.replace('VJ ', '').trim();
        
        // Use a more relaxed query: Fetch everything, then filter in memory for fuzzy match 
        // to catch variations like "Ice p", "Ice P", etc., ensuring we don't miss records.
        const allMovies = await fetchPublicMovies();
        
        const filteredMovies = allMovies.filter((m) => {
           if (!m.vj) return false;
           const v = m.vj.toLowerCase();
           const searchTarget = vjName.toLowerCase();
           return v.includes(searchTarget) || searchTarget.includes(v);
        });
        
        setMovies(dedupeSeriesMovies(filteredMovies));
      } catch (err) {
        console.error("Error fetching VJ movies:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMovies();
  }, [vjInfo.name]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-24">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-40 bg-[#0B0C10]/95 backdrop-blur-md border-b border-[#1F2833] p-4 flex items-center gap-4 shadow-xl">
        <Link href="/vjs" className="text-white hover:text-[#D90429] transition-colors bg-[#1F2833] p-1.5 rounded-full flex items-center justify-center">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-black text-white uppercase tracking-wider drop-shadow-md">{vjInfo.name}</h1>
          <p className="text-[#D90429] text-[10px] uppercase tracking-widest font-black">{movies.length} Dubbed Movies</p>
        </div>
      </header>

      {/* spacer for fixed header */}
      <div className="pt-20"></div>

      {/* Grid of Movies */}
      <div className="p-4 grid grid-cols-3 gap-3 mt-4">
        {movies.map(movie => (
          <Link href={`/movie/${movie.id}`} key={movie.id} className="relative group">
            <div className="aspect-[2/3] w-full rounded-md bg-[#1F2833] overflow-hidden mb-2">
              <img src={movie.poster} alt={movie.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
              {isSeriesMovie(movie) && (
                <div className="absolute top-2 right-2 bg-white/95 text-[#0B0C10] text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full z-10 shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
                  EPS
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Play className="text-[#D90429] fill-[#D90429]" size={32} />
              </div>
            </div>
            <h3 className="text-white text-[10px] font-medium leading-tight line-clamp-2">{movie.title}</h3>
          </Link>
        ))}
        {movies.length === 0 && (
          <div className="col-span-full text-center text-[#888888] mt-20 font-mono text-sm uppercase tracking-widest">
            NO ASSETS FOUND IN THIS VJ.
          </div>
        )}
      </div>

      {/* Shared Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-[#0B0C10] border-t border-white/5 flex items-center justify-around px-2 z-50 md:hidden pb-safe">
        <Link href="/" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
           <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
           <span className="text-[10px] font-bold">Home</span>
        </Link>
        <Link href="/vjs" className="flex flex-col items-center gap-1 text-[#D90429] w-16 transition-colors">
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
