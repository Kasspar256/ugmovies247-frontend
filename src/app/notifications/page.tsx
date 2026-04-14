'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRing, Clapperboard, RefreshCw } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import {
  getLatestUploadedMovies,
  getMovieTimestamp,
  markLatestUploadsAsSeen,
} from '@/lib/latestUploadNotifications';
import type { Movie } from '@/types/movie';

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

export default function NotificationsPage() {
  const [latestMovies, setLatestMovies] = useState<Movie[]>(() =>
    getLatestUploadedMovies(readCachedPublicMovies())
  );
  const [loading, setLoading] = useState(() => latestMovies.length === 0);
  const [refreshing, setRefreshing] = useState(false);

  const loadLatestMovies = async (force = false) => {
    try {
      if (force) {
        setRefreshing(true);
      }

      const movies = await fetchPublicMovies({ force, refreshEntitlement: true });
      const latestUploads = getLatestUploadedMovies(movies);

      setLatestMovies(latestUploads);
      markLatestUploadsAsSeen(latestUploads);
    } catch (error) {
      console.error('[notifications] failed to load latest uploads', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    markLatestUploadsAsSeen(latestMovies);
    void loadLatestMovies(true);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-24 pt-24 md:px-8 md:pb-14 md:pt-[118px] lg:px-10 font-sans">
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
             className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white transition-colors hover:border-[#D90429]/40 hover:text-[#D90429]"
             aria-label="Refresh latest uploads"
           >
             <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
           </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="h-10 w-10 rounded-full border-4 border-[#1F2833] border-t-[#D90429] animate-spin" />
          </div>
        ) : latestMovies.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#1F2833]/20 px-4 py-8 text-center text-sm text-[#888888]">
            No uploaded movies have reached the app yet.
          </div>
        ) : (
          <div className="space-y-4">
            {latestMovies.map((movie, index) => (
              <Link
                key={movie.id}
                href={`/movie/${movie.id}`}
                className={`block rounded-xl border p-4 transition-colors backdrop-blur ${
                  index === 0
                    ? 'bg-[#1F2833]/34 border-[#D90429]/30 hover:bg-[#1F2833]/60'
                    : 'bg-[#1F2833]/20 border-white/5 hover:bg-[#1F2833]/50'
                }`}
              >
                <div className="flex gap-4 items-start">
                  <div
                    className={`h-14 w-11 overflow-hidden rounded-lg border flex-shrink-0 mt-1 ${
                      index === 0
                        ? 'border-[#D90429]/30 bg-black'
                        : 'border-white/5 bg-black'
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
                        {index === 0 ? (
                          <BellRing className="text-[#D90429]" size={20} />
                        ) : (
                          <Clapperboard className="text-[#888888]" size={20} />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-white font-bold text-sm mb-1 uppercase tracking-wider line-clamp-2">
                      {index === 0 ? 'Newest Upload' : 'Movie Uploaded'}
                    </h3>
                    <p className="text-white text-sm font-semibold line-clamp-2">
                      {movie.title}
                    </p>
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
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
