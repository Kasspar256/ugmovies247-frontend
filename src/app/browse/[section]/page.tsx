'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import MobilePageHeader from '@/components/MobilePageHeader';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import {
  DEFAULT_HOME_PAGE_CATEGORIES,
  getHomeCollectionByKey,
  type HomePageCategoryRecord,
} from '@/lib/homeRows';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import type { Movie } from '@/types/movie';

function getMovieVjLabel(movie: Movie) {
  return movie.vj && movie.vj !== 'Unknown' ? `VJ ${movie.vj}` : 'VJ HD';
}

export default function BrowseSectionPage() {
  const params = useParams<{ section: string }>();
  const sectionKey = Array.isArray(params.section) ? params.section[0] : params.section;
  const [movies, setMovies] = useState<Movie[]>(() => dedupeSeriesMovies(readCachedPublicMovies()));
  const [categories, setCategories] = useState<HomePageCategoryRecord[]>(DEFAULT_HOME_PAGE_CATEGORIES);
  const [loading, setLoading] = useState(() => movies.length === 0);

  useEffect(() => {
    let mounted = true;

    const loadSectionData = async () => {
      try {
        const shouldRefreshEntitlement = readCachedPublicMovies().length === 0;
        const [nextMovies, categoryResponse] = await Promise.all([
          fetchPublicMovies({ refreshEntitlement: shouldRefreshEntitlement }),
          fetch('/api/categories/home', {
            cache: 'no-store',
          }).catch(() => null),
        ]);

        if (!mounted) {
          return;
        }

        setMovies(dedupeSeriesMovies(nextMovies));

        if (categoryResponse?.ok) {
          const payload = (await categoryResponse.json().catch(() => ({}))) as {
            categories?: HomePageCategoryRecord[];
          };

          if (Array.isArray(payload.categories) && payload.categories.length) {
            setCategories(payload.categories);
          }
        }
      } catch (error) {
        console.error('[browse] failed to load section', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadSectionData();

    return () => {
      mounted = false;
    };
  }, []);

  const collection = sectionKey
    ? getHomeCollectionByKey({
        movies,
        homePageCategories: categories,
        sectionKey,
      })
    : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center">
        <div className="h-12 w-12 rounded-full border-4 border-[#1F2833] border-t-[#D90429] animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-16 text-white md:px-8 md:pb-16 md:pt-[118px] lg:px-10">
      <MobilePageHeader title={collection?.title || 'Browse'} fallbackHref="/browse" />

      <div className="mx-auto max-w-6xl">
        <div className="hidden md:block">
          <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/40">
            Browse
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">
            {collection?.title || 'Section not found'}
          </h1>
        </div>

        {!collection ? (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-[#11141C]/75 p-6 text-sm text-white/65 shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
            This section could not be found. Head back to the home page and choose another row.
          </div>
        ) : !collection.movies.length ? (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-[#11141C]/75 p-6 text-sm text-white/65 shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
            No titles are available in this section right now.
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-[28px] border border-white/10 bg-[#11141C]/75 px-5 py-4 text-sm text-white/60 shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
              {collection.movies.length} title{collection.movies.length === 1 ? '' : 's'}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {collection.movies.map((movie) => (
                <Link
                  href={`/movie/${movie.id}`}
                  key={movie.id}
                  className="group overflow-hidden rounded-[22px] border border-white/8 bg-[#11141C] transition-colors hover:border-[#D90429]/35"
                >
                  <div className="relative aspect-[2/3] overflow-hidden bg-[#1F2833]">
                    <img
                      src={movie.poster || 'https://via.placeholder.com/300x450/1F2833/888888?text=NO+POSTER'}
                      alt={movie.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                    {isSeriesMovie(movie) && (
                      <span className="absolute right-2 top-2 rounded-full border border-white/20 bg-black/70 px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-white">
                        Series
                      </span>
                    )}
                  </div>

                  <div className="p-3">
                    <div className="text-sm font-semibold leading-6 text-white line-clamp-2">
                      {movie.title}
                    </div>
                    <div className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#D90429]">
                      {getMovieVjLabel(movie)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
