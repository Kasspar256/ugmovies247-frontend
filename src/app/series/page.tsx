'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search as SearchIcon } from 'lucide-react';
import CatalogFilterDropdown from '@/components/catalog/CatalogFilterDropdown';
import MobilePageHeader from '@/components/MobilePageHeader';
import { getOptimizedArtworkUrl } from '@/lib/artwork';
import { dedupeSeriesMovies } from '@/lib/moviePresentation';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import {
  CATALOG_FILTER_ALL,
  buildCatalogEmptyMessage,
  buildCatalogGenreOptions,
  buildCatalogVjOptions,
  filterCatalogBySelection,
  getCatalogVjLabel,
  type CatalogFilterKind,
} from '@/lib/catalogFilters';
import type { Movie } from '@/types/movie';

const PAGE_TITLE = 'Series';

function AiModeStyles() {
  return (
    <style jsx global>{`
      @keyframes ai-border-orbit {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      @keyframes ai-border-pulse {
        0%,
        100% {
          box-shadow:
            0 0 16px rgba(85, 140, 255, 0.28),
            0 0 24px rgba(236, 72, 153, 0.18);
        }
        50% {
          box-shadow:
            0 0 22px rgba(147, 51, 234, 0.36),
            0 0 34px rgba(59, 130, 246, 0.28),
            0 0 38px rgba(236, 72, 153, 0.22);
        }
      }

      .ai-mode-button::before {
        content: '';
        position: absolute;
        inset: -80%;
        background: conic-gradient(
          from 0deg,
          #8b5cf6,
          #38bdf8,
          #60a5fa,
          #ec4899,
          #f472b6,
          #8b5cf6
        );
        animation: ai-border-orbit 4.5s linear infinite;
      }

      .ai-mode-button {
        animation: ai-border-pulse 2.8s ease-in-out infinite;
      }
    `}</style>
  );
}

function AskAiButton({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/search/ai-chat"
      className={`ai-mode-button relative flex items-center justify-center overflow-hidden rounded-full p-[1px] font-black uppercase text-white ${
        compact
          ? 'h-8 min-w-[4.35rem] text-[10px] tracking-[0.16em]'
          : 'h-11 min-w-[6.1rem] text-xs tracking-[0.18em]'
      }`}
      aria-label="Ask AI"
    >
      <span
        className={`relative z-10 flex h-full w-full items-center justify-center rounded-full bg-[#0B0F18]/95 text-white shadow-[inset_0_0_18px_rgba(255,255,255,0.05)] ${
          compact ? 'px-3' : 'px-4'
        }`}
      >
        Ask AI
      </span>
    </Link>
  );
}

function getAllSeries(catalog: Movie[]) {
  return dedupeSeriesMovies(catalog).filter((movie) => movie.contentType === 'series');
}

function CatalogSkeletonGrid() {
  return (
    <div className="grid grid-cols-3 gap-x-6 gap-y-6 sm:grid-cols-4 md:grid-cols-5 md:gap-x-7 md:gap-y-8 2xl:grid-cols-6">
      {Array.from({ length: 24 }).map((_, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          className="min-w-0"
        >
          <div className="aspect-[2/3] animate-pulse rounded-[14px] border border-white/8 bg-white/[0.08] md:rounded-[17px]" />
          <div className="mt-3 h-3 w-4/5 animate-pulse rounded-full bg-white/[0.08]" />
        </div>
      ))}
    </div>
  );
}

function SeriesCard({ series, priority }: { series: Movie; priority: boolean }) {
  return (
    <Link href={`/movie/${series.id}`} className="group min-w-0">
      <div className="relative aspect-[2/3] overflow-hidden rounded-[14px] border border-white/8 bg-[#11141C] shadow-[0_10px_22px_rgba(0,0,0,0.32)] md:rounded-[17px]">
        {series.poster ? (
          <img
            src={getOptimizedArtworkUrl(series.poster, 'card')}
            alt={series.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#111827]">
            <img
              src="/logow.png"
              alt=""
              aria-hidden="true"
              className="h-14 w-14 scale-[1.8] object-contain opacity-70"
            />
          </div>
        )}

        <div className="absolute left-0 top-0 z-10 max-w-[76%] rounded-br-lg bg-[#D90429] px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-[0.1em] text-white shadow-[2px_2px_10px_rgba(0,0,0,0.5)] md:text-[9px]">
          <span className="block truncate">{getCatalogVjLabel(series)}</span>
        </div>
      </div>

      <div className="pt-2">
        <h3
          className="line-clamp-2 min-h-[2rem] overflow-hidden text-[11px] font-black leading-[1.15] text-white transition-colors group-hover:text-[#FFB3C1] md:min-h-[2.45rem] md:text-sm md:leading-tight"
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
          }}
        >
          {series.title}
        </h3>
      </div>
    </Link>
  );
}

