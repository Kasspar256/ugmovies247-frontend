'use client';

export type CastTransport = 'google-cast' | 'airplay' | null;

export type CastStateSnapshot = {
  status: 'idle' | 'connecting' | 'connected';
  connected: boolean;
  transport: CastTransport;
  deviceName: string;
  currentTime: number;
  duration: number;
  isPaused: boolean;
  available: boolean;
  message: string;
};

type CastListener = (snapshot: CastStateSnapshot) => void;

type CastVideoElement = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

type StartCastingOptions = {
  videoElement: HTMLVideoElement | null;
  playbackUrl: string;
  title: string;
  poster?: string;
  playbackType?: 'mp4' | 'hls';
  currentTime?: number;
  autoplay?: boolean;
};

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: any;
    WebKitPlaybackTargetAvailabilityEvent?: unknown;
  }
}

const initialSnapshot: CastStateSnapshot = {
  status: 'idle',
  connected: false,
  transport: null,
  deviceName: '',
  currentTime: 0,
  duration: 0,
  isPaused: true,
  available: false,
  message: '',
};

let googleCastSdkPromise: Promise<boolean> | null = null;
let castInitialized = false;
let castAvailabilityKnown = false;
let castContext: any = null;
let remotePlayer: any = null;
let remoteController: any = null;
let activeVideoElement: CastVideoElement | null = null;
let snapshot: CastStateSnapshot = initialSnapshot;
let lastAirPlayAvailability = false;

const listeners = new Set<CastListener>();

let remotePlayerListener: ((event?: unknown) => void) | null = null;
let sessionStateListener: ((event: any) => void) | null = null;
let castStateListener: ((event: any) => void) | null = null;
let airPlayAvailabilityListener: ((event: Event) => void) | null = null;
let airPlayWirelessChangeListener: (() => void) | null = null;

function emit(next: Partial<CastStateSnapshot>) {
  snapshot = {
    ...snapshot,
    ...next,
  };

  listeners.forEach((listener) => {
    listener(snapshot);
  });
}

function hasGoogleCastFramework() {
  return Boolean(window.cast?.framework && window.chrome?.cast?.media);
}

function getCurrentCastSession() {
  return castContext?.getCurrentSession?.() || null;
}

function getCastStateValue() {
  return castContext?.getCastState?.() || '';
}

function getCastDeviceName() {
  const session = getCurrentCastSession();
  return session?.getCastDevice?.()?.friendlyName || '';
}

function inferContentType(playbackUrl: string, playbackType: StartCastingOptions['playbackType']) {
  if (playbackType === 'hls' || /\.m3u8(\?|$)/i.test(playbackUrl)) {
    return 'application/x-mpegURL';
  }

  return 'video/mp4';
}

function createLoadRequest(options: StartCastingOptions) {
  const mediaInfo = new window.chrome.cast.media.MediaInfo(
    options.playbackUrl,
    inferContentType(options.playbackUrl, options.playbackType)
  );
  const metadata = new window.chrome.cast.media.GenericMediaMetadata();
  metadata.title = options.title;

  if (options.poster) {
    metadata.images = [{ url: options.poster }];
  }

  mediaInfo.metadata = metadata;
  mediaInfo.streamType = window.chrome.cast.media.StreamType.BUFFERED;

  const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
  request.autoplay = options.autoplay !== false;

  const requestedTime =
    typeof options.currentTime === 'number' && Number.isFinite(options.currentTime)
      ? Math.max(0, options.currentTime)
      : 0;

  if (requestedTime > 0) {
    request.currentTime = requestedTime;
  }

  return request;
}

