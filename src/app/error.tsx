'use client';

import { useEffect } from 'react';
import {
  PersistentPlaybackHost,
  usePlayback,
} from '@/components/player/PlaybackProvider';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { activeSource } = usePlayback();
  const hasActivePlayback = Boolean(activeSource?.sourceUrl);

  useEffect(() => {
    console.error('[app-error]', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[#0B0C10] px-6 pb-28 pt-12 text-center text-white">
      {hasActivePlayback ? (
        <div className="mx-auto mb-8 aspect-video w-full max-w-xl overflow-hidden rounded-[28px] border border-white/8 bg-black shadow-[0_28px_80px_rgba(0,0,0,0.42)]">
          <PersistentPlaybackHost active className="h-full w-full" />
        </div>
      ) : null}
      <section className="mx-auto w-full max-w-md">
        {!hasActivePlayback ? (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.06] shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
            <img src="/siteicon.png" alt="" className="h-16 w-16 object-contain" />
          </div>
        ) : null}
        <div className="mt-7 inline-flex rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-white/68">
          Playback Safe Mode
        </div>
        <h1 className="mt-5 text-4xl font-black leading-tight tracking-[-0.03em]">
          {hasActivePlayback ? 'Player is still running' : 'We are reconnecting your session'}
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-7 text-white/66">
          {hasActivePlayback
            ? 'The movie is still playing. Continue will retry the page without dropping the live video.'
            : 'The app hit a temporary loading problem. Your account and movie data are kept safe on this device.'}
        </p>
        <div className="mt-7 grid gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-14 rounded-[18px] bg-[#D90429] px-5 text-sm font-black uppercase tracking-[0.16em] text-white"
          >
            Continue
          </button>
          <a
            href="/browse"
            className="inline-flex min-h-14 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.06] px-5 text-sm font-black uppercase tracking-[0.16em] text-white/88"
          >
            Back to Browse
          </a>
        </div>
      </section>
    </main>
  );
}
