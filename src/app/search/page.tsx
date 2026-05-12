'use client';

import { type FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  Film,
  Search as SearchIcon,
  X,
} from 'lucide-react';
import { type Movie } from '@/types/movie';
import { dedupeSeriesMovies, isSeriesMovie } from '@/lib/moviePresentation';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import { getOptimizedArtworkUrl } from '@/lib/artwork';
import { GENRE_DIRECTORY, VJ_DIRECTORY } from '@/config/constants';

const FILTER_ALL = '__all__';
const PAGE_SIZE = 72;

type FilterKind = 'vj' | 'genre';

function cleanOption(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripVjPrefix(value?: string | null) {
  return cleanOption(value).replace(/^vj\s+/i, '');
}

function formatVjOption(value?: string | null) {
  const vjName = stripVjPrefix(value);
  return vjName ? `VJ ${vjName}` : '';
}

function normalizeVjForMatch(value: string) {
  return normalizeForSearch(stripVjPrefix(value));
}

function getMovieGenres(movie: Movie) {
  return Array.from(
    new Set([...(movie.genres || []), ...(movie.category || [])].map(cleanOption).filter(Boolean))
  );
}

function getVjName(movie: Movie) {
  const vj = stripVjPrefix(movie.vj);
  return vj && vj.toLowerCase() !== 'unknown' ? vj : '';
}

function getVjLabel(movie: Movie) {
  const vj = getVjName(movie);
  return vj ? `VJ ${vj}` : 'VJ HD';
}

function matchesSelectedValue(value: string, selectedValue: string) {
  return normalizeForSearch(value) === normalizeForSearch(selectedValue);
}

function matchesSelectedVj(value: string, selectedValue: string) {
  return normalizeVjForMatch(value) === normalizeVjForMatch(selectedValue);
}

function uniqueOptionsInOrder(values: string[]) {
  const seen = new Set<string>();
  const options: string[] = [];

  values.forEach((value) => {
    const option = cleanOption(value);
    const key = normalizeForSearch(option);

    if (!option || seen.has(key)) {
      return;
    }

    seen.add(key);
    options.push(option);
  });

  return options;
}

function findMatchingVjOption(query: string, options: string[]) {
  const search = normalizeForSearch(query);
  const searchVj = normalizeVjForMatch(query);

  if (searchVj.length < 2) {
    return '';
  }

  return (
    options.find((option) => {
      const optionVj = normalizeVjForMatch(option);

      if (!optionVj) {
        return false;
      }

      if (optionVj.length <= 2) {
        return searchVj === optionVj || search.includes(optionVj);
      }

      return (
        optionVj === searchVj ||
        optionVj.startsWith(searchVj) ||
        searchVj.includes(optionVj) ||
        search.includes(optionVj)
      );
    }) || ''
  );
}

function findMatchingGenreOption(query: string, options: string[]) {
  const search = normalizeForSearch(query);

  if (search.length < 3) {
    return '';
  }

  return (
    options.find((option) => {
      const genre = normalizeForSearch(option);

      return genre === search || genre.startsWith(search) || search.includes(genre);
    }) || ''
  );
}

function buildNoMoviesMessage({
  hasQuery,
  selectedVj,
  selectedGenre,
}: {
  hasQuery: boolean;
  selectedVj: string;
  selectedGenre: string;
}) {
  if (selectedVj !== FILTER_ALL && selectedGenre !== FILTER_ALL) {
    return 'No movies found for the selected VJ and Genre.';
  }

  if (selectedVj !== FILTER_ALL) {
    return 'No movies found for the selected VJ.';
  }

  if (selectedGenre !== FILTER_ALL) {
    return 'No movies found for the selected Genre.';
  }

  return hasQuery ? 'No movies found for your search.' : 'No movies found right now.';
}

function FilterDropdown({
  kind,
  label,
  value,
  options,
  isOpen,
  onToggle,
  onSelect,
}: {
  kind: FilterKind;
  label: string;
  value: string;
  options: string[];
  isOpen: boolean;
  onToggle: (kind: FilterKind) => void;
  onSelect: (value: string) => void;
}) {
  const selectedLabel = value === FILTER_ALL ? 'All' : value;

  return (
    <div className="relative min-w-0 flex-1 md:max-w-[260px]" data-search-filter-menu>
      <button
        type="button"
        onClick={() => onToggle(kind)}
        aria-expanded={isOpen}
        className="group flex h-11 w-full items-center justify-between gap-3 rounded-full border border-white/20 bg-white/[0.08] px-4 text-left shadow-[0_14px_32px_rgba(0,0,0,0.22)] backdrop-blur-lg transition-all duration-300 hover:border-cyan-200/40 hover:bg-white/[0.12] md:h-12 md:px-5"
      >
        <span className="min-w-0">
          <span className="block text-[9px] font-black uppercase tracking-[0.24em] text-cyan-100/60">
            {label}
          </span>
          <span className="block truncate text-[12px] font-black uppercase tracking-[0.12em] text-white md:text-sm">
            {selectedLabel}
          </span>
        </span>
        <ChevronDown
          size={17}
          className={`shrink-0 text-white/70 transition-transform duration-300 ${
            isOpen ? 'rotate-180 text-cyan-100' : 'group-hover:text-white'
          }`}
        />
      </button>

      <div
        className={`absolute left-0 top-[calc(100%+0.6rem)] z-[80] w-full overflow-hidden rounded-3xl border border-white/20 bg-[#09101D]/95 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl transition-all duration-300 md:w-[min(34rem,calc(100vw-5rem))] ${
          isOpen
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-2 opacity-0'
        }`}
      >
        <div className="grid max-h-72 gap-1 overflow-y-auto p-2 [scrollbar-color:rgba(125,211,252,0.55)_rgba(255,255,255,0.08)] [scrollbar-width:thin] md:max-h-[22rem] md:grid-cols-2">
          <button
            type="button"
            onClick={() => onSelect(FILTER_ALL)}
            className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-[12px] font-black uppercase tracking-[0.14em] transition-colors md:col-span-2 ${
              value === FILTER_ALL
                ? 'bg-white text-[#07101C]'
                : 'text-white/80 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            All
          </button>

          {options.map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => onSelect(option)}
              className={`mt-1 flex w-full items-center rounded-2xl px-4 py-3 text-left text-[12px] font-bold transition-colors ${
                value === option
                  ? 'bg-cyan-300/95 text-[#07101C]'
                  : 'text-white/75 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <span className="truncate">{option}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchMovieCard({ movie, priority }: { movie: Movie; priority: boolean }) {
  return (
    <Link
      href={`/movie/${movie.id}`}
      className="group min-w-0"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-[14px] border border-white/8 bg-[#11141C] shadow-[0_10px_22px_rgba(0,0,0,0.32)] md:rounded-[17px]">
        {movie.poster ? (
          <img
            src={getOptimizedArtworkUrl(movie.poster, 'card')}
            alt={movie.title}
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
          <span className="block truncate">{getVjLabel(movie)}</span>
        </div>

        {isSeriesMovie(movie) && (
          <div className="absolute right-1.5 top-1.5 z-10 rounded-full bg-white/95 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-widest text-[#0B0C10] shadow-[0_4px_12px_rgba(0,0,0,0.35)] md:right-2 md:top-2 md:text-[9px]">
            EPS
          </div>
        )}
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
          {movie.title}
        </h3>
      </div>
    </Link>
  );
}

function SearchSkeletonGrid() {
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

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [selectedVj, setSelectedVj] = useState(FILTER_ALL);
  const [selectedGenre, setSelectedGenre] = useState(FILTER_ALL);
  const [openFilter, setOpenFilter] = useState<FilterKind | null>(null);
  const [allMovies, setAllMovies] = useState<Movie[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const cachedMovies = dedupeSeriesMovies(readCachedPublicMovies());

    if (cachedMovies.length) {
      setAllMovies(cachedMovies);
      setLoading(false);
    }

    const fetchMovies = async () => {
      try {
        const data = dedupeSeriesMovies(await fetchPublicMovies({ force: true }));
        setAllMovies(data);
        setLoadError('');
      } catch (err) {
        console.error('Error fetching movies for search:', err);
        setLoadError('We could not refresh the catalog. Showing any cached movies available.');
      } finally {
        setLoading(false);
      }
    };

    void fetchMovies();
  }, []);

  useEffect(() => {
    if (!openFilter) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-search-filter-menu]')) {
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

  const vjOptions = useMemo(
    () =>
      uniqueOptionsInOrder([
        ...VJ_DIRECTORY.map((vj) => formatVjOption(vj.name)),
        ...allMovies.map((movie) => formatVjOption(getVjName(movie))),
      ]),
    [allMovies]
  );

  const genreOptions = useMemo(
    () =>
      uniqueOptionsInOrder([...GENRE_DIRECTORY, ...allMovies.flatMap(getMovieGenres)]),
    [allMovies]
  );

  useEffect(() => {
    if (selectedVj !== FILTER_ALL && !vjOptions.includes(selectedVj)) {
      setSelectedVj(FILTER_ALL);
    }
  }, [selectedVj, vjOptions]);

  useEffect(() => {
    if (selectedGenre !== FILTER_ALL && !genreOptions.includes(selectedGenre)) {
      setSelectedGenre(FILTER_ALL);
    }
  }, [selectedGenre, genreOptions]);

  const queryInferredVj = useMemo(
    () => findMatchingVjOption(deferredQuery, vjOptions),
    [deferredQuery, vjOptions]
  );
  const queryInferredGenre = useMemo(
    () => findMatchingGenreOption(deferredQuery, genreOptions),
    [deferredQuery, genreOptions]
  );

  const activeVj = selectedVj !== FILTER_ALL ? selectedVj : queryInferredVj || FILTER_ALL;
  const activeGenre =
    selectedGenre !== FILTER_ALL ? selectedGenre : queryInferredGenre || FILTER_ALL;

  const filteredMovies = useMemo(() => {
    const searchTerm = normalizeForSearch(deferredQuery);
    const shouldUseTextSearch = Boolean(searchTerm && !queryInferredVj && !queryInferredGenre);

    return allMovies.filter((movie) => {
      const matchesText =
        !shouldUseTextSearch ||
        [
          movie.title,
          movie.name,
          movie.original_title,
          movie.description,
          movie.overview,
          getVjLabel(movie),
          ...getMovieGenres(movie),
          ...(movie.tags || []),
        ]
          .filter(Boolean)
          .some((value) => normalizeForSearch(String(value)).includes(searchTerm));

      const matchesVj =
        activeVj === FILTER_ALL || matchesSelectedVj(getVjName(movie), activeVj);
      const matchesGenre =
        activeGenre === FILTER_ALL ||
        getMovieGenres(movie).some((genre) => matchesSelectedValue(genre, activeGenre));

      return matchesText && matchesVj && matchesGenre;
    });
  }, [activeGenre, activeVj, allMovies, deferredQuery, queryInferredGenre, queryInferredVj]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeGenre, activeVj, deferredQuery]);

  useEffect(() => {
    const node = loadMoreRef.current;

    if (!node || visibleCount >= filteredMovies.length) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((currentCount) =>
            Math.min(currentCount + PAGE_SIZE, filteredMovies.length)
          );
        }
      },
      {
        rootMargin: '700px 0px',
      }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [filteredMovies.length, visibleCount]);

  const visibleMovies = filteredMovies.slice(0, visibleCount);
  const hasActiveFilters =
    query.trim().length > 0 || selectedVj !== FILTER_ALL || selectedGenre !== FILTER_ALL;
  const isFilteringPending = query !== deferredQuery;
  const noMoviesMessage = buildNoMoviesMessage({
    hasQuery: query.trim().length > 0,
    selectedVj: activeVj,
    selectedGenre: activeGenre,
  });

  const handleToggleFilter = (kind: FilterKind) => {
    setOpenFilter((current) => (current === kind ? null : kind));
  };

  const handleSelectVj = (value: string) => {
    setSelectedVj(value);
    setOpenFilter(null);
  };

  const handleSelectGenre = (value: string) => {
    setSelectedGenre(value);
    setOpenFilter(null);
  };

  const handleClearFilters = () => {
    setQuery('');
    setSelectedVj(FILTER_ALL);
    setSelectedGenre(FILTER_ALL);
    setOpenFilter(null);
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextVj = findMatchingVjOption(query, vjOptions);
    const nextGenre = findMatchingGenreOption(query, genreOptions);

    if (nextVj) {
      setSelectedVj(nextVj);
    }

    if (nextGenre) {
      setSelectedGenre(nextGenre);
    }

    setVisibleCount(PAGE_SIZE);
    setOpenFilter(null);

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#060912] pb-[calc(8rem+env(safe-area-inset-bottom))] text-white md:pb-16">
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

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-16%] top-[-12%] h-[24rem] w-[24rem] rounded-full bg-cyan-400/10 blur-[90px]" />
        <div className="absolute right-[-18%] top-[10%] h-[26rem] w-[26rem] rounded-full bg-indigo-500/10 blur-[100px]" />
        <div className="absolute bottom-[-14%] left-[20%] h-[22rem] w-[22rem] rounded-full bg-amber-300/10 blur-[100px]" />
      </div>
      <section className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#060912]/80 px-4 pb-4 pt-4 shadow-[0_16px_45px_rgba(0,0,0,0.28)] backdrop-blur-2xl md:static md:border-b-0 md:bg-transparent md:px-8 md:pb-2 md:pt-[118px] md:shadow-none lg:px-10">
        <div className="mx-auto max-w-[1380px]">
          <div className="flex items-center gap-3 md:hidden">
            <Link
              href="/browse"
              className="flex h-[46px] w-[68px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.08] shadow-[0_14px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl"
              aria-label="Go home"
            >
              <img
                src="/logow.png"
                alt="UG Movies 247"
                className="h-14 w-14 translate-y-2 scale-125 object-cover"
              />
            </Link>

            <form
              onSubmit={handleSearchSubmit}
              role="search"
              className="relative flex flex-1 items-center rounded-[26px] border border-white/10 bg-white/[0.08] px-2 py-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-all focus-within:border-cyan-200/40 focus-within:bg-white/[0.11]"
            >
              <div className="flex-shrink-0 pl-2 text-white/60">
                <SearchIcon size={18} />
              </div>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
                autoCorrect="off"
                enterKeyHint="search"
                inputMode="search"
                spellCheck={false}
                placeholder="Search movies, VJs, genres..."
                className="w-full bg-transparent py-2 pl-3 pr-[5.8rem] text-[16px] font-semibold leading-6 text-white outline-none placeholder:text-white/40"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-[5.25rem] flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-white/70 transition-colors hover:bg-white/[0.14] hover:text-white"
                  aria-label="Clear search"
                  type="button"
                >
                  <X size={16} />
                </button>
              )}
              <Link
                href="/search/ai-chat"
                className="ai-mode-button absolute right-2 flex h-8 min-w-[4.35rem] items-center justify-center overflow-hidden rounded-full p-[1px] text-[10px] font-black uppercase tracking-[0.16em] text-white"
                aria-label="Ask AI"
              >
                <span className="relative z-10 flex h-full w-full items-center justify-center rounded-full bg-[#0B0F18]/95 px-3 text-white shadow-[inset_0_0_18px_rgba(255,255,255,0.05)]">
                  Ask AI
                </span>
              </Link>
            </form>
          </div>

          <div className="hidden md:block">
            <form onSubmit={handleSearchSubmit} role="search" className="relative">
              <SearchIcon
                className="absolute left-6 top-1/2 -translate-y-1/2 text-white/50"
                size={26}
              />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
                autoCorrect="off"
                enterKeyHint="search"
                inputMode="search"
                spellCheck={false}
                placeholder="Search movies, VJs, genres, dubs, or movie ideas..."
                className="w-full rounded-full border border-white/10 bg-white/[0.08] py-5 pl-16 pr-40 text-[16px] font-semibold leading-7 text-white shadow-[0_18px_55px_rgba(0,0,0,0.32)] outline-none backdrop-blur-2xl transition-all placeholder:text-white/40 focus:border-cyan-200/40 focus:bg-white/[0.11] md:text-lg"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-[7.8rem] top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/[0.08] text-white/70 transition-colors hover:bg-white/[0.14] hover:text-white"
                  aria-label="Clear search"
                  type="button"
                >
                  <X size={19} />
                </button>
              )}
              <Link
                href="/search/ai-chat"
                className="ai-mode-button absolute right-5 top-1/2 flex h-11 min-w-[6.1rem] -translate-y-1/2 items-center justify-center overflow-hidden rounded-full p-[1px] text-xs font-black uppercase tracking-[0.18em] text-white"
                aria-label="Ask AI"
              >
                <span className="relative z-10 flex h-full w-full items-center justify-center rounded-full bg-[#0B0F18]/95 px-4 text-white shadow-[inset_0_0_18px_rgba(255,255,255,0.05)]">
                  Ask AI
                </span>
              </Link>
            </form>
          </div>

          <div className="mt-3 flex items-center gap-2.5 md:mt-5 md:gap-3">
            <FilterDropdown
              kind="vj"
              label="VJ"
              value={selectedVj}
              options={vjOptions}
              isOpen={openFilter === 'vj'}
              onToggle={handleToggleFilter}
              onSelect={handleSelectVj}
            />
            <FilterDropdown
              kind="genre"
              label="Genre"
              value={selectedGenre}
              options={genreOptions}
              isOpen={openFilter === 'genre'}
              onToggle={handleToggleFilter}
              onSelect={handleSelectGenre}
            />
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="hidden h-12 shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-5 text-[11px] font-black uppercase tracking-[0.18em] text-white/60 backdrop-blur-lg transition-colors hover:bg-white/[0.12] hover:text-white md:block"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto mt-5 max-w-[1380px] px-4 md:mt-8 md:px-8 lg:px-10">
        <div className="mb-4 flex items-center justify-between gap-4 md:mb-6">
          <div className="text-[10px] font-black uppercase tracking-[0.26em] text-cyan-100/50">
            {isFilteringPending ? 'Searching...' : hasActiveFilters ? 'Filtered movies' : 'All movies'}
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-2 text-[9px] font-black uppercase tracking-[0.16em] text-white/70 backdrop-blur-lg transition-colors hover:bg-white/[0.12] hover:text-white md:hidden"
            >
              Reset
            </button>
          )}
        </div>

        {loadError && (
          <div className="mb-4 rounded-3xl border border-amber-200/20 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100 backdrop-blur-xl">
            {loadError}
          </div>
        )}

        {loading && !allMovies.length ? (
          <SearchSkeletonGrid />
        ) : filteredMovies.length === 0 ? (
          <div className="rounded-[32px] border border-white/10 bg-white/[0.06] p-7 text-center shadow-[0_20px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl md:p-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-cyan-100">
              <Film size={28} />
            </div>
            <h3 className="mx-auto mt-5 max-w-xl break-words text-lg font-extrabold leading-7 text-white md:text-xl md:font-black md:leading-8">
              {noMoviesMessage}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-white/60">
              Try a different VJ, genre, or movie name. The full movie grid returns as soon as you reset the filters.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-x-6 gap-y-6 sm:grid-cols-4 md:grid-cols-5 md:gap-x-7 md:gap-y-8 2xl:grid-cols-6">
              {visibleMovies.map((movie, index) => (
                <SearchMovieCard key={movie.id} movie={movie} priority={index < 18} />
              ))}
            </div>

            {visibleCount < filteredMovies.length ? (
              <div ref={loadMoreRef} className="flex justify-center py-8">
                <div className="rounded-full border border-white/10 bg-white/[0.06] px-5 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/50 backdrop-blur-xl">
                  Loading more movies
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-[10px] font-black uppercase tracking-[0.22em] text-white/30">
                End of catalog
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
