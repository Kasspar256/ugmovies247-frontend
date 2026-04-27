'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, BellRing, CheckCheck, Clapperboard, RefreshCw } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import {
  getLatestUploadedMovies,
  getMovieTimestamp,
  markLatestUploadsAsSeen,
} from '@/lib/latestUploadNotifications';
import {
  fetchUserNotifications,
  formatNotificationTime,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  type UserNotification,
} from '@/lib/userNotifications';
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadNotifications = async () => {
    const payload = await fetchUserNotifications();
    setAppNotifications(payload.notifications);
    setUnreadCount(payload.unreadCount);
  };

  const loadLatestMovies = async (force = false) => {
    const movies = await fetchPublicMovies({ force, refreshEntitlement: true });
    const latestUploads = getLatestUploadedMovies(movies);

    setLatestMovies(latestUploads);
    markLatestUploadsAsSeen(latestUploads);
  };

  const refreshAll = async (force = false) => {
    try {
      if (force) {
        setRefreshing(true);
      }

      setError('');
      await Promise.all([loadNotifications(), loadLatestMovies(force)]);
    } catch (refreshError) {
      console.error('[notifications] failed to refresh notifications', refreshError);
      setError(refreshError instanceof Error ? refreshError.message : 'Notifications could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    markLatestUploadsAsSeen(latestMovies);
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
    <div className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-20 text-white md:px-8 md:pb-14 md:pt-[118px] lg:px-10">
      <MobilePageHeader title="Notifications" fallbackHref="/profile" />

      <div className="mx-auto mt-2 w-full max-w-3xl space-y-5">
        <section className="rounded-[28px] border border-white/10 bg-[#11141C]/82 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.32)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                App Inbox
              </div>
              <h1 className="mt-2 text-2xl font-black tracking-[-0.03em] text-white">
                Notifications
              </h1>
              <p className="mt-2 text-sm leading-6 text-white/55">
                Movie alerts, account messages, and app updates appear here.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshAll(true)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white transition-colors hover:border-[#D90429]/40 hover:text-[#D90429]"
              aria-label="Refresh notifications"
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full border border-[#D90429]/20 bg-[#D90429]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#FFB3C1]">
              {unreadCount} unread
            </span>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/70 transition-colors hover:border-white/25 hover:text-white"
              >
                <CheckCheck size={14} />
                Mark all read
              </button>
            ) : null}
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1F2833] border-t-[#D90429]" />
          </div>
        ) : (
          <>
            <section className="space-y-3">
              {appNotifications.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-[#1F2833]/20 px-4 py-8 text-center text-sm text-white/50">
                  No app notifications yet.
                </div>
              ) : (
                appNotifications.map((notification) => (
                  <Link
                    key={notification.id}
                    href={`/notifications/${notification.id}`}
                    onClick={() => void handleNotificationClick(notification)}
                    className={`block rounded-[24px] border p-4 transition-colors ${
                      notification.read
                        ? 'border-white/8 bg-[#11141C]/62 hover:border-white/16'
                        : 'border-[#D90429]/28 bg-[#D90429]/10 hover:border-[#D90429]/45'
                    }`}
                  >
                    <div className="flex gap-4">
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
                          notification.read
                            ? 'border-white/10 bg-white/5 text-white/55'
                            : 'border-[#D90429]/25 bg-[#D90429]/12 text-[#FFB3C1]'
                        }`}
                      >
                        {notification.read ? <Bell size={18} /> : <BellRing size={18} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white">
                            {notification.title}
                          </h2>
                          {!notification.read ? (
                            <span className="rounded-full bg-[#D90429] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-white">
                              New
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-white/66">{notification.body.length > 150 ? `${notification.body.slice(0, 150)}...` : notification.body}</p>
                        <div className="mt-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                          {formatNotificationTime(notification.createdAt)}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between rounded-[22px] border border-white/8 bg-[#1F2833]/30 px-4 py-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                    Latest Upload Alerts
                  </div>
                  <p className="mt-1 text-xs text-white/45">Fresh movie uploads across the app.</p>
                </div>
              </div>

              {latestMovies.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-[#1F2833]/20 px-4 py-8 text-center text-sm text-white/50">
                  No uploaded movies have reached the app yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {latestMovies.map((movie, index) => (
                    <Link
                      key={movie.id}
                      href={`/movie/${movie.id}`}
                      className="block rounded-[24px] border border-white/8 bg-[#11141C]/62 p-4 transition-colors hover:border-[#D90429]/28"
                    >
                      <div className="flex items-start gap-4">
                        <div className="mt-1 h-14 w-11 shrink-0 overflow-hidden rounded-xl border border-white/8 bg-black">
                          {movie.poster ? (
                            <img
                              src={movie.poster}
                              alt={movie.title}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Clapperboard className="text-white/45" size={20} />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-black uppercase tracking-[0.12em] text-white">
                            {index === 0 ? 'Newest Upload' : 'Movie Uploaded'}
                          </h3>
                          <p className="mt-1 text-sm font-semibold text-white/84">{movie.title}</p>
                          <p className="mt-1 text-xs leading-5 text-white/48">
                            {movie.vj && movie.vj !== 'Unknown'
                              ? `VJ ${movie.vj} uploaded this title.`
                              : 'A new movie was uploaded to the app.'}
                          </p>
                          <div className="mt-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFB3C1]">
                            {getRelativeTimeLabel(movie)}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
