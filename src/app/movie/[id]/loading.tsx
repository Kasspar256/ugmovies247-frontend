'use client';

import { useEffect, useState } from 'react';

const PENDING_MOVIE_NAVIGATION_KEY = 'ugmovies247.pending-movie-navigation.v1';

type PendingMovie = {
  id?: string;
  title?: string;
  name?: string;
  poster?: string;
  backdrop?: string;
  contentType?: 'movie' | 'series';
  vj?: string;
  genres?: string[];
};

export default function MovieRouteLoading() {
  const [movie, setMovie] = useState<PendingMovie | null>(null);

  useEffect(() => {
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

  const title = movie?.title || movie?.name || 'UGMOVIES247';
  const artwork = movie?.backdrop || movie?.poster || '';

  return (
    <main className="min-h-screen bg-[#0B0C10] pb-[calc(7.5rem+env(safe-area-inset-bottom))] text-white">
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {artwork ? (
          <>
            <img
              src={artwork}
              alt={title}
              className="absolute inset-0 h-full w-full object-cover opacity-55 blur-[1px]"
            />
            <div className="absolute inset-0 bg-black/50" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[#080A0F]" />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/25 bg-[#D90429]/86 pl-1 shadow-[0_0_34px_rgba(217,4,41,0.42)]">
            <svg className="h-9 w-9 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 4l12 6-12 6z" />
            </svg>
          </div>
        </div>
      </div>

      <section className="px-7 pt-8 text-center">
        <h1 className="text-4xl font-black leading-tight tracking-[-0.05em] text-white">
          {title}
        </h1>
        <div className="mt-6 flex items-center justify-center gap-3 text-sm font-black text-white/72">
          <span>{movie?.genres?.[0] || (movie?.contentType === 'series' ? 'Series' : 'Movie')}</span>
          <span className="text-[#D90429]">{movie?.vj || 'UGMOVIES247'}</span>
        </div>
        <div className="mx-auto mt-8 h-14 max-w-xl rounded-[18px] border border-white/10 bg-[#1F2D42]/82 shadow-[0_18px_44px_rgba(0,0,0,0.34)]" />
        <div className="mx-auto mt-5 grid max-w-xl grid-cols-3 gap-3">
          <div className="h-14 rounded-[18px] border border-white/10 bg-white/[0.06]" />
          <div className="h-14 rounded-[18px] border border-white/10 bg-white/[0.06]" />
          <div className="h-14 rounded-[18px] border border-white/10 bg-white/[0.06]" />
        </div>
      </section>
    </main>
  );
}
