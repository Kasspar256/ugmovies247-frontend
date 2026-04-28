'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Cast,
  GripHorizontal,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Settings2,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  bindCastVideoElement,
  getCastStateSnapshot,
  primeCastSupport,
  seekCastBy,
  startCasting,
  stopCasting,
  subscribeToCastState,
  syncCastingMedia,
  toggleCastPlayback,
  type CastStateSnapshot,
} from '@/lib/cast';

export type PlaybackPhase =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export type PlaybackSource = {
  sessionKey: string;
  movieId: string;
  sourceUrl: string;
  fallbackUrl?: string;
  castUrl?: string;
  playbackType?: 'mp4' | 'hls';
  autoplay?: boolean;
  poster?: string;
  title: string;
  description?: string;
  watchHref: string;
};

type PlaybackContextValue = {
  activeSource: PlaybackSource | null;
  playbackPhase: PlaybackPhase;
  fatalErrorMessage: string;
  currentTime: number;
  duration: number;
  videoElement: HTMLVideoElement | null;
  setPlaybackSource: (source: PlaybackSource | null) => void;
  registerInlineHost: (node: HTMLDivElement | null) => void;
  clearPlayback: () => void;
  togglePlayPause: () => void;
  seekBy: (seconds: number) => void;
  openFullscreen: () => Promise<void>;
  openWatchView: () => void;
};

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type IOSVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: OrientationLockType) => Promise<void>;
  unlock?: () => void;
};

type MiniPlayerPosition = {
  x: number;
  y: number;
};

type MiniPlayerSize = {
  width: number;
  height: number;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

const STARTUP_ERROR_GRACE_MS = 2200;
const FATAL_ERROR_DELAY_MS = 1600;
const CONTROL_HIDE_DELAY_MS = 2600;
const DESKTOP_MINI_PLAYER_WIDTH = 360;
const MOBILE_MINI_PLAYER_MIN_WIDTH = 220;
const MOBILE_MINI_PLAYER_MAX_WIDTH = 360;
const DESKTOP_MINI_MARGIN = 24;
const MOBILE_MINI_MARGIN = 14;
const MINI_PLAYER_BOTTOM_DESKTOP = 28;
const MINI_PLAYER_BOTTOM_MOBILE = 92;
const VOLUME_STORAGE_KEY = 'ugmovies247.player.volume';
const MUTE_STORAGE_KEY = 'ugmovies247.player.muted';
const PLAYBACK_RATE_STORAGE_KEY = 'ugmovies247.player.rate';
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const normalizedSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(normalizedSeconds / 3600);
  const minutes = Math.floor((normalizedSeconds % 3600) / 60);
  const remainingSeconds = normalizedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(
      2,
      '0'
    )}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatPlaybackRate(rate: number) {
  return `${Number(rate.toFixed(2)).toString().replace(/\.0$/, '')}x`;
}

function isMediaRecovering(video: HTMLVideoElement | null, phase: PlaybackPhase) {
  if (!video) {
    return false;
  }

  if (phase === 'playing' || phase === 'buffering') {
    return true;
  }

  if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    return true;
  }

  return video.networkState === HTMLMediaElement.NETWORK_LOADING && Boolean(video.currentSrc);
}

function areSourcesEqual(current: PlaybackSource | null, next: PlaybackSource | null) {
  if (!current || !next) {
    return current === next;
  }

  return (
    current.sessionKey === next.sessionKey &&
    current.movieId === next.movieId &&
    current.sourceUrl === next.sourceUrl &&
    (current.fallbackUrl || '') === (next.fallbackUrl || '') &&
    (current.castUrl || '') === (next.castUrl || '') &&
    (current.playbackType || 'mp4') === (next.playbackType || 'mp4') &&
    Boolean(current.autoplay) === Boolean(next.autoplay) &&
    current.poster === next.poster &&
    current.title === next.title &&
    current.description === next.description &&
    current.watchHref === next.watchHref
  );
}

function getBufferedUntil(video: HTMLVideoElement | null) {
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
    return 0;
  }

  try {
    const { buffered, currentTime } = video;

    for (let index = 0; index < buffered.length; index += 1) {
      const start = buffered.start(index);
      const end = buffered.end(index);

      if (currentTime >= start && currentTime <= end) {
        return end;
      }
    }

    if (buffered.length > 0) {
      return buffered.end(buffered.length - 1);
    }
  } catch {
    return 0;
  }

  return 0;
}

function readStoredNumber(key: string, fallback: number) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const rawValue = window.localStorage.getItem(key);
  const parsedValue = rawValue ? Number(rawValue) : Number.NaN;

  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const rawValue = window.localStorage.getItem(key);

  if (rawValue === 'true') {
    return true;
  }

  if (rawValue === 'false') {
    return false;
  }

  return fallback;
}

function resolveMiniPlayerSize(isDesktop: boolean, viewportWidth: number): MiniPlayerSize {
  if (isDesktop) {
    return {
      width: DESKTOP_MINI_PLAYER_WIDTH,
      height: Math.round((DESKTOP_MINI_PLAYER_WIDTH * 9) / 16),
    };
  }

  const width = clamp(
    Math.round(viewportWidth * 0.86),
    MOBILE_MINI_PLAYER_MIN_WIDTH,
    MOBILE_MINI_PLAYER_MAX_WIDTH
  );

  return {
    width,
    height: Math.round((width * 9) / 16),
  };
}

function resolveDefaultMiniPlayerPosition(
  viewportWidth: number,
  viewportHeight: number,
  size: MiniPlayerSize,
  isDesktop: boolean
) {
  if (!isDesktop) {
    return {
      x: Math.max(MOBILE_MINI_MARGIN, Math.round((viewportWidth - size.width) / 2)),
      y: Math.max(MOBILE_MINI_MARGIN + 18, Math.round(viewportHeight * 0.11)),
    };
  }

  return {
    x: Math.max(DESKTOP_MINI_MARGIN, viewportWidth - size.width - DESKTOP_MINI_MARGIN),
    y: Math.max(
      DESKTOP_MINI_MARGIN,
      viewportHeight - size.height - MINI_PLAYER_BOTTOM_DESKTOP
    ),
  };
}

function clampMiniPlayerPosition(
  position: MiniPlayerPosition,
  viewportWidth: number,
  viewportHeight: number,
  size: MiniPlayerSize,
  isDesktop: boolean
) {
  const margin = isDesktop ? DESKTOP_MINI_MARGIN : MOBILE_MINI_MARGIN;

  return {
    x: clamp(position.x, margin, Math.max(margin, viewportWidth - size.width - margin)),
    y: clamp(position.y, margin, Math.max(margin, viewportHeight - size.height - margin)),
  };
}

function PlayerShellButton({
  onClick,
  ariaLabel,
  children,
  className = '',
}: {
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{ WebkitTapHighlightColor: 'transparent' }}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/48 text-white shadow-[0_12px_28px_rgba(0,0,0,0.28)] transition-all hover:border-white/25 hover:bg-black/68 ${className}`}
    >
      {children}
    </button>
  );
}

function SpinnerOrb({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/48 backdrop-blur-xl ${className}`}
      aria-hidden="true"
    >
      <Loader2 size={18} className="animate-spin text-white/84" />
    </span>
  );
}


function StreamLoadingIndicator({ compact = false }: { compact?: boolean }) {
  return <SpinnerOrb className={compact ? 'h-12 w-12' : 'h-14 w-14'} />;
}

function useIsDesktopViewport() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mediaQuery.matches);

    update();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return isDesktop;
}

function useIsIOSDevice() {
  const [isIOSDevice, setIsIOSDevice] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      return;
    }

    const platform = navigator.platform || '';
    const touchPoints = navigator.maxTouchPoints || 0;
    const userAgent = navigator.userAgent || '';
    const isiPhone = /iPhone/i.test(userAgent);
    const isiPad = /iPad/i.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1);

    setIsIOSDevice(isiPhone || isiPad);
  }, []);

  return isIOSDevice;
}

