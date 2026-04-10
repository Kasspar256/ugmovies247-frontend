'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Play, ArrowLeft, Film } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies } from '@/lib/publicMovies';

export default function GenreDetail({ params }: { params: { id: string } }) {
  const genreId = decodeURIComponent(params.id);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMovies = async () => {
      try {
        const allMovies = await fetchPublicMovies();
        
        let filtered: Movie[];
        // Special mapping for Indian
        if (genreId.toLowerCase() === 'indian') {
           filtered = allMovies.filter(m => m.country === 'India' || m.genres?.map((g) => g.toLowerCase()).includes('indian'));
        } else if (genreId.toLowerCase() === 'k-drama' || genreId.toLowerCase() === 'k drama') {
           filtered = allMovies.filter(m => m.country === 'South Korea' || m.genres?.map((g) => g.toLowerCase()).includes('k-drama'));
        } else {
           filtered = allMovies.filter(m => m.genres?.map((g) => g.toLowerCase()).includes(genreId.toLowerCase()));
        }
        
        setMovies(dedupeSeriesMovies(filtered));
      } catch (err) {
        console.error("Error fetching genre movies:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMovies();
  }, [genreId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-24 md:pb-12 pt-16 md:pt-28 px-4 md:px-12">
      
      {/* Desktop Header */}
      <header className="hidden md:flex absolute top-0 w-full z-50 justify-between items-center p-6 bg-gradient-to-b from-black/90 to-transparent left-0">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center justify-center p-1 w-64 hover:scale-105 transition-transform z-50">
             <img src="/logo2_perfect.png" alt="UG Movies 247" className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_2px_20px_rgba(217,4,41,0.9)]" />
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/" className="text-[#888888] hover:text-[#D90429] transition-colors">Home</Link>
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
        <Link href="/genres" className="text-white hover:text-[#D90429] transition-colors bg-[#1F2833] p-1.5 rounded-full flex items-center justify-center">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-black text-white uppercase tracking-wider">{genreId}</h1>
          <p className="text-[#D90429] text-[10px] font-bold uppercase tracking-widest">{movies.length} Vaulted Files</p>
        </div>
      </header>

      {/* Desktop Info */}
      <div className="hidden md:block mb-8">
        <h1 className="text-5xl font-black text-white uppercase tracking-widest mb-2 border-l-4 border-[#D90429] pl-6">{genreId}</h1>
        <p className="text-[#888888] pl-6 font-bold uppercase tracking-widest">{movies.length} Encrypted Files</p>
      </div>

      {/* Grid of Movies */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-6">
        {movies.map(movie => (
          <Link href={`/movie/${movie.id}`} key={movie.id} className="relative group bg-[#1F2833]/30 p-2 md:p-3 rounded-xl border border-transparent hover:border-white/10 transition-colors shadow-lg">
            <div className="aspect-[2/3] w-full rounded-lg bg-[#1F2833] overflow-hidden mb-3">
              <img src={movie.poster} alt={movie.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              {isSeriesMovie(movie) && (
                <div className="absolute top-3 right-3 bg-white/95 text-[#0B0C10] text-[7px] md:text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full z-10 shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
                  EPS
                </div>
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Play className="text-[#D90429] fill-[#D90429] drop-shadow-[0_0_15px_rgba(217,4,41,0.8)]" size={48} />
              </div>
            </div>
            <h3 className="text-white text-sm md:text-base font-bold leading-tight mb-1 truncate group-hover:text-[#D90429] transition-colors">{movie.title}</h3>
            <p className="text-[#D90429] text-[10px] md:text-xs font-black uppercase tracking-widest">{movie.vj && movie.vj !== 'Unknown' ? `VJ ${movie.vj}` : 'VJ HD'}</p>
          </Link>
        ))}
        {movies.length === 0 && (
          <div className="col-span-full text-center text-[#888888] mt-20 font-mono">
            NO ASSETS FOUND IN THIS GENRE.
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
        <Link href="/genres" className="flex flex-col items-center gap-1 text-[#D90429] w-16 transition-colors">
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
