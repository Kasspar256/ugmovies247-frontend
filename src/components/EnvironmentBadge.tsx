'use client';

import { APP_ENV, APP_ENV_LABEL, FIREBASE_PROJECT_LABEL, SHOULD_SHOW_ENV_BADGE } from '@/lib/appEnv';

export default function EnvironmentBadge() {
  if (!SHOULD_SHOW_ENV_BADGE) {
    return null;
  }

  const tone =
    APP_ENV === 'production'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
      : APP_ENV === 'staging'
        ? 'border-amber-400/25 bg-amber-400/10 text-amber-100'
        : 'border-sky-400/25 bg-sky-400/10 text-sky-100';

  return (
    <div className="fixed bottom-20 left-4 z-[70] md:bottom-6 md:left-6">
      <div
        className={`rounded-2xl border px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl ${tone}`}
      >
        <div className="text-[10px] font-black uppercase tracking-[0.28em]">
          {APP_ENV_LABEL}
        </div>
        <div className="mt-1 text-[11px] font-medium opacity-90">
          {FIREBASE_PROJECT_LABEL}
        </div>
      </div>
    </div>
  );
}
