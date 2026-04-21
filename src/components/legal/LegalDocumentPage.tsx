import Link from 'next/link';
import type { ReactNode } from 'react';

type LegalDocumentPageProps = {
  eyebrow?: string;
  title: string;
  summary: ReactNode;
  lastUpdated: string;
  children: ReactNode;
};

type SectionProps = {
  id?: string;
  title: string;
  children: ReactNode;
};

type SubsectionProps = {
  title: string;
  children: ReactNode;
};

export function LegalInlineLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="font-semibold text-[#B00020] underline decoration-[#D90429]/35 underline-offset-4 transition-colors hover:text-black"
    >
      {children}
    </a>
  );
}

export function LegalSection({ id, title, children }: SectionProps) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-slate-200 pt-10 first:border-t-0 first:pt-0">
      <h2 className="text-2xl font-bold tracking-[-0.03em] text-slate-950">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-slate-700 sm:text-base">{children}</div>
    </section>
  );
}

export function LegalSubsection({ title, children }: SubsectionProps) {
  return (
    <div className="space-y-3 pt-2">
      <h3 className="text-lg font-semibold tracking-[-0.02em] text-slate-900">{title}</h3>
      <div className="space-y-3 text-[15px] leading-7 text-slate-700 sm:text-base">{children}</div>
    </div>
  );
}

export function LegalBulletList({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc space-y-2 pl-6 text-[15px] leading-7 text-slate-700 marker:text-[#D90429] sm:text-base">
      {children}
    </ul>
  );
}

export function LegalNumberedList({ children }: { children: ReactNode }) {
  return (
    <ol className="list-decimal space-y-2 pl-6 text-[15px] leading-7 text-slate-700 marker:font-semibold marker:text-slate-900 sm:text-base">
      {children}
    </ol>
  );
}

export default function LegalDocumentPage({
  eyebrow = 'UGMovies247 Legal',
  title,
  summary,
  lastUpdated,
  children,
}: LegalDocumentPageProps) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-black/10 bg-black">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-center px-4 sm:h-[72px] sm:px-6">
          <Link
            href="/"
            className="text-center text-[15px] font-black uppercase tracking-[0.38em] text-[#D90429] transition-transform hover:scale-[1.01] sm:text-[18px] [text-shadow:0_0_18px_rgba(217,4,41,0.38)]"
          >
            UGMOVIES247
          </Link>
        </div>
      </header>

      <main className="px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        <article className="mx-auto max-w-4xl">
          <div className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">{eyebrow}</div>
          <h1 className="mt-4 text-4xl font-black uppercase tracking-[-0.04em] text-slate-950 sm:text-5xl">
            {title}
          </h1>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-5 sm:p-6">
            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">
              Last Updated
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900 sm:text-base">{lastUpdated}</div>
            <div className="mt-4 text-[15px] leading-7 text-slate-700 sm:text-base">{summary}</div>
          </div>

          <div className="mt-10 space-y-10">{children}</div>
        </article>
      </main>
    </div>
  );
}
