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
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Cast,
  GripHorizontal,
  Lock,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Sun,
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
import {
  fetchPlaybackProgressRecord,
  getCachedPlaybackProgress,
  writeCachedPlaybackProgress,
} from '@/lib/playbackProgress';
import {
  clearStreamingVideoCache,
  releaseVideoElementMedia,
  trimStreamingCachePressure,
} from '@/lib/mobile/streamingCache';

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
  nextActionKey?: string;
  nextLabel?: string;
  nextCountdownLabel?: string;
  onNext?: () => void;
  previousActionKey?: string;
  previousLabel?: string;
  onPrevious?: () => void;
  disableResume?: boolean;
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

type IOSPresentationMode = 'inline' | 'fullscreen' | 'picture-in-picture';

type IOSVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitPresentationMode?: IOSPresentationMode;
  webkitSupportsPresentationMode?: (mode: IOSPresentationMode) => boolean;
  webkitSetPresentationMode?: (mode: IOSPresentationMode) => void;
  requestPictureInPicture?: () => Promise<unknown>;
  disablePictureInPicture?: boolean;
};

type PictureInPictureDocument = Document & {
  pictureInPictureElement?: Element | null;
  pictureInPictureEnabled?: boolean;
  exitPictureInPicture?: () => Promise<void>;
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

type PlaybackResumeSnapshot = {
  position: number;
  duration: number;
  paused: boolean;
  updatedAt: number;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

const STARTUP_ERROR_GRACE_MS = 2200;
const FATAL_ERROR_DELAY_MS = 1600;
const SOURCE_RETRY_BASE_DELAY_MS = 850;
const SOURCE_RETRY_MAX_DELAY_MS = 7500;
const SOURCE_RETRY_MAX_ATTEMPTS = 7;
const MANIFEST_WAKEUP_TIMEOUT_MS = 3000;
const LOADING_WATCHDOG_DELAY_MS = 9500;
const STALL_RECOVERY_DELAY_MS = 4500;
const HARD_STALL_RECOVERY_DELAY_MS = 10000;
const STALL_PROGRESS_EPSILON_SECONDS = 0.15;
const SEEK_BUMP_SECONDS = 0.22;
const NEXT_AUTOPLAY_COUNTDOWN_SECONDS = 5;
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
const BRIGHTNESS_STORAGE_KEY = 'ugmovies247.player.brightness';
const PIP_HINT_STORAGE_KEY = 'ugmovies247.player.pip-hint-seen';
const SESSION_PROGRESS_STORAGE_KEY = 'ugmovies247.player.session-progress.v1';
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
    (current.nextActionKey || '') === (next.nextActionKey || '') &&
    (current.nextLabel || '') === (next.nextLabel || '') &&
    (current.nextCountdownLabel || '') === (next.nextCountdownLabel || '') &&
    (current.previousActionKey || '') === (next.previousActionKey || '') &&
    (current.previousLabel || '') === (next.previousLabel || '') &&
    Boolean(current.disableResume) === Boolean(next.disableResume) &&
    current.poster === next.poster &&
    current.title === next.title &&
    current.description === next.description &&
    current.watchHref === next.watchHref
  );
}

function getPlaybackSourceKey(source: PlaybackSource | null) {
  return source ? `${source.sessionKey}|${source.sourceUrl}` : '';
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

function readSessionProgress(movieId: string): PlaybackResumeSnapshot | null {
  if (typeof window === 'undefined' || !movieId) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(`${SESSION_PROGRESS_STORAGE_KEY}:${movieId}`);
    const parsedValue = rawValue ? (JSON.parse(rawValue) as Partial<PlaybackResumeSnapshot>) : null;

    if (!parsedValue || typeof parsedValue.position !== 'number' || parsedValue.position < 1) {
      return null;
    }

    return {
      position: parsedValue.position,
      duration: typeof parsedValue.duration === 'number' ? parsedValue.duration : 0,
      paused: Boolean(parsedValue.paused),
      updatedAt: typeof parsedValue.updatedAt === 'number' ? parsedValue.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeSessionProgress(movieId: string, snapshot: PlaybackResumeSnapshot) {
  if (typeof window === 'undefined' || !movieId || snapshot.position < 1) {
    return;
  }

  try {
    window.localStorage.setItem(
      `${SESSION_PROGRESS_STORAGE_KEY}:${movieId}`,
      JSON.stringify(snapshot)
    );
  } catch {
    // Storage can be unavailable in restricted WebViews. The in-memory snapshot still works.
  }
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
  const ringStyle = {
    background:
      'conic-gradient(from 145deg, #D90429 0deg 64deg, rgba(255,255,255,0.98) 64deg 360deg)',
    WebkitMask:
      'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))',
    mask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))',
  };

  return (
    <span
      className={`relative inline-flex h-12 w-12 items-center justify-center rounded-full ${className}`}
      aria-label="Loading video"
      role="status"
    >
      <span
        className="absolute inset-0 animate-spin rounded-full shadow-[0_0_18px_rgba(217,4,41,0.28)]"
        style={ringStyle}
        aria-hidden="true"
      />
    </span>
  );
}

function PictureInPictureIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11" width="7" height="5" rx="1" />
    </svg>
  );
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

function useIsAndroidDevice() {
  const [isAndroidDevice, setIsAndroidDevice] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      return;
    }

    setIsAndroidDevice(/Android/i.test(navigator.userAgent || ''));
  }, []);

  return isAndroidDevice;
}

function useIsNativeAndroidAppShell() {
  const [isNativeAndroidAppShell, setIsNativeAndroidAppShell] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      return;
    }

    const userAgent = navigator.userAgent || '';
    const windowCapacitor = typeof window !== 'undefined'
      ? (window as typeof window & {
          Capacitor?: {
            getPlatform?: () => string;
            platform?: string;
          };
        }).Capacitor
      : null;
    const nativePlatform =
      typeof windowCapacitor?.getPlatform === 'function'
        ? windowCapacitor.getPlatform()
        : windowCapacitor?.platform || '';

    setIsNativeAndroidAppShell(
      /Android/i.test(userAgent) &&
        (/Ugmovies247App/i.test(userAgent) || nativePlatform === 'android')
    );
  }, []);

  return isNativeAndroidAppShell;
}

function useIsTouchDevice() {
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      return;
    }

    const hasTouchPoints = (navigator.maxTouchPoints || 0) > 0;
    const hasCoarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;

    setIsTouchDevice(hasTouchPoints || hasCoarsePointer);
  }, []);

  return isTouchDevice;
}

async function lockLandscapeOrientation() {
  if (typeof window === 'undefined') {
    return;
  }

  const orientation = window.screen?.orientation as ScreenOrientationWithLock | undefined;

  if (typeof orientation?.lock !== 'function') {
    return;
  }

  await orientation.lock('landscape').catch(async (error) => {
    console.log('Orientation lock rejected:', error);
    await orientation.lock('landscape-primary').catch((fallbackError) => {
      console.log('Orientation lock rejected:', fallbackError);
      // Some browsers/WebViews only allow orientation lock after fullscreen starts.
    });
  });
}

