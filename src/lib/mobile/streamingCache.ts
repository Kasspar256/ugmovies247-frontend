'use client';

export const STREAMING_CACHE_LIMIT_BYTES = 150 * 1024 * 1024;

type NativeStreamingCachePlugin = {
  trimVideoCache?: (options: { maxBytes: number; reason?: string }) => Promise<unknown>;
  clearVideoCache?: (options?: { reason?: string }) => Promise<unknown>;
};

function getNativeStreamingCachePlugin() {
  if (typeof window === 'undefined') {
    return null;
  }

  const windowCapacitor = (window as typeof window & {
    Capacitor?: { Plugins?: Record<string, unknown> };
  }).Capacitor;

  return (
    windowCapacitor?.Plugins?.UgmoviesCache ||
    windowCapacitor?.Plugins?.UGMoviesCache ||
    null
  ) as NativeStreamingCachePlugin | null;
}

export function releaseVideoElementMedia(videoElement: HTMLVideoElement | null | undefined) {
  if (!videoElement) {
    return;
  }

  try {
    videoElement.pause();
  } catch {
    // Ignore browser-specific pause failures during route teardown.
  }

  try {
    videoElement.preload = 'none';
    videoElement.removeAttribute('src');
    videoElement.load();
  } catch (error) {
    console.warn('[streaming-cache] failed to release video element media', error);
  }
}

export async function trimStreamingCachePressure(reason: string) {
  const nativeCachePlugin = getNativeStreamingCachePlugin();

  if (nativeCachePlugin?.trimVideoCache) {
    try {
      await nativeCachePlugin.trimVideoCache({
        maxBytes: STREAMING_CACHE_LIMIT_BYTES,
        reason,
      });
      return;
    } catch (error) {
      console.warn('[streaming-cache] native trim failed', error);
    }
  }

  if (typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  try {
    const cacheNames = await window.caches.keys();
    const mediaCacheNames = cacheNames.filter((cacheName) =>
      /video|media|stream|hls|m3u8|segment/i.test(cacheName)
    );

    await Promise.all(mediaCacheNames.map((cacheName) => window.caches.delete(cacheName)));
  } catch (error) {
    console.warn('[streaming-cache] browser cache trim failed', error);
  }
}
