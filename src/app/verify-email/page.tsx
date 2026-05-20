import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { verifyEmailToken } from '@/lib/server/emailTokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  const token = String(searchParams?.token || '').trim();
  const result = token ? await verifyEmailToken(token) : { ok: false as const, reason: 'invalid' as const };
  const isSuccess = result.ok;

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#0B0C10] px-3 py-8 text-white min-[390px]:px-4 min-[390px]:py-12">
      <section className="w-full max-w-md rounded-[24px] border border-white/10 bg-[#11141C]/90 p-4 text-center shadow-[0_30px_80px_rgba(0,0,0,0.5)] min-[390px]:rounded-[32px] min-[390px]:p-7">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
          isSuccess ? 'bg-emerald-500/12 text-emerald-300' : 'bg-red-500/12 text-red-200'
        }`}>
          {isSuccess ? <CheckCircle2 size={34} /> : <XCircle size={34} />}
        </div>
        <h1 className="mt-4 text-[clamp(1.55rem,7vw,1.9rem)] font-black leading-tight tracking-[-0.03em] min-[390px]:mt-5 min-[390px]:text-3xl min-[390px]:tracking-[-0.04em]">
          {isSuccess ? 'Email verified' : 'Verification failed'}
        </h1>
        <p className="mt-2 text-xs leading-5 text-white/68 min-[390px]:mt-3 min-[390px]:text-sm min-[390px]:leading-7">
          {isSuccess
            ? 'Your email has been verified successfully.'
            : 'This verification link is invalid, expired, or already used. You can request a new one from your profile.'}
        </p>
        <Link
          href="/browse"
          className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-[#D90429] px-4 py-3.5 text-xs font-black uppercase tracking-[0.17em] text-white min-[390px]:mt-6 min-[390px]:px-5 min-[390px]:py-4 min-[390px]:text-sm min-[390px]:tracking-[0.24em]"
        >
          Continue
        </Link>
      </section>
    </main>
  );
}