async function unlockScreenOrientation(preferPortrait = false) {
  if (typeof window === 'undefined') {
    return;
  }

  const orientation = window.screen?.orientation as ScreenOrientationWithLock | undefined;

  if (preferPortrait && typeof orientation?.lock === 'function') {
    await orientation.lock('portrait').catch(async () => {
      await orientation.lock?.('portrait-primary').catch(() => undefined);
    });
    return;
  }

  if (typeof orientation?.unlock === 'function') {
    orientation.unlock();
  }
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isDesktop = useIsDesktopViewport();
  const isIOSDevice = useIsIOSDevice();
  const isAndroidDevice = useIsAndroidDevice();
  const isNativeAndroidAppShell = useIsNativeAndroidAppShell();
  const isTouchDevice = useIsTouchDevice();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const scrubberRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const fatalErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const castFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickIntentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manifestWakeupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardStallRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextCountdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gestureIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipHintShownRef = useRef(false);
  const pendingAutoplayRef = useRef(false);
  const userPausedRef = useRef(false);
  const suppressNextPauseIntentRef = useRef(false);
  const retriedCurrentSourceRef = useRef(false);
  const sourceRetryCountRef = useRef(0);
  const startupGraceUntilRef = useRef(0);
  const lastAssignedSourceKeyRef = useRef('');
  const fallbackSourceRef = useRef('');
  const pendingResumeRef = useRef<{ sourceKey: string; position: number; applied: boolean } | null>(null);
  const lastProgressAtRef = useRef(Date.now());
  const lastProgressTimeRef = useRef(0);
  const lastKnownPlaybackRef = useRef<Record<string, PlaybackResumeSnapshot>>({});
  const lastSessionProgressPersistAtRef = useRef(0);
  const lastVolumeBeforeMuteRef = useRef(1);
  const playbackPhaseRef = useRef<PlaybackPhase>('idle');
  const castSnapshotRef = useRef<CastStateSnapshot>(getCastStateSnapshot());
  const lastPlaybackCacheSyncRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const lastWatchHistorySyncRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const miniDragStateRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const sideGestureStateRef = useRef<{
    pointerId: number;
    side: 'brightness' | 'volume';
    startY: number;
    startValue: number;
    moved: boolean;
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
  const [videoBrightness, setVideoBrightness] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [softLandscapeFullscreen, setSoftLandscapeFullscreen] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [pictureInPictureSupported, setPictureInPictureSupported] = useState(false);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [desktopSeekFeedback, setDesktopSeekFeedback] = useState('');
  const [desktopSeekFeedbackSide, setDesktopSeekFeedbackSide] = useState<'left' | 'right'>('right');
  const [castFeedbackMessage, setCastFeedbackMessage] = useState('');
  const [castSnapshot, setCastSnapshot] = useState<CastStateSnapshot>(() => getCastStateSnapshot());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isControlsLocked, setIsControlsLocked] = useState(false);
  const [gestureIndicator, setGestureIndicator] = useState<{
    side: 'brightness' | 'volume';
    value: number;
  } | null>(null);
  const [hoverPreviewTime, setHoverPreviewTime] = useState<number | null>(null);
  const [hoverPreviewRatio, setHoverPreviewRatio] = useState<number | null>(null);
  const [miniPlayerSize, setMiniPlayerSize] = useState<MiniPlayerSize>({
    width: DESKTOP_MINI_PLAYER_WIDTH,
    height: Math.round((DESKTOP_MINI_PLAYER_WIDTH * 9) / 16),
  });
  const [miniPlayerPosition, setMiniPlayerPosition] = useState<MiniPlayerPosition | null>(null);
  const [isDraggingMiniPlayer, setIsDraggingMiniPlayer] = useState(false);
  const [nextCountdownSeconds, setNextCountdownSeconds] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const effectiveFullscreen = isFullscreen || softLandscapeFullscreen;

  useEffect(() => {
    lastPlaybackCacheSyncRef.current = { key: '', at: 0 };
    lastWatchHistorySyncRef.current = { key: '', at: 0 };
  }, [activeSource?.sessionKey]);

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

  const clearSourceRetryTimer = useCallback(() => {
    if (sourceRetryTimerRef.current) {
      clearTimeout(sourceRetryTimerRef.current);
      sourceRetryTimerRef.current = null;
    }
  }, []);

  const clearManifestWakeupTimer = useCallback(() => {
    if (manifestWakeupTimerRef.current) {
      clearTimeout(manifestWakeupTimerRef.current);
      manifestWakeupTimerRef.current = null;
    }
  }, []);

  const clearLoadingWatchdogTimer = useCallback(() => {
    if (loadingWatchdogTimerRef.current) {
      clearTimeout(loadingWatchdogTimerRef.current);
      loadingWatchdogTimerRef.current = null;
    }
  }, []);

  const clearStallRecoveryTimers = useCallback(() => {
    if (stallRecoveryTimerRef.current) {
      clearTimeout(stallRecoveryTimerRef.current);
      stallRecoveryTimerRef.current = null;
    }

    if (hardStallRecoveryTimerRef.current) {
      clearTimeout(hardStallRecoveryTimerRef.current);
      hardStallRecoveryTimerRef.current = null;
    }
  }, []);

  const clearNextCountdownTimer = useCallback(() => {
    if (nextCountdownTimerRef.current) {
      clearTimeout(nextCountdownTimerRef.current);
      nextCountdownTimerRef.current = null;
    }

    if (nextCountdownIntervalRef.current) {
      clearInterval(nextCountdownIntervalRef.current);
      nextCountdownIntervalRef.current = null;
    }

    setNextCountdownSeconds(null);
  }, []);

  const clearGestureIndicatorTimer = useCallback(() => {
    if (gestureIndicatorTimerRef.current) {
      clearTimeout(gestureIndicatorTimerRef.current);
      gestureIndicatorTimerRef.current = null;
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

  const rememberPlaybackPosition = useCallback(
    (sourceOverride?: PlaybackSource | null) => {
      const source = sourceOverride === undefined ? activeSource : sourceOverride;

      if (!source?.movieId) {
        return;
      }

      const videoElement = videoRef.current;
      const position = Number.isFinite(videoElement?.currentTime)
        ? videoElement?.currentTime || 0
        : currentTime;
      const totalDuration = Number.isFinite(videoElement?.duration)
        ? videoElement?.duration || 0
        : duration;

      if (!Number.isFinite(position) || position < 1) {
        return;
      }

      const snapshot: PlaybackResumeSnapshot = {
        position,
        duration: Number.isFinite(totalDuration) ? totalDuration : 0,
        paused: videoElement ? videoElement.paused : playbackPhaseRef.current !== 'playing',
        updatedAt: Date.now(),
      };
      const sourceKey = getPlaybackSourceKey(source);

      if (sourceKey) {
        lastKnownPlaybackRef.current[sourceKey] = snapshot;
      }

      const sessionProgressKey = source.sessionKey || sourceKey || source.movieId;

      if (sessionProgressKey) {
        lastKnownPlaybackRef.current[`session:${sessionProgressKey}`] = snapshot;
        writeSessionProgress(sessionProgressKey, snapshot);
      }
    },
    [activeSource, currentTime, duration]
  );

  const resolveResumePosition = useCallback(
    (source: PlaybackSource, sourceKey: string) => {
      const sourceSnapshot = lastKnownPlaybackRef.current[sourceKey];
      const sessionProgressKey = source.sessionKey || sourceKey || source.movieId;
      const sessionSnapshot =
        lastKnownPlaybackRef.current[`session:${sessionProgressKey}`] ||
        readSessionProgress(sessionProgressKey);
      const cachedProgress = source.disableResume ? null : getCachedPlaybackProgress(source.movieId);
      const candidates = [
        sourceSnapshot?.position,
        sessionSnapshot?.position,
        cachedProgress && !cachedProgress.isFinished ? cachedProgress.lastPosition : 0,
      ]
        .filter((position): position is number => Number.isFinite(position) && position >= 1)
        .sort((left, right) => right - left);

      return candidates[0] || 0;
    },
    []
  );

  const updateVolumeState = useCallback((nextVolume: number, nextMuted?: boolean) => {
    const normalizedVolume = clamp(nextVolume, 0, 1);
    const shouldMute = nextMuted ?? normalizedVolume <= 0.001;

    if (normalizedVolume > 0.001) {
      lastVolumeBeforeMuteRef.current = normalizedVolume;
    }

    setVolume(normalizedVolume);
    setIsMuted(shouldMute);
  }, []);

  const updateBrightnessState = useCallback((nextBrightness: number) => {
    setVideoBrightness(clamp(nextBrightness, 0.18, 1));
  }, []);

  const showControls = useCallback(
    (keepOpen = false) => {
      if (isControlsLocked) {
        clearHideControlsTimer();
        setControlsVisible(false);
        setSettingsOpen(false);
        return;
      }

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
    [activeSource, clearHideControlsTimer, isControlsLocked, isDraggingMiniPlayer, settingsOpen]
  );

  const setVideoElement = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      setVideoElementState(node);

      if (node) {
        node.setAttribute('playsinline', 'true');
        node.setAttribute('webkit-playsinline', 'true');
        node.setAttribute('x-webkit-airplay', 'allow');
        node.volume = clamp(volume, 0, 1);
        node.muted = isMuted;
        node.playbackRate = playbackRate;
        (node as IOSVideoElement).disablePictureInPicture = false;
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

    setInlineRect((currentRect) => {
      if (
        !isDesktop &&
        currentRect &&
        Math.abs(currentRect.width - nextRect.width) < 2 &&
        Math.abs(currentRect.height - nextRect.height) < 2
      ) {
        return currentRect;
      }

      return nextRect;
    });
  }, [inlineHost, isDesktop]);

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
    window.addEventListener('scroll', syncInlineRect, { passive: true });

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncInlineRect);
      window.removeEventListener('scroll', syncInlineRect);
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

      if ((nextIsFullscreen || softLandscapeFullscreen) && !isDesktop) {
        void lockLandscapeOrientation();
      } else if (!nextIsFullscreen && !softLandscapeFullscreen) {
        void unlockScreenOrientation(true);
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
  }, [isDesktop, softLandscapeFullscreen, videoElementState]);

  useEffect(() => {
    if (!softLandscapeFullscreen || typeof document === 'undefined') {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      void unlockScreenOrientation(true);
    };
  }, [softLandscapeFullscreen]);

  useEffect(() => {
    const videoElement = videoElementState as IOSVideoElement | null;
    const pipDocument = document as PictureInPictureDocument;
    const canUseStandardPictureInPicture = Boolean(
      videoElement?.requestPictureInPicture &&
        pipDocument.pictureInPictureEnabled !== false
    );
    const canUseWebkitPictureInPicture = Boolean(
      videoElement?.webkitSupportsPresentationMode?.('picture-in-picture')
    );

    setPictureInPictureSupported(canUseStandardPictureInPicture || canUseWebkitPictureInPicture);
    setIsPictureInPicture(
      Boolean(pipDocument.pictureInPictureElement) ||
        videoElement?.webkitPresentationMode === 'picture-in-picture'
    );

    if (!videoElement) {
      return;
    }

    const handleEnterPictureInPicture = () => setIsPictureInPicture(true);
    const handleLeavePictureInPicture = () => setIsPictureInPicture(false);
    const handleWebkitPresentationModeChange = () => {
      setIsPictureInPicture(
        Boolean(pipDocument.pictureInPictureElement) ||
          videoElement.webkitPresentationMode === 'picture-in-picture'
      );
    };

    videoElement.addEventListener('enterpictureinpicture', handleEnterPictureInPicture);
    videoElement.addEventListener('leavepictureinpicture', handleLeavePictureInPicture);
    videoElement.addEventListener(
      'webkitpresentationmodechanged',
      handleWebkitPresentationModeChange
    );

    return () => {
      videoElement.removeEventListener('enterpictureinpicture', handleEnterPictureInPicture);
      videoElement.removeEventListener('leavepictureinpicture', handleLeavePictureInPicture);
      videoElement.removeEventListener(
        'webkitpresentationmodechanged',
        handleWebkitPresentationModeChange
      );
    };
  }, [videoElementState]);

  useEffect(() => {
    const storedVolume = clamp(readStoredNumber(VOLUME_STORAGE_KEY, 1), 0, 1);
    const storedMuted = readStoredBoolean(MUTE_STORAGE_KEY, false);
    const storedPlaybackRate = clamp(readStoredNumber(PLAYBACK_RATE_STORAGE_KEY, 1), 0.75, 2);
    const storedBrightness = clamp(readStoredNumber(BRIGHTNESS_STORAGE_KEY, 1), 0.18, 1);

    lastVolumeBeforeMuteRef.current = storedVolume > 0.001 ? storedVolume : 1;
    setVolume(storedVolume);
    setIsMuted(storedMuted);
    setPlaybackRate(storedPlaybackRate);
    setVideoBrightness(storedBrightness);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
      window.localStorage.setItem(MUTE_STORAGE_KEY, String(isMuted));
      window.localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(playbackRate));
      window.localStorage.setItem(BRIGHTNESS_STORAGE_KEY, String(videoBrightness));
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    videoElement.volume = clamp(volume, 0, 1);
    videoElement.muted = isMuted;
    videoElement.playbackRate = playbackRate;
  }, [isMuted, playbackRate, videoBrightness, volume]);

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
    if (typeof window === 'undefined') {
      return;
    }

    const persistBeforeExit = () => {
      rememberPlaybackPosition();
      void clearStreamingVideoCache('page-exit');
    };

    window.addEventListener('pagehide', persistBeforeExit);
    window.addEventListener('beforeunload', persistBeforeExit);

    return () => {
      window.removeEventListener('pagehide', persistBeforeExit);
      window.removeEventListener('beforeunload', persistBeforeExit);
    };
  }, [rememberPlaybackPosition]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const clearWhenBackgrounded = () => {
      if (document.visibilityState === 'hidden') {
        rememberPlaybackPosition();
        void clearStreamingVideoCache('app-background');
      }
    };

    document.addEventListener('visibilitychange', clearWhenBackgrounded);

    return () => {
      document.removeEventListener('visibilitychange', clearWhenBackgrounded);
    };
  }, [rememberPlaybackPosition]);

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
          suppressNextPauseIntentRef.current = true;
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
            userPausedRef.current = false;
            void videoElement.play().catch(() => {
              setPlaybackPhaseSafe('paused');
            });
          } else {
            userPausedRef.current = true;
            setPlaybackPhaseSafe('paused');
          }
        }
      }
    });
  }, [activeSource?.sourceUrl, clearFatalError, setPlaybackPhaseSafe]);

  const setPlaybackSource = useCallback(
    (nextSource: PlaybackSource | null) => {
      setActiveSourceState((currentSource) => {
        if (areSourcesEqual(currentSource, nextSource)) {
          return currentSource;
        }

        if (
          currentSource &&
          nextSource &&
          getPlaybackSourceKey(currentSource) === getPlaybackSourceKey(nextSource)
        ) {
          return {
            ...currentSource,
            ...nextSource,
            autoplay: Boolean(currentSource.autoplay || nextSource.autoplay),
          };
        }

        rememberPlaybackPosition(currentSource);
        return nextSource;
      });
    },
    [rememberPlaybackPosition]
  );

  const clearPlayback = useCallback(() => {
    rememberPlaybackPosition();
    clearClickIntentTimer();
    clearFatalError();
    clearSourceRetryTimer();
    clearManifestWakeupTimer();
    clearLoadingWatchdogTimer();
    clearStallRecoveryTimers();
    clearNextCountdownTimer();
    clearGestureIndicatorTimer();
    pendingAutoplayRef.current = false;
    userPausedRef.current = false;
    retriedCurrentSourceRef.current = false;
    sourceRetryCountRef.current = 0;
    fallbackSourceRef.current = '';
    startupGraceUntilRef.current = 0;
    lastAssignedSourceKeyRef.current = '';
    pendingResumeRef.current = null;
    lastPlaybackCacheSyncRef.current = { key: '', at: 0 };
    lastWatchHistorySyncRef.current = { key: '', at: 0 };
    setHasStartedPlayback(false);
    setActiveSourceState(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedUntil(0);
    setHoverPreviewTime(null);
    setHoverPreviewRatio(null);
    setSettingsOpen(false);
    setIsControlsLocked(false);
    setGestureIndicator(null);
    setSoftLandscapeFullscreen(false);
    setIsFullscreen(false);
    void unlockScreenOrientation(true);
    setPlaybackPhaseSafe('idle');

    const videoElement = videoRef.current;

    if (videoElement) {
      releaseVideoElementMedia(videoElement);
    }

    void clearStreamingVideoCache('clear-playback');
  }, [
    clearClickIntentTimer,
    clearFatalError,
    clearGestureIndicatorTimer,
    clearLoadingWatchdogTimer,
    clearManifestWakeupTimer,
    clearNextCountdownTimer,
    clearSourceRetryTimer,
    clearStallRecoveryTimers,
    rememberPlaybackPosition,
    setPlaybackPhaseSafe,
  ]);

  useEffect(() => {
    if (!activeSource && softLandscapeFullscreen) {
      setSoftLandscapeFullscreen(false);
      setIsFullscreen(false);
      void unlockScreenOrientation(true);
    }
  }, [activeSource, softLandscapeFullscreen]);

  const attemptSourceReload = useCallback(
    (reason: string) => {
      const videoElement = videoRef.current;

      if (!videoElement || !activeSource?.sourceUrl) {
        return;
      }

      const activeUrl = fallbackSourceRef.current || activeSource.sourceUrl;
      const activeSourceKey = `${activeSource.sessionKey}|${activeUrl}`;
      const currentPosition = Number.isFinite(videoElement.currentTime)
        ? videoElement.currentTime
        : currentTime;

      rememberPlaybackPosition();
      clearFatalError();
      clearManifestWakeupTimer();
      clearStallRecoveryTimers();

      if (currentPosition >= 1) {
        pendingResumeRef.current = {
          sourceKey: activeSourceKey,
          position: currentPosition,
          applied: false,
        };
      }

      lastAssignedSourceKeyRef.current = activeSourceKey;
      startupGraceUntilRef.current = Date.now() + STARTUP_ERROR_GRACE_MS;
      pendingAutoplayRef.current =
        !userPausedRef.current && (Boolean(activeSource.autoplay) || !videoElement.paused);
      setPlaybackPhaseSafe(currentPosition > 0 ? 'buffering' : 'loading');

      try {
        if (!videoElement.paused) {
          suppressNextPauseIntentRef.current = true;
          videoElement.pause();
        }
        releaseVideoElementMedia(videoElement);
        videoElement.preload = 'metadata';
        videoElement.src = activeUrl;
        videoElement.load();
        void trimStreamingCachePressure(`source-reload:${reason}`);
      } catch (error) {
        console.warn('[player] source reload failed', {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      activeSource,
      clearFatalError,
      clearManifestWakeupTimer,
      clearStallRecoveryTimers,
      currentTime,
      rememberPlaybackPosition,
      setPlaybackPhaseSafe,
    ]
  );

  const scheduleSourceRetry = useCallback(
    (reason: string) => {
      clearSourceRetryTimer();

      if (!activeSource?.sourceUrl) {
        return;
      }

      const nextAttempt = sourceRetryCountRef.current + 1;

      if (nextAttempt > SOURCE_RETRY_MAX_ATTEMPTS) {
        setFatalErrorMessage(
          'Video is taking too long to connect. Please check your network and try again.'
        );
        setPlaybackPhaseSafe('error');
        return;
      }

      const retryDelay = clamp(
        SOURCE_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, nextAttempt - 1),
        SOURCE_RETRY_BASE_DELAY_MS,
        SOURCE_RETRY_MAX_DELAY_MS
      );

      sourceRetryTimerRef.current = setTimeout(() => {
        sourceRetryTimerRef.current = null;
        sourceRetryCountRef.current = nextAttempt;
        attemptSourceReload(reason);
      }, retryDelay);
    },
    [activeSource?.sourceUrl, attemptSourceReload, clearSourceRetryTimer, setPlaybackPhaseSafe]
  );

  const scheduleManifestWakeup = useCallback(
    (reason: string) => {
      clearManifestWakeupTimer();

      if (!activeSource?.sourceUrl) {
        return;
      }

      manifestWakeupTimerRef.current = setTimeout(() => {
        manifestWakeupTimerRef.current = null;

        const videoElement = videoRef.current;

        if (
          !videoElement ||
          !activeSource?.sourceUrl ||
          videoElement.readyState >= HTMLMediaElement.HAVE_METADATA ||
          playbackPhaseRef.current === 'playing' ||
          playbackPhaseRef.current === 'paused'
        ) {
          return;
        }

        sourceRetryCountRef.current = Math.max(sourceRetryCountRef.current, 0);
        attemptSourceReload(reason);
      }, MANIFEST_WAKEUP_TIMEOUT_MS);
    },
    [activeSource?.sourceUrl, attemptSourceReload, clearManifestWakeupTimer]
  );

  const scheduleLoadingWatchdog = useCallback(
    (reason: string) => {
      clearLoadingWatchdogTimer();

      if (!activeSource?.sourceUrl) {
        return;
      }

      loadingWatchdogTimerRef.current = setTimeout(() => {
        loadingWatchdogTimerRef.current = null;

        const videoElement = videoRef.current;

        if (
          !videoElement ||
          !activeSource?.sourceUrl ||
          videoElement.ended ||
          playbackPhaseRef.current === 'playing' ||
          playbackPhaseRef.current === 'paused' ||
          playbackPhaseRef.current === 'ended'
        ) {
          return;
        }

        const readyForFrames = videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
        const noRecentProgress =
          Date.now() - lastProgressAtRef.current >= LOADING_WATCHDOG_DELAY_MS - 1000;

        if (readyForFrames && !noRecentProgress) {
          scheduleLoadingWatchdog(reason);
          return;
        }

        if (sourceRetryCountRef.current >= SOURCE_RETRY_MAX_ATTEMPTS) {
          setFatalErrorMessage(
            'Video is taking too long to connect. Please check your network and try again.'
          );
          setPlaybackPhaseSafe('error');
          return;
        }

        sourceRetryCountRef.current += 1;
        attemptSourceReload(reason);
        scheduleLoadingWatchdog(reason);
      }, LOADING_WATCHDOG_DELAY_MS);
    },
    [
      activeSource?.sourceUrl,
      attemptSourceReload,
      clearLoadingWatchdogTimer,
      setPlaybackPhaseSafe,
    ]
  );

  const recoverStalledPlayback = useCallback(
    (reason: string, forceReload = false) => {
      const videoElement = videoRef.current;

      if (
        !videoElement ||
        !activeSource?.sourceUrl ||
        videoElement.ended ||
        userPausedRef.current ||
        videoElement.paused ||
        playbackPhaseRef.current === 'paused' ||
        castSnapshotRef.current.transport === 'google-cast'
      ) {
        return;
      }

      const currentPosition = Number.isFinite(videoElement.currentTime)
        ? videoElement.currentTime
        : currentTime;
      const hasRecentProgress =
        Date.now() - lastProgressAtRef.current < STALL_RECOVERY_DELAY_MS &&
        Math.abs(currentPosition - lastProgressTimeRef.current) >= STALL_PROGRESS_EPSILON_SECONDS;

      if (!forceReload && hasRecentProgress) {
        return;
      }

      rememberPlaybackPosition();
      clearFatalError();
      setPlaybackPhaseSafe(currentPosition > 0 ? 'buffering' : 'loading');

      const safeDuration = Number.isFinite(videoElement.duration) && videoElement.duration > 0
        ? videoElement.duration
        : 0;
      const canSeekBump =
        !forceReload &&
        currentPosition > 0 &&
        (!safeDuration || currentPosition + SEEK_BUMP_SECONDS < safeDuration - 1);

      if (canSeekBump) {
        try {
          videoElement.currentTime = currentPosition + SEEK_BUMP_SECONDS;
          if (!userPausedRef.current) {
            void videoElement.play().catch(() => undefined);
          }
          return;
        } catch {
          // Fall through to a source reload if the WebView refuses the kick seek.
        }
      }

      scheduleSourceRetry(reason);
    },
    [
      activeSource?.sourceUrl,
      clearFatalError,
      currentTime,
      rememberPlaybackPosition,
      scheduleSourceRetry,
      setPlaybackPhaseSafe,
    ]
  );

  const scheduleStallRecovery = useCallback(
    (reason: string) => {
      clearStallRecoveryTimers();

      stallRecoveryTimerRef.current = setTimeout(() => {
        stallRecoveryTimerRef.current = null;
        recoverStalledPlayback(reason);
      }, STALL_RECOVERY_DELAY_MS);

      hardStallRecoveryTimerRef.current = setTimeout(() => {
        hardStallRecoveryTimerRef.current = null;
        recoverStalledPlayback(reason, true);
      }, HARD_STALL_RECOVERY_DELAY_MS);
    },
    [clearStallRecoveryTimers, recoverStalledPlayback]
  );

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

        const hasRecentProgress =
          Date.now() - lastProgressAtRef.current < HARD_STALL_RECOVERY_DELAY_MS;

        if (isMediaRecovering(videoElement, playbackPhaseRef.current) && hasRecentProgress) {
          return;
        }

        if (
          !retriedCurrentSourceRef.current ||
          sourceRetryCountRef.current < SOURCE_RETRY_MAX_ATTEMPTS
        ) {
          retriedCurrentSourceRef.current = true;
          setPlaybackPhaseSafe('loading');
          scheduleSourceRetry('fatal-error-delay');
          scheduleFatalError(message);
          return;
        }

        setFatalErrorMessage(message);
        setPlaybackPhaseSafe('error');
      }, Math.max(350, initialDelay));
    },
    [clearFatalErrorTimer, scheduleSourceRetry, setPlaybackPhaseSafe]
  );

  const applyPendingResume = useCallback(() => {
    const videoElement = videoRef.current;
    const pendingResume = pendingResumeRef.current;

    if (!videoElement || !activeSource?.sourceUrl || !pendingResume || pendingResume.applied) {
      return;
    }

    const currentSourceKey = lastAssignedSourceKeyRef.current || `${activeSource.sessionKey}|${activeSource.sourceUrl}`;

    if (pendingResume.sourceKey !== currentSourceKey) {
      return;
    }

    const safeDuration = Number.isFinite(videoElement.duration) && videoElement.duration > 0
      ? videoElement.duration
      : 0;
    const maxResumePosition = safeDuration > 0
      ? Math.max(0, safeDuration - 8)
      : pendingResume.position;
    const resumePosition = clamp(pendingResume.position, 0, maxResumePosition);

    const currentPosition = Number.isFinite(videoElement.currentTime)
      ? videoElement.currentTime || 0
      : 0;

    if (resumePosition < 1 || currentPosition >= Math.max(1, resumePosition - 1)) {
      pendingResumeRef.current = { ...pendingResume, applied: true };
      return;
    }

    try {
      videoElement.currentTime = resumePosition;
      setCurrentTime(resumePosition);
      lastProgressTimeRef.current = resumePosition;
      lastProgressAtRef.current = Date.now();
      pendingResumeRef.current = { ...pendingResume, applied: true };
    } catch {
      // Some mobile WebViews reject early seeks until canplay; canplay will retry.
    }
  }, [activeSource?.sessionKey, activeSource?.sourceUrl]);

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
    const resumePosition = resolveResumePosition(activeSource, nextSourceKey);

    clearFatalError();
    clearSourceRetryTimer();
    clearManifestWakeupTimer();
    clearLoadingWatchdogTimer();
    clearStallRecoveryTimers();
    clearNextCountdownTimer();
    startupGraceUntilRef.current = Date.now() + STARTUP_ERROR_GRACE_MS;
    userPausedRef.current = false;
    pendingAutoplayRef.current = shouldResumePlayback;
    retriedCurrentSourceRef.current = false;
    sourceRetryCountRef.current = 0;
    fallbackSourceRef.current = '';
    lastAssignedSourceKeyRef.current = nextSourceKey;
    const cachedProgress = activeSource.disableResume
      ? null
      : getCachedPlaybackProgress(activeSource.movieId);
    pendingResumeRef.current =
      resumePosition >= 1
        ? {
            sourceKey: nextSourceKey,
            position: resumePosition,
            applied: false,
          }
        : cachedProgress && !cachedProgress.isFinished && cachedProgress.lastPosition >= 10
          ? {
            sourceKey: nextSourceKey,
            position: cachedProgress.lastPosition,
            applied: false,
          }
          : null;
    lastProgressAtRef.current = Date.now();
    lastProgressTimeRef.current = resumePosition;
    setHasStartedPlayback(false);
    setCurrentTime(resumePosition);
    setDuration(0);
    setBufferedUntil(0);
    setPlaybackPhaseSafe('loading');

    try {
      if (!videoElement.paused) {
        suppressNextPauseIntentRef.current = true;
        videoElement.pause();
      }
      videoElement.currentTime = 0;
      releaseVideoElementMedia(videoElement);
      void clearStreamingVideoCache('source-switch');
      videoElement.preload = 'metadata';
      videoElement.src = activeSource.sourceUrl;
      videoElement.load();
      scheduleManifestWakeup('manifest-timeout');
      scheduleLoadingWatchdog('source-assignment-watchdog');
    } catch (error) {
      console.warn('[player] failed to assign source', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    activeSource?.autoplay,
    activeSource?.disableResume,
    activeSource?.movieId,
    activeSource?.sessionKey,
    activeSource?.sourceUrl,
    videoElementState,
    clearFatalError,
    clearLoadingWatchdogTimer,
    clearManifestWakeupTimer,
    clearNextCountdownTimer,
    clearSourceRetryTimer,
    clearStallRecoveryTimers,
    resolveResumePosition,
    scheduleLoadingWatchdog,
    scheduleManifestWakeup,
    setPlaybackPhaseSafe,
  ]);

  useEffect(() => {
    if (!activeSource?.movieId || !activeSource.sourceUrl || activeSource.disableResume) {
      return;
    }

    let isActive = true;
    const sourceKey = `${activeSource.sessionKey}|${activeSource.sourceUrl}`;

    void fetchPlaybackProgressRecord(activeSource.movieId)
      .then((record) => {
        if (!isActive || !record || record.isFinished || record.lastPosition < 10) {
          return;
        }

        pendingResumeRef.current = {
          sourceKey,
          position: record.lastPosition,
          applied: false,
        };

        applyPendingResume();
      })
      .catch(() => undefined);

    return () => {
      isActive = false;
    };
  }, [
    activeSource?.disableResume,
    activeSource?.movieId,
    activeSource?.sessionKey,
    activeSource?.sourceUrl,
    applyPendingResume,
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
      clearGestureIndicatorTimer();
      clearSeekFeedbackTimer();
      clearSourceRetryTimer();
      clearStallRecoveryTimers();
    };
  }, [
    clearCastFeedbackTimer,
    clearClickIntentTimer,
    clearFatalErrorTimer,
    clearGestureIndicatorTimer,
    clearHideControlsTimer,
    clearSeekFeedbackTimer,
    clearSourceRetryTimer,
    clearStallRecoveryTimers,
  ]);

  useEffect(() => {
    clearHideControlsTimer();

    if (isControlsLocked) {
      setControlsVisible(false);
      setSettingsOpen(false);
      return;
    }

    if (!activeSource || settingsOpen || playbackPhase !== 'playing' || isDraggingMiniPlayer) {
      setControlsVisible(true);
      return;
    }

    setControlsVisible(true);
    hideControlsTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROL_HIDE_DELAY_MS);

    return clearHideControlsTimer;
  }, [
    activeSource,
    clearHideControlsTimer,
    isControlsLocked,
    isDraggingMiniPlayer,
    playbackPhase,
    settingsOpen,
  ]);

  const tryEnterFullscreen = useCallback(async () => {
    const videoElement = videoRef.current as IOSVideoElement | null;
    const shellElement = shellRef.current;

    if (!videoElement) {
      return;
    }

    showControls(true);

    const doc = document as WebkitDocument;
    const scheduleMobileLandscapeFallback = () => {
      if (isDesktop || typeof window === 'undefined') {
        return;
      }

      const enforceLandscape = () => {
        void lockLandscapeOrientation();

        if (window.innerHeight >= window.innerWidth) {
          setSoftLandscapeFullscreen(true);
        }
      };

      window.setTimeout(enforceLandscape, 180);
      window.setTimeout(enforceLandscape, 650);
    };

    if (
      softLandscapeFullscreen ||
      document.fullscreenElement ||
      doc.webkitFullscreenElement ||
      videoElement.webkitDisplayingFullscreen
    ) {
      if (softLandscapeFullscreen) {
        setSoftLandscapeFullscreen(false);
        setIsFullscreen(false);
        await unlockScreenOrientation(true);
        return;
      }

      if (videoElement.webkitExitFullscreen) {
        videoElement.webkitExitFullscreen();
        setIsFullscreen(false);
        await unlockScreenOrientation(true);
        return;
      }

      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
        setIsFullscreen(false);
        await unlockScreenOrientation(true);
        return;
      }

      if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
        setIsFullscreen(false);
        await unlockScreenOrientation(true);
      }

      return;
    }

    if (isIOSDevice && typeof videoElement.webkitEnterFullscreen === 'function') {
      await lockLandscapeOrientation();
      try {
        videoElement.webkitEnterFullscreen();
        setIsFullscreen(true);
        window.setTimeout(() => {
          void lockLandscapeOrientation();
        }, 250);
        return;
      } catch {
        setSoftLandscapeFullscreen(true);
        setIsFullscreen(true);
      }

      window.setTimeout(() => {
        void lockLandscapeOrientation();
      }, 250);
      return;
    }

    if (isNativeAndroidAppShell && !isDesktop) {
      await lockLandscapeOrientation();
      setIsFullscreen(true);
      setSoftLandscapeFullscreen(true);
      scheduleMobileLandscapeFallback();
      return;
    }

    if (shellElement && typeof shellElement.requestFullscreen === 'function') {
      try {
        await shellElement.requestFullscreen();
        setIsFullscreen(true);

        if (!isDesktop) {
          await lockLandscapeOrientation();
          scheduleMobileLandscapeFallback();
        }

        return;
      } catch {
        if (!isDesktop) {
          setIsFullscreen(true);
          setSoftLandscapeFullscreen(true);
          scheduleMobileLandscapeFallback();
          return;
        }
      }
    }

    if (typeof videoElement.requestFullscreen === 'function') {
      try {
        await videoElement.requestFullscreen();
        setIsFullscreen(true);

        if (!isDesktop) {
          await lockLandscapeOrientation();
          scheduleMobileLandscapeFallback();
        }
      } catch {
        if (!isDesktop) {
          setIsFullscreen(true);
          setSoftLandscapeFullscreen(true);
          scheduleMobileLandscapeFallback();
        }
      }
      return;
    }

    if (!isDesktop) {
      setIsFullscreen(true);
      setSoftLandscapeFullscreen(true);
      scheduleMobileLandscapeFallback();
    }
  }, [isDesktop, isIOSDevice, isNativeAndroidAppShell, showControls, softLandscapeFullscreen]);

  const tryTogglePictureInPicture = useCallback(async () => {
    const videoElement = videoRef.current as IOSVideoElement | null;
    const pipDocument = document as PictureInPictureDocument;

    showControls(true);

    if (isNativeAndroidAppShell) {
      return;
    }

    const canUseStandardPictureInPicture = Boolean(
      videoElement?.requestPictureInPicture &&
        pipDocument.pictureInPictureEnabled !== false
    );
    const canUseWebkitPictureInPicture = Boolean(
      videoElement?.webkitSupportsPresentationMode?.('picture-in-picture') &&
        videoElement.webkitSetPresentationMode
    );

    if (!videoElement) {
      showCastFeedback('Picture-in-picture is not ready yet.');
      return;
    }

    if (!canUseStandardPictureInPicture && !canUseWebkitPictureInPicture) {
      if (isAndroidDevice) {
        showCastFeedback(
          'Opening fullscreen. Press Home to keep watching if your Android browser supports pop-up video.'
        );
        void tryEnterFullscreen();
        return;
      }

      showCastFeedback('Picture-in-picture is not supported on this browser.');
      return;
    }

    try {
      if (canUseStandardPictureInPicture) {
        if (pipDocument.pictureInPictureElement) {
          await pipDocument.exitPictureInPicture?.();
          return;
        }

        await videoElement.requestPictureInPicture?.();
        return;
      }

      if (videoElement.webkitPresentationMode === 'picture-in-picture') {
        videoElement.webkitSetPresentationMode?.('inline');
        return;
      }

      videoElement.webkitSetPresentationMode?.('picture-in-picture');
    } catch (error) {
      if (isAndroidDevice) {
        showCastFeedback(
          'Opening fullscreen. Press Home to keep watching if your Android browser supports pop-up video.'
        );
        void tryEnterFullscreen();
        return;
      }

      showCastFeedback(
        error instanceof Error
          ? error.message
          : 'Picture-in-picture could not be started right now.'
      );
    }
  }, [
    isAndroidDevice,
    isNativeAndroidAppShell,
    showCastFeedback,
    showControls,
    tryEnterFullscreen,
  ]);

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
      userPausedRef.current = false;
      pendingAutoplayRef.current = true;
      clearFatalError();
      void videoElement.play().catch(() => {
        setPlaybackPhaseSafe('paused');
      });
      return;
    }

    userPausedRef.current = true;
    pendingAutoplayRef.current = false;
    clearLoadingWatchdogTimer();
    clearStallRecoveryTimers();
    videoElement.pause();
  }, [
    clearFatalError,
    clearLoadingWatchdogTimer,
    clearStallRecoveryTimers,
    setPlaybackPhaseSafe,
    showCastFeedback,
    showControls,
  ]);

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
          suppressNextPauseIntentRef.current = true;
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

  useEffect(() => {
    if (!activeSource || typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    try {
      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: activeSource.title,
          artist: 'UGMOVIES247',
          album: activeSource.description || 'UGMOVIES247',
          artwork: activeSource.poster
            ? [
                {
                  src: activeSource.poster,
                  sizes: '512x512',
                  type: 'image/jpeg',
                },
              ]
            : [],
        });
      }

      navigator.mediaSession.setActionHandler('play', () => {
        const videoElement = videoRef.current;
        if (videoElement?.paused || videoElement?.ended) {
          userPausedRef.current = false;
          pendingAutoplayRef.current = true;
          void videoElement.play().catch(() => undefined);
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        userPausedRef.current = true;
        pendingAutoplayRef.current = false;
        videoRef.current?.pause();
      });
      navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          seekTo(details.seekTime);
        }
      });
    } catch {
      // Media Session is best effort and varies by Android browser/WebView.
    }

    return () => {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('seekto', null);
      } catch {
        // Ignore browsers that expose a partial Media Session API.
      }
    };
  }, [activeSource, seekBy, seekTo]);

  const canOfferPictureInPictureControl =
    !isNativeAndroidAppShell && pictureInPictureSupported;

  useEffect(() => {
    if (isNativeAndroidAppShell || !activeSource || !pictureInPictureSupported || typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      const videoElement = videoRef.current as IOSVideoElement | null;
      const pipDocument = document as PictureInPictureDocument;
      const canUseStandardPictureInPicture = Boolean(
        videoElement?.requestPictureInPicture &&
          pipDocument.pictureInPictureEnabled !== false
      );
      const canUseWebkitPictureInPicture = Boolean(
        videoElement?.webkitSupportsPresentationMode?.('picture-in-picture') &&
          videoElement.webkitSetPresentationMode
      );
      const alreadyInPictureInPicture =
        Boolean(pipDocument.pictureInPictureElement) ||
        videoElement?.webkitPresentationMode === 'picture-in-picture';

      if (
        document.visibilityState !== 'hidden' ||
        playbackPhaseRef.current !== 'playing' ||
        !videoElement ||
        (!canUseStandardPictureInPicture && !canUseWebkitPictureInPicture) ||
        alreadyInPictureInPicture
      ) {
        return;
      }

      // Browsers may block automatic PiP without a recent user gesture; the manual PiP button
      // below remains the reliable path when the platform requires explicit permission.
      if (canUseStandardPictureInPicture) {
        void videoElement.requestPictureInPicture?.().catch(() => undefined);
        return;
      }

      try {
        videoElement.webkitSetPresentationMode?.('picture-in-picture');
      } catch {
        // Safari may still require a direct user gesture.
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [activeSource, isNativeAndroidAppShell, pictureInPictureSupported]);

  useEffect(() => {
    if (
      !activeSource ||
      !canOfferPictureInPictureControl ||
      isPictureInPicture ||
      playbackPhase !== 'playing' ||
      pipHintShownRef.current ||
      typeof window === 'undefined'
    ) {
      return;
    }

    try {
      if (window.localStorage.getItem(PIP_HINT_STORAGE_KEY) === 'true') {
        pipHintShownRef.current = true;
        return;
      }

      window.localStorage.setItem(PIP_HINT_STORAGE_KEY, 'true');
    } catch {
      // Storage can be unavailable in some private browser shells; the hint is optional.
    }

    pipHintShownRef.current = true;
    showCastFeedback('Tap the small-window button to keep watching outside the app.');
  }, [
    activeSource,
    canOfferPictureInPictureControl,
    isPictureInPicture,
    playbackPhase,
    showCastFeedback,
  ]);

  const hasInlineHost = Boolean(inlineHost);
  const isInlineMode = Boolean(activeSource && hasInlineHost);
  const isMiniMode = Boolean(activeSource && !hasInlineHost && hasStartedPlayback);
  const isMobileInlineMode = isInlineMode && (!isDesktop || (effectiveFullscreen && isTouchDevice));
  const isMobileLandscapeInlineMode = isMobileInlineMode && effectiveFullscreen;
  const isMobilePortraitInlineMode = isMobileInlineMode && !effectiveFullscreen;
  const isDesktopInlineMode = isInlineMode && !isMobileInlineMode;
  const shouldRotateSoftLandscapeFullscreen =
    softLandscapeFullscreen &&
    typeof window !== 'undefined' &&
    window.innerHeight >= window.innerWidth;

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
    ? softLandscapeFullscreen
      ? shouldRotateSoftLandscapeFullscreen
        ? {
          position: 'fixed',
          top: '50%',
          left: '50%',
          width: '100svh',
          height: '100svw',
          maxWidth: '100svh',
          maxHeight: '100svw',
          transform: 'translate(-50%, -50%) rotate(90deg)',
          transformOrigin: 'center center',
          touchAction: 'none',
          zIndex: 10030,
          borderRadius: 0,
        }
        : {
            position: 'fixed',
            inset: 0,
            width: '100vw',
            height: '100vh',
            touchAction: 'none',
            zIndex: 10030,
            borderRadius: 0,
          }
      : effectiveFullscreen
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
          top: isDesktop ? inlineRect.top : 0,
          left: isDesktop ? inlineRect.left : 0,
          width: isDesktop ? inlineRect.width : '100vw',
          height: inlineRect.height,
          zIndex: isDesktop ? 35 : 70,
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
    scheduleManifestWakeup('manifest-loadstart-timeout');
    scheduleLoadingWatchdog('load-start-watchdog');
    scheduleStallRecovery('load-start');
  }, [
    clearFatalError,
    scheduleLoadingWatchdog,
    scheduleManifestWakeup,
    scheduleStallRecovery,
    setPlaybackPhaseSafe,
    showControls,
  ]);

  const handleLoadedMetadata = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    setDuration(Number.isFinite(videoElement.duration) ? videoElement.duration : 0);
    clearManifestWakeupTimer();
    applyPendingResume();
    setCurrentTime(Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : 0);
    syncBufferedProgress();
  }, [applyPendingResume, clearManifestWakeupTimer, syncBufferedProgress]);

  const handleCanPlay = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    clearFatalError();
    clearManifestWakeupTimer();
    clearLoadingWatchdogTimer();
    clearSourceRetryTimer();
    clearStallRecoveryTimers();
    sourceRetryCountRef.current = 0;

    if (!videoElement) {
      return;
    }

    setDuration(Number.isFinite(videoElement.duration) ? videoElement.duration : 0);
    applyPendingResume();
    syncBufferedProgress();

    if (pendingAutoplayRef.current && !userPausedRef.current) {
      pendingAutoplayRef.current = false;
      void videoElement.play().catch(() => {
        setPlaybackPhaseSafe('paused');
      });
      return;
    }

    pendingAutoplayRef.current = false;
    setPlaybackPhaseSafe(videoElement.paused ? 'paused' : 'playing');
  }, [
    applyPendingResume,
    clearFatalError,
    clearLoadingWatchdogTimer,
    clearManifestWakeupTimer,
    clearSourceRetryTimer,
    clearStallRecoveryTimers,
    setPlaybackPhaseSafe,
    syncBufferedProgress,
  ]);

  const syncWatchHistory = useCallback(
    (completed = false, force = false) => {
      const videoElement = videoRef.current;

      if (!videoElement || !activeSource?.movieId || !activeSource.title) {
        return;
      }

      const progressSeconds = Number.isFinite(videoElement.currentTime)
        ? videoElement.currentTime
        : currentTime;
      const durationSeconds = Number.isFinite(videoElement.duration)
        ? videoElement.duration
        : duration;
      const normalizedProgressSeconds = Math.max(0, Math.floor(progressSeconds));
      const normalizedDurationSeconds = Math.max(0, Math.floor(durationSeconds));

      if (!completed && normalizedProgressSeconds < 10) {
        return;
      }

      const progressPercent =
        normalizedDurationSeconds > 0
          ? clamp(Math.round((normalizedProgressSeconds / normalizedDurationSeconds) * 100), 0, 100)
          : 0;
      const isFinished =
        completed || (normalizedDurationSeconds > 0 && normalizedProgressSeconds / normalizedDurationSeconds > 0.9);
      const now = Date.now();
      const cacheBucket = isFinished
        ? 'finished'
        : `progress-${Math.floor(normalizedProgressSeconds / 10)}`;
      const cacheKey = `${activeSource.sessionKey}:${activeSource.movieId}:${cacheBucket}`;

      if (
        force ||
        isFinished ||
        lastPlaybackCacheSyncRef.current.key !== cacheKey ||
        now - lastPlaybackCacheSyncRef.current.at >= 9_000
      ) {
        lastPlaybackCacheSyncRef.current = { key: cacheKey, at: now };
        writeCachedPlaybackProgress({
          movieId: activeSource.movieId,
          title: activeSource.title,
          poster: activeSource.poster || '',
          watchHref: activeSource.watchHref || '',
          lastPosition: normalizedProgressSeconds,
          totalDuration: normalizedDurationSeconds,
          isFinished,
        });
      }

      const syncBucket = isFinished
        ? 'finished'
        : force
          ? `manual-${normalizedProgressSeconds}`
          : `progress-${Math.floor(normalizedProgressSeconds / 60)}`;
      const syncKey = `${activeSource.sessionKey}:${activeSource.movieId}:${syncBucket}`;

      if (
        !force &&
        lastWatchHistorySyncRef.current.key === syncKey &&
        now - lastWatchHistorySyncRef.current.at < 55_000
      ) {
        return;
      }

      lastWatchHistorySyncRef.current = { key: syncKey, at: now };

      void fetch('/api/user/watch-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify({
          movieId: activeSource.movieId,
          title: activeSource.title,
          poster: activeSource.poster || '',
          watchHref: activeSource.watchHref || '',
          progressSeconds: normalizedProgressSeconds,
          durationSeconds: normalizedDurationSeconds,
          progressPercent,
          completed: isFinished,
        }),
      }).catch(() => undefined);
    },
    [activeSource, currentTime, duration]
  );

  const handlePlaying = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    clearFatalError();
    clearManifestWakeupTimer();
    clearLoadingWatchdogTimer();
    clearSourceRetryTimer();
    clearStallRecoveryTimers();
    clearNextCountdownTimer();
    sourceRetryCountRef.current = 0;
    lastProgressAtRef.current = Date.now();
    lastProgressTimeRef.current = videoRef.current?.currentTime || 0;
    userPausedRef.current = false;
    setHasStartedPlayback(true);
    setPlaybackPhaseSafe('playing');
    showControls();
  }, [
    clearFatalError,
    clearLoadingWatchdogTimer,
    clearManifestWakeupTimer,
    clearNextCountdownTimer,
    clearSourceRetryTimer,
    clearStallRecoveryTimers,
    setPlaybackPhaseSafe,
    showControls,
  ]);

  const handlePause = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement || videoElement.ended) {
      return;
    }

    const isInternalPause = suppressNextPauseIntentRef.current;
    suppressNextPauseIntentRef.current = false;

    if (!isInternalPause) {
      userPausedRef.current = true;
      pendingAutoplayRef.current = false;
      clearLoadingWatchdogTimer();
      clearStallRecoveryTimers();
    }

    setPlaybackPhaseSafe('paused');
    setControlsVisible(true);
    rememberPlaybackPosition();
    syncWatchHistory(false, true);
  }, [
    clearLoadingWatchdogTimer,
    clearStallRecoveryTimers,
    rememberPlaybackPosition,
    setPlaybackPhaseSafe,
    syncWatchHistory,
  ]);

  const handleEnded = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    syncWatchHistory(true, true);
    rememberPlaybackPosition();
    setPlaybackPhaseSafe('ended');
    setControlsVisible(true);
    clearNextCountdownTimer();

    if (!activeSource?.onNext || !activeSource.nextActionKey) {
      void trimStreamingCachePressure('playback-ended');
      return;
    }

    setNextCountdownSeconds(NEXT_AUTOPLAY_COUNTDOWN_SECONDS);
    nextCountdownIntervalRef.current = setInterval(() => {
      setNextCountdownSeconds((currentValue) => {
        if (currentValue === null) {
          return null;
        }

        return Math.max(0, currentValue - 1);
      });
    }, 1000);
    nextCountdownTimerRef.current = setTimeout(() => {
      clearNextCountdownTimer();
      activeSource.onNext?.();
    }, NEXT_AUTOPLAY_COUNTDOWN_SECONDS * 1000);
  }, [
    activeSource,
    clearNextCountdownTimer,
    rememberPlaybackPosition,
    setPlaybackPhaseSafe,
    syncWatchHistory,
  ]);

  const handleWaiting = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement || videoElement.ended || userPausedRef.current || videoElement.paused) {
      return;
    }

    clearFatalError();
    setPlaybackPhaseSafe(videoElement.currentTime > 0 ? 'buffering' : 'loading');
    syncBufferedProgress();
    scheduleManifestWakeup('media-waiting-manifest-timeout');
    scheduleLoadingWatchdog('media-waiting-watchdog');
    scheduleStallRecovery('media-waiting');
  }, [
    clearFatalError,
    scheduleLoadingWatchdog,
    scheduleManifestWakeup,
    scheduleStallRecovery,
    setPlaybackPhaseSafe,
    syncBufferedProgress,
  ]);

  const handleTimeUpdate = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    const nextCurrentTime = videoElement.currentTime || 0;
    const didAdvance =
      Math.abs(nextCurrentTime - lastProgressTimeRef.current) >= STALL_PROGRESS_EPSILON_SECONDS;

    setCurrentTime(nextCurrentTime);

    if (didAdvance) {
      lastProgressAtRef.current = Date.now();
      lastProgressTimeRef.current = nextCurrentTime;
      clearLoadingWatchdogTimer();
      clearStallRecoveryTimers();
    }

    if (activeSource?.movieId) {
      const sourceKey = getPlaybackSourceKey(activeSource);
      const snapshot: PlaybackResumeSnapshot = {
        position: nextCurrentTime,
        duration: Number.isFinite(videoElement.duration) ? videoElement.duration || 0 : duration,
        paused: videoElement.paused,
        updatedAt: Date.now(),
      };

      if (sourceKey) {
        lastKnownPlaybackRef.current[sourceKey] = snapshot;
      }

      const sessionProgressKey = activeSource.sessionKey || sourceKey || activeSource.movieId;

      if (sessionProgressKey) {
        lastKnownPlaybackRef.current[`session:${sessionProgressKey}`] = snapshot;
      }

      if (Date.now() - lastSessionProgressPersistAtRef.current > 4000) {
        lastSessionProgressPersistAtRef.current = Date.now();
        writeSessionProgress(sessionProgressKey, snapshot);
      }
    }

    syncBufferedProgress();
    syncWatchHistory(false);

    if (
      !videoElement.paused &&
      !videoElement.ended &&
      (playbackPhaseRef.current === 'loading' || playbackPhaseRef.current === 'buffering')
    ) {
      clearFatalError();
      setPlaybackPhaseSafe('playing');
    }
  }, [
    activeSource,
    clearFatalError,
    clearLoadingWatchdogTimer,
    clearStallRecoveryTimers,
    duration,
    setPlaybackPhaseSafe,
    syncBufferedProgress,
    syncWatchHistory,
  ]);

  const handleVideoError = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current as IOSVideoElement | null;
    const fallbackUrl = activeSource?.fallbackUrl?.trim() || '';

    if (!videoElement || !activeSource || videoElement.networkState === HTMLMediaElement.NETWORK_EMPTY) {
      return;
    }

    rememberPlaybackPosition();
    clearManifestWakeupTimer();
    clearLoadingWatchdogTimer();
    clearStallRecoveryTimers();

    if (
      fallbackUrl &&
      fallbackUrl !== activeSource.sourceUrl &&
      fallbackSourceRef.current !== fallbackUrl
    ) {
      clearFatalError();
      fallbackSourceRef.current = fallbackUrl;
      retriedCurrentSourceRef.current = false;
      sourceRetryCountRef.current = 0;
      startupGraceUntilRef.current = Date.now() + STARTUP_ERROR_GRACE_MS;
      lastAssignedSourceKeyRef.current = `${activeSource.sessionKey}|${fallbackUrl}`;
      const fallbackResumePosition = Number.isFinite(videoElement.currentTime)
        ? videoElement.currentTime || currentTime
        : currentTime;

      if (pendingResumeRef.current || fallbackResumePosition >= 1) {
        pendingResumeRef.current = {
          sourceKey: `${activeSource.sessionKey}|${fallbackUrl}`,
          position: pendingResumeRef.current?.position || fallbackResumePosition,
          applied: false,
        };
      }
      setPlaybackPhaseSafe('loading');
      if (!videoElement.paused) {
        suppressNextPauseIntentRef.current = true;
        videoElement.pause();
      }
      releaseVideoElementMedia(videoElement);
      videoElement.preload = 'metadata';
      videoElement.src = fallbackUrl;
      videoElement.load();
      void trimStreamingCachePressure('fallback-source');
      scheduleManifestWakeup('fallback-manifest-timeout');
      scheduleLoadingWatchdog('fallback-loading-watchdog');
      return;
    }

    setPlaybackPhaseSafe(videoElement.currentTime > 0 ? 'buffering' : 'loading');
    scheduleSourceRetry('video-error');
    scheduleFatalError(
      'Video failed to load. Please try again in a moment or switch to another source.'
    );
  }, [
    activeSource,
    clearFatalError,
    clearLoadingWatchdogTimer,
    clearManifestWakeupTimer,
    clearStallRecoveryTimers,
    currentTime,
    rememberPlaybackPosition,
    scheduleFatalError,
    scheduleLoadingWatchdog,
    scheduleManifestWakeup,
    scheduleSourceRetry,
    setPlaybackPhaseSafe,
  ]);

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

      if (isControlsLocked) {
        if (event.key.toLowerCase() === 'l') {
          event.preventDefault();
          setIsControlsLocked(false);
        }

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

      if (event.key.toLowerCase() === 'p') {
        event.stopPropagation();
        event.preventDefault();
        void tryTogglePictureInPicture();
        return;
      }

      if (event.key.toLowerCase() === 'm') {
        event.stopPropagation();
        event.preventDefault();
        toggleMute();
      }
    },
    [
      adjustVolumeBy,
      isControlsLocked,
      isInlineMode,
      seekBy,
      toggleMute,
      togglePlayPause,
      tryEnterFullscreen,
      tryTogglePictureInPicture,
    ]
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

      if (isControlsLocked) {
        if (event.key.toLowerCase() === 'l') {
          event.preventDefault();
          setIsControlsLocked(false);
        }

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

      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        void tryTogglePictureInPicture();
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
    isControlsLocked,
    isInlineMode,
    seekBy,
    toggleMute,
    togglePlayPause,
    tryEnterFullscreen,
    tryTogglePictureInPicture,
  ]);

  const handleSurfaceClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (isControlsLocked) {
      event.stopPropagation();
      return;
    }

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
  }, [
    clearClickIntentTimer,
    isControlsLocked,
    isMiniMode,
    isMobileInlineMode,
    seekBy,
    showControls,
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

  const previewScrubValue = useCallback(
    (target: HTMLInputElement) => {
      if (!duration) {
        return;
      }

      const nextTime = clamp(Number(target.value) || 0, 0, duration);
      setIsScrubbing(true);
      setScrubTime(nextTime);
      seekTo(nextTime);
      showControls(true);
    },
    [duration, seekTo, showControls]
  );

  const handleScrubberInput = useCallback(
    (event: ReactFormEvent<HTMLInputElement>) => {
      event.stopPropagation();
      previewScrubValue(event.currentTarget);
    },
    [previewScrubValue]
  );

  const handleScrubberMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLInputElement>) => {
      if (!isScrubbing && event.buttons !== 1) {
        return;
      }

      event.stopPropagation();
      previewScrubValue(event.currentTarget);
    },
    [isScrubbing, previewScrubValue]
  );

  const handleScrubberTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLInputElement>) => {
      if (!isScrubbing) {
        return;
      }

      event.stopPropagation();
      previewScrubValue(event.currentTarget);
    },
    [isScrubbing, previewScrubValue]
  );

  const handleScrubberDragStart = useCallback(
    (event: ReactPointerEvent<HTMLInputElement>) => {
      event.stopPropagation();
      setIsScrubbing(true);
      previewScrubValue(event.currentTarget);
      showControls(true);
    },
    [previewScrubValue, showControls]
  );

  const handleScrubberDragEnd = useCallback(
    (event: ReactPointerEvent<HTMLInputElement>) => {
      event.stopPropagation();
      previewScrubValue(event.currentTarget);
      setIsScrubbing(false);
      setScrubTime(null);
      showControls();
    },
    [previewScrubValue, showControls]
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

  const showGestureAdjustment = useCallback(
    (side: 'brightness' | 'volume', value: number, keepVisible = false) => {
      clearGestureIndicatorTimer();
      setGestureIndicator({ side, value: clamp(value, 0, 1) });

      if (!keepVisible) {
        gestureIndicatorTimerRef.current = setTimeout(() => {
          setGestureIndicator(null);
          gestureIndicatorTimerRef.current = null;
        }, 780);
      }
    },
    [clearGestureIndicatorTimer]
  );

  const handleSideGestureStart = useCallback(
    (side: 'brightness' | 'volume', event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isMobileInlineMode || isControlsLocked) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Older Android WebViews can throw if capture is unavailable.
      }
      showControls(true);

      const startValue = side === 'brightness' ? videoBrightness : isMuted ? 0 : volume;
      sideGestureStateRef.current = {
        pointerId: event.pointerId,
        side,
        startY: event.clientY,
        startValue,
        moved: false,
      };
    },
    [
      isControlsLocked,
      isMobileInlineMode,
      isMuted,
      showControls,
      showGestureAdjustment,
      videoBrightness,
      volume,
    ]
  );

  const handleSideGestureMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gestureState = sideGestureStateRef.current;

      if (!gestureState || gestureState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const delta = (gestureState.startY - event.clientY) / 180;

      if (!gestureState.moved && Math.abs(event.clientY - gestureState.startY) < 8) {
        return;
      }

      gestureState.moved = true;

      if (gestureState.side === 'brightness') {
        const nextBrightness = clamp(gestureState.startValue + delta, 0.18, 1);
        updateBrightnessState(nextBrightness);
        showGestureAdjustment('brightness', nextBrightness, true);
      } else {
        const nextVolume = clamp(gestureState.startValue + delta, 0, 1);
        const videoElement = videoRef.current;

        if (videoElement) {
          try {
            videoElement.muted = nextVolume <= 0.001;
            videoElement.volume = nextVolume;
          } catch {
            // Some mobile browsers only allow hardware buttons to control real device volume.
          }
        }

        updateVolumeState(nextVolume, nextVolume <= 0.001);
        showGestureAdjustment('volume', nextVolume, true);
      }

      showControls(true);
    },
    [showControls, showGestureAdjustment, updateBrightnessState, updateVolumeState]
  );

  const handleSideGestureEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gestureState = sideGestureStateRef.current;

      if (!gestureState || gestureState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      sideGestureStateRef.current = null;

      if (gestureState.moved) {
        showGestureAdjustment(
          gestureState.side,
          gestureState.side === 'brightness' ? videoBrightness : isMuted ? 0 : volume
        );
      } else {
        clearGestureIndicatorTimer();
        setGestureIndicator(null);
      }
    },
    [clearGestureIndicatorTimer, isMuted, showGestureAdjustment, videoBrightness, volume]
  );

  const handleShellPointerMove = useCallback(() => {
    if (isControlsLocked) {
      return;
    }

    if (!isMiniMode) {
      showControls();
    }
  }, [isControlsLocked, isMiniMode, showControls]);

  const handleShellPointerLeave = useCallback(() => {
    if (isControlsLocked) {
      return;
    }

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
    isControlsLocked,
    isMiniMode,
    playbackPhase,
    settingsOpen,
  ]);

  const bufferedPercent =
    duration > 0 ? clamp((bufferedUntil / duration) * 100, 0, 100) : 0;
  const displayCurrentTime = isScrubbing && scrubTime !== null ? scrubTime : currentTime;
  const playedPercent =
    duration > 0 ? clamp((displayCurrentTime / duration) * 100, 0, 100) : 0;
  const activeTimeLabel = `${formatTime(displayCurrentTime)} / ${formatTime(duration)}`;
  const hasNextAction = Boolean(activeSource?.onNext && activeSource.nextActionKey);
  const hasPreviousAction = Boolean(activeSource?.onPrevious && activeSource.previousActionKey);
  const nextActionLabel = activeSource?.nextLabel || 'Next';
  const previousActionLabel = activeSource?.previousLabel || 'Previous';
  const effectiveControlsVisible =
    !isControlsLocked && (controlsVisible || playbackPhase !== 'playing');
  const brightnessOverlayOpacity = clamp((1 - videoBrightness) * 0.78, 0, 0.72);
  const gestureIndicatorPercent = gestureIndicator
    ? Math.round(clamp(gestureIndicator.value, 0, 1) * 100)
    : 0;
  const showCenterAction =
    !isMiniMode &&
    !isControlsLocked &&
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

  const triggerNextAction = useCallback(() => {
    if (!activeSource?.onNext) {
      return;
    }

    clearNextCountdownTimer();
    activeSource.onNext();
  }, [activeSource, clearNextCountdownTimer]);

  const triggerPreviousAction = useCallback(() => {
    if (!activeSource?.onPrevious) {
      return;
    }

    clearNextCountdownTimer();
    activeSource.onPrevious();
  }, [activeSource, clearNextCountdownTimer]);

  const toggleControlsLock = useCallback(() => {
    clearHideControlsTimer();
    clearGestureIndicatorTimer();
    setSettingsOpen(false);
    setGestureIndicator(null);

    if (isControlsLocked) {
      setIsControlsLocked(false);
      setControlsVisible(true);
      return;
    }

    setIsControlsLocked(true);
    setControlsVisible(false);
  }, [clearGestureIndicatorTimer, clearHideControlsTimer, isControlsLocked]);

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
              key={getPlaybackSourceKey(activeSource) || 'idle'}
              ref={setVideoElement}
              poster={activeSource.poster || ''}
              preload="metadata"
              playsInline
              autoPlay={Boolean(activeSource.autoplay)}
              controls={false}
              style={{
                WebkitTapHighlightColor: 'transparent',
              }}
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

            {nextCountdownSeconds !== null && hasNextAction ? (
              <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center px-6">
                <div className="pointer-events-auto max-w-[min(92vw,420px)] rounded-[28px] border border-white/12 bg-black/72 px-6 py-5 text-center shadow-[0_26px_80px_rgba(0,0,0,0.52)] backdrop-blur-2xl">
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-white/68">
                    {activeSource.nextCountdownLabel || 'Next starts in'}
                  </p>
                  <p className="mt-2 text-4xl font-black tabular-nums text-white">
                    {nextCountdownSeconds}
                  </p>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      triggerNextAction();
                    }}
                    className="mt-4 inline-flex items-center justify-center rounded-full bg-[#D90429] px-5 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white shadow-[0_12px_32px_rgba(217,4,41,0.34)] transition-transform hover:scale-[1.02]"
                  >
                    Play now
                  </button>
                </div>
              </div>
            ) : null}

            {!isMiniMode ? (
              <button
                type="button"
                className="absolute inset-0 z-[1] bg-transparent"
                aria-label={playbackPhase === 'playing' ? 'Pause video' : 'Play video'}
                onClick={handleSurfaceClick}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              />
            ) : null}

            {isInlineMode ? (
              <>
                <div
                  className="pointer-events-none absolute inset-0 z-[2] bg-black transition-opacity duration-200"
                  style={{ opacity: brightnessOverlayOpacity }}
                />

                {isMobileLandscapeInlineMode ? (
                  <>
                    <div
                      className="absolute inset-y-0 left-0 z-[3] w-1/2 touch-none"
                      aria-label="Swipe up or down to adjust brightness"
                      onPointerDown={(event) => handleSideGestureStart('brightness', event)}
                      onPointerMove={handleSideGestureMove}
                      onPointerUp={handleSideGestureEnd}
                      onPointerCancel={handleSideGestureEnd}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!isControlsLocked) {
                          showControls();
                        }
                      }}
                    />
                    <div
                      className="absolute inset-y-0 right-0 z-[3] w-1/2 touch-none"
                      aria-label="Swipe up or down to adjust volume"
                      onPointerDown={(event) => handleSideGestureStart('volume', event)}
                      onPointerMove={handleSideGestureMove}
                      onPointerUp={handleSideGestureEnd}
                      onPointerCancel={handleSideGestureEnd}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!isControlsLocked) {
                          showControls();
                        }
                      }}
                    />
                  </>
                ) : null}

                {gestureIndicator && isMobileLandscapeInlineMode ? (
                  <div className="pointer-events-none absolute left-1/2 top-5 z-40 flex min-w-[150px] -translate-x-1/2 items-center gap-3 rounded-full border border-white/12 bg-black/55 px-4 py-2 text-white shadow-[0_18px_44px_rgba(0,0,0,0.34)]">
                    {gestureIndicator.side === 'brightness' ? (
                      <Sun size={18} className="text-white/90" />
                    ) : (
                      <Volume2 size={18} className="text-white/90" />
                    )}
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/18">
                      <div
                        className="h-full rounded-full bg-[#D90429]"
                        style={{ width: `${gestureIndicatorPercent}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-[10px] font-black tabular-nums tracking-[0.12em] text-white/82">
                      {gestureIndicatorPercent}
                    </span>
                  </div>
                ) : null}

                {isMobileLandscapeInlineMode ? (
                  <button
                    type="button"
                    aria-label={isControlsLocked ? 'Unlock player controls' : 'Lock player controls'}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleControlsLock();
                    }}
                    className={`pointer-events-auto absolute bottom-5 right-5 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full border text-white shadow-[0_12px_28px_rgba(0,0,0,0.32)] transition-all ${
                      isControlsLocked
                        ? 'border-[#D90429]/60 bg-[#D90429]/18'
                        : 'border-white/45 bg-transparent hover:border-white/75'
                    }`}
                  >
                    <Lock size={18} />
                  </button>
                ) : null}

                {effectiveControlsVisible ? (
                  <>
                    {isMobileLandscapeInlineMode || isDesktopInlineMode ? (
                      <div
                        className="pointer-events-auto absolute right-4 top-4 z-30 flex items-center gap-4"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          aria-label={castButtonAriaLabel}
                          onClick={handleCastButtonClick}
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-full border text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-colors ${
                            isCasting
                              ? 'border-[#D90429]/70 bg-[#D90429]/18 text-[#FFD7DF]'
                              : 'border-white/45 bg-transparent hover:border-white/75'
                          }`}
                        >
                          <Cast size={18} />
                        </button>
                        <button
                          type="button"
                          aria-label={effectiveFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                          onClick={(event) => {
                            event.stopPropagation();
                            void tryEnterFullscreen();
                          }}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/45 bg-transparent text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-colors hover:border-white/75"
                        >
                          {effectiveFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                        </button>
                      </div>
                    ) : null}

                    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-5">
                      {playbackPhase === 'loading' || playbackPhase === 'buffering' ? (
                        <SpinnerOrb className="h-14 w-14" />
                      ) : isMobilePortraitInlineMode ? (
                        <button
                          type="button"
                          aria-label={playbackPhase === 'playing' ? 'Pause video' : 'Play video'}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePlayPause();
                          }}
                          className="pointer-events-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#D90429] text-white shadow-[0_16px_44px_rgba(217,4,41,0.38)] transition-transform active:scale-95"
                        >
                          {playbackPhase === 'playing' ? (
                            <Pause size={27} />
                          ) : (
                            <Play size={27} className="translate-x-[2px]" />
                          )}
                        </button>
                      ) : (
                        <div className="pointer-events-auto flex items-center justify-center gap-5 sm:gap-7">
                          <button
                            type="button"
                            aria-label={previousActionLabel}
                            aria-disabled={!hasPreviousAction}
                            disabled={!hasPreviousAction}
                            onClick={(event) => {
                              event.stopPropagation();
                              triggerPreviousAction();
                            }}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border bg-transparent text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-all sm:h-12 sm:w-12 ${
                              hasPreviousAction
                                ? 'border-white/45 hover:border-white/75'
                                : 'cursor-not-allowed border-white/18 text-white/30'
                            }`}
                          >
                            <StepBack size={21} />
                          </button>

                          <button
                            type="button"
                            aria-label="Rewind 10 seconds"
                            onClick={(event) => {
                              event.stopPropagation();
                              seekBy(-10);
                            }}
                            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-transparent text-white drop-shadow-[0_8px_18px_rgba(0,0,0,0.6)] transition-transform active:scale-95 sm:h-14 sm:w-14"
                          >
                            <RotateCcw size={28} />
                            <span className="sr-only">10 seconds</span>
                          </button>
                          <button
                            type="button"
                            aria-label={playbackPhase === 'playing' ? 'Pause video' : 'Play video'}
                            onClick={(event) => {
                              event.stopPropagation();
                              togglePlayPause();
                            }}
                            className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#D90429] text-white shadow-[0_18px_46px_rgba(217,4,41,0.42)] transition-transform active:scale-95 sm:h-[4.5rem] sm:w-[4.5rem]"
                          >
                            {playbackPhase === 'playing' ? (
                              <Pause size={30} />
                            ) : (
                              <Play size={30} className="translate-x-[2px]" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label="Forward 10 seconds"
                            onClick={(event) => {
                              event.stopPropagation();
                              seekBy(10);
                            }}
                            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-transparent text-white drop-shadow-[0_8px_18px_rgba(0,0,0,0.6)] transition-transform active:scale-95 sm:h-14 sm:w-14"
                          >
                            <RotateCw size={28} />
                            <span className="sr-only">10 seconds</span>
                          </button>

                          <button
                            type="button"
                            aria-label={nextActionLabel}
                            aria-disabled={!hasNextAction}
                            disabled={!hasNextAction}
                            onClick={(event) => {
                              event.stopPropagation();
                              triggerNextAction();
                            }}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border bg-transparent text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-all sm:h-12 sm:w-12 ${
                              hasNextAction
                                ? 'border-white/45 hover:border-white/75'
                                : 'cursor-not-allowed border-white/18 text-white/30'
                            }`}
                          >
                            <StepForward size={21} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div
                      className={`pointer-events-auto absolute inset-x-0 bottom-0 z-30 ${
                        isMobilePortraitInlineMode
                          ? 'pb-4 pl-4 pr-16'
                          : 'px-5 pb-5 sm:px-7 sm:pb-6'
                      }`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
                        <span className="w-[42px] shrink-0 text-right text-[10px] font-black tabular-nums tracking-[0.08em] text-white/90 sm:w-[56px] sm:text-[11px]">
                          {formatTime(displayCurrentTime)}
                        </span>
                        <div
                          ref={scrubberRef}
                          className="relative h-8 flex-1"
                          onPointerMove={handleScrubberPointerMove}
                          onPointerLeave={handleScrubberPointerLeave}
                        >
                          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/24">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-white/28"
                              style={{ width: `${bufferedPercent}%` }}
                            />
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-[#D90429]"
                              style={{ width: `${playedPercent}%` }}
                            />
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={Math.max(duration, 0)}
                            step={0.1}
                            value={Math.min(displayCurrentTime, duration || 0)}
                            className="player-range absolute inset-0 z-10 h-full w-full"
                            aria-label="Seek video"
                            onPointerDown={handleScrubberDragStart}
                            onPointerUp={handleScrubberDragEnd}
                            onPointerCancel={handleScrubberDragEnd}
                            onChange={handleScrubberInput}
                            onInput={handleScrubberInput}
                            onMouseMove={handleScrubberMouseMove}
                            onTouchMove={handleScrubberTouchMove}
                          />

                          {hoverPreviewTime !== null && hoverPreviewRatio !== null && duration > 0 ? (
                            <div
                              className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-full border border-white/12 bg-black/72 px-2 py-1 text-[9px] font-black tracking-[0.16em] text-white/90"
                              style={{ left: `${hoverPreviewRatio * 100}%` }}
                            >
                              {formatTime(hoverPreviewTime)}
                            </div>
                          ) : null}
                        </div>
                        <span className="w-[42px] shrink-0 text-left text-[10px] font-black tabular-nums tracking-[0.08em] text-white/90 sm:w-[56px] sm:text-[11px]">
                          {formatTime(duration)}
                        </span>
                        {isMobilePortraitInlineMode ? (
                          <button
                            type="button"
                            aria-label="Enter fullscreen"
                            onClick={(event) => {
                              event.stopPropagation();
                              void tryEnterFullscreen();
                            }}
                            className="absolute bottom-3 right-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/45 bg-transparent text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-colors hover:border-white/75"
                          >
                            <Maximize size={19} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : null}
              </>
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

              {false && isInlineMode ? (
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
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          aria-label="Go back"
                          onClick={(event) => {
                            event.stopPropagation();
                            router.back();
                          }}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#D90429]/30 bg-black/48 text-white shadow-[0_12px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl"
                        >
                          <ArrowLeft size={17} />
                        </button>
                        <div className="hidden min-w-0 rounded-full border border-white/10 bg-black/38 px-3 py-2 backdrop-blur-xl min-[390px]:block">
                          <p className="max-w-[34vw] truncate text-[10px] font-black uppercase tracking-[0.18em] text-white/72">
                            {activeSource.title}
                          </p>
                        </div>
                      </div>
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
                      {canOfferPictureInPictureControl ? (
                        <PlayerShellButton
                          ariaLabel={
                            isPictureInPicture
                              ? 'Exit picture-in-picture'
                              : 'Watch in picture-in-picture'
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            void tryTogglePictureInPicture();
                          }}
                          className={`${isMobileInlineMode ? 'h-9 w-9' : ''} ${
                            isPictureInPicture ? 'border-[#D90429]/45 bg-[#D90429]/18 text-[#FFD7DF]' : ''
                          }`}
                        >
                          <PictureInPictureIcon size={isMobileInlineMode ? 15 : 18} />
                        </PlayerShellButton>
                      ) : null}
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
                        ariaLabel={effectiveFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        onClick={(event) => {
                          event.stopPropagation();
                          void tryEnterFullscreen();
                        }}
                        className={isMobileInlineMode ? 'h-9 w-9' : ''}
                      >
                        {effectiveFullscreen ? (
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
                        <SpinnerOrb className="h-14 w-14" />
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
                          <SpinnerOrb className="h-12 w-12" />
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
                            {hasNextAction ? (
                              <PlayerShellButton
                                ariaLabel={nextActionLabel}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  triggerNextAction();
                                }}
                                className="h-10 w-10 border-[#D90429]/45 bg-[#D90429]/20 text-[#FFD7DF]"
                              >
                                <SkipForward size={15} />
                              </PlayerShellButton>
                            ) : null}
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
                        className={`pointer-events-auto absolute bottom-[5.1rem] left-0 top-[4.5rem] z-20 flex w-[24%] max-w-[112px] touch-none items-center justify-start pl-3 transition-all duration-300 ${
                          controlsVisible || playbackPhase !== 'playing'
                            ? 'opacity-100'
                            : 'opacity-0'
                        }`}
                        aria-label="Swipe up or down to adjust brightness"
                        role="slider"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(((videoBrightness - 0.55) / 0.9) * 100)}
                        onPointerDown={(event) => handleSideGestureStart('brightness', event)}
                        onPointerMove={handleSideGestureMove}
                        onPointerUp={handleSideGestureEnd}
                        onPointerCancel={handleSideGestureEnd}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex h-28 w-10 flex-col items-center justify-center gap-2 rounded-full border border-white/10 bg-black/42 py-3 shadow-[0_14px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                          <Settings2 size={14} className="text-white/82" />
                          <div className="relative h-14 w-1.5 overflow-hidden rounded-full bg-white/20">
                            <div
                              className="absolute inset-x-0 bottom-0 rounded-full bg-[#D90429]"
                              style={{ height: `${clamp(((videoBrightness - 0.55) / 0.9) * 100, 0, 100)}%` }}
                            />
                          </div>
                          <span className="text-[8px] font-black tabular-nums text-white/70">
                            {Math.round(videoBrightness * 100)}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`pointer-events-auto absolute bottom-[5.1rem] right-0 top-[4.5rem] z-20 flex w-[24%] max-w-[112px] touch-none items-center justify-end pr-3 transition-all duration-300 ${
                          controlsVisible || playbackPhase !== 'playing'
                            ? 'opacity-100'
                            : 'opacity-0'
                        }`}
                        aria-label="Swipe up or down to adjust volume"
                        role="slider"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
                        onPointerDown={(event) => handleSideGestureStart('volume', event)}
                        onPointerMove={handleSideGestureMove}
                        onPointerUp={handleSideGestureEnd}
                        onPointerCancel={handleSideGestureEnd}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex h-28 w-10 flex-col items-center justify-center gap-2 rounded-full border border-white/10 bg-black/42 py-3 shadow-[0_14px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                          {volumeIcon}
                          <div className="relative h-14 w-1.5 overflow-hidden rounded-full bg-white/20">
                            <div
                              className="absolute inset-x-0 bottom-0 rounded-full bg-[#D90429]"
                              style={{ height: `${clamp((isMuted ? 0 : volume) * 100, 0, 100)}%` }}
                            />
                          </div>
                          <span className="text-[8px] font-black tabular-nums text-white/70">
                            {Math.round((isMuted ? 0 : volume) * 100)}
                          </span>
                        </div>
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
                          <div className="relative h-2 rounded-full bg-white/18">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-white/24"
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
                              value={Math.min(displayCurrentTime, duration || 0)}
                              className="player-range absolute inset-0 z-10 h-full w-full"
                              onPointerDown={handleScrubberDragStart}
                              onPointerUp={handleScrubberDragEnd}
                              onPointerCancel={handleScrubberDragEnd}
                              onChange={handleScrubberInput}
                              onInput={handleScrubberInput}
                              onMouseMove={handleScrubberMouseMove}
                              onTouchMove={handleScrubberTouchMove}
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

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label="Rewind 10 seconds"
                              onClick={(event) => {
                                event.stopPropagation();
                                seekBy(-10);
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/42 text-white"
                            >
                              <SkipBack size={16} />
                            </button>
                            <button
                              type="button"
                              aria-label={playbackPhase === 'playing' ? 'Pause video' : 'Play video'}
                              onClick={(event) => {
                                event.stopPropagation();
                                togglePlayPause();
                              }}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-[0_12px_30px_rgba(0,0,0,0.32)]"
                            >
                              {playbackPhase === 'playing' ? (
                                <Pause size={18} />
                              ) : (
                                <Play size={18} className="translate-x-[1px]" />
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label="Forward 10 seconds"
                              onClick={(event) => {
                                event.stopPropagation();
                                seekBy(10);
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/42 text-white"
                            >
                              <SkipForward size={16} />
                            </button>
                          </div>

                          <div className="shrink-0 whitespace-nowrap rounded-full border border-white/12 bg-black/64 px-2.5 py-1.5 text-center text-[9px] font-black tabular-nums tracking-[0.08em] text-white shadow-[0_8px_22px_rgba(0,0,0,0.28)] backdrop-blur-xl min-[390px]:px-3 min-[390px]:text-[10px]">
                            {activeTimeLabel}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleMute();
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/42 text-white"
                              aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                            >
                              {volumeIcon}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSettingsOpen((currentState) => !currentState);
                                showControls(true);
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/42 text-white"
                              aria-label="Player settings"
                            >
                              <Settings2 size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void tryEnterFullscreen();
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/42 text-white"
                              aria-label={effectiveFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                            >
                              {effectiveFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                            </button>
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
                        <div className="relative h-2.5 rounded-full bg-white/16">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-white/24"
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
                            value={Math.min(displayCurrentTime, duration || 0)}
                            className="player-range absolute inset-0 z-10 h-full w-full"
                            onPointerDown={handleScrubberDragStart}
                            onPointerUp={handleScrubberDragEnd}
                            onPointerCancel={handleScrubberDragEnd}
                            onChange={handleScrubberInput}
                            onInput={handleScrubberInput}
                            onMouseMove={handleScrubberMouseMove}
                            onTouchMove={handleScrubberTouchMove}
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
                          {hasNextAction ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                triggerNextAction();
                              }}
                              className="inline-flex h-11 items-center gap-2 rounded-full border border-[#D90429]/35 bg-[#D90429]/16 px-3 text-[11px] font-black uppercase tracking-[0.15em] text-[#FFD7DF] transition-colors hover:border-[#D90429]/55 hover:bg-[#D90429]/24"
                              aria-label={nextActionLabel}
                            >
                              <SkipForward size={16} />
                              <span className="hidden md:inline">{nextActionLabel}</span>
                            </button>
                          ) : null}
                          <PlayerShellButton
                            ariaLabel="Forward 10 seconds"
                            onClick={(event) => {
                              event.stopPropagation();
                              seekBy(10);
                            }}
                          >
                            <SkipForward size={18} />
                          </PlayerShellButton>

                          <div className="ml-1 shrink-0 whitespace-nowrap rounded-full border border-white/12 bg-black/64 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white shadow-[0_8px_22px_rgba(0,0,0,0.25)] backdrop-blur-xl">
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
                            ariaLabel={effectiveFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                            onClick={(event) => {
                              event.stopPropagation();
                              void tryEnterFullscreen();
                            }}
                          >
                            {effectiveFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
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
                      {canOfferPictureInPictureControl ? (
                        <PlayerShellButton
                          ariaLabel={
                            isPictureInPicture
                              ? 'Exit picture-in-picture'
                              : 'Watch in picture-in-picture'
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            void tryTogglePictureInPicture();
                          }}
                          className={`h-8 w-8 ${
                            isPictureInPicture ? 'border-[#D90429]/45 bg-[#D90429]/18 text-[#FFD7DF]' : ''
                          }`}
                        >
                          <PictureInPictureIcon size={14} />
                        </PlayerShellButton>
                      ) : null}
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

                        {hasNextAction ? (
                          <PlayerShellButton
                            ariaLabel={nextActionLabel}
                            onClick={(event) => {
                              event.stopPropagation();
                              triggerNextAction();
                            }}
                            className="h-9 w-9 border-[#D90429]/45 bg-[#D90429]/20 text-[#FFD7DF]"
                          >
                            <SkipForward size={15} />
                          </PlayerShellButton>
                        ) : null}

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

                      <div className="relative mt-3 h-2 rounded-full bg-white/16">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-white/24"
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
