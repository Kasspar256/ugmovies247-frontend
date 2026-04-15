import type { ReactNode } from 'react';
import MobilePageHeader from '@/components/MobilePageHeader';

type LegalSection = {
  title: string;
  paragraphs?: ReactNode[];
  items?: ReactNode[];
};

export default function LegalDocumentPage({
  eyebrow,
  title,
  summary,
  updatedLabel,
  sections,
}: {
  eyebrow: string;
  title: string;
  summary: ReactNode;
  updatedLabel: string;
  sections: LegalSection[];
}) {
  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)] pt-16 text-white md:px-8 md:pb-16 md:pt-[118px] lg:px-10">
      <MobilePageHeader title={title} fallbackHref="/login" />

      <div className="mx-auto max-w-4xl">
        <div className="hidden md:block">
          <div className="text-xs font-black uppercase tracking-[0.24em] text-white/42">{eyebrow}</div>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-white">{title}</h1>
        </div>

        <section className="mt-6 rounded-[30px] border border-white/10 bg-[#11141C]/84 p-6 shadow-[0_24px_54px_rgba(0,0,0,0.34)] md:p-8">
          <div className="text-xs font-black uppercase tracking-[0.24em] text-white/42">Last Updated</div>
          <div className="mt-2 text-base font-semibold text-white">{updatedLabel}</div>
          <div className="mt-5 text-[15px] leading-7 text-white/74">{summary}</div>
        </section>

        <div className="mt-5 space-y-4">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-[28px] border border-white/10 bg-[#11141C]/74 p-6 shadow-[0_18px_42px_rgba(0,0,0,0.24)] md:p-7"
            >
              <h2 className="text-xl font-black tracking-[-0.03em] text-white">{section.title}</h2>

              {section.paragraphs?.length ? (
                <div className="mt-4 space-y-3 text-[15px] leading-7 text-white/72">
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={`${section.title}-paragraph-${index}`}>{paragraph}</p>
                  ))}
                </div>
              ) : null}

              {section.items?.length ? (
                <ul className="mt-4 space-y-3 text-[15px] leading-7 text-white/72">
                  {section.items.map((item, index) => (
                    <li key={`${section.title}-item-${index}`} className="flex gap-3">
                      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#D90429]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