export default function SeriesDirectoryPage() {
  const [series, setSeries] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedVj, setSelectedVj] = useState(CATALOG_FILTER_ALL);
  const [selectedGenre, setSelectedGenre] = useState(CATALOG_FILTER_ALL);
  const [openFilter, setOpenFilter] = useState<CatalogFilterKind | null>(null);

  useEffect(() => {
    const cachedSeries = getAllSeries(readCachedPublicMovies());

    if (cachedSeries.length) {
      setSeries(cachedSeries);
      setLoading(false);
    }

    const loadSeries = async () => {
      try {
        const catalog = await fetchPublicMovies({ force: true });
        setSeries(getAllSeries(catalog));
        setLoadError('');
      } catch (error) {
        console.error('[series-page] failed to load series catalog', error);
        setLoadError('We could not refresh the series right now. Showing any cached series available.');
      } finally {
        setLoading(false);
      }
    };

    void loadSeries();
  }, []);

  useEffect(() => {
    if (!openFilter || typeof window === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-catalog-filter-menu]')) {
        return;
      }

      setOpenFilter(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenFilter(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openFilter]);

  const vjOptions = useMemo(() => buildCatalogVjOptions(series), [series]);
  const genreOptions = useMemo(() => buildCatalogGenreOptions(series), [series]);
  const filteredSeries = useMemo(
    () => filterCatalogBySelection(series, selectedVj, selectedGenre),
    [selectedGenre, selectedVj, series]
  );
  const hasActiveFilters =
    selectedVj !== CATALOG_FILTER_ALL || selectedGenre !== CATALOG_FILTER_ALL;
  const emptyMessage = buildCatalogEmptyMessage('series', selectedVj, selectedGenre);

  useEffect(() => {
    if (selectedVj !== CATALOG_FILTER_ALL && !vjOptions.includes(selectedVj)) {
      setSelectedVj(CATALOG_FILTER_ALL);
    }
  }, [selectedVj, vjOptions]);

  useEffect(() => {
    if (selectedGenre !== CATALOG_FILTER_ALL && !genreOptions.includes(selectedGenre)) {
      setSelectedGenre(CATALOG_FILTER_ALL);
    }
  }, [selectedGenre, genreOptions]);

  const handleToggleFilter = (kind: CatalogFilterKind) => {
    setOpenFilter((current) => (current === kind ? null : kind));
  };

  const handleResetFilters = () => {
    setSelectedVj(CATALOG_FILTER_ALL);
    setSelectedGenre(CATALOG_FILTER_ALL);
    setOpenFilter(null);
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#060912] pb-[calc(8rem+env(safe-area-inset-bottom))] text-white md:pb-16">
      <AiModeStyles />

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-16%] top-[-12%] h-[24rem] w-[24rem] rounded-full bg-cyan-400/10 blur-[90px]" />
        <div className="absolute right-[-18%] top-[10%] h-[26rem] w-[26rem] rounded-full bg-indigo-500/10 blur-[100px]" />
        <div className="absolute bottom-[-14%] left-[20%] h-[22rem] w-[22rem] rounded-full bg-amber-300/10 blur-[100px]" />
      </div>

      <MobilePageHeader
        title={PAGE_TITLE}
        subtitle="Browse series only"
        fallbackHref="/browse"
        actionHref="/search"
        actionIcon={<SearchIcon size={18} />}
        actionAriaLabel="Search the catalog"
        inlineAction={<AskAiButton compact />}
      />

      <section className="relative z-10 mx-auto max-w-[1380px] px-4 pt-20 md:px-8 md:pt-[118px] lg:px-10">
        <header className="mb-6 hidden items-start justify-between gap-6 md:flex">
          <div>
            <h1 className="text-4xl font-black uppercase tracking-[0.18em] text-white">
              Series
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/55">
              Browse your favorite series. Standalone movies stay in the Movies section.
            </p>
          </div>
          <AskAiButton />
        </header>

        {loadError && (
          <div className="mb-4 rounded-3xl border border-amber-200/20 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100 backdrop-blur-xl">
            {loadError}
          </div>
        )}

        <div className="relative z-40 mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 gap-3">
            <CatalogFilterDropdown
              kind="vj"
              label="VJ"
              value={selectedVj}
              options={vjOptions}
              isOpen={openFilter === 'vj'}
              onToggle={handleToggleFilter}
              onSelect={(value) => {
                setSelectedVj(value);
                setOpenFilter(null);
              }}
            />
            <CatalogFilterDropdown
              kind="genre"
              label="Genre"
              value={selectedGenre}
              options={genreOptions}
              isOpen={openFilter === 'genre'}
              onToggle={handleToggleFilter}
              onSelect={(value) => {
                setSelectedGenre(value);
                setOpenFilter(null);
              }}
            />
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="self-start rounded-full border border-white/[0.14] bg-white/[0.07] px-5 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-white/75 shadow-[0_12px_30px_rgba(0,0,0,0.22)] backdrop-blur-lg transition-all hover:border-white/[0.24] hover:bg-white/[0.1] hover:text-white sm:self-center"
            >
              Reset
            </button>
          )}
        </div>

        {loading && !series.length ? (
          <CatalogSkeletonGrid />
        ) : filteredSeries.length === 0 ? (
          <div className="rounded-[32px] border border-white/10 bg-white/[0.06] p-7 text-center shadow-[0_20px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl md:p-12">
            <h2 className="text-lg font-black text-white md:text-xl">
              {emptyMessage}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-white/60">
              {hasActiveFilters
                ? 'Try another VJ or genre, or reset the filters to return to all series.'
                : 'Series will appear here as soon as they are available.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-6 gap-y-6 sm:grid-cols-4 md:grid-cols-5 md:gap-x-7 md:gap-y-8 2xl:grid-cols-6">
            {filteredSeries.map((item, index) => (
              <SeriesCard key={item.id} series={item} priority={index < 18} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

