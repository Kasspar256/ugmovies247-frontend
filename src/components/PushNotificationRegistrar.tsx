'use client';

import { useEffect } from 'react';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { app } from '@/lib/firebase';

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

type NativePushNotification = {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
};

type NativePushPlugin = {
  requestPermissions?: () => Promise<{ receive?: string }>;
  register?: () => Promise<void>;
  createChannel?: (channel: {
    id: string;
    name: string;
    description?: string;
    importance?: number;
    visibility?: number;
    sound?: string;
  }) => Promise<void>;
  addListener?: (
    eventName: string,
    listener: (payload: unknown) => void
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
};

const FCM_TOKEN_STORAGE_KEYS = ['ugmovies247.fcmToken', 'fcmToken'];
const BADGE_COUNT_STORAGE_KEY = 'ugmovies247.notification.unread-count.v1';

function getNativePushPlugin() {
  if (typeof window === 'undefined') {
    return null;
  }

  const capacitor = (window as typeof window & {
    Capacitor?: { Plugins?: { PushNotifications?: NativePushPlugin } };
  }).Capacitor;

  return capacitor?.Plugins?.PushNotifications || null;
}

function readStoredBadgeCount() {
  if (typeof window === 'undefined') {
    return 0;
  }

  try {
    const parsed = Number(window.localStorage.getItem(BADGE_COUNT_STORAGE_KEY) || '0');
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

function writeStoredBadgeCount(count: number) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (count > 0) {
      window.localStorage.setItem(BADGE_COUNT_STORAGE_KEY, String(count));
    } else {
      window.localStorage.removeItem(BADGE_COUNT_STORAGE_KEY);
    }
  } catch {
    // Badge storage is best-effort only.
  }
}

async function setBadgeCount(count: number) {
  const normalizedCount = Math.max(0, Math.floor(count));
  writeStoredBadgeCount(normalizedCount);

  if (Capacitor.isNativePlatform()) {
    try {
      const { Badge } = await import('@capawesome/capacitor-badge');

      if (normalizedCount > 0) {
        await Badge.set({ count: normalizedCount });
      } else {
        await Badge.clear();
      }
    } catch (error) {
      console.warn('[push] native app badge update failed', error);
    }
  }

  if (typeof navigator === 'undefined') {
    return;
  }

  const badgeNavigator = navigator as BadgeNavigator;

  try {
    if (normalizedCount > 0 && typeof badgeNavigator.setAppBadge === 'function') {
      await badgeNavigator.setAppBadge(normalizedCount);
    } else if (normalizedCount <= 0 && typeof badgeNavigator.clearAppBadge === 'function') {
      await badgeNavigator.clearAppBadge();
    }
  } catch (error) {
    console.warn('[push] app badge update failed', error);
  }
}

function readUnreadCountFromPayload(payload: unknown) {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const notification = record.notification && typeof record.notification === 'object'
    ? (record.notification as Record<string, unknown>)
    : {};
  const data = record.data && typeof record.data === 'object'
    ? (record.data as Record<string, unknown>)
    : notification.data && typeof notification.data === 'object'
      ? (notification.data as Record<string, unknown>)
      : {};
  const candidates = [
    record.unreadCount,
    record.badgeCount,
    record.badge,
    data.unreadCount,
    data.badgeCount,
    data.badge,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);

    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }

  return null;
}

async function applyBadgeFromPayload(payload: unknown) {
  const explicitCount = readUnreadCountFromPayload(payload);

  if (explicitCount !== null) {
    await setBadgeCount(explicitCount);
    return;
  }

  await setBadgeCount(readStoredBadgeCount() + 1);
}

function storeToken(token: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    FCM_TOKEN_STORAGE_KEYS.forEach((key) => window.localStorage.setItem(key, token));
  } catch {
    // Server registration is retried independently.
  }
}

async function registerTokenWithServer(token: string, platform: string) {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    return false;
  }

  storeToken(normalizedToken);

  try {
    const response = await fetch('/api/notifications/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token: normalizedToken, platform }),
    });

    return response.ok;
  } catch (error) {
    console.warn('[push] token registration failed', error);
    return false;
  }
}

