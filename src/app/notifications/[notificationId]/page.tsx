'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bell, ExternalLink, Loader2 } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import {
  fetchUserNotification,
  formatNotificationTime,
  markUserNotificationRead,
  type UserNotification,
} from '@/lib/userNotifications';

export default function NotificationDetailPage({
  params,
}: {
  params: { notificationId: string };
}) {
  const [notification, setNotification] = useState<UserNotification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const loadNotification = async () => {
      try {
        setError('');
        const payload = await fetchUserNotification(params.notificationId);

        if (!active) {
          return;
        }

        setNotification(payload.notification);
        if (!payload.notification.read) {
          void markUserNotificationRead(payload.notification.id).catch(() => undefined);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Notification could not be loaded.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadNotification();

    return () => {
      active = false;
    };
  }, [params.notificationId]);

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-20 text-white md:px-8 md:pb-14 md:pt-[118px]">
      <MobilePageHeader title="Notification" fallbackHref="/notifications" />

      <div className="mx-auto mt-2 w-full max-w-3xl">
        <Link
          href="/notifications"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white/70 transition hover:text-white"
        >
          <ArrowLeft size={16} />
          Back to notifications
        </Link>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="animate-spin text-[#D90429]" size={32} />
          </div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : notification ? (
          <article className="mt-6 overflow-hidden rounded-[30px] border border-white/10 bg-[#11141C]/90 shadow-[0_24px_70px_rgba(0,0,0,0.38)]">
            <div className="border-b border-white/10 bg-gradient-to-br from-[#172635] to-[#0B0C10] p-6">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#D90429]/15 text-[#FFB3C1]">
                  <Bell size={23} />
                </span>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-white/35">
                    {formatNotificationTime(notification.createdAt)}
                  </p>
                  <h1 className="mt-2 text-2xl font-black leading-tight tracking-[-0.03em] text-white">
                    {notification.title}
                  </h1>
                </div>
              </div>
            </div>

            <div className="space-y-6 p-6">
              <p className="whitespace-pre-wrap text-base leading-8 text-white/78">
                {notification.body}
              </p>

              {notification.path && notification.path !== `/notifications/${notification.id}` ? (
                <Link
                  href={notification.path}
                  className="inline-flex items-center gap-2 rounded-2xl border border-[#D90429]/30 bg-[#D90429]/12 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-[#FFB3C1] transition hover:border-[#D90429]/60 hover:text-white"
                >
                  Open related page
                  <ExternalLink size={16} />
                </Link>
              ) : null}
            </div>
          </article>
        ) : null}
      </div>
    </main>
  );
}
