'use client';

import { APP_ENV } from '@/lib/appEnv';

export default function AuthDevHelper({ items }: { items: string[] }) {
  if (APP_ENV === 'production' || items.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
      <div className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-200">
        Dev Diagnostics
      </div>
      <div className="mt-2 space-y-1.5">
        {items.map((item) => (
          <p key={item} className="leading-5">
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}
