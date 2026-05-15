'use client';

const FCM_TOKEN_KEYS = [
  'ugmovies247.fcmToken',
  'ugmovies247.fcm-token',
  'ugmovies247.pushToken',
  'ugmovies247.push-token',
  'fcmToken',
];

export function readStoredFcmToken() {
  if (typeof window === 'undefined') {
    return '';
  }

  const bridgedToken = (window as typeof window & {
    UGMOVIES247_FCM_TOKEN?: string;
  }).UGMOVIES247_FCM_TOKEN;

  if (typeof bridgedToken === 'string' && bridgedToken.trim()) {
    return bridgedToken.trim();
  }

  try {
    for (const key of FCM_TOKEN_KEYS) {
      const value = window.localStorage.getItem(key);

      if (value?.trim()) {
        return value.trim();
      }
    }
  } catch {
    // Native builds without storage access can still submit requests; email remains the fallback.
  }

  return '';
}
