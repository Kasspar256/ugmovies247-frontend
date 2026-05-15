'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

function resolveMovieIdFromUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const movieIdFromQuery = parsed.searchParams.get('movieId') || parsed.searchParams.get('movie');

    if (movieIdFromQuery) {
      return movieIdFromQuery;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    const movieIndex = segments.indexOf('movie');

    if (movieIndex >= 0 && segments[movieIndex + 1]) {
      return decodeURIComponent(segments[movieIndex + 1]);
    }
  } catch {
    return '';
  }

  return '';
}

async function registerFcmToken(token: string) {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    return;
  }

  try {
    window.localStorage.setItem('ugmovies247.fcmToken', normalizedToken);
  } catch {
    // Keep going; the server registration is the important part.
  }

  await fetch('/api/notifications/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      token: normalizedToken,
      platform: Capacitor.getPlatform(),
    }),
  }).catch(() => undefined);
}

export default function MovieRequestDeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    const openMovie = (movieId: string) => {
      const normalizedMovieId = movieId.trim();

      if (!normalizedMovieId) {
        return;
      }

      router.push(`/movie/${encodeURIComponent(normalizedMovieId)}?fresh=1&fromRequest=1`);
    };
    const pendingMovieId = (window as typeof window & {
      UGMOVIES247_PENDING_MOVIE_ID?: string;
    }).UGMOVIES247_PENDING_MOVIE_ID;
    const bridgedFcmToken = (window as typeof window & {
      UGMOVIES247_FCM_TOKEN?: string;
    }).UGMOVIES247_FCM_TOKEN;
    const onReadyEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ movieId?: string }>).detail;
      openMovie(String(detail?.movieId || ''));
    };
    const onFcmTokenEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ token?: string }>).detail;
      registerFcmToken(String(detail?.token || ''));
    };

    if (typeof pendingMovieId === 'string' && pendingMovieId.trim()) {
      openMovie(pendingMovieId);
      (window as typeof window & { UGMOVIES247_PENDING_MOVIE_ID?: string }).UGMOVIES247_PENDING_MOVIE_ID = '';
    }

    if (typeof bridgedFcmToken === 'string' && bridgedFcmToken.trim()) {
      registerFcmToken(bridgedFcmToken);
    }

    window.addEventListener('ugmovies247:movie-request-ready', onReadyEvent);
    window.addEventListener('ugmovies247:fcm-token', onFcmTokenEvent);

    if (!Capacitor.isNativePlatform()) {
      return () => {
        window.removeEventListener('ugmovies247:movie-request-ready', onReadyEvent);
        window.removeEventListener('ugmovies247:fcm-token', onFcmTokenEvent);
      };
    }

    let isMounted = true;
    let listenerHandle: { remove: () => Promise<void> } | null = null;

    App.addListener('appUrlOpen', ({ url }) => {
      const movieId = resolveMovieIdFromUrl(url);

      if (!movieId) {
        return;
      }

      openMovie(movieId);
    }).then((handle) => {
      if (!isMounted) {
        handle.remove().catch(() => undefined);
        return;
      }

      listenerHandle = handle;
    }).catch(() => undefined);

    return () => {
      isMounted = false;
      window.removeEventListener('ugmovies247:movie-request-ready', onReadyEvent);
      window.removeEventListener('ugmovies247:fcm-token', onFcmTokenEvent);
      listenerHandle?.remove().catch(() => undefined);
    };
  }, [router]);

  return null;
}
