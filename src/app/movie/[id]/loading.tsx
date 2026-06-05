'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  PersistentPlaybackHost,
  usePlayback,
} from '@/components/player/PlaybackProvider';

const PENDING_MOVIE_NAVIGATION_KEY = 'ugmovies247.pending-movie-navigation.v1';

type PendingMovie = {
  id?: string;
  movieId?: string;
  title?: string;
  name?: string;
  poster?: string;
  backdrop?: string;
};

function SpinnerRing({ className = 'h-16 w-16' }: { className?: string }) {
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full ${className}`}
      aria-label="Opening player"
      role="status"
    >
      <span className="absolute inset-0 rounded-full bg-[#D90429]/18 blur-lg" />
      <span
        className="absolute inset-0 animate-spin rounded-full p-[3px] shadow-[0_0_22px_rgba(217,4,41,0.34)]"
        style={{
          background:
            'conic-gradient(from 300deg, #D90429 0deg 64deg, rgba(255,255,255,0.96) 64deg 360deg)',
        }}
      >
        <span className="block h-full w-full rounded-full bg-black" />
      </span>
    </span>
  );
}

function normalizeHref(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export default function MovieRouteLoading() {
  const { activeSource } = usePlayback();
  const [movie, setMovie] = useState<PendingMovie | null>(null);
  const [currentHref, setCurrentHref] = useState('');

  useEffect(() => {
    setCurrentHref(`${window.location.pathname}${window.location.search}`);

    try {
      const raw = window.sessionStorage.getItem(PENDING_MOVIE_NAVIGATION_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as { movie?: PendingMovie; cachedAt?: number };

      if (parsed.movie && (!parsed.cachedAt || Date.now() - parsed.cachedAt < 1000 * 60)) {
        setMovie(parsed.movie);
      }
    } catch {
      setMovie(null);
    }
  }, []);

  const isExpandingCurrentPlayback = useMemo(() => {
    if (!activeSource?.sourceUrl || !activeSource.watchHref || !currentHref) {
      return false;
    }

    return normalizeHref(activeSource.watchHref) === currentHref;
  }, [activeSource?.sourceUrl, activeSource?.watchHref, currentHref]);

  const title = activeSource?.title || movie?.title || movie?.name || 'UGMOVIES247';
  const artwork = activeSource?.poster || movie?.backdrop || movie?.poster || '';

  return (
    <main className="min-h-screen bg-[#0B0C10] pb-[calc(7.5rem+env(safe-area-inset-bottom))] text-white">
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {isExpandingCurrentPlayback ? (
          <PersistentPlaybackHost active className="h-full w-full" />
        ) : (
          <>
            {artwork ? (
              <>
                <img
                  src={artwork}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover opacity-28 blur-[1px]"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/38 via-black/68 to-black/88" />
              </>
            ) : null}
            <div className="absolute inset-0 flex items-center justify-center">
              <SpinnerRing />
            </div>
          </>
        )}
      </div>

      <section className="px-7 pt-8 text-center">
        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-white/46">
          Opening player
        </p>
        <h1 className="mx-auto mt-4 max-w-xl text-4xl font-black leading-tight tracking-[-0.05em] text-white">
          {title}
        </h1>
      </section>
    </main>
  );
}
