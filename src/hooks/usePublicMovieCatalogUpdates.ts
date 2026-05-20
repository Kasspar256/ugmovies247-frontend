'use client';

import { useEffect, useRef } from 'react';
import {
  readCachedPublicMovies,
  subscribePublicMovieUpdates,
} from '@/lib/publicMovies';
import type { Movie } from '@/types/movie';

export function usePublicMovieCatalogUpdates(onUpdate: (movies: Movie[]) => void) {
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => subscribePublicMovieUpdates(() => {
    onUpdateRef.current(readCachedPublicMovies());
  }), []);
}
