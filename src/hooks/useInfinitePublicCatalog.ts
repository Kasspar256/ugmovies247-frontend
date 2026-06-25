'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { type Movie } from '@/types/movie';
import {
  fetchPublicMoviePage,
  PUBLIC_MOVIE_BOOTSTRAP_LIMIT,
  readCachedPublicMovies,
} from '@/lib/publicMovies';
import { usePublicMovieCatalogUpdates } from '@/hooks/usePublicMovieCatalogUpdates';

type UseInfinitePublicCatalogOptions<TItem> = {
  initialMovies?: Movie[];
  pageSize?: number;
  logLabel: string;
  selectItems: (catalog: Movie[]) => TItem[];
};

type UseInfinitePublicCatalogResult<TItem> = {
  catalog: Movie[];
  items: TItem[];
  loading: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  loadError: string;
  sentinelRef: MutableRefObject<HTMLDivElement | null>;
  loadNextPage: () => void;
};

function mergeCatalogAppend(existingMovies: Movie[], incomingMovies: Movie[]) {
  if (!incomingMovies.length) {
    return existingMovies;
  }

  const nextMovies = [...existingMovies];
  const indexById = new Map<string, number>();

  nextMovies.forEach((movie, index) => {
    indexById.set(movie.id, index);

    if (movie.movieId) {
      indexById.set(movie.movieId, index);
    }
  });

  incomingMovies.forEach((movie) => {
    const knownIndex = indexById.get(movie.id) ?? (movie.movieId ? indexById.get(movie.movieId) : undefined);

    if (typeof knownIndex === 'number') {
      nextMovies[knownIndex] = {
        ...nextMovies[knownIndex],
        ...movie,
      };
      return;
    }

    indexById.set(movie.id, nextMovies.length);

    if (movie.movieId) {
      indexById.set(movie.movieId, nextMovies.length);
    }

    nextMovies.push(movie);
  });

  return nextMovies;
}

export function useInfinitePublicCatalog<TItem>({
  initialMovies = [],
  pageSize = 25,
  logLabel,
  selectItems,
}: UseInfinitePublicCatalogOptions<TItem>): UseInfinitePublicCatalogResult<TItem> {
  const normalizedPageSize = Math.max(1, Math.min(240, Math.floor(pageSize || PUBLIC_MOVIE_BOOTSTRAP_LIMIT)));
  const [catalog, setCatalog] = useState<Movie[]>(() => initialMovies);
  const [loading, setLoading] = useState(() => initialMovies.length === 0);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState('');
  const catalogRef = useRef<Movie[]>(initialMovies);
  const cursorRef = useRef('');
  const hasMoreRef = useRef(true);
  const isFetchingRef = useRef(false);
  const hasFetchedFirstPageRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const appendCatalog = useCallback(
    (incomingMovies: Movie[], reason: 'INITIAL' | 'APPEND') => {
      setCatalog((currentCatalog) => {
        const nextCatalog = mergeCatalogAppend(currentCatalog, incomingMovies);

        catalogRef.current = nextCatalog;

        if (incomingMovies.length) {
          console.info(`[CatalogPagination] ${reason} ${logLabel}`, {
            received: incomingMovies.length,
            before: currentCatalog.length,
            after: nextCatalog.length,
          });
        }

        return nextCatalog;
      });
    },
    [logLabel]
  );

  usePublicMovieCatalogUpdates((updatedCatalog) => {
    appendCatalog(updatedCatalog, 'APPEND');
  });

  const loadPage = useCallback(
    async (mode: 'initial' | 'next') => {
      if (isFetchingRef.current) {
        return;
      }

      if (mode === 'next' && !hasMoreRef.current) {
        return;
      }

      isFetchingRef.current = true;
      setIsFetchingMore(mode === 'next');

      try {
        const page = await fetchPublicMoviePage({
          limit: normalizedPageSize,
          cursor: mode === 'next' ? cursorRef.current : '',
          force: mode === 'initial' && catalogRef.current.length === 0,
        });

        appendCatalog(page.movies, mode === 'initial' ? 'INITIAL' : 'APPEND');
        cursorRef.current = page.nextCursor;
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
        setLoadError('');
      } catch (error) {
        console.error(`[CatalogPagination] failed ${logLabel}`, error);
        setLoadError('We could not load more titles right now. Showing the titles already available.');
      } finally {
        hasFetchedFirstPageRef.current = true;
        isFetchingRef.current = false;
        setIsFetchingMore(false);
        setLoading(false);
      }
    },
    [appendCatalog, logLabel, normalizedPageSize]
  );

  const loadNextPage = useCallback(() => {
    void loadPage(hasFetchedFirstPageRef.current ? 'next' : 'initial');
  }, [loadPage]);

  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  useEffect(() => {
    const cachedMovies = readCachedPublicMovies();

    if (cachedMovies.length) {
      appendCatalog(cachedMovies, 'APPEND');
      setLoading(false);
    }

    void loadPage('initial');
  }, [appendCatalog, loadPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel || typeof window === 'undefined') {
      return;
    }

    const BrowserIntersectionObserver = window.IntersectionObserver;

    if (typeof BrowserIntersectionObserver === 'function') {
      const observer = new BrowserIntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            loadNextPage();
          }
        },
        {
          root: null,
          rootMargin: '900px 0px',
          threshold: 0.01,
        }
      );

      observer.observe(sentinel);

      return () => observer.disconnect();
    }

    const handleScroll = () => {
      const scrollBottom = window.scrollY + window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight || document.body.scrollHeight;

      if (documentHeight - scrollBottom < 900) {
        loadNextPage();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [catalog.length, loadNextPage]);

  const items = useMemo(() => selectItems(catalog), [catalog, selectItems]);

  return {
    catalog,
    items,
    loading,
    isFetchingMore,
    hasMore,
    loadError,
    sentinelRef,
    loadNextPage,
  };
}
