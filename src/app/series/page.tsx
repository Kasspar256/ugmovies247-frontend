'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Film, Play, Search as SearchIcon, Tv2 } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import type { Movie } from '@/types/movie';
import { getOptimizedArtworkUrl } from '@/lib/artwork';

function getAllSeries(catalog: Movie[]) {
  return dedupeSeriesMovies(catalog).filter((movie) => isSeriesMovie(movie));
}

function getSeriesMeta(movie: Movie) {
  const seasonCount = movie.seasons?.length || 0;
  const episodeCount =
    movie.seasons?.reduce((total, season) => total + season.episodes.length, 0) || 0;

  if (seasonCount > 0 && episodeCount > 0) {
    return `${seasonCount} season${seasonCount === 1 ? '' : 's'} - ${episodeCount} episode${episodeCount === 1 ? '' : 's'}`;
  }

  if (episodeCount > 0) {
    return `${episodeCount} episode${episodeCount === 1 ? '' : 's'}`;
  }

  if (seasonCount > 0) {
    return `${seasonCount} season${seasonCount === 1 ? '' : 's'}`;
  }

  return movie.genres?.[0] || 'Series';
}

export default function SeriesDirectoryPage() {
  const [allSeries, setAllSeries] = useState<Movie[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cachedSeries = getAllSeries(readCachedPublicMovies());

    if (cachedSeries.length) {
      setAllSeries(cachedSeries);
      setLoading(false);
    }

    const loadSeries = async () => {
      try {
        const movies = await fetchPublicMovies();
        setAllSeries(getAllSeries(movies));
      } catch (error) {
        console.error('[series-page] failed to load series catalog', error);
      } finally {
        setLoading(false);
      }
    };

    void loadSeries();
  }, []);

  const filteredSeries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return allSeries;
    }

    return allSeries.filter((series) => {
      const haystack = [
        series.title,
        series.original_title,
        series.name,
        series.vj,
        ...(series.genres || []),
      ]
        .map((entry) => String(entry || '').toLowerCase())
        .filter(Boolean);

      return haystack.some((entry) => entry.includes(normalizedQuery));
    });
  }, [allSeries, query]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] pt-16 md:px-8 md:pb-14 md:pt-[118px] lg:px-10 font-sans text-white">
      <MobilePageHeader
        title="Series"
        subtitle="All series in the app"
        fallbackHref="/profile"
        actionHref="/search"
        actionIcon={<SearchIcon size={18} />}
        actionAriaLabel="Search the catalog"
      />

      <main className="mx-auto mt-4 max-w-[1380px] px-4 sm:px-5 md:mt-0 md:px-0">
        <header className="hidden md:block">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-4xl font-black uppercase tracking-[0.18em] text-white">
                Series
              </h1>
              <p className="mt-3 text-sm text-white/55">
                Browse every series currently available across the app catalog.
              </p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-[#11141C]/80 px-5 py-4 text-right shadow-[0_14px_30px_rgba(0,0,0,0.28)]">
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/42">
                Total Series
              </div>
              <div className="mt-2 text-3xl font-black text-white">{allSeries.length}</div>
            </div>
          </div>
          <div className="mt-6 h-px w-full bg-white/8" />
        </header>

        <section className="mt-4 md:mt-8">
          <div className="rounded-[20px] border border-white/8 bg-[#0B0F15] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.28)] md:p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3 text-sm text-white/52">
                <Tv2 size={18} className="text-[#D90429]" />
                <span className="font-medium">
                  {filteredSeries.length} series
                  {filteredSeries.length === 1 ? '' : ' entries'}
                </span>
              </div>

              <div className="relative w-full md:max-w-[380px]">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-white/38">
                  <SearchIcon size={17} />
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search series"
                  aria-label="Search series"
                  className="w-full rounded-[16px] border border-white/8 bg-white/[0.02] py-3 pl-11 pr-4 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-white/14 focus:bg-white/[0.03]"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 pb-20 md:mt-6">
          {!filteredSeries.length ? (
            <div className="flex min-h-[260px] items-center justify-center rounded-[20px] border border-dashed border-white/10 bg-[#0A0E14] px-6 text-center">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.02em] text-white">
                  No series found
                </h2>
                <p className="mt-2 text-sm text-white/48">
                  Try a different search, or add more series in the admin panel.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:gap-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {filteredSeries.map((series, index) => (
                <Link
                  href={`/movie/${series.id}`}
                  key={series.id}
                  className="group block"
                >
                  <article className="overflow-hidden rounded-[16px] border border-white/8 bg-[#0A0E14] shadow-[0_12px_26px_rgba(0,0,0,0.24)] transition-colors duration-200 hover:border-white/14 hover:bg-white/[0.035]">
                    <div className="relative aspect-[2/3] overflow-hidden bg-[#12161F]">
                      <img
                        src={getOptimizedArtworkUrl(series.poster, 'card')}
                        alt={series.title}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading={index < 6 ? 'eager' : 'lazy'}
                        decoding="async"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#05070B] via-black/15 to-transparent" />
                      <div className="absolute left-2 top-2 rounded-full border border-white/15 bg-black/45 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-white/85 md:left-3 md:top-3 md:px-2 md:py-1 md:text-[10px]">
                        Series
                      </div>
                      <div className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/35 text-white/80 transition-transform duration-200 group-hover:scale-105 group-hover:text-white md:right-3 md:top-3 md:h-10 md:w-10">
                        <Play size={14} className="fill-current ml-0.5 md:h-4 md:w-4" />
                      </div>
                    </div>

                    <div className="p-2.5 md:p-3">
                      <h2 className="line-clamp-2 text-[11px] font-bold leading-tight tracking-[-0.02em] text-white transition-colors group-hover:text-[#FFB3C1] md:text-[14px]">
                        {series.title}
                      </h2>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-white/45 md:gap-2 md:text-[11px] md:tracking-[0.16em]">
                        <span className="rounded-full border border-[#D90429]/30 bg-[#D90429]/10 px-1.5 py-0.5 font-black text-[#FFB3C1] md:px-2.5 md:py-1">
                          {series.vj && series.vj !== 'Unknown' ? `VJ ${series.vj}` : 'VJ HD'}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 font-black text-white/65 md:px-2.5 md:py-1">
                          {series.releaseYear || series.release_date?.slice(0, 4) || 'Series'}
                        </span>
                      </div>

                      <div className="mt-2 hidden items-center gap-1.5 text-[11px] text-white/58 md:flex">
                        <Film size={14} className="text-white/32" />
                        <span>{getSeriesMeta(series)}</span>
                      </div>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
