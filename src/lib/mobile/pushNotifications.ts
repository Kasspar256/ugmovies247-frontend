'use client';

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

type PushRouteHandler = (path: string) => void;

let listenersInitialized = false;
let registerInFlight = false;
let registeredToken = '';

function resolveNotificationPath(data: Record<string, unknown> | undefined) {
  const movieId = String(data?.movieId || data?.movie_id || '').trim();
  const path = String(data?.path || data?.url || '').trim();

  if (movieId) {
    return `/movie/${encodeURIComponent(movieId)}`;
  }

  if (path.startsWith('/')) {
    return path;
  }

  return '';
}

async function savePushToken(token: string) {
  if (!token || token === registeredToken) {
    return;
  }

  const response = await fetch('/api/notifications/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      token,
      platform: Capacitor.getPlatform(),
    }),
  });

  if (!response.ok) {
    throw new Error('Push token could not be saved.');
  }

  registeredToken = token;
}

async function ensurePushListeners(onRoute: PushRouteHandler) {
  if (listenersInitialized) {
    return;
  }

  listenersInitialized = true;

  await PushNotifications.addListener('registration', (token) => {
    void savePushToken(token.value).catch((error) => {
      console.warn('[push] token save failed', error);
    });
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.warn('[push] registration failed', error.error);
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.info('[push] foreground notification received', notification);
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
    const path = resolveNotificationPath(event.notification.data as Record<string, unknown> | undefined);

    if (path) {
      onRoute(path);
    }
  });
}

export async function initializeNativePushNotifications(onRoute: PushRouteHandler) {
  if (!Capacitor.isNativePlatform() || registerInFlight) {
    return;
  }

  registerInFlight = true;

  try {
    await ensurePushListeners(onRoute);

    await PushNotifications.createChannel({
      id: 'movie_updates',
      name: 'Movie updates',
      description: 'New movie, subscription, and account alerts',
      importance: 4,
      visibility: 1,
      sound: 'default',
      vibration: true,
    }).catch(() => undefined);

    let permission = await PushNotifications.checkPermissions();

    if (permission.receive === 'prompt') {
      permission = await PushNotifications.requestPermissions();
    }

    if (permission.receive !== 'granted') {
      return;
    }

    await PushNotifications.register();
  } finally {
    registerInFlight = false;
  }
}
