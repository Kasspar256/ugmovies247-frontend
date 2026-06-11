'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, BellRing, CheckCheck, Clapperboard, RefreshCw } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import {
  fetchPublicMovies,
  PUBLIC_MOVIE_PAGE_LIMIT,
  readCachedPublicMovies,
} from '@/lib/publicMovies';
import {
  getLatestUploadedMovies,
  getMovieTimestamp,
  clearLatestUploadBadgeCount,
  markLatestUploadsAsSeen,
} from '@/lib/latestUploadNotifications';
import {
  fetchUserNotifications,
  formatNotificationTime,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  type UserNotification,
} from '@/lib/userNotifications';
import { isAppInReview } from '@/lib/appReview';
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
  const [appNotifications, setAppNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestMovies, setLatestMovies] = useState<Movie[]>(() =>
    getLatestUploadedMovies(readCachedPublicMovies())
  );
  const [loading, setLoading] = useState(() => latestMovies.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadNotifications = async () => {
    const payload = await fetchUserNotifications();
    setAppNotifications(payload.notifications);
    setUnreadCount(payload.unreadCount);
  };

  const loadLatestMovies = async (force = false) => {
    const movies = await fetchPublicMovies({
      force,
      refreshEntitlement: true,
      limit: PUBLIC_MOVIE_PAGE_LIMIT,
    });
    const latestUploads = getLatestUploadedMovies(movies);

    setLatestMovies(latestUploads);
    markLatestUploadsAsSeen(latestUploads);
    clearLatestUploadBadgeCount();
  };

  const refreshAll = async (force = false) => {
    try {
      if (force) {
        setRefreshing(true);
      }

      setError('');
      await Promise.all([loadNotifications(), loadLatestMovies(force)]);
    } catch (error) {
      console.error('[notifications] failed to load latest uploads', error);
      setError(error instanceof Error ? error.message : 'Notifications could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    markLatestUploadsAsSeen(latestMovies);
    clearLatestUploadBadgeCount();
    void refreshAll(true);
  }, []);

  const handleNotificationClick = async (notification: UserNotification) => {
    if (!notification.read) {
      setAppNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
      );
      setUnreadCount((current) => Math.max(0, current - 1));
      await markUserNotificationRead(notification.id).catch((markError) => {
        console.warn('[notifications] failed to mark notification read', markError);
      });
    }
  };

  const handleMarkAllRead = async () => {
    setAppNotifications((current) => current.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
    await markAllUserNotificationsRead().catch((markError) => {
      console.warn('[notifications] failed to mark all notifications read', markError);
      void loadNotifications();
    });
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-24 md:px-8 md:pb-14 md:pt-[118px] lg:px-10 font-sans">
      <MobilePageHeader title="Notifications" fallbackHref="/profile" />

      <div className="mt-2 max-w-3xl mx-auto w-full">
        <div className="flex items-center justify-between bg-[#1F2833]/40 p-4 rounded-xl border border-white/5 mb-6 shadow-lg">
           <div>
             <span className="text-sm font-bold text-white tracking-widest uppercase">Latest Upload Alerts</span>
             <p className="mt-1 text-xs text-[#888888]">
               Fresh movie and series uploads across the app appear here automatically.
             </p>
           </div>
           <button
             type="button"
             onClick={() => void refreshAll(true)}
             className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white transition-colors hover:border-[#D90429]/40 hover:text-[#D90429]"
             aria-label="Refresh latest uploads"
           >
             <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
           </button>
        </div>

        <section className="mb-6 rounded-xl border border-white/5 bg-[#1F2833]/28 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold uppercase tracking-widest text-white">
                App Inbox
              </div>
              <p className="mt-1 text-xs text-[#888888]">
                Admin alerts, account messages, and missed push notifications appear here.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[#D90429]/20 bg-[#D90429]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFB3C1]">
                {unreadCount} unread
              </span>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/70 transition-colors hover:border-white/25 hover:text-white"
                >
                  <CheckCheck size={14} />
                  Mark read
                </button>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {appNotifications.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/15 px-4 py-6 text-center text-sm text-[#888888]">
                No app notifications yet.
              </div>
            ) : (
              appNotifications.map((notification) => (
                <Link
                  key={notification.id}
                  href={notification.path || '/notifications'}
                  onClick={() => void handleNotificationClick(notification)}
                  className={`block rounded-xl border p-4 transition-colors ${
                    notification.read
                      ? 'border-white/5 bg-black/15 hover:border-white/15'
                      : 'border-[#D90429]/28 bg-[#D90429]/10 hover:border-[#D90429]/45'
                  }`}
                >
                  <div className="flex gap-4">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                        notification.read
                          ? 'border-white/10 bg-white/5 text-white/55'
                          : 'border-[#D90429]/25 bg-[#D90429]/12 text-[#FFB3C1]'
                      }`}
                    >
                      {notification.read ? <Bell size={18} /> : <BellRing size={18} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-black uppercase tracking-[0.1em] text-white">
                          {notification.title}
                        </h2>
                        {!notification.read ? (
                          <span className="rounded-full bg-[#D90429] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white">
                            New
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-white/66">{notification.body}</p>
                      <div className="mt-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
                        {formatNotificationTime(notification.createdAt)}
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="h-10 w-10 rounded-full border-4 border-[#1F2833] border-t-[#D90429] animate-spin" />
          </div>
        ) : latestMovies.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#1F2833]/20 px-4 py-8 text-center text-sm text-[#888888]">
            No uploaded movies or series have reached the app yet.
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
                      {index === 0
                        ? 'Newest Upload'
                        : movie.contentType === 'series'
                          ? 'Series Uploaded'
                          : 'Movie Uploaded'}
                    </h3>
                    <p className="text-white text-sm font-semibold line-clamp-2">
                      {movie.title}
                    </p>
                    <p className="mt-1 text-[#888888] text-xs leading-relaxed line-clamp-2">
                      {movie.vj && movie.vj !== 'Unknown'
                        ? `VJ ${movie.vj} uploaded this ${
                            movie.contentType === 'series' ? 'series' : 'title'
                          } to the app. Open it now and ${
                            isAppInReview ? 'watch the trailer.' : 'start watching.'
                          }`
                        : `A new ${
                            movie.contentType === 'series' ? 'series' : 'movie'
                          } was uploaded to the app. Open it now and ${
                            isAppInReview ? 'watch the trailer.' : 'start watching.'
                          }`}
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
