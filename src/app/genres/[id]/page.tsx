'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Play, Film } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import MobilePageHeader from '@/components/MobilePageHeader';

function getGenreMovies(genreId: string, allMovies: Movie[]) {
  if (genreId.toLowerCase() === 'indian') {
    return allMovies.filter(
      (movie) =>
        movie.country === 'India' ||
        movie.genres?.map((genre) => genre.toLowerCase()).includes('indian')
    );
  }

  if (genreId.toLowerCase() === 'k-drama' || genreId.toLowerCase() === 'k drama') {
    return allMovies.filter(
      (movie) =>
        movie.country === 'South Korea' ||
        movie.genres?.map((genre) => genre.toLowerCase()).includes('k-drama')
    );
  }

  return allMovies.filter((movie) =>
    movie.genres?.map((genre) => genre.toLowerCase()).includes(genreId.toLowerCase())
  );
}

export default function GenreDetail({ params }: { params: { id: string } }) {
  const genreId = decodeURIComponent(params.id);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cachedMovies = dedupeSeriesMovies(getGenreMovies(genreId, readCachedPublicMovies()));

    if (cachedMovies.length) {
      setMovies(cachedMovies);
      setLoading(false);
    }

    const fetchMovies = async () => {
      try {
        const allMovies = await fetchPublicMovies();

        setMovies(dedupeSeriesMovies(getGenreMovies(genreId, allMovies)));
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
    <div className="min-h-screen bg-[#0B0C10] pb-24 md:px-8 md:pb-14 md:pt-[118px] lg:px-10">

      <MobilePageHeader
        title={genreId}
        subtitle={`${movies.length} Vaulted Files`}
        fallbackHref="/genres"
      />

      {/* Desktop Info */}
      <div className="hidden md:block mb-8 max-w-[1380px] mx-auto">
        <h1 className="text-5xl font-black text-white uppercase tracking-widest mb-2 border-l-4 border-[#D90429] pl-6">{genreId}</h1>
        <p className="text-[#888888] pl-6 font-bold uppercase tracking-widest">{movies.length} Encrypted Files</p>
      </div>

      {/* Grid of Movies */}
      <div className="grid max-w-[1380px] mx-auto grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-6">
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
    </div>
  );
}