async function lockLandscapeOrientation() {
  if (typeof window === 'undefined') {
    return;
  }

  const orientation = window.screen?.orientation as ScreenOrientationWithLock | undefined;

  if (typeof orientation?.lock !== 'function') {
    return;
  }

  await orientation.lock('landscape').catch(() => {
    // Some browsers/WebViews only allow orientation lock after fullscreen starts.
  });
}

function unlockScreenOrientation() {
  if (typeof window === 'undefined') {
    return;
  }

  const orientation = window.screen?.orientation as ScreenOrientationWithLock | undefined;

  if (typeof orientation?.unlock === 'function') {
    orientation.unlock();
  }
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isDesktop = useIsDesktopViewport();
  const isIOSDevice = useIsIOSDevice();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const scrubberRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const fatalErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const castFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickIntentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutoplayRef = useRef(false);
  const retriedCurrentSourceRef = useRef(false);
  const startupGraceUntilRef = useRef(0);
  const lastAssignedSourceKeyRef = useRef('');
  const fallbackSourceRef = useRef('');
  const lastVolumeBeforeMuteRef = useRef(1);
  const playbackPhaseRef = useRef<PlaybackPhase>('idle');
  const castSnapshotRef = useRef<CastStateSnapshot>(getCastStateSnapshot());
  const miniDragStateRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const [activeSource, setActiveSourceState] = useState<PlaybackSource | null>(null);
  const [inlineHost, setInlineHost] = useState<HTMLDivElement | null>(null);
  const [inlineRect, setInlineRect] = useState<DOMRect | null>(null);
  const [videoElementState, setVideoElementState] = useState<HTMLVideoElement | null>(null);
  const [playbackPhase, setPlaybackPhase] = useState<PlaybackPhase>('idle');
  const [fatalErrorMessage, setFatalErrorMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedUntil, setBufferedUntil] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [desktopSeekFeedback, setDesktopSeekFeedback] = useState('');
  const [desktopSeekFeedbackSide, setDesktopSeekFeedbackSide] = useState<'left' | 'right'>('right');
  const [castFeedbackMessage, setCastFeedbackMessage] = useState('');
  const [castSnapshot, setCastSnapshot] = useState<CastStateSnapshot>(() => getCastStateSnapshot());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hoverPreviewTime, setHoverPreviewTime] = useState<number | null>(null);
  const [hoverPreviewRatio, setHoverPreviewRatio] = useState<number | null>(null);
  const [miniPlayerSize, setMiniPlayerSize] = useState<MiniPlayerSize>({
    width: DESKTOP_MINI_PLAYER_WIDTH,
    height: Math.round((DESKTOP_MINI_PLAYER_WIDTH * 9) / 16),
  });
  const [miniPlayerPosition, setMiniPlayerPosition] = useState<MiniPlayerPosition | null>(null);
  const [isDraggingMiniPlayer, setIsDraggingMiniPlayer] = useState(false);

  const setPlaybackPhaseSafe = useCallback((nextPhase: PlaybackPhase) => {
    playbackPhaseRef.current = nextPhase;
    setPlaybackPhase(nextPhase);
  }, []);

  const clearFatalErrorTimer = useCallback(() => {
    if (fatalErrorTimerRef.current) {
      clearTimeout(fatalErrorTimerRef.current);
      fatalErrorTimerRef.current = null;
    }
  }, []);

  const clearSeekFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, []);

  const clearCastFeedbackTimer = useCallback(() => {
    if (castFeedbackTimerRef.current) {
      clearTimeout(castFeedbackTimerRef.current);
      castFeedbackTimerRef.current = null;
    }
  }, []);

  const clearHideControlsTimer = useCallback(() => {
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
  }, []);

  const clearClickIntentTimer = useCallback(() => {
    if (clickIntentTimerRef.current) {
      clearTimeout(clickIntentTimerRef.current);
      clickIntentTimerRef.current = null;
    }
  }, []);

  const clearFatalError = useCallback(() => {
    clearFatalErrorTimer();
    setFatalErrorMessage('');
  }, [clearFatalErrorTimer]);

  const showCastFeedback = useCallback(
    (message: string) => {
      clearCastFeedbackTimer();
      setCastFeedbackMessage(message);
      castFeedbackTimerRef.current = setTimeout(() => {
        setCastFeedbackMessage('');
      }, 3200);
    },
    [clearCastFeedbackTimer]
  );

  const syncBufferedProgress = useCallback(() => {
    setBufferedUntil(getBufferedUntil(videoRef.current));
  }, []);

  const updateVolumeState = useCallback((nextVolume: number, nextMuted?: boolean) => {
    const normalizedVolume = clamp(nextVolume, 0, 1);
    const shouldMute = nextMuted ?? normalizedVolume <= 0.001;

    if (normalizedVolume > 0.001) {
      lastVolumeBeforeMuteRef.current = normalizedVolume;
    }

    setVolume(normalizedVolume);
    setIsMuted(shouldMute);
  }, []);

  const showControls = useCallback(
    (keepOpen = false) => {
      setControlsVisible(true);
      clearHideControlsTimer();

      if (keepOpen) {
        return;
      }

      const shouldAutoHide =
        Boolean(activeSource) &&
        playbackPhaseRef.current === 'playing' &&
        !settingsOpen &&
        !isDraggingMiniPlayer;

      if (shouldAutoHide) {
        hideControlsTimerRef.current = setTimeout(() => {
          setControlsVisible(false);
        }, CONTROL_HIDE_DELAY_MS);
      }
    },
    [activeSource, clearHideControlsTimer, inlineHost, isDraggingMiniPlayer, settingsOpen]
  );

  const setVideoElement = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      setVideoElementState(node);

      if (node) {
        node.setAttribute('playsinline', 'true');
        node.setAttribute('webkit-playsinline', 'true');
        node.setAttribute('x-webkit-airplay', 'allow');
        node.preload = 'metadata';
        node.setAttribute('preload', 'metadata');
        node.volume = clamp(volume, 0, 1);
        node.muted = isMuted;
        node.playbackRate = playbackRate;
      }
    },
    [isMuted, playbackRate, volume]
  );

  const syncInlineRect = useCallback(() => {
    if (!inlineHost) {
      setInlineRect(null);
      return;
    }

    const nextRect = inlineHost.getBoundingClientRect();

    if (nextRect.width < 8 || nextRect.height < 8) {
      setInlineRect(null);
      return;
    }

    setInlineRect(nextRect);
  }, [inlineHost]);

  useLayoutEffect(() => {
    syncInlineRect();
  }, [syncInlineRect]);

  useEffect(() => {
    if (!inlineHost || typeof window === 'undefined') {
      setInlineRect(null);
      return;
    }

    syncInlineRect();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncInlineRect) : null;

    resizeObserver?.observe(inlineHost);
    window.addEventListener('resize', syncInlineRect);
    window.addEventListener('scroll', syncInlineRect, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncInlineRect);
      window.removeEventListener('scroll', syncInlineRect, true);
    };
  }, [inlineHost, syncInlineRect]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as WebkitDocument;
      const inlineVideo = videoRef.current as IOSVideoElement | null;
      const nextIsFullscreen = Boolean(
        document.fullscreenElement ||
          doc.webkitFullscreenElement ||
          inlineVideo?.webkitDisplayingFullscreen
      );

      setIsFullscreen(nextIsFullscreen);

      if (nextIsFullscreen && !isDesktop) {
        void lockLandscapeOrientation();
      } else if (!nextIsFullscreen) {
        unlockScreenOrientation();
      }
    };

    const currentVideo = videoElementState as IOSVideoElement | null;

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    currentVideo?.addEventListener('webkitbeginfullscreen', handleFullscreenChange as EventListener);
    currentVideo?.addEventListener('webkitendfullscreen', handleFullscreenChange as EventListener);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      currentVideo?.removeEventListener(
        'webkitbeginfullscreen',
        handleFullscreenChange as EventListener
      );
      currentVideo?.removeEventListener(
        'webkitendfullscreen',
        handleFullscreenChange as EventListener
      );
    };
  }, [isDesktop, videoElementState]);

  useEffect(() => {
    const storedVolume = clamp(readStoredNumber(VOLUME_STORAGE_KEY, 1), 0, 1);
    const storedMuted = readStoredBoolean(MUTE_STORAGE_KEY, false);
    const storedPlaybackRate = clamp(readStoredNumber(PLAYBACK_RATE_STORAGE_KEY, 1), 0.75, 2);

    lastVolumeBeforeMuteRef.current = storedVolume > 0.001 ? storedVolume : 1;
    setVolume(storedVolume);
    setIsMuted(storedMuted);
    setPlaybackRate(storedPlaybackRate);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
      window.localStorage.setItem(MUTE_STORAGE_KEY, String(isMuted));
      window.localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(playbackRate));
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    videoElement.volume = clamp(volume, 0, 1);
    videoElement.muted = isMuted;
    videoElement.playbackRate = playbackRate;
  }, [isMuted, playbackRate, volume]);

  useEffect(() => {
    if (!settingsOpen || !controlsVisible) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (settingsMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setSettingsOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [controlsVisible, settingsOpen]);

  useEffect(() => {
    void primeCastSupport().catch(() => undefined);
  }, []);

  useEffect(() => {
    return bindCastVideoElement(videoElementState);
  }, [videoElementState]);

  useEffect(() => {
    return subscribeToCastState((nextSnapshot) => {
      const priorSnapshot = castSnapshotRef.current;
      const wasGoogleCasting =
        priorSnapshot.transport === 'google-cast' && priorSnapshot.connected;
      const isGoogleCasting =
        nextSnapshot.transport === 'google-cast' && nextSnapshot.connected;

      castSnapshotRef.current = nextSnapshot;
      setCastSnapshot(nextSnapshot);

      if (isGoogleCasting) {
        clearFatalError();
        setCurrentTime(nextSnapshot.currentTime || 0);
        setDuration(nextSnapshot.duration || 0);
        setHasStartedPlayback(true);
        setPlaybackPhaseSafe(nextSnapshot.isPaused ? 'paused' : 'playing');

        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        }

        return;
      }

      if (wasGoogleCasting && !isGoogleCasting) {
        const videoElement = videoRef.current;

        if (videoElement && activeSource?.sourceUrl) {
          if (Number.isFinite(priorSnapshot.currentTime) && priorSnapshot.currentTime > 0) {
            try {
              videoElement.currentTime = priorSnapshot.currentTime;
              setCurrentTime(priorSnapshot.currentTime);
            } catch {
              setCurrentTime(priorSnapshot.currentTime);
            }
          }

          if (!priorSnapshot.isPaused) {
            void videoElement.play().catch(() => {
              setPlaybackPhaseSafe('paused');
            });
          } else {
            setPlaybackPhaseSafe('paused');
          }
        }
      }
    });
  }, [activeSource?.sourceUrl, clearFatalError, setPlaybackPhaseSafe]);

  const setPlaybackSource = useCallback((nextSource: PlaybackSource | null) => {
    setActiveSourceState((currentSource) =>
      areSourcesEqual(currentSource, nextSource) ? currentSource : nextSource
    );
  }, []);

  const clearPlayback = useCallback(() => {
    clearClickIntentTimer();
    clearFatalError();
    pendingAutoplayRef.current = false;
    retriedCurrentSourceRef.current = false;
    fallbackSourceRef.current = '';
    startupGraceUntilRef.current = 0;
    lastAssignedSourceKeyRef.current = '';
    setHasStartedPlayback(false);
    setActiveSourceState(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedUntil(0);
    setHoverPreviewTime(null);
    setHoverPreviewRatio(null);
    setSettingsOpen(false);
    setPlaybackPhaseSafe('idle');

    const videoElement = videoRef.current;

    if (videoElement) {
      videoElement.pause();
      videoElement.removeAttribute('src');
      videoElement.load();
    }
  }, [clearClickIntentTimer, clearFatalError, setPlaybackPhaseSafe]);

  const scheduleFatalError = useCallback(
    (message: string) => {
      clearFatalErrorTimer();

      const now = Date.now();
      const initialDelay =
        now < startupGraceUntilRef.current
          ? startupGraceUntilRef.current - now
          : FATAL_ERROR_DELAY_MS;

      fatalErrorTimerRef.current = setTimeout(() => {
        const videoElement = videoRef.current;

        if (!videoElement) {
          return;
        }

        if (isMediaRecovering(videoElement, playbackPhaseRef.current)) {
          return;
        }

        if (!retriedCurrentSourceRef.current) {
          retriedCurrentSourceRef.current = true;
          setPlaybackPhaseSafe('loading');
          videoElement.load();
          scheduleFatalError(message);
          return;
        }

        setFatalErrorMessage(message);
        setPlaybackPhaseSafe('error');
      }, Math.max(350, initialDelay));
    },
    [clearFatalErrorTimer, setPlaybackPhaseSafe]
  );

  useEffect(() => {
    const videoElement = videoRef.current;

    if (!videoElement || !activeSource?.sourceUrl) {
      return;
    }

    const nextSourceKey = `${activeSource.sessionKey}|${activeSource.sourceUrl}`;

    if (lastAssignedSourceKeyRef.current === nextSourceKey) {
      return;
    }

    const shouldResumePlayback =
      Boolean(activeSource.autoplay) ||
      playbackPhaseRef.current === 'playing' ||
      playbackPhaseRef.current === 'buffering';

    clearFatalError();
    startupGraceUntilRef.current = Date.now() + STARTUP_ERROR_GRACE_MS;
    pendingAutoplayRef.current = shouldResumePlayback;
    retriedCurrentSourceRef.current = false;
    fallbackSourceRef.current = '';
    lastAssignedSourceKeyRef.current = nextSourceKey;
    setHasStartedPlayback(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedUntil(0);
    setPlaybackPhaseSafe('loading');

    videoElement.pause();
    videoElement.preload = 'metadata';
    videoElement.setAttribute('preload', 'metadata');
    videoElement.src = activeSource.sourceUrl;
    videoElement.load();

    if (shouldResumePlayback) {
      void videoElement.play().catch(() => {
        setPlaybackPhaseSafe('paused');
      });
    }
  }, [
    activeSource?.autoplay,
    activeSource?.sessionKey,
    activeSource?.sourceUrl,
    clearFatalError,
    setPlaybackPhaseSafe,
  ]);

  useEffect(() => {
    if (!activeSource || castSnapshot.transport !== 'google-cast' || !castSnapshot.connected) {
      return;
    }

    const localVideoCurrentTime = videoRef.current?.currentTime;
    const nextCastStartTime =
      typeof localVideoCurrentTime === 'number' && Number.isFinite(localVideoCurrentTime)
        ? localVideoCurrentTime
        : castSnapshotRef.current.currentTime || 0;

    void syncCastingMedia({
      videoElement: videoRef.current,
      playbackUrl: activeSource.castUrl || activeSource.sourceUrl,
      title: activeSource.title,
      poster: activeSource.poster,
      playbackType: activeSource.playbackType,
      currentTime: nextCastStartTime,
      autoplay:
        playbackPhaseRef.current === 'playing' || playbackPhaseRef.current === 'buffering',
    }).catch((error) => {
      console.error('[player] cast sync failed', error);
      showCastFeedback(
        error instanceof Error ? error.message : 'We could not update the cast device.'
      );
    });
  }, [
    activeSource,
    castSnapshot.connected,
    castSnapshot.transport,
    showCastFeedback,
  ]);

  useEffect(() => {
    return () => {
      clearCastFeedbackTimer();
      clearClickIntentTimer();
      clearFatalErrorTimer();
      clearHideControlsTimer();
      clearSeekFeedbackTimer();
    };
  }, [
    clearCastFeedbackTimer,
    clearClickIntentTimer,
    clearFatalErrorTimer,
    clearHideControlsTimer,
    clearSeekFeedbackTimer,
  ]);

  useEffect(() => {
    if (!activeSource || settingsOpen || playbackPhase !== 'playing' || isDraggingMiniPlayer) {
      clearHideControlsTimer();
      setControlsVisible(true);
      return;
    }

    hideControlsTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROL_HIDE_DELAY_MS);

    return clearHideControlsTimer;
  }, [activeSource, clearHideControlsTimer, isDraggingMiniPlayer, playbackPhase, settingsOpen]);

  const tryEnterFullscreen = useCallback(async () => {
    const videoElement = videoRef.current as IOSVideoElement | null;
    const shellElement = shellRef.current;

    if (!videoElement) {
      return;
    }

    showControls(true);

    const doc = document as WebkitDocument;

    if (
      document.fullscreenElement ||
      doc.webkitFullscreenElement ||
      videoElement.webkitDisplayingFullscreen
    ) {
      if (videoElement.webkitExitFullscreen) {
        videoElement.webkitExitFullscreen();
        return;
      }

      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
        return;
      }

      if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      }

      return;
    }

    if (isIOSDevice && typeof videoElement.webkitEnterFullscreen === 'function') {
      videoElement.webkitEnterFullscreen();
      return;
    }

    if (shellElement && typeof shellElement.requestFullscreen === 'function') {
      await shellElement.requestFullscreen();
      if (!isDesktop) {
        await lockLandscapeOrientation();
      }
      return;
    }

    if (typeof videoElement.requestFullscreen === 'function') {
      await videoElement.requestFullscreen();
      if (!isDesktop) {
        await lockLandscapeOrientation();
      }
    }
  }, [isDesktop, isIOSDevice, showControls]);

  const openWatchView = useCallback(() => {
    if (!activeSource?.watchHref) {
      return;
    }

    router.push(activeSource.watchHref);
  }, [activeSource?.watchHref, router]);

  const togglePlayPause = useCallback(() => {
    showControls();

    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      clearFatalError();
      void toggleCastPlayback().catch((error) => {
        showCastFeedback(
          error instanceof Error ? error.message : 'We could not control the cast device.'
        );
      });
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    if (videoElement.paused || videoElement.ended) {
      clearFatalError();
      void videoElement.play().catch(() => {
        setPlaybackPhaseSafe('paused');
      });
      return;
    }

    videoElement.pause();
  }, [clearFatalError, setPlaybackPhaseSafe, showCastFeedback, showControls]);

  const seekTo = useCallback(
    (nextTime: number) => {
      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      const targetTime = safeDuration > 0 ? clamp(nextTime, 0, safeDuration) : Math.max(0, nextTime);

      showControls(true);

      if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
        const delta = targetTime - currentTime;

        if (Math.abs(delta) > 0.05) {
          void seekCastBy(delta).catch((error) => {
            showCastFeedback(
              error instanceof Error ? error.message : 'We could not seek on the cast device.'
            );
          });
        }

        setCurrentTime(targetTime);
        return;
      }

      const videoElement = videoRef.current;

      if (!videoElement) {
        return;
      }

      videoElement.currentTime = targetTime;
      setCurrentTime(targetTime);
      syncBufferedProgress();
    },
    [currentTime, duration, showCastFeedback, showControls, syncBufferedProgress]
  );

  const seekBy = useCallback(
    (seconds: number) => {
      const targetTime = currentTime + seconds;
      seekTo(targetTime);

      if (seconds !== 0) {
        clearSeekFeedbackTimer();
        setDesktopSeekFeedbackSide(seconds < 0 ? 'left' : 'right');
        setDesktopSeekFeedback(`${seconds > 0 ? '+' : ''}${seconds}s`);
        feedbackTimerRef.current = setTimeout(() => {
          setDesktopSeekFeedback('');
        }, 720);
      }
    },
    [clearSeekFeedbackTimer, currentTime, seekTo]
  );

  const adjustVolumeBy = useCallback(
    (delta: number) => {
      const nextVolume = clamp((isMuted ? lastVolumeBeforeMuteRef.current : volume) + delta, 0, 1);
      updateVolumeState(nextVolume, nextVolume <= 0.001);
      showControls();
    },
    [isMuted, showControls, updateVolumeState, volume]
  );

  const toggleMute = useCallback(() => {
    if (!isMuted) {
      if (volume > 0.001) {
        lastVolumeBeforeMuteRef.current = volume;
      }

      setIsMuted(true);
      showControls(true);
      return;
    }

    const restoredVolume = lastVolumeBeforeMuteRef.current > 0.001 ? lastVolumeBeforeMuteRef.current : 0.65;
    updateVolumeState(restoredVolume, false);
    showControls(true);
  }, [isMuted, showControls, updateVolumeState, volume]);

  const setPlaybackRateAndPersist = useCallback(
    (nextPlaybackRate: number) => {
      setPlaybackRate(clamp(nextPlaybackRate, 0.75, 2));
      setSettingsOpen(false);
      showControls(true);
    },
    [showControls]
  );

  const cyclePlaybackRate = useCallback(() => {
    const currentIndex = PLAYBACK_RATES.findIndex(
      (candidatePlaybackRate) => Math.abs(candidatePlaybackRate - playbackRate) < 0.001
    );
    const nextPlaybackRate =
      PLAYBACK_RATES[(currentIndex + 1 + PLAYBACK_RATES.length) % PLAYBACK_RATES.length];
    setPlaybackRateAndPersist(nextPlaybackRate);
  }, [playbackRate, setPlaybackRateAndPersist]);

  const isGoogleCasting =
    castSnapshot.transport === 'google-cast' && castSnapshot.connected;
  const isAirPlayCasting =
    castSnapshot.transport === 'airplay' && castSnapshot.connected;
  const isCasting = isGoogleCasting || isAirPlayCasting;
  const castButtonAriaLabel = isGoogleCasting
    ? 'Disconnect Chromecast'
    : isAirPlayCasting
      ? 'Open AirPlay picker'
      : 'Cast video';

  const handleCastButtonClick = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      showControls(true);

      if (!activeSource?.sourceUrl && !activeSource?.castUrl) {
        showCastFeedback('This movie is not ready for casting yet.');
        return;
      }

      try {
        const localVideoCurrentTime = videoRef.current?.currentTime;
        const nextCastStartTime =
          typeof localVideoCurrentTime === 'number' && Number.isFinite(localVideoCurrentTime)
            ? localVideoCurrentTime
            : currentTime;

        if (castSnapshotRef.current.connected) {
          const message = await stopCasting();
          showCastFeedback(message);
          return;
        }

        const message = await startCasting({
          videoElement: videoRef.current,
          playbackUrl: activeSource.castUrl || activeSource.sourceUrl,
          title: activeSource.title,
          poster: activeSource.poster,
          playbackType: activeSource.playbackType,
          currentTime: nextCastStartTime,
          autoplay:
            playbackPhaseRef.current === 'playing' ||
            playbackPhaseRef.current === 'buffering',
        });

        if (
          castSnapshotRef.current.transport === 'google-cast' &&
          castSnapshotRef.current.connected &&
          videoRef.current &&
          !videoRef.current.paused
        ) {
          videoRef.current.pause();
        }

        showCastFeedback(message);
      } catch (error) {
        showCastFeedback(
          error instanceof Error
            ? error.message
            : 'We could not start casting right now.'
        );
      }
    },
    [activeSource, currentTime, showCastFeedback, showControls]
  );

  const hasInlineHost = Boolean(inlineHost);
  const isInlineMode = Boolean(activeSource && hasInlineHost);
  const isMiniMode = Boolean(activeSource && !hasInlineHost && hasStartedPlayback);
  const isMobileInlineMode = isInlineMode && !isDesktop;
  const isDesktopInlineMode = isInlineMode && isDesktop;

  useEffect(() => {
    if (!isMiniMode || typeof window === 'undefined') {
      return;
    }

    const syncMiniPlayerBounds = () => {
      const nextSize = resolveMiniPlayerSize(isDesktop, window.innerWidth);
      setMiniPlayerSize(nextSize);
      setMiniPlayerPosition((currentPosition) => {
        const basePosition =
          currentPosition ||
          resolveDefaultMiniPlayerPosition(
            window.innerWidth,
            window.innerHeight,
            nextSize,
            isDesktop
          );

        return clampMiniPlayerPosition(
          basePosition,
          window.innerWidth,
          window.innerHeight,
          nextSize,
          isDesktop
        );
      });
    };

    syncMiniPlayerBounds();
    window.addEventListener('resize', syncMiniPlayerBounds);
    return () => window.removeEventListener('resize', syncMiniPlayerBounds);
  }, [isDesktop, isMiniMode]);

  useEffect(() => {
    if (!isDraggingMiniPlayer || typeof window === 'undefined') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = miniDragStateRef.current;

      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const nextPosition = clampMiniPlayerPosition(
        {
          x: dragState.originX + (event.clientX - dragState.startX),
          y: dragState.originY + (event.clientY - dragState.startY),
        },
        window.innerWidth,
        window.innerHeight,
        miniPlayerSize,
        isDesktop
      );

      setMiniPlayerPosition(nextPosition);
    };

    const handlePointerRelease = (event: PointerEvent) => {
      const dragState = miniDragStateRef.current;

      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      miniDragStateRef.current = null;
      setIsDraggingMiniPlayer(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
    };
  }, [isDesktop, isDraggingMiniPlayer, miniPlayerSize]);

  const playerShellStyle: CSSProperties = isInlineMode
    ? isFullscreen
      ? {
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 10030,
        }
      : inlineRect
      ? {
          position: 'fixed',
          top: inlineRect.top,
          left: inlineRect.left,
          width: inlineRect.width,
          height: inlineRect.height,
          zIndex: 35,
        }
      : {
          position: 'fixed',
          inset: 0,
          width: 0,
          height: 0,
          opacity: 0,
          pointerEvents: 'none',
          zIndex: 35,
        }
    : isMiniMode && miniPlayerPosition
      ? {
          position: 'fixed',
          top: miniPlayerPosition.y,
          left: miniPlayerPosition.x,
          width: miniPlayerSize.width,
          height: miniPlayerSize.height,
          zIndex: 10020,
        }
      : {
          position: 'fixed',
          top: 0,
          left: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
          zIndex: -1,
        };

  const handleLoadStart = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    clearFatalError();
    setPlaybackPhaseSafe('loading');
    setBufferedUntil(0);
    showControls(true);
  }, [clearFatalError, setPlaybackPhaseSafe, showControls]);

  const handleLoadedMetadata = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    setDuration(Number.isFinite(videoElement.duration) ? videoElement.duration : 0);
    setCurrentTime(Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : 0);
    syncBufferedProgress();
  }, [syncBufferedProgress]);

  const handleCanPlay = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    clearFatalError();

    if (!videoElement) {
      return;
    }

    setDuration(Number.isFinite(videoElement.duration) ? videoElement.duration : 0);
    syncBufferedProgress();

    if (pendingAutoplayRef.current) {
      pendingAutoplayRef.current = false;
      void videoElement.play().catch(() => {
        setPlaybackPhaseSafe('paused');
      });
      return;
    }

    setPlaybackPhaseSafe(videoElement.paused ? 'paused' : 'playing');
  }, [clearFatalError, setPlaybackPhaseSafe, syncBufferedProgress]);

  const handlePlaying = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    clearFatalError();
    setHasStartedPlayback(true);
    setPlaybackPhaseSafe('playing');
  }, [clearFatalError, setPlaybackPhaseSafe]);

  const handlePause = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement || videoElement.ended) {
      return;
    }

    setPlaybackPhaseSafe('paused');
    setControlsVisible(true);
  }, [setPlaybackPhaseSafe]);

  const handleEnded = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    setPlaybackPhaseSafe('ended');
    setControlsVisible(true);
  }, [setPlaybackPhaseSafe]);

  const handleWaiting = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement || videoElement.ended) {
      return;
    }

    clearFatalError();
    setPlaybackPhaseSafe(videoElement.currentTime > 0 ? 'buffering' : 'loading');
    syncBufferedProgress();
  }, [clearFatalError, setPlaybackPhaseSafe, syncBufferedProgress]);

  const handleTimeUpdate = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    setCurrentTime(videoElement.currentTime || 0);
    syncBufferedProgress();

    if (
      !videoElement.paused &&
      !videoElement.ended &&
      (playbackPhaseRef.current === 'loading' || playbackPhaseRef.current === 'buffering')
    ) {
      clearFatalError();
      setPlaybackPhaseSafe('playing');
    }
  }, [clearFatalError, setPlaybackPhaseSafe, syncBufferedProgress]);

  const handleVideoError = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current as IOSVideoElement | null;
    const fallbackUrl = activeSource?.fallbackUrl?.trim() || '';

    if (!videoElement || !activeSource || videoElement.networkState === HTMLMediaElement.NETWORK_EMPTY) {
      return;
    }

    if (
      fallbackUrl &&
      fallbackUrl !== activeSource.sourceUrl &&
      fallbackSourceRef.current !== fallbackUrl
    ) {
      clearFatalError();
      fallbackSourceRef.current = fallbackUrl;
      retriedCurrentSourceRef.current = false;
      startupGraceUntilRef.current = Date.now() + STARTUP_ERROR_GRACE_MS;
      lastAssignedSourceKeyRef.current = `${activeSource.sessionKey}|${fallbackUrl}`;
      setPlaybackPhaseSafe('loading');
      videoElement.pause();
      videoElement.preload = 'metadata';
      videoElement.setAttribute('preload', 'metadata');
      videoElement.src = fallbackUrl;
      videoElement.load();

      if (pendingAutoplayRef.current) {
        void videoElement.play().catch(() => {
          setPlaybackPhaseSafe('paused');
        });
      }
      return;
    }

    scheduleFatalError(
      'Video failed to load. Please try again in a moment or switch to another source.'
    );
  }, [activeSource, clearFatalError, scheduleFatalError, setPlaybackPhaseSafe]);

  const handleShellKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isInlineMode) {
        return;
      }

      if (event.repeat) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const targetTagName = target?.tagName?.toLowerCase();

      if (targetTagName === 'input' || targetTagName === 'button') {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.stopPropagation();
        event.preventDefault();
        seekBy(-10);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.stopPropagation();
        event.preventDefault();
        seekBy(10);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.stopPropagation();
        event.preventDefault();
        adjustVolumeBy(0.05);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.stopPropagation();
        event.preventDefault();
        adjustVolumeBy(-0.05);
        return;
      }

      if (event.key === ' ' || event.key.toLowerCase() === 'k') {
        event.stopPropagation();
        event.preventDefault();
        togglePlayPause();
        return;
      }

      if (event.key.toLowerCase() === 'f') {
        event.stopPropagation();
        event.preventDefault();
        void tryEnterFullscreen();
        return;
      }

      if (event.key.toLowerCase() === 'm') {
        event.stopPropagation();
        event.preventDefault();
        toggleMute();
      }
    },
    [adjustVolumeBy, isInlineMode, seekBy, toggleMute, togglePlayPause, tryEnterFullscreen]
  );

  useEffect(() => {
    if (!activeSource || !isInlineMode || typeof window === 'undefined') {
      return;
    }

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const targetTagName = target?.tagName?.toLowerCase();

      if (
        targetTagName === 'input' ||
        targetTagName === 'textarea' ||
        targetTagName === 'button' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekBy(-10);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekBy(10);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        adjustVolumeBy(0.05);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        adjustVolumeBy(-0.05);
        return;
      }

      if (event.key === ' ' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePlayPause();
        return;
      }

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void tryEnterFullscreen();
        return;
      }

      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    activeSource,
    adjustVolumeBy,
    isInlineMode,
    seekBy,
    toggleMute,
    togglePlayPause,
    tryEnterFullscreen,
  ]);

  const handleSurfaceClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (isMiniMode) {
      showControls();
      return;
    }

    if (event.detail >= 2) {
      clearClickIntentTimer();

      if (isMobileInlineMode) {
        const rect = event.currentTarget.getBoundingClientRect();
        const clickOffset = event.clientX - rect.left;
        seekBy(clickOffset >= rect.width / 2 ? 10 : -10);
        return;
      }

      void tryEnterFullscreen();
      return;
    }

    showControls();

    if (isMobileInlineMode) {
      return;
    }

    clearClickIntentTimer();
    clickIntentTimerRef.current = setTimeout(() => {
      togglePlayPause();
      clickIntentTimerRef.current = null;
    }, 220);
  }, [
    clearClickIntentTimer,
    isMiniMode,
    isMobileInlineMode,
    seekBy,
    showControls,
    togglePlayPause,
    tryEnterFullscreen,
  ]);

  const handleScrubberPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!duration || !scrubberRef.current) {
        return;
      }

      const rect = scrubberRef.current.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      setHoverPreviewRatio(ratio);
      setHoverPreviewTime(duration * ratio);
    },
    [duration]
  );

  const handleScrubberPointerLeave = useCallback(() => {
    setHoverPreviewRatio(null);
    setHoverPreviewTime(null);
  }, []);

  const handleMiniDragStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isMiniMode || !miniPlayerPosition) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      showControls(true);
      miniDragStateRef.current = {
        pointerId: event.pointerId,
        originX: miniPlayerPosition.x,
        originY: miniPlayerPosition.y,
        startX: event.clientX,
        startY: event.clientY,
      };
      setIsDraggingMiniPlayer(true);
    },
    [isMiniMode, miniPlayerPosition, showControls]
  );

  const handleShellPointerMove = useCallback(() => {
    if (!isMiniMode) {
      showControls();
    }
  }, [isMiniMode, showControls]);

  const handleShellPointerLeave = useCallback(() => {
    if (!isMiniMode && playbackPhase === 'playing' && !settingsOpen) {
      clearHideControlsTimer();
      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, CONTROL_HIDE_DELAY_MS / 2);
    }

    handleScrubberPointerLeave();
  }, [
    clearHideControlsTimer,
    handleScrubberPointerLeave,
    isMiniMode,
    playbackPhase,
    settingsOpen,
  ]);

  const bufferedPercent =
    duration > 0 ? clamp((bufferedUntil / duration) * 100, 0, 100) : 0;
  const playedPercent =
    duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0;
  const activeTimeLabel = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  const showCenterAction =
    !isMiniMode &&
    (playbackPhase === 'paused' ||
      playbackPhase === 'ended' ||
      playbackPhase === 'loading' ||
      playbackPhase === 'buffering' ||
      controlsVisible);

  const volumeIcon =
    isMuted || volume <= 0.001 ? (
      <VolumeX size={18} />
    ) : volume < 0.55 ? (
      <Volume1 size={18} />
    ) : (
      <Volume2 size={18} />
    );

  const contextValue = useMemo<PlaybackContextValue>(
    () => ({
      activeSource,
      playbackPhase,
      fatalErrorMessage,
      currentTime,
      duration,
      videoElement: videoElementState,
      setPlaybackSource,
      registerInlineHost: setInlineHost,
      clearPlayback,
      togglePlayPause,
      seekBy,
      openFullscreen: tryEnterFullscreen,
      openWatchView,
    }),
    [
      activeSource,
      clearPlayback,
      currentTime,
      duration,
      fatalErrorMessage,
      openWatchView,
      playbackPhase,
      seekBy,
      setPlaybackSource,
      togglePlayPause,
      tryEnterFullscreen,
      videoElementState,
    ]
  );

  return (
    <PlaybackContext.Provider value={contextValue}>
      {children}
      {activeSource ? (
        <div
          ref={shellRef}
          style={{ ...playerShellStyle, WebkitTapHighlightColor: 'transparent' }}
          className={
            isInlineMode
              ? 'overflow-hidden bg-black outline-none focus:outline-none focus-visible:outline-none md:rounded-[28px]'
              : isMiniMode
                ? 'overflow-hidden rounded-[22px] border border-white/10 bg-black outline-none shadow-[0_25px_70px_rgba(0,0,0,0.5)] backdrop-blur-xl focus:outline-none focus-visible:outline-none'
                : 'overflow-hidden bg-black'
          }
          tabIndex={isInlineMode ? 0 : -1}
          onKeyDown={handleShellKeyDown}
          onPointerMove={handleShellPointerMove}
          onPointerDown={() => {
            showControls();
            if (isDesktop) {
              shellRef.current?.focus({ preventScroll: true });
            }
          }}
          onPointerLeave={handleShellPointerLeave}
        >
          <div className="relative h-full w-full bg-black">
            <video
              ref={setVideoElement}
              poster={activeSource.poster || ''}
              preload="metadata"
              playsInline
              autoPlay={Boolean(activeSource.autoplay)}
              controls={false}
              style={{ WebkitTapHighlightColor: 'transparent' }}
              className="h-full w-full object-contain bg-black"
              onLoadStart={handleLoadStart}
              onLoadedMetadata={handleLoadedMetadata}
              onCanPlay={handleCanPlay}
              onPlaying={handlePlaying}
              onPlay={handlePlaying}
              onPause={handlePause}
              onEnded={handleEnded}
              onWaiting={handleWaiting}
              onStalled={handleWaiting}
              onSeeking={handleWaiting}
              onTimeUpdate={handleTimeUpdate}
              onProgress={syncBufferedProgress}
              onDurationChange={handleLoadedMetadata}
              onError={handleVideoError}
            />

            {!isMiniMode ? (
              <button
                type="button"
                className="absolute inset-0 z-[1] bg-transparent"
                aria-label={playbackPhase === 'playing' ? 'Pause video' : 'Play video'}
                onClick={handleSurfaceClick}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              />
            ) : null}

            <div
              className={`pointer-events-none absolute inset-0 z-[2] transition-opacity duration-300 ${
                controlsVisible || playbackPhase !== 'playing'
                  ? 'opacity-100'
                  : 'opacity-0'
              }`}
            >
              <div
                className={`absolute inset-0 transition-opacity duration-300 ${
                  isMiniMode
                    ? 'bg-transparent'
                    : 'bg-gradient-to-t from-black/85 via-black/22 to-black/42'
                } ${
                  controlsVisible || playbackPhase !== 'playing'
                    ? 'opacity-100'
                    : 'opacity-0'
                }`}
              />

              {isInlineMode ? (
                <>
                  <div
                    className={`pointer-events-auto absolute left-3 right-3 top-3 flex items-start justify-between gap-3 transition-all duration-300 md:left-4 md:right-4 md:top-4 ${
                      controlsVisible || playbackPhase !== 'playing'
                        ? 'translate-y-0 opacity-100'
                        : '-translate-y-2 opacity-0'
                    }`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {isDesktopInlineMode ? (
                      <div className="min-w-0 rounded-full border border-white/10 bg-black/44 px-3 py-2 backdrop-blur-xl">
                        <p className="max-w-[240px] truncate text-[10px] font-black uppercase tracking-[0.24em] text-white/70 md:max-w-[420px]">
                          Now Playing
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold text-white md:text-base">
                          {activeSource.title}
                        </p>
                      </div>
                    ) : (
                      <div />
                    )}

                    <div className="flex items-center gap-2">
                      <PlayerShellButton
                        ariaLabel={castButtonAriaLabel}
                        onClick={handleCastButtonClick}
                        className={`${isMobileInlineMode ? 'h-9 w-9' : ''} ${
                          isCasting ? 'border-[#D90429]/45 bg-[#D90429]/18 text-[#FFD7DF]' : ''
                        }`}
                      >
                        <Cast size={isMobileInlineMode ? 15 : 18} />
                      </PlayerShellButton>
                      <PlayerShellButton
                        ariaLabel="Player settings"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSettingsOpen((currentState) => !currentState);
                          showControls(true);
                        }}
                        className={isMobileInlineMode ? 'h-9 w-9' : ''}
                      >
                        <Settings2 size={isMobileInlineMode ? 15 : 18} />
                      </PlayerShellButton>
                      <PlayerShellButton
                        ariaLabel={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        onClick={(event) => {
                          event.stopPropagation();
                          void tryEnterFullscreen();
                        }}
                        className={isMobileInlineMode ? 'h-9 w-9' : ''}
                      >
                        {isFullscreen ? (
                          <Minimize size={isMobileInlineMode ? 15 : 18} />
                        ) : (
                          <Maximize size={isMobileInlineMode ? 15 : 18} />
                        )}
                      </PlayerShellButton>
                    </div>
                  </div>

                  {settingsOpen ? (
                    <div
                      ref={settingsMenuRef}
                      className="pointer-events-auto absolute right-3 top-[4.45rem] z-20 w-52 rounded-2xl border border-white/10 bg-[#0E121A]/92 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.42)] backdrop-blur-2xl md:right-4"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-white/70">
                          Playback
                        </p>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/72">
                          Auto Quality
                        </span>
                      </div>

                      <div className="space-y-1">
                        {PLAYBACK_RATES.map((rateOption) => {
                          const isActiveRate = Math.abs(rateOption - playbackRate) < 0.001;
                          return (
                            <button
                              key={`speed-${rateOption}`}
                              type="button"
                              onClick={() => setPlaybackRateAndPersist(rateOption)}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                                isActiveRate
                                  ? 'bg-[#D90429]/16 text-white'
                                  : 'text-white/74 hover:bg-white/6 hover:text-white'
                              }`}
                            >
                              <span>Speed</span>
                              <span>{formatPlaybackRate(rateOption)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {isDesktopInlineMode && showCenterAction ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-5">
                      {playbackPhase === 'loading' || playbackPhase === 'buffering' ? (
                        <StreamLoadingIndicator />
                      ) : (
                        <button
                          type="button"
                          className="pointer-events-auto inline-flex h-20 w-20 items-center justify-center rounded-full border border-white/12 bg-black/42 text-white shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-all hover:scale-[1.03] hover:bg-black/58"
                          aria-label={playbackPhase === 'playing' ? 'Pause video' : 'Play video'}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePlayPause();
                          }}
                        >
                          {playbackPhase === 'playing' ? (
                            <Pause size={30} />
                          ) : (
                            <Play size={30} className="translate-x-[2px]" />
                          )}
                        </button>
                      )}
                    </div>
                  ) : null}

                  {isMobileInlineMode ? (
                    <>
                      <div
                        className={`pointer-events-auto absolute inset-x-0 top-[48%] z-20 flex -translate-y-1/2 items-center justify-center gap-3 px-4 transition-all duration-300 ${
                          controlsVisible || playbackPhase !== 'playing'
                            ? 'opacity-100'
                            : 'opacity-0'
                        }`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {playbackPhase === 'loading' || playbackPhase === 'buffering' ? (
                          <StreamLoadingIndicator compact />
                        ) : playbackPhase === 'paused' || playbackPhase === 'ended' ? (
                          <button
                            type="button"
                            className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#D90429] text-white shadow-[0_16px_40px_rgba(217,4,41,0.42)] transition-transform hover:scale-[1.02]"
                            aria-label="Play video"
                            onClick={(event) => {
                              event.stopPropagation();
                              togglePlayPause();
                            }}
                          >
                            <Play size={24} className="translate-x-[1px]" />
                          </button>
                        ) : (
                          <>
                            <PlayerShellButton
                              ariaLabel="Rewind 10 seconds"
                              onClick={(event) => {
                                event.stopPropagation();
                                seekBy(-10);
                              }}
                              className="h-10 w-10"
                            >
                              <SkipBack size={15} />
                            </PlayerShellButton>
                            <PlayerShellButton
                              ariaLabel="Pause video"
                              onClick={(event) => {
                                event.stopPropagation();
                                togglePlayPause();
                              }}
                              className="h-12 w-12 bg-black/58"
                            >
                              <Pause size={18} />
                            </PlayerShellButton>
                            <PlayerShellButton
                              ariaLabel="Forward 10 seconds"
                              onClick={(event) => {
                                event.stopPropagation();
                                seekBy(10);
                              }}
                              className="h-10 w-10"
                            >
                              <SkipForward size={15} />
                            </PlayerShellButton>
                          </>
                        )}
                      </div>

                      <div
                        className={`pointer-events-auto absolute inset-x-0 bottom-0 z-20 px-3 pb-3 transition-all duration-300 ${
                          controlsVisible || playbackPhase !== 'playing'
                            ? 'translate-y-0 opacity-100'
                            : 'translate-y-5 opacity-0'
                        }`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div
                          ref={scrubberRef}
                          className="relative mb-2"
                          onPointerMove={handleScrubberPointerMove}
                          onPointerLeave={handleScrubberPointerLeave}
                        >
                          <div className="relative h-2 rounded-full bg-white/14">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-white/26"
                              style={{ width: `${bufferedPercent}%` }}
                            />
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-[#D90429]"
                              style={{ width: `${playedPercent}%` }}
                            />
                            <input
                              type="range"
                              min={0}
                              max={Math.max(duration, 0)}
                              step={0.1}
                              value={Math.min(currentTime, duration || 0)}
                              className="player-range absolute inset-0 z-10 h-full w-full"
                              onChange={(event) => {
                                seekTo(Number(event.target.value));
                              }}
                              onInput={() => showControls(true)}
                            />
                          </div>

                          {hoverPreviewTime !== null && hoverPreviewRatio !== null && duration > 0 ? (
                            <div
                              className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-full border border-white/10 bg-black/84 px-2 py-1 text-[9px] font-black tracking-[0.18em] text-white/86 backdrop-blur-xl"
                              style={{ left: `${hoverPreviewRatio * 100}%` }}
                            >
                              {formatTime(hoverPreviewTime)}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center justify-center">
                          <div className="rounded-full border border-white/10 bg-black/42 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/82">
                            {activeTimeLabel}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : null}

                  {isDesktopInlineMode ? (
                  <div
                    className={`pointer-events-auto absolute inset-x-0 bottom-0 z-20 px-3 pb-3 transition-all duration-300 md:px-4 md:pb-4 ${
                      controlsVisible || playbackPhase !== 'playing'
                        ? 'translate-y-0 opacity-100'
                        : 'translate-y-5 opacity-0'
                    }`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="px-1 py-2 md:px-1">
                      <div
                        ref={scrubberRef}
                        className="relative mb-3"
                        onPointerMove={handleScrubberPointerMove}
                        onPointerLeave={handleScrubberPointerLeave}
                      >
                        <div className="relative h-2.5 rounded-full bg-white/10">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                            style={{ width: `${bufferedPercent}%` }}
                          />
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-[#D90429]"
                            style={{ width: `${playedPercent}%` }}
                          />
                          <input
                            type="range"
                            min={0}
                            max={Math.max(duration, 0)}
                            step={0.1}
                            value={Math.min(currentTime, duration || 0)}
                            className="player-range absolute inset-0 z-10 h-full w-full"
                            onChange={(event) => {
                              seekTo(Number(event.target.value));
                            }}
                            onInput={() => showControls(true)}
                          />
                        </div>

                        {hoverPreviewTime !== null && hoverPreviewRatio !== null && duration > 0 ? (
                          <div
                            className="pointer-events-none absolute -top-9 -translate-x-1/2 rounded-full border border-white/10 bg-black/84 px-2.5 py-1 text-[10px] font-black tracking-[0.18em] text-white/86 backdrop-blur-xl"
                            style={{ left: `${hoverPreviewRatio * 100}%` }}
                          >
                            {formatTime(hoverPreviewTime)}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-2 md:gap-3">
                          <PlayerShellButton
                            ariaLabel="Rewind 10 seconds"
                            onClick={(event) => {
                              event.stopPropagation();
                              seekBy(-10);
                            }}
                          >
                            <SkipBack size={18} />
                          </PlayerShellButton>
                          <PlayerShellButton
                            ariaLabel={playbackPhase === 'playing' ? 'Pause video' : 'Play video'}
                            onClick={(event) => {
                              event.stopPropagation();
                              togglePlayPause();
                            }}
                            className="h-12 w-12 md:h-14 md:w-14"
                          >
                            {playbackPhase === 'playing' ? (
                              <Pause size={20} />
                            ) : (
                              <Play size={20} className="translate-x-[1px]" />
                            )}
                          </PlayerShellButton>
                          <PlayerShellButton
                            ariaLabel="Forward 10 seconds"
                            onClick={(event) => {
                              event.stopPropagation();
                              seekBy(10);
                            }}
                          >
                            <SkipForward size={18} />
                          </PlayerShellButton>

                          <div className="ml-1 rounded-full border border-white/10 bg-black/38 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white/80">
                            {activeTimeLabel}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleMute();
                            }}
                            className="inline-flex h-11 items-center gap-2 rounded-full border border-white/10 bg-black/36 px-3 text-white transition-colors hover:border-white/20 hover:bg-black/54"
                            aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                          >
                            {volumeIcon}
                            <span className="hidden text-[11px] font-black uppercase tracking-[0.16em] text-white/76 md:inline">
                              Audio
                            </span>
                          </button>

                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={isMuted ? 0 : volume}
                            className="player-volume-range hidden w-24 md:block"
                            aria-label="Volume"
                            onChange={(event) => {
                              updateVolumeState(Number(event.target.value), false);
                              showControls(true);
                            }}
                          />

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              cyclePlaybackRate();
                            }}
                            className="rounded-full border border-white/10 bg-black/36 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white/78 transition-colors hover:border-white/20 hover:bg-black/54"
                          >
                            Speed {formatPlaybackRate(playbackRate)}
                          </button>

                          <PlayerShellButton
                            ariaLabel={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                            onClick={(event) => {
                              event.stopPropagation();
                              void tryEnterFullscreen();
                            }}
                          >
                            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                          </PlayerShellButton>
                        </div>
                      </div>
                    </div>
                  </div>
                  ) : null}
                </>
              ) : null}

              {isMiniMode ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      showControls();
                    }}
                    className="pointer-events-auto absolute inset-0"
                    aria-label={`Show controls for ${activeSource.title}`}
                  />

                  <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
                    <button
                      type="button"
                      aria-label="Move mini player"
                      onPointerDown={handleMiniDragStart}
                      className="pointer-events-auto inline-flex h-8 w-8 touch-none items-center justify-center rounded-full border border-white/10 bg-black/54 text-white/80 backdrop-blur-xl"
                    >
                      <GripHorizontal size={15} />
                    </button>

                    <div className="pointer-events-auto flex items-center gap-2">
                      <PlayerShellButton
                        ariaLabel="Return to full player"
                        onClick={(event) => {
                          event.stopPropagation();
                          openWatchView();
                        }}
                        className="h-8 w-8"
                      >
                        <Maximize size={14} />
                      </PlayerShellButton>
                      <PlayerShellButton
                        ariaLabel="Close mini player"
                        onClick={(event) => {
                          event.stopPropagation();
                          clearPlayback();
                        }}
                        className="h-8 w-8 text-white/80"
                      >
                        <X size={14} />
                      </PlayerShellButton>
                    </div>
                  </div>

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
                    <div className="p-1">
                      <div className="pointer-events-auto flex items-center justify-center gap-4">
                        <PlayerShellButton
                          ariaLabel="Rewind 10 seconds"
                          onClick={(event) => {
                            event.stopPropagation();
                            seekBy(-10);
                          }}
                          className="h-9 w-9 bg-black/42"
                        >
                          <SkipBack size={15} />
                        </PlayerShellButton>

                        <PlayerShellButton
                          ariaLabel={playbackPhase === 'playing' ? 'Pause video' : 'Play video'}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePlayPause();
                          }}
                          className="h-11 w-11 bg-black/52"
                        >
                          {playbackPhase === 'playing' ? (
                            <Pause size={18} />
                          ) : (
                            <Play size={18} className="translate-x-[1px]" />
                          )}
                        </PlayerShellButton>

                        <PlayerShellButton
                          ariaLabel="Forward 10 seconds"
                          onClick={(event) => {
                            event.stopPropagation();
                            seekBy(10);
                          }}
                          className="h-9 w-9 bg-black/42"
                        >
                          <SkipForward size={15} />
                        </PlayerShellButton>
                      </div>

                      <div className="relative mt-3 h-2 rounded-full bg-white/10">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                          style={{ width: `${bufferedPercent}%` }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-[#D90429]"
                          style={{ width: `${playedPercent}%` }}
                        />
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.16em] text-white/70">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {isCasting ? (
              <div className="pointer-events-none absolute left-3 top-3 z-30 flex max-w-[78%] items-center gap-2 rounded-full border border-white/10 bg-black/58 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white/84 backdrop-blur-xl md:left-4 md:top-4 md:text-[11px]">
                <Cast size={14} className="text-[#FFD7DF]" />
                <span className="truncate">
                  {isGoogleCasting
                    ? `Casting to ${castSnapshot.deviceName || 'Chromecast'}`
                    : 'AirPlay Active'}
                </span>
              </div>
            ) : null}

            {castFeedbackMessage ? (
              <div className="pointer-events-none absolute left-1/2 top-4 z-30 w-[min(92%,420px)] -translate-x-1/2 rounded-full border border-white/10 bg-black/68 px-4 py-2 text-center text-[10px] font-black uppercase tracking-[0.18em] text-white/86 backdrop-blur-xl md:text-[11px]">
                {castFeedbackMessage}
              </div>
            ) : null}

            {fatalErrorMessage ? (
              <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/78 px-5 text-center">
                <div className="rounded-full border border-[#D90429]/28 bg-[#D90429]/12 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-[#FFB3C1]">
                  Playback Error
                </div>
                <p className="mt-4 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-white">
                  <AlertTriangle size={16} className="text-[#FFB3C1]" />
                  Video failed to load
                </p>
                <p className="mt-3 max-w-md text-xs leading-6 text-white/70 md:text-sm">
                  {fatalErrorMessage}
                </p>
              </div>
            ) : null}

            {desktopSeekFeedback ? (
              <div
                className={`pointer-events-none absolute inset-y-0 z-30 flex items-center ${
                  desktopSeekFeedbackSide === 'left'
                    ? 'left-0 justify-start pl-[8%]'
                    : 'right-0 justify-end pr-[8%]'
                }`}
              >
                <div
                  className={`rounded-full border border-white/12 bg-black/62 font-black uppercase tracking-[0.22em] text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)] ${
                    isDesktop ? 'px-6 py-3 text-lg' : 'px-4 py-2 text-sm'
                  }`}
                >
                  {desktopSeekFeedback}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const context = useContext(PlaybackContext);

  if (!context) {
    throw new Error('usePlayback must be used within PlaybackProvider.');
  }

  return context;
}

export function PersistentPlaybackHost({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  const { registerInlineHost } = usePlayback();
  const hostRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = hostRef.current;

    if (active && node) {
      registerInlineHost(node);

      return () => {
        registerInlineHost(null);
      };
    }

    registerInlineHost(null);

    return undefined;
  }, [active, registerInlineHost]);

  return <div ref={hostRef} className={className} />;
}
