'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { VJ_DIRECTORY } from '@/config/constants';
import { ArrowLeft, Play } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import MobilePageHeader from '@/components/MobilePageHeader';

function getMoviesForVj(vjName: string, allMovies: Movie[]) {
  const searchTarget = vjName.replace('VJ ', '').trim().toLowerCase();

  return allMovies.filter((movie) => {
    if (!movie.vj) {
      return false;
    }

    const normalizedVj = movie.vj.toLowerCase();
    return normalizedVj.includes(searchTarget) || searchTarget.includes(normalizedVj);
  });
}

export default function VJDetail({ params }: { params: { id: string } }) {
  const vjId = params.id;
  const vjInfo = VJ_DIRECTORY.find(v => v.id === vjId) || { name: 'Unknown VJ' };
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cachedMovies = dedupeSeriesMovies(getMoviesForVj(vjInfo.name, readCachedPublicMovies()));

    if (cachedMovies.length) {
      setMovies(cachedMovies);
      setLoading(false);
    }

    const fetchMovies = async () => {
      try {
        const allMovies = await fetchPublicMovies();

        setMovies(dedupeSeriesMovies(getMoviesForVj(vjInfo.name, allMovies)));
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
      <MobilePageHeader
        title={vjInfo.name}
        subtitle={`${movies.length} Dubbed Movies`}
        fallbackHref="/vjs"
      />

      <header className="hidden md:flex fixed top-0 left-0 w-full z-40 items-center gap-4 border-b border-[#1F2833] bg-[#0B0C10]/95 p-4 shadow-xl backdrop-blur-md">
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
    </div>
  );
}
