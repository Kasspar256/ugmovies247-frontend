'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import { usePublicMovieCatalogUpdates } from '@/hooks/usePublicMovieCatalogUpdates';
import MobilePageHeader from '@/components/MobilePageHeader';
import VirtualizedCatalogGrid from '@/components/catalog/VirtualizedCatalogGrid';
import { getOptimizedArtworkUrl } from '@/lib/artwork';
import { ensureReviewMinimumMovies } from '@/lib/reviewCatalogFill';
import { isAppInReview } from '@/lib/appReview';
import { hasMatureExclusiveCategory, MATURE_EXCLUSIVES_CATEGORY } from '@/lib/matureContent';
import { isIndianCatalogMovie } from '@/lib/regionalCatalog';

function getGenreMovies(genreId: string, allMovies: Movie[]) {
  const isMatureGenre = genreId.toLowerCase() === MATURE_EXCLUSIVES_CATEGORY.toLowerCase();
  const availableMovies = isMatureGenre
    ? allMovies.filter((movie) => hasMatureExclusiveCategory(movie.category || []))
    : allMovies.filter((movie) => !hasMatureExclusiveCategory(movie.category || []));

  if (isMatureGenre) {
    return availableMovies;
  }

  if (genreId.toLowerCase() === 'indian') {
    return availableMovies.filter((movie) => isIndianCatalogMovie(movie));
  }

  if (genreId.toLowerCase() === 'k-drama' || genreId.toLowerCase() === 'k drama') {
    return availableMovies.filter(
      (movie) =>
        movie.country === 'South Korea' ||
        movie.genres?.map((genre) => genre.toLowerCase()).includes('k-drama')
    );
  }

  return availableMovies.filter((movie) =>
    movie.genres?.map((genre) => genre.toLowerCase()).includes(genreId.toLowerCase())
  );
}

function getGenreIntro(genreId: string, count: number) {
  const normalizedGenre = genreId.replace(/[-_]+/g, ' ').trim();
  const readableGenre = normalizedGenre || 'movie';
  if (isAppInReview) {
    return `Discover ${count} ${readableGenre} trailer picks on UGMOVIES247, including VJ catalog entries, movie details, and discovery lists selected for Uganda and East Africa.`;
  }

  return `Watch ${count} ${readableGenre} titles on UGMOVIES247, including Ugandan movies, Luganda translated movies, VJ translated movies, and online entertainment selected for Uganda and East Africa.`;
}

export default function GenreClientPage({
  params,
  initialMovies = [],
}: {
  params: { id: string };
  initialMovies?: Movie[];
}) {
  const genreId = decodeURIComponent(params.id);
  const serverGenreMovies = useMemo(
    () =>
      ensureReviewMinimumMovies(
        `genre:${genreId}`,
        getGenreMovies(genreId, initialMovies),
        initialMovies
      ),
    [genreId, initialMovies]
  );
  const [movies, setMovies] = useState<Movie[]>(serverGenreMovies);
  const [loading, setLoading] = useState(serverGenreMovies.length === 0);

  usePublicMovieCatalogUpdates((catalog) => {
    setMovies(
      ensureReviewMinimumMovies(
        `genre:${genreId}`,
        getGenreMovies(genreId, catalog),
        catalog
      )
    );
  });

  useEffect(() => {
    const cachedCatalog = readCachedPublicMovies();
    const cachedMovies = ensureReviewMinimumMovies(
      `genre:${genreId}`,
      getGenreMovies(genreId, cachedCatalog),
      cachedCatalog
    );

    if (cachedMovies.length) {
      setMovies(cachedMovies);
      setLoading(false);
    } else if (serverGenreMovies.length) {
      setMovies(serverGenreMovies);
      setLoading(false);
    }

    const fetchMovies = async () => {
      try {
        const allMovies = await fetchPublicMovies();

        setMovies(
          ensureReviewMinimumMovies(
            `genre:${genreId}`,
            getGenreMovies(genreId, allMovies),
            allMovies
          )
        );
      } catch (err) {
        console.error("Error fetching genre movies:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMovies();
  }, [genreId, serverGenreMovies]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </div>
    );
  }

  const genreIntro = getGenreIntro(genreId, movies.length);

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 md:pt-[118px] lg:px-10">

      <MobilePageHeader
        title={genreId}
        subtitle={isAppInReview ? `${movies.length} Trailer Picks` : `${movies.length} Vaulted Files`}
        fallbackHref="/genres"
      />
      <p className="mx-4 mt-3 text-sm leading-6 text-white/64 md:hidden">
        {genreIntro}
      </p>

      {/* Desktop Info */}
      <div className="hidden md:block mb-8 max-w-[1380px] mx-auto">
        <h1 className="text-5xl font-black text-white uppercase tracking-widest mb-2 border-l-4 border-[#D90429] pl-6">{genreId}</h1>
        <p className="text-[#888888] pl-6 font-bold uppercase tracking-widest">
          {isAppInReview ? `${movies.length} Trailer Picks` : `${movies.length} Encrypted Files`}
        </p>
        <p className="mt-4 max-w-3xl pl-6 text-sm leading-7 text-white/62">
          {genreIntro}
        </p>
      </div>

      {/* Grid of Movies */}
      <div className="max-w-[1380px] mx-auto mt-6">
        <VirtualizedCatalogGrid
          items={movies}
          getKey={(movie) => movie.id}
          columns={{ base: 2, md: 4, lg: 5 }}
          rowHeight={{ base: 342, md: 382, lg: 392 }}
          rowClassName="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5"
          renderItem={(movie, index) => (
            <Link href={`/movie/${movie.id}`} className="relative group bg-[#1F2833]/30 p-2 md:p-3 rounded-xl border border-transparent hover:border-white/10 transition-colors shadow-lg block">
              <div className="aspect-[2/3] w-full rounded-lg bg-[#1F2833] overflow-hidden mb-3 relative">
                <img
                  src={getOptimizedArtworkUrl(movie.poster, 'card')}
                  alt={`${isAppInReview ? 'Discover' : 'Watch'} ${movie.title} on UGMOVIES247`}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  loading={index < 6 ? 'eager' : 'lazy'}
                  decoding="async"
                />
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
          )}
        />
        {movies.length === 0 && (
          <div className="col-span-full text-center text-[#888888] mt-20 font-mono">
            NO ASSETS FOUND IN THIS GENRE.
          </div>
        )}
      </div>
    </div>
  );
}
