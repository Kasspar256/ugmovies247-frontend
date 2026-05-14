'use client';

type GoogleAuthButtonProps = {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  idleLabel: string;
  loadingLabel?: string;
};

export default function GoogleAuthButton({
  onClick,
  disabled = false,
  loading = false,
  idleLabel,
  loadingLabel = 'Connecting to Google...',
}: GoogleAuthButtonProps) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled || loading}
      aria-busy={loading}
      className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white px-4 py-4 text-sm font-black uppercase tracking-[0.2em] text-[#11141C] shadow-[0_18px_35px_rgba(0,0,0,0.18)] transition-colors hover:bg-[#F4F6F8] disabled:cursor-wait disabled:bg-white/70"
    >
      <GoogleMark />
      <span>{loading ? loadingLabel : idleLabel}</span>
      {loading ? <GoogleAuthSpinner /> : null}
    </button>
  );
}

function GoogleAuthSpinner() {
  return (
    <span
      className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#11141C]/20 border-t-[#11141C]"
      aria-hidden="true"
    />
  );
}

function GoogleMark() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12.24 10.285v3.821h5.445c-.239 1.226-.958 2.265-2.041 2.964l3.3 2.562c1.922-1.771 3.026-4.377 3.026-7.491 0-.719-.064-1.411-.183-2.074H12.24z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.754 0 5.06-.913 6.747-2.468l-3.3-2.562c-.913.611-2.082.972-3.447.972-2.648 0-4.889-1.787-5.69-4.19H2.898v2.633A9.997 9.997 0 0012 22z"
      />
      <path
        fill="#4A90E2"
        d="M6.31 13.752A5.998 5.998 0 016 12c0-.608.105-1.199.31-1.752V7.615H2.898A9.997 9.997 0 002 12c0 1.61.385 3.135 1.067 4.385l3.243-2.633z"
      />
      <path
        fill="#FBBC05"
        d="M12 6.058c1.497 0 2.84.515 3.9 1.524l2.922-2.922C17.055 2.997 14.749 2 12 2A9.997 9.997 0 003.067 7.615l3.243 2.633c.801-2.403 3.042-4.19 5.69-4.19z"
      />
    </svg>
  );
}
