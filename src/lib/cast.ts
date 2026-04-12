'use client';

let googleCastSdkPromise: Promise<boolean> | null = null;

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

function hasGoogleCastFramework() {
  return Boolean(window.cast?.framework && window.chrome?.cast?.media);
}

async function loadGoogleCastFramework() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  if (hasGoogleCastFramework()) {
    return true;
  }

  if (googleCastSdkPromise) {
    return googleCastSdkPromise;
  }

  googleCastSdkPromise = new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };

    const previousCallback = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      previousCallback?.(isAvailable);
      finish(isAvailable && hasGoogleCastFramework());
    };

    const existingScript = document.getElementById('google-cast-sdk') as HTMLScriptElement | null;

    if (!existingScript) {
      const script = document.createElement('script');
      script.id = 'google-cast-sdk';
      script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
      script.async = true;
      script.onerror = () => finish(false);
      document.head.appendChild(script);
    }

    window.setTimeout(() => {
      finish(hasGoogleCastFramework());
    }, 4000);
  }).finally(() => {
    googleCastSdkPromise = null;
  });

  return googleCastSdkPromise;
}

async function tryGoogleCast(options: {
  playbackUrl: string;
  title: string;
  poster?: string;
  contentType: string;
}) {
  const loaded = await loadGoogleCastFramework();

  if (!loaded || !window.cast?.framework || !window.chrome?.cast?.media) {
    return false;
  }

  const castContext = window.cast.framework.CastContext.getInstance();
  castContext.setOptions({
    receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });

  if (castContext.getCastState?.() !== window.cast.framework.CastState.CONNECTED) {
    await castContext.requestSession();
  }

  const session = castContext.getCurrentSession?.();

  if (!session) {
    return false;
  }

  const mediaInfo = new window.chrome.cast.media.MediaInfo(options.playbackUrl, options.contentType);
  const metadata = new window.chrome.cast.media.GenericMediaMetadata();
  metadata.title = options.title;

  if (options.poster) {
    metadata.images = [{ url: options.poster }];
  }

  mediaInfo.metadata = metadata;

  const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
  await session.loadMedia(request);
  return true;
}

async function tryBrowserRemotePlayback(videoElement: HTMLVideoElement | null) {
  if (!videoElement) {
    return null;
  }

  const enhancedVideo = videoElement as HTMLVideoElement & {
    remote?: {
      prompt?: () => Promise<void>;
      watchAvailability?: (callback: (available: boolean) => void) => Promise<number>;
    };
    webkitShowPlaybackTargetPicker?: () => void;
    webkitCurrentPlaybackTargetIsWireless?: boolean;
  };

  if (enhancedVideo.remote && typeof enhancedVideo.remote.prompt === 'function') {
    if (typeof enhancedVideo.remote.watchAvailability === 'function') {
      const isAvailable = await new Promise<boolean>((resolve) => {
        let settled = false;

        enhancedVideo.remote!.watchAvailability!((available: boolean) => {
          if (!settled) {
            settled = true;
            resolve(available);
          }
        }).catch(() => {
          if (!settled) {
            settled = true;
            resolve(true);
          }
        });

        window.setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(true);
          }
        }, 1200);
      });

      if (!isAvailable) {
        return 'No cast devices were found on this network right now.';
      }
    }

    await enhancedVideo.remote.prompt();
    return 'Casting device picker opened.';
  }

  if (typeof enhancedVideo.webkitShowPlaybackTargetPicker === 'function') {
    enhancedVideo.webkitShowPlaybackTargetPicker();
    return enhancedVideo.webkitCurrentPlaybackTargetIsWireless
      ? 'Casting to your selected AirPlay device.'
      : 'AirPlay device picker opened.';
  }

  return null;
}

export async function startCasting(options: {
  videoElement: HTMLVideoElement | null;
  playbackUrl: string;
  title: string;
  poster?: string;
  playbackType?: 'mp4' | 'hls';
}) {
  if (!options.playbackUrl) {
    throw new Error('This movie is not ready for casting yet.');
  }

  const contentType =
    options.playbackType === 'hls' || options.playbackUrl.endsWith('.m3u8')
      ? 'application/x-mpegURL'
      : 'video/mp4';

  try {
    const castStarted = await tryGoogleCast({
      playbackUrl: options.playbackUrl,
      title: options.title,
      poster: options.poster,
      contentType,
    });

    if (castStarted) {
      return 'Casting started on your selected device.';
    }
  } catch (error) {
    console.error('[cast] Google Cast start failed', error);
  }

  const browserMessage = await tryBrowserRemotePlayback(options.videoElement);

  if (browserMessage) {
    return browserMessage;
  }

  throw new Error('Casting is not available in this browser right now. Try Chrome with Google Cast or Safari with AirPlay.');
}
