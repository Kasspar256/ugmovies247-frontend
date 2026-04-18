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
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Cast,
  Expand,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
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

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

const STARTUP_ERROR_GRACE_MS = 2200;
const FATAL_ERROR_DELAY_MS = 1600;
const MINI_PLAYER_MOBILE_WIDTH = 220;
const MINI_PLAYER_DESKTOP_WIDTH = 320;

type IOSVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

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
    current.poster === next.poster &&
    current.title === next.title &&
    current.description === next.description &&
    current.watchHref === next.watchHref
  );
}

function PlayerShellButton({
  onClick,
  ariaLabel,
  children,
  className = '',
}: {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/45 text-white transition-colors hover:border-white/20 hover:bg-black/60 ${className}`}
    >
      {children}
    </button>
  );
}

function SpinnerOrb({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/42 backdrop-blur-xl ${className}`}
      aria-hidden="true"
    >
      <Loader2 size={15} className="animate-spin text-white/82" />
    </span>
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

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isDesktop = useIsDesktopViewport();
  const isIOSDevice = useIsIOSDevice();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const fatalErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const castFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutoplayRef = useRef(false);
  const retriedCurrentSourceRef = useRef(false);
  const lastAssignedSourceRef = useRef('');
  const fallbackSourceRef = useRef('');
  const startupGraceUntilRef = useRef(0);
  const [activeSource, setActiveSourceState] = useState<PlaybackSource | null>(null);
  const [inlineHost, setInlineHost] = useState<HTMLDivElement | null>(null);
  const [inlineRect, setInlineRect] = useState<DOMRect | null>(null);
  const [videoElementState, setVideoElementState] = useState<HTMLVideoElement | null>(null);
  const [playbackPhase, setPlaybackPhase] = useState<PlaybackPhase>('idle');
  const [fatalErrorMessage, setFatalErrorMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [desktopSeekFeedback, setDesktopSeekFeedback] = useState('');
  const [castFeedbackMessage, setCastFeedbackMessage] = useState('');
  const [castSnapshot, setCastSnapshot] = useState<CastStateSnapshot>(() => getCastStateSnapshot());
  const playbackPhaseRef = useRef<PlaybackPhase>('idle');
  const castSnapshotRef = useRef<CastStateSnapshot>(getCastStateSnapshot());

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

  const clearFatalError = useCallback(() => {
    clearFatalErrorTimer();
    setFatalErrorMessage('');
  }, [clearFatalErrorTimer]);

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

  const setVideoElement = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoElementState(node);

    if (node) {
      node.setAttribute('playsinline', 'true');
      node.setAttribute('webkit-playsinline', 'true');
      node.setAttribute('x-webkit-airplay', 'allow');
    }
  }, []);

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
      setIsFullscreen(Boolean(document.fullscreenElement || doc.webkitFullscreenElement || inlineVideo?.webkitDisplayingFullscreen));
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
  }, [videoElementState]);

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
    clearFatalError();
    pendingAutoplayRef.current = false;
    retriedCurrentSourceRef.current = false;
    fallbackSourceRef.current = '';
    startupGraceUntilRef.current = 0;
    lastAssignedSourceRef.current = '';
    setActiveSourceState(null);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackPhaseSafe('idle');

    const videoElement = videoRef.current;

    if (videoElement) {
      videoElement.pause();
      videoElement.removeAttribute('src');
      videoElement.load();
    }
  }, [clearFatalError, setPlaybackPhaseSafe]);

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

    if (!videoElement) {
      return;
    }

    if (!activeSource?.sourceUrl) {
      return;
    }

    if (lastAssignedSourceRef.current === activeSource.sourceUrl) {
      return;
    }

    const shouldResumePlayback =
      playbackPhaseRef.current === 'playing' || playbackPhaseRef.current === 'buffering';

    clearFatalError();
    startupGraceUntilRef.current = Date.now() + STARTUP_ERROR_GRACE_MS;
    pendingAutoplayRef.current = shouldResumePlayback;
    retriedCurrentSourceRef.current = false;
    fallbackSourceRef.current = '';
    lastAssignedSourceRef.current = activeSource.sourceUrl;
    setCurrentTime(0);
    setDuration(0);
    setPlaybackPhaseSafe('loading');

    videoElement.pause();
    videoElement.src = activeSource.sourceUrl;
    videoElement.load();
  }, [activeSource?.sessionKey, activeSource?.sourceUrl, clearFatalError, setPlaybackPhaseSafe]);

  useEffect(() => {
    if (
      !activeSource ||
      castSnapshot.transport !== 'google-cast' ||
      !castSnapshot.connected
    ) {
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
      clearFatalErrorTimer();
      clearSeekFeedbackTimer();
      clearCastFeedbackTimer();
    };
  }, [clearCastFeedbackTimer, clearFatalErrorTimer, clearSeekFeedbackTimer]);

  const tryEnterFullscreen = useCallback(async () => {
    const videoElement = videoRef.current as IOSVideoElement | null;
    const shellElement = shellRef.current;

    if (!videoElement) {
      return;
    }

    const doc = document as WebkitDocument;

    if (document.fullscreenElement || doc.webkitFullscreenElement || videoElement.webkitDisplayingFullscreen) {
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
      return;
    }

    if (typeof videoElement.requestFullscreen === 'function') {
      await videoElement.requestFullscreen();
    }
  }, [isIOSDevice]);

  const openWatchView = useCallback(() => {
    if (!activeSource?.watchHref) {
      return;
    }

    router.push(activeSource.watchHref);
  }, [activeSource?.watchHref, router]);

  const togglePlayPause = useCallback(() => {
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
  }, [clearFatalError, setPlaybackPhaseSafe, showCastFeedback]);

  const seekBy = useCallback(
    (seconds: number) => {
      if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
        void seekCastBy(seconds).catch((error) => {
          showCastFeedback(
            error instanceof Error ? error.message : 'We could not seek on the cast device.'
          );
        });

        if (isDesktop && seconds !== 0) {
          clearSeekFeedbackTimer();
          setDesktopSeekFeedback(`${seconds > 0 ? '+' : ''}${seconds}s`);
          feedbackTimerRef.current = setTimeout(() => {
            setDesktopSeekFeedback('');
          }, 720);
        }

        return;
      }

      const videoElement = videoRef.current;

      if (!videoElement || !Number.isFinite(videoElement.currentTime)) {
        return;
      }

      const hasDuration = Number.isFinite(videoElement.duration) && videoElement.duration > 0;
      const nextTime = hasDuration
        ? Math.min(Math.max(0, videoElement.currentTime + seconds), videoElement.duration)
        : Math.max(0, videoElement.currentTime + seconds);

      videoElement.currentTime = nextTime;
      setCurrentTime(nextTime);

      if (isDesktop && seconds !== 0) {
        clearSeekFeedbackTimer();
        setDesktopSeekFeedback(`${seconds > 0 ? '+' : ''}${seconds}s`);
        feedbackTimerRef.current = setTimeout(() => {
          setDesktopSeekFeedback('');
        }, 720);
      }
    },
    [clearSeekFeedbackTimer, isDesktop, showCastFeedback]
  );

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
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

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
    [activeSource, currentTime, showCastFeedback]
  );

  const hasInlineHost = Boolean(inlineHost);
  const isInlineMode = Boolean(activeSource && hasInlineHost);
  const prefersNativeFloatingPlayback = !isDesktop && isIOSDevice;
  const isMiniMode = Boolean(activeSource && !hasInlineHost && !prefersNativeFloatingPlayback);
  const showNativeControls = !isDesktop && isInlineMode;
  const miniPlayerBottom = isDesktop
    ? 24
    : `calc(84px + env(safe-area-inset-bottom))`;
  const playerShellStyle: CSSProperties = isInlineMode
    ? inlineRect
      ? {
          position: 'fixed',
          top: inlineRect.top,
          left: inlineRect.left,
          width: inlineRect.width,
          height: inlineRect.height,
          zIndex: 30,
        }
      : {
          position: 'fixed',
          inset: 0,
          width: 0,
          height: 0,
          opacity: 0,
          pointerEvents: 'none',
          zIndex: 30,
        }
    : isMiniMode
      ? {
        position: 'fixed',
        right: isDesktop ? 24 : 14,
        bottom: miniPlayerBottom,
        width: isDesktop ? MINI_PLAYER_DESKTOP_WIDTH : MINI_PLAYER_MOBILE_WIDTH,
        aspectRatio: '16 / 9',
        zIndex: 10010,
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
  }, [clearFatalError, setPlaybackPhaseSafe]);

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
  }, []);

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

    if (pendingAutoplayRef.current) {
      pendingAutoplayRef.current = false;
      void videoElement.play().catch(() => {
        setPlaybackPhaseSafe('paused');
      });
      return;
    }

    setPlaybackPhaseSafe(videoElement.paused ? 'paused' : 'playing');
  }, [clearFatalError, setPlaybackPhaseSafe]);

  const handlePlaying = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    clearFatalError();
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
  }, [setPlaybackPhaseSafe]);

  const handleEnded = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    setPlaybackPhaseSafe('ended');
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
  }, [clearFatalError, setPlaybackPhaseSafe]);

  const handleTimeUpdate = useCallback(() => {
    if (castSnapshotRef.current.transport === 'google-cast' && castSnapshotRef.current.connected) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    setCurrentTime(videoElement.currentTime || 0);

    if (
      !videoElement.paused &&
      !videoElement.ended &&
      (playbackPhaseRef.current === 'loading' || playbackPhaseRef.current === 'buffering')
    ) {
      clearFatalError();
      setPlaybackPhaseSafe('playing');
    }
  }, [clearFatalError, setPlaybackPhaseSafe]);

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
      fallbackUrl !== lastAssignedSourceRef.current &&
      fallbackSourceRef.current !== fallbackUrl
    ) {
      clearFatalError();
      fallbackSourceRef.current = fallbackUrl;
      retriedCurrentSourceRef.current = false;
      startupGraceUntilRef.current = Date.now() + STARTUP_ERROR_GRACE_MS;
      lastAssignedSourceRef.current = fallbackUrl;
      setPlaybackPhaseSafe('loading');
      videoElement.pause();
      videoElement.src = fallbackUrl;
      videoElement.load();
      return;
    }

    scheduleFatalError(
      'Video failed to load. Please try again in a moment or switch to another source.'
    );
  }, [activeSource, activeSource?.fallbackUrl, clearFatalError, scheduleFatalError, setPlaybackPhaseSafe]);

  const handleOpenWatchView = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      openWatchView();
    },
    [openWatchView]
  );

  const handleShellKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isDesktop || !isInlineMode) {
        return;
      }

      if (event.repeat) {
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

      if (event.key === ' ' || event.key === 'k') {
        event.preventDefault();
        togglePlayPause();
        return;
      }

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void tryEnterFullscreen();
      }
    },
    [isDesktop, isInlineMode, seekBy, togglePlayPause, tryEnterFullscreen]
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
      playbackPhase,
      fatalErrorMessage,
      currentTime,
      duration,
      videoElementState,
      setPlaybackSource,
      clearPlayback,
      togglePlayPause,
      seekBy,
      tryEnterFullscreen,
      openWatchView,
    ]
  );

  return (
    <PlaybackContext.Provider value={contextValue}>
      {children}
      {activeSource ? (
        <div
          ref={shellRef}
          style={playerShellStyle}
          className={
            isInlineMode
              ? 'overflow-hidden bg-black'
              : isMiniMode
                ? 'overflow-hidden rounded-[22px] border border-white/10 bg-black shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl'
                : 'overflow-hidden bg-black'
          }
          tabIndex={isDesktop && isInlineMode ? 0 : -1}
          onKeyDown={handleShellKeyDown}
        >
          <div className="relative h-full w-full bg-black">
            <video
              ref={setVideoElement}
              poster={activeSource.poster || ''}
              preload="metadata"
              playsInline
              controls={showNativeControls}
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
              onDurationChange={handleLoadedMetadata}
              onError={handleVideoError}
            />

            {isInlineMode && !showNativeControls ? (
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/35">
                <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-2 md:right-4 md:top-4">
                  <PlayerShellButton
                    ariaLabel={castButtonAriaLabel}
                    onClick={handleCastButtonClick}
                    className={
                      isCasting ? 'border-[#D90429]/45 bg-[#D90429]/18 text-[#FFD7DF]' : ''
                    }
                  >
                    <Cast size={18} />
                  </PlayerShellButton>
                  <PlayerShellButton
                    ariaLabel={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    onClick={(event) => {
                      event.stopPropagation();
                      void tryEnterFullscreen();
                    }}
                  >
                    <Expand size={18} />
                  </PlayerShellButton>
                </div>

                <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-3 md:p-4">
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
                      {playbackPhase === 'playing' ? <Pause size={20} /> : <Play size={20} />}
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
                  </div>

                  <div className="rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-white/80">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </div>
                </div>
              </div>
            ) : null}

            {showNativeControls ? (
              <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                <PlayerShellButton
                  ariaLabel={castButtonAriaLabel}
                  onClick={handleCastButtonClick}
                  className={`h-10 w-10 bg-black/55 ${
                    isCasting ? 'border-[#D90429]/45 bg-[#D90429]/18 text-[#FFD7DF]' : ''
                  }`}
                >
                  <Cast size={16} />
                </PlayerShellButton>
                <PlayerShellButton
                  ariaLabel={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  onClick={(event) => {
                    event.stopPropagation();
                    void tryEnterFullscreen();
                  }}
                  className="h-10 w-10 bg-black/55"
                >
                  <Expand size={16} />
                </PlayerShellButton>
              </div>
            ) : null}

            {isMiniMode ? (
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/12 to-black/18">
                <button
                  type="button"
                  onClick={handleOpenWatchView}
                  className="pointer-events-auto absolute inset-0 text-left"
                  aria-label={`Open ${activeSource.title}`}
                />

                <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-2">
                  <PlayerShellButton
                    ariaLabel={castButtonAriaLabel}
                    onClick={handleCastButtonClick}
                    className={`h-10 w-10 ${
                      isCasting ? 'border-[#D90429]/45 bg-[#D90429]/18 text-[#FFD7DF]' : ''
                    }`}
                  >
                    <Cast size={16} />
                  </PlayerShellButton>
                  <PlayerShellButton
                    ariaLabel="Return to full player"
                    onClick={handleOpenWatchView}
                    className="h-10 w-10"
                  >
                    <Expand size={16} />
                  </PlayerShellButton>
                  <PlayerShellButton
                    ariaLabel="Close mini player"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearPlayback();
                    }}
                    className="h-10 w-10 text-white/80"
                  >
                    <X size={16} />
                  </PlayerShellButton>
                </div>

                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-black uppercase tracking-[0.2em] text-white/65">
                      Now Playing
                    </p>
                    <p className="mt-1 truncate text-sm font-bold text-white">
                      {activeSource.title}
                    </p>
                  </div>

                  <div className="pointer-events-auto flex items-center gap-2">
                    <PlayerShellButton
                      ariaLabel={playbackPhase === 'playing' ? 'Pause video' : 'Play video'}
                      onClick={(event) => {
                        event.stopPropagation();
                        togglePlayPause();
                      }}
                      className="h-11 w-11"
                    >
                      {playbackPhase === 'playing' ? <Pause size={18} /> : <Play size={18} />}
                    </PlayerShellButton>
                  </div>
                </div>
              </div>
            ) : null}

            {isCasting ? (
              <div className="pointer-events-none absolute left-3 top-3 flex max-w-[70%] items-center gap-2 rounded-full border border-white/10 bg-black/58 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white/84 backdrop-blur-xl md:left-4 md:top-4 md:text-[11px]">
                <Cast size={14} className="text-[#FFD7DF]" />
                <span className="truncate">
                  {isGoogleCasting
                    ? `Casting to ${castSnapshot.deviceName || 'Chromecast'}`
                    : 'AirPlay Active'}
                </span>
              </div>
            ) : null}

            {castFeedbackMessage ? (
              <div className="pointer-events-none absolute left-1/2 top-4 z-20 w-[min(92%,420px)] -translate-x-1/2 rounded-full border border-white/10 bg-black/64 px-4 py-2 text-center text-[10px] font-black uppercase tracking-[0.18em] text-white/86 backdrop-blur-xl md:text-[11px]">
                {castFeedbackMessage}
              </div>
            ) : null}

            {playbackPhase === 'loading' && currentTime <= 0.1 && !fatalErrorMessage ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <SpinnerOrb />
              </div>
            ) : null}

            {fatalErrorMessage ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 px-5 text-center">
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

            {desktopSeekFeedback && isDesktop ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="rounded-full border border-white/12 bg-black/62 px-6 py-3 text-lg font-black uppercase tracking-[0.22em] text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
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
