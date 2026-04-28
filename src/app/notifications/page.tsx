'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRing, Clapperboard, RefreshCw, Trash2 } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import {
  getLatestUploadedMovies,
  getMovieTimestamp,
  markLatestUploadsAsSeen,
} from '@/lib/latestUploadNotifications';
import type { Movie } from '@/types/movie';

const DISMISSED_NOTIFICATIONS_KEY = 'ugmovies247:dismissed-upload-notifications';

function getNotificationId(movie: Movie) {
  return `latest-upload:${movie.id}`;
}

function readDismissedNotificationIds() {
  if (typeof window === 'undefined') {
    return new Set<string>();
  }

  try {
    const raw = window.localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(parsed.filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

function writeDismissedNotificationIds(ids: Set<string>) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(Array.from(ids).slice(-200)));
}

function filterDismissedNotifications(movies: Movie[], dismissedIds: Set<string>) {
  return movies.filter((movie) => !dismissedIds.has(getNotificationId(movie)));
}

function getRelativeTimeLabel(movie: Movie) {
  const timestamp = getMovieTimestamp(movie);

  if (!timestamp) {
    return 'Just added';
  }

  const diffMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function NotificationCard({
  movie,
  index,
  onDismiss,
}: {
  movie: Movie;
  index: number;
  onDismiss: (movie: Movie) => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const isNewest = index === 0;

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-center bg-red-600/90">
        <button
          type="button"
          onClick={() => onDismiss(movie)}
          className="flex h-full w-full items-center justify-center text-white transition active:scale-90 active:opacity-75"
          aria-label={`Delete ${movie.title} notification`}
        >
          <Trash2 size={20} />
        </button>
      </div>

      <Link
        href={`/movie/${movie.id}`}
        onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)}
        onTouchMove={(event) => {
          if (touchStartX === null) {
            return;
          }

          const currentX = event.touches[0]?.clientX ?? touchStartX;
          const nextDragX = Math.min(0, Math.max(-96, currentX - touchStartX));
          setDragX(nextDragX);
        }}
        onTouchEnd={() => {
          if (dragX <= -72) {
            onDismiss(movie);
          }

          setDragX(0);
          setTouchStartX(null);
        }}
        style={{ transform: `translateX(${dragX}px)` }}
        className={`block rounded-xl border p-4 backdrop-blur transition-all duration-150 active:scale-[0.99] active:opacity-85 ${
          isNewest
            ? 'bg-[#1F2833] border-[#D90429]/30 hover:bg-[#1F2833]/80'
            : 'bg-[#1F2833] border-white/5 hover:bg-[#1F2833]/80'
        }`}
      >
        <div className="flex gap-4 items-start">
          <div
            className={`h-14 w-11 overflow-hidden rounded-lg border flex-shrink-0 mt-1 ${
              isNewest ? 'border-[#D90429]/30 bg-black' : 'border-white/5 bg-black'
            }`}
          >
            {movie.poster ? (
              <img
                src={movie.poster}
                alt={movie.title}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                {isNewest ? (
                  <BellRing className="text-[#D90429]" size={20} />
                ) : (
                  <Clapperboard className="text-[#888888]" size={20} />
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-white font-bold text-sm mb-1 uppercase tracking-wider line-clamp-2">
                  {isNewest ? 'Newest Upload' : 'Movie Uploaded'}
                </h3>
                <p className="text-white text-sm font-semibold line-clamp-2">
                  {movie.title}
                </p>
              </div>

              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDismiss(movie);
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-400/20 bg-red-500/10 text-red-100 transition active:scale-90 active:opacity-75"
                aria-label={`Delete ${movie.title} notification`}
              >
                <Trash2 size={15} />
              </button>
            </div>

            <p className="mt-1 text-[#888888] text-xs leading-relaxed line-clamp-2">
              {movie.vj && movie.vj !== 'Unknown'
                ? `VJ ${movie.vj} uploaded this title to the app. Open it now and start watching.`
                : 'A new movie was uploaded to the app. Open it now and start watching.'}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[#D90429] text-[10px] font-black uppercase tracking-widest bg-[#D90429]/10 w-max px-2 py-0.5 rounded border border-[#D90429]/20">
                {getRelativeTimeLabel(movie)}
              </span>
              {movie.vj && movie.vj !== 'Unknown' && (
                <span className="text-[#888888] text-[10px] font-black uppercase tracking-widest bg-black/40 w-max px-2 py-0.5 rounded border border-white/5">
                  VJ {movie.vj}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

export default function NotificationsPage() {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readDismissedNotificationIds());
  const [latestMovies, setLatestMovies] = useState<Movie[]>(() =>
    filterDismissedNotifications(getLatestUploadedMovies(readCachedPublicMovies()), readDismissedNotificationIds())
  );
  const [loading, setLoading] = useState(() => latestMovies.length === 0);
  const [refreshing, setRefreshing] = useState(false);

  const loadLatestMovies = async (force = false, nextDismissedIds = dismissedIds) => {
    try {
      if (force) {
        setRefreshing(true);
      }

      const movies = await fetchPublicMovies({ force, refreshEntitlement: true });
      const latestUploads = filterDismissedNotifications(getLatestUploadedMovies(movies), nextDismissedIds);

      setLatestMovies(latestUploads);
      markLatestUploadsAsSeen(latestUploads);
    } catch (error) {
      console.error('[notifications] failed to load latest uploads', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const dismissNotification = (movie: Movie) => {
    const nextDismissedIds = new Set(dismissedIds);
    nextDismissedIds.add(getNotificationId(movie));
    setDismissedIds(nextDismissedIds);
    writeDismissedNotificationIds(nextDismissedIds);
    setLatestMovies((current) => current.filter((item) => item.id !== movie.id));
  };

  useEffect(() => {
    markLatestUploadsAsSeen(latestMovies);
    void loadLatestMovies(true);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] pt-24 md:px-8 md:pb-14 md:pt-[118px] lg:px-10 font-sans">
      <MobilePageHeader title="Notifications" fallbackHref="/profile" />

      <div className="mt-2 max-w-3xl mx-auto w-full">
        <div className="flex items-center justify-between bg-[#1F2833]/40 p-4 rounded-xl border border-white/5 mb-6 shadow-lg">
           <div>
             <span className="text-sm font-bold text-white tracking-widest uppercase">Latest Upload Alerts</span>
             <p className="mt-1 text-xs text-[#888888]">
               Fresh movie uploads across the app appear here automatically.
             </p>
           </div>
           <button
             type="button"
             onClick={() => void loadLatestMovies(true)}
             className="inline-flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white transition-all duration-150 hover:border-[#D90429]/40 hover:text-[#D90429] active:scale-90 active:opacity-75"
             aria-label="Refresh latest uploads"
           >
             <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
           </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="animate-pulse rounded-xl border border-white/5 bg-[#1F2833]/25 p-4">
                <div className="flex gap-4">
                  <div className="h-14 w-11 rounded-lg bg-white/10" />
                  <div className="flex-1 space-y-3">
                    <div className="h-3 w-28 rounded-full bg-white/10" />
                    <div className="h-4 w-4/5 rounded-full bg-white/10" />
                    <div className="h-3 w-full rounded-full bg-white/8" />
                    <div className="h-3 w-2/3 rounded-full bg-white/8" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : latestMovies.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#1F2833]/20 px-4 py-8 text-center text-sm text-[#888888]">
            No uploaded movies have reached the app yet.
          </div>
        ) : (
          <div className="space-y-4">
            {latestMovies.map((movie, index) => (
              <NotificationCard
                key={movie.id}
                movie={movie}
                index={index}
                onDismiss={dismissNotification}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
