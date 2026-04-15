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
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 md:pt-[118px] lg:px-10">
      <MobilePageHeader
        title={vjInfo.name}
        subtitle={`${movies.length} Dubbed Movies`}
        fallbackHref="/vjs"
      />

      <div className="hidden md:flex mx-auto w-full max-w-[1380px] items-center gap-4">
        <Link href="/vjs" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1F2833]/70 text-white transition-colors hover:bg-[#D90429]">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-[0.18em] text-white">{vjInfo.name}</h1>
          <p className="mt-1 text-[11px] font-black uppercase tracking-[0.26em] text-[#D90429]">{movies.length} Dubbed Movies</p>
        </div>
      </div>

      {/* Grid of Movies */}
      <div className="mx-auto mt-4 grid max-w-[1380px] grid-cols-3 gap-3 p-4 md:grid-cols-4 md:gap-5 md:px-0">
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