function syncRemoteSnapshot() {
  const session = getCurrentCastSession();
  const connected = Boolean(remotePlayer?.isConnected);
  const castState = getCastStateValue();
  const available = castAvailabilityKnown
    ? castState !== window.cast?.framework?.CastState?.NO_DEVICES_AVAILABLE
    : snapshot.available;

  emit({
    status:
      connected ? 'connected' : castState === window.cast?.framework?.CastState?.CONNECTING ? 'connecting' : 'idle',
    connected,
    transport: connected ? 'google-cast' : snapshot.transport === 'google-cast' ? null : snapshot.transport,
    deviceName: connected ? getCastDeviceName() : snapshot.transport === 'google-cast' ? '' : snapshot.deviceName,
    currentTime:
      connected && typeof remotePlayer?.currentTime === 'number' ? remotePlayer.currentTime : snapshot.currentTime,
    duration:
      connected && typeof remotePlayer?.duration === 'number' && Number.isFinite(remotePlayer.duration)
        ? remotePlayer.duration
        : snapshot.duration,
    isPaused: connected ? Boolean(remotePlayer?.isPaused) : snapshot.isPaused,
    available,
    message: connected && session ? `Casting to ${getCastDeviceName() || 'your device'}.` : snapshot.message,
  });
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

function ensureGoogleCastController() {
  if (!hasGoogleCastFramework()) {
    return false;
  }

  if (!castContext) {
    castContext = window.cast.framework.CastContext.getInstance();
  }

  if (!castInitialized) {
    castContext.setOptions({
      receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });

    castStateListener = (event: any) => {
      castAvailabilityKnown = true;
      const hasDevices =
        event?.castState !== window.cast.framework.CastState.NO_DEVICES_AVAILABLE;

      emit({
        available: hasDevices,
        status:
          event?.castState === window.cast.framework.CastState.CONNECTING
            ? 'connecting'
            : snapshot.connected
              ? 'connected'
              : 'idle',
      });
    };

    sessionStateListener = (event: any) => {
      switch (event?.sessionState) {
        case window.cast.framework.SessionState.SESSION_STARTING:
          emit({
            status: 'connecting',
            available: true,
            message: 'Connecting to cast device...',
          });
          break;
        case window.cast.framework.SessionState.SESSION_STARTED:
        case window.cast.framework.SessionState.SESSION_RESUMED:
          syncRemoteSnapshot();
          emit({
            status: 'connected',
            connected: true,
            transport: 'google-cast',
            deviceName: getCastDeviceName(),
            message: `Casting to ${getCastDeviceName() || 'your device'}.`,
          });
          break;
        case window.cast.framework.SessionState.SESSION_ENDING:
          emit({
            status: 'idle',
            message: 'Disconnecting from cast device...',
          });
          break;
        case window.cast.framework.SessionState.SESSION_ENDED:
          emit({
            status: 'idle',
            connected: false,
            transport: null,
            deviceName: '',
            message: '',
          });
          break;
        default:
          break;
      }
    };

    castContext.addEventListener(
      window.cast.framework.CastContextEventType.CAST_STATE_CHANGED,
      castStateListener
    );
    castContext.addEventListener(
      window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      sessionStateListener
    );

    castInitialized = true;
  }

  if (!remotePlayer) {
    remotePlayer = new window.cast.framework.RemotePlayer();
  }

  if (!remoteController) {
    remoteController = new window.cast.framework.RemotePlayerController(remotePlayer);
    remotePlayerListener = () => {
      syncRemoteSnapshot();
    };

    remoteController.addEventListener(
      window.cast.framework.RemotePlayerEventType.ANY_CHANGE,
      remotePlayerListener
    );
  }

  return true;
}

function removeAirPlayListeners(videoElement: CastVideoElement | null) {
  if (!videoElement) {
    return;
  }

  if (airPlayAvailabilityListener) {
    videoElement.removeEventListener(
      'webkitplaybacktargetavailabilitychanged',
      airPlayAvailabilityListener
    );
  }

  if (airPlayWirelessChangeListener) {
    videoElement.removeEventListener(
      'webkitcurrentplaybacktargetiswirelesschanged',
      airPlayWirelessChangeListener
    );
  }
}

function syncAirPlaySnapshot() {
  const wireless = Boolean(activeVideoElement?.webkitCurrentPlaybackTargetIsWireless);
  const googleCastStillConnected =
    snapshot.transport === 'google-cast' && snapshot.connected;

  emit({
    connected: wireless || googleCastStillConnected,
    transport: wireless ? 'airplay' : snapshot.transport === 'airplay' ? null : snapshot.transport,
    deviceName: wireless ? 'AirPlay' : snapshot.transport === 'airplay' ? '' : snapshot.deviceName,
    status:
      wireless || googleCastStillConnected
        ? 'connected'
        : snapshot.status === 'connecting'
          ? 'connecting'
          : 'idle',
    message: wireless ? 'Streaming over AirPlay.' : snapshot.transport === 'airplay' ? '' : snapshot.message,
  });
}

export function bindCastVideoElement(videoElement: HTMLVideoElement | null) {
  const nextVideoElement = videoElement as CastVideoElement | null;

  if (activeVideoElement === nextVideoElement) {
    return () => undefined;
  }

  removeAirPlayListeners(activeVideoElement);
  activeVideoElement = nextVideoElement;

  if (!activeVideoElement) {
    lastAirPlayAvailability = false;
    return () => undefined;
  }

  airPlayAvailabilityListener = ((event: Event) => {
    const typedEvent = event as Event & { availability?: string };
    lastAirPlayAvailability = typedEvent.availability === 'available';

    emit({
      available: snapshot.available || lastAirPlayAvailability,
    });
  }) as EventListener;

  airPlayWirelessChangeListener = () => {
    syncAirPlaySnapshot();
  };

  activeVideoElement.addEventListener(
    'webkitplaybacktargetavailabilitychanged',
    airPlayAvailabilityListener
  );
  activeVideoElement.addEventListener(
    'webkitcurrentplaybacktargetiswirelesschanged',
    airPlayWirelessChangeListener
  );

  syncAirPlaySnapshot();

  return () => {
    if (activeVideoElement === nextVideoElement) {
      removeAirPlayListeners(nextVideoElement);
      activeVideoElement = null;
      lastAirPlayAvailability = false;
    }
  };
}

export function getCastStateSnapshot() {
  return snapshot;
}

export function subscribeToCastState(listener: CastListener) {
  listeners.add(listener);
  listener(snapshot);

  return () => {
    listeners.delete(listener);
  };
}

export async function primeCastSupport() {
  const loaded = await loadGoogleCastFramework();

  if (!loaded) {
    return false;
  }

  return ensureGoogleCastController();
}

async function tryGoogleCast(options: StartCastingOptions) {
  const loaded = await loadGoogleCastFramework();

  if (!loaded || !ensureGoogleCastController()) {
    return false;
  }

  castAvailabilityKnown = true;

  if (getCastStateValue() === window.cast.framework.CastState.NO_DEVICES_AVAILABLE) {
    throw new Error('No Chromecast devices were found on this Wi-Fi network right now.');
  }

  emit({
    status: 'connecting',
    available: true,
    message: 'Opening Chromecast device picker...',
  });

  try {
    if (castContext.getCastState?.() !== window.cast.framework.CastState.CONNECTED) {
      await castContext.requestSession();
    }
  } catch (error) {
    const castErrorCode = String((error as { code?: string })?.code || '').toLowerCase();

    if (castErrorCode.includes('cancel')) {
      throw new Error('Chromecast selection was cancelled.');
    }

    if (
      castErrorCode.includes('receiver_unavailable') ||
      castErrorCode.includes('timeout') ||
      castErrorCode.includes('no_devices_available')
    ) {
      throw new Error('No Chromecast devices were found on this Wi-Fi network right now.');
    }

    throw new Error('We could not connect to a Chromecast device right now.');
  }

  const session = getCurrentCastSession();

  if (!session) {
    throw new Error('We could not start a Chromecast session right now.');
  }

  try {
    await session.loadMedia(createLoadRequest(options));
  } catch {
    throw new Error(
      'The cast device could not load this video. The playback URL must be directly reachable by the TV and allow standard media requests.'
    );
  }

  syncRemoteSnapshot();
  emit({
    status: 'connected',
    connected: true,
    transport: 'google-cast',
    deviceName: getCastDeviceName(),
    message: `Casting to ${getCastDeviceName() || 'your device'}.`,
  });

  return true;
}

function canUseAirPlay(videoElement: CastVideoElement | null) {
  return Boolean(videoElement && typeof videoElement.webkitShowPlaybackTargetPicker === 'function');
}

async function tryAirPlay(videoElement: CastVideoElement | null) {
  if (!canUseAirPlay(videoElement)) {
    return false;
  }

  videoElement!.webkitShowPlaybackTargetPicker!();

  emit({
    available: true,
    message: videoElement?.webkitCurrentPlaybackTargetIsWireless
      ? 'Streaming over AirPlay.'
      : 'AirPlay device picker opened.',
  });

  return true;
}

export async function startCasting(options: StartCastingOptions) {
  if (!options.playbackUrl) {
    throw new Error('This movie is not ready for casting yet.');
  }

  bindCastVideoElement(options.videoElement);

  const enhancedOptions: StartCastingOptions = {
    ...options,
    currentTime:
      typeof options.currentTime === 'number'
        ? options.currentTime
        : options.videoElement?.currentTime || 0,
    autoplay:
      typeof options.autoplay === 'boolean'
        ? options.autoplay
        : !options.videoElement?.paused,
  };

  try {
    const started = await tryGoogleCast(enhancedOptions);

    if (started) {
      return `Casting to ${getCastDeviceName() || 'your device'}.`;
    }
  } catch (error) {
    if (canUseAirPlay(options.videoElement as CastVideoElement | null)) {
      const airPlayStarted = await tryAirPlay(options.videoElement as CastVideoElement | null);

      if (airPlayStarted) {
        return 'AirPlay device picker opened.';
      }
    }

    throw error;
  }

  if (await tryAirPlay(options.videoElement as CastVideoElement | null)) {
    return 'AirPlay device picker opened.';
  }

  throw new Error(
    'Chromecast is only available in supported Chromium browsers, and Safari can only offer AirPlay-compatible devices.'
  );
}

export async function syncCastingMedia(options: StartCastingOptions) {
  if (snapshot.transport !== 'google-cast' || !snapshot.connected) {
    return;
  }

  const session = getCurrentCastSession();

  if (!session) {
    return;
  }

  const activeContentId = session.getMediaSession?.()?.media?.contentId || '';
  const nextContentId = options.playbackUrl;

  if (activeContentId === nextContentId) {
    return;
  }

  await session.loadMedia(createLoadRequest(options));
  syncRemoteSnapshot();
}

export async function stopCasting() {
  if (snapshot.transport === 'google-cast') {
    const session = getCurrentCastSession();

    if (session) {
      await session.endSession(true);
    }

    emit({
      status: 'idle',
      connected: false,
      transport: null,
      deviceName: '',
      message: 'Chromecast disconnected.',
    });

    return 'Chromecast disconnected.';
  }

  if (snapshot.transport === 'airplay' && canUseAirPlay(activeVideoElement)) {
    activeVideoElement!.webkitShowPlaybackTargetPicker!();
    return 'Use the AirPlay picker to switch or disconnect your device.';
  }

  return 'No active cast session.';
}

export async function toggleCastPlayback() {
  if (snapshot.transport !== 'google-cast' || !snapshot.connected || !remoteController) {
    return;
  }

  remoteController.playOrPause();
}

export async function seekCastBy(seconds: number) {
  if (snapshot.transport !== 'google-cast' || !snapshot.connected || !remoteController || !remotePlayer) {
    return;
  }

  const currentTime =
    typeof remotePlayer.currentTime === 'number' && Number.isFinite(remotePlayer.currentTime)
      ? remotePlayer.currentTime
      : 0;
  const maxDuration =
    typeof remotePlayer.duration === 'number' &&
    Number.isFinite(remotePlayer.duration) &&
    remotePlayer.duration > 0
      ? remotePlayer.duration
      : Number.POSITIVE_INFINITY;
  const nextTime = Math.min(Math.max(0, currentTime + seconds), maxDuration);

  remotePlayer.currentTime = nextTime;
  remoteController.seek();
}