function resolveNotificationRoute(payload: unknown) {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const notification = record.notification && typeof record.notification === 'object'
    ? (record.notification as Record<string, unknown>)
    : {};
  const data = record.data && typeof record.data === 'object'
    ? (record.data as Record<string, unknown>)
    : notification.data && typeof notification.data === 'object'
      ? (notification.data as Record<string, unknown>)
      : notification.extra && typeof notification.extra === 'object'
        ? (notification.extra as Record<string, unknown>)
        : record;
  const rawRoute = String(data.route || data.link || data.url || '').trim();
  const movieId = String(data.movieId || data.movie || '').trim();

  if (rawRoute) {
    return rawRoute;
  }

  if (movieId) {
    return `/movie/${encodeURIComponent(movieId)}?fresh=1&fromPush=1`;
  }

  return '/notifications';
}

function openNotificationRoute(payload: unknown) {
  if (typeof window === 'undefined') {
    return;
  }

  const route = resolveNotificationRoute(payload);

  try {
    window.location.assign(route);
  } catch {
    window.location.href = route;
  }
}

async function maybeShowForegroundNotification(payload: NativePushNotification) {
  if (Capacitor.isNativePlatform()) {
    await maybeShowNativeForegroundNotification(payload);
    return;
  }

  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return;
  }

  if (document.visibilityState !== 'visible' || Notification.permission !== 'granted') {
    return;
  }

  const title = payload.title || 'UGMOVIES247';
  const options: NotificationOptions & { badge?: string; image?: string } = {
    body: payload.body || 'A new update is ready.',
    icon: '/siteicon.png',
    badge: '/favicon.png',
    data: payload.data || {},
  };
  const notification = new Notification(title, options);

  notification.onclick = () => {
    notification.close();
    openNotificationRoute(payload);
  };
}

async function maybeShowNativeForegroundNotification(payload: NativePushNotification) {
  const data = payload.data || {};
  const title = payload.title || String(data.title || data.notificationTitle || 'UGMOVIES247');
  const body = payload.body || String(data.body || data.message || 'A new update is ready.');
  const channelId = String(data.channelId || data.channel || 'latest_uploads');

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const permission = await LocalNotifications.requestPermissions().catch(() => null);

    if (permission?.display && permission.display !== 'granted') {
      return;
    }

    if (Capacitor.getPlatform() === 'android') {
      await LocalNotifications.createChannel({
        id: channelId,
        name: channelId === 'movie_requests' ? 'Movie Requests' : 'Latest Uploads',
        description:
          channelId === 'movie_requests'
            ? 'Request status and admin alerts'
            : 'New movie and series upload alerts',
        importance: 5,
        visibility: 1,
        sound: 'default',
      }).catch(() => undefined);
    }

    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.max(1, Math.floor(Date.now() % 2147483647)),
          title,
          body,
          channelId,
          extra: data,
        },
      ],
    });
  } catch (error) {
    console.warn('[push] native foreground notification failed', error);
  }
}

async function normalizeListenerHandle(
  handle: Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> } | undefined
) {
  if (!handle) {
    return null;
  }

  return Promise.resolve(handle).catch(() => null);
}

async function registerNativeLocalNotificationActionListener() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    return normalizeListenerHandle(
      LocalNotifications.addListener('localNotificationActionPerformed', (payload) => {
        void setBadgeCount(Math.max(0, readStoredBadgeCount() - 1));
        openNotificationRoute(payload);
      })
    );
  } catch (error) {
    console.warn('[push] native local notification action listener failed', error);
    return null;
  }
}

