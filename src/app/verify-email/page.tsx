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
    <main className="flex min-h-screen items-center justify-center bg-[#0B0C10] px-4 py-12 text-white">
      <section className="w-full max-w-md rounded-[32px] border border-white/10 bg-[#11141C]/90 p-7 text-center shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
          isSuccess ? 'bg-emerald-500/12 text-emerald-300' : 'bg-red-500/12 text-red-200'
        }`}>
          {isSuccess ? <CheckCircle2 size={34} /> : <XCircle size={34} />}
        </div>
        <h1 className="mt-5 text-3xl font-black tracking-[-0.04em]">
          {isSuccess ? 'Email verified' : 'Verification failed'}
        </h1>
        <p className="mt-3 text-sm leading-7 text-white/68">
          {isSuccess
            ? 'Your email has been verified successfully.'
            : 'This verification link is invalid, expired, or already used. You can request a new one from your profile.'}
        </p>
        <Link
          href="/browse"
          className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.24em] text-white"
        >
          Continue
        </Link>
      </section>
    </main>
  );
}