async function registerNativePush() {
  const plugin = getNativePushPlugin();

  if (!plugin?.requestPermissions || !plugin.register || !plugin.addListener) {
    return () => undefined;
  }

  const permission = await plugin.requestPermissions().catch(() => null);

  if (permission?.receive && permission.receive !== 'granted') {
    return () => undefined;
  }

  if (Capacitor.getPlatform() === 'android' && typeof plugin.createChannel === 'function') {
    await Promise.all([
      plugin.createChannel({
        id: 'latest_uploads',
        name: 'Latest Uploads',
        description: 'New movie and series upload alerts',
        importance: 5,
        visibility: 1,
        sound: 'default',
      }),
      plugin.createChannel({
        id: 'movie_requests',
        name: 'Movie Requests',
        description: 'Request status and admin alerts',
        importance: 5,
        visibility: 1,
        sound: 'default',
      }),
    ]).catch((error) => {
      console.warn('[push] Android notification channel setup failed', error);
    });
  }

  const registrationHandle = await normalizeListenerHandle(
    plugin.addListener('registration', (payload) => {
      const token = String(
        (payload as { value?: string; token?: string })?.value ||
          (payload as { value?: string; token?: string })?.token ||
          ''
      ).trim();

      if (token) {
        void registerTokenWithServer(token, Capacitor.getPlatform());
      }
    })
  );
  const receivedHandle = await normalizeListenerHandle(
    plugin.addListener('pushNotificationReceived', (payload) => {
      void applyBadgeFromPayload(payload);
      void maybeShowForegroundNotification(payload as NativePushNotification);
    })
  );
  const actionHandle = await normalizeListenerHandle(
    plugin.addListener('pushNotificationActionPerformed', (payload) => {
      void setBadgeCount(Math.max(0, readStoredBadgeCount() - 1));
      openNotificationRoute(payload);
    })
  );
  const localActionHandle = await registerNativeLocalNotificationActionListener();

  await plugin.register().catch((error) => {
    console.warn('[push] native registration failed', error);
  });

  return () => {
    void registrationHandle?.remove().catch(() => undefined);
    void receivedHandle?.remove().catch(() => undefined);
    void actionHandle?.remove().catch(() => undefined);
    void localActionHandle?.remove().catch(() => undefined);
  };
}

async function registerWebPush() {
  if (
    typeof window === 'undefined' ||
    typeof Notification === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !window.isSecureContext
  ) {
    return () => undefined;
  }

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || '';

  if (!vapidKey) {
    console.warn('[push] NEXT_PUBLIC_FIREBASE_VAPID_KEY is missing; web push registration skipped.');
    return () => undefined;
  }

  const supported = await isSupported().catch(() => false);

  if (!supported) {
    return () => undefined;
  }

  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission().catch(() => 'denied' as NotificationPermission)
      : Notification.permission;

  if (permission !== 'granted') {
    return () => undefined;
  }

  const registration =
    (await navigator.serviceWorker.ready.catch(() => null)) ||
    (await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null));

  if (!registration) {
    return () => undefined;
  }

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  }).catch((error) => {
    console.warn('[push] web token registration failed', error);
    return '';
  });

  if (token) {
    void registerTokenWithServer(token, 'web');
  }

  const unsubscribe = onMessage(messaging, (payload) => {
    void applyBadgeFromPayload(payload);
    void maybeShowForegroundNotification({
      title: payload.notification?.title,
      body: payload.notification?.body,
      data: payload.data,
    });
  });

  return unsubscribe;
}

export default function PushNotificationRegistrar() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let isMounted = true;

    const register = async () => {
      const nativeCleanup = Capacitor.isNativePlatform()
        ? await registerNativePush()
        : await registerWebPush();

      if (!isMounted) {
        nativeCleanup?.();
        return;
      }

      cleanup = nativeCleanup;
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ugmovies247:push') {
        void applyBadgeFromPayload(event.data.payload);
      }
    };
    const syncStoredBadge = () => {
      void setBadgeCount(readStoredBadgeCount());
    };

    void register();
    syncStoredBadge();
    navigator.serviceWorker?.addEventListener?.('message', handleServiceWorkerMessage);
    document.addEventListener('visibilitychange', syncStoredBadge);
    window.addEventListener('focus', syncStoredBadge);

    return () => {
      isMounted = false;
      cleanup?.();
      navigator.serviceWorker?.removeEventListener?.('message', handleServiceWorkerMessage);
      document.removeEventListener('visibilitychange', syncStoredBadge);
      window.removeEventListener('focus', syncStoredBadge);
    };
  }, []);

  return null;
}
