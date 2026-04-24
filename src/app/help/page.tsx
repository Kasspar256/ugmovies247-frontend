import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowUpRight,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  Shield,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Manrope, Sora } from 'next/font/google';

const headingFont = Sora({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
});

const bodyFont = Manrope({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Help | UG Movies 247',
  description: 'Find help online for UG Movies 247, including customer service, privacy, and terms information.',
};

const EMAIL_SUBJECT = encodeURIComponent('UG Movies 247 Help Center');
const EMAIL_BODY = encodeURIComponent(
  "Hello UG Movies 247,\r\n\r\nI need help with my account or the platform.\r\n\r\nThank you."
);
const HELP_CENTER_HREF = `mailto:info@ugmovies247.com?subject=${EMAIL_SUBJECT}&body=${EMAIL_BODY}`;
const CALL_HREF = 'tel:+256727261375';
const WHATSAPP_HREF = 'https://wa.me/256727261375';

function InfoCard({
  href,
  label,
  icon: Icon,
  internal = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  internal?: boolean;
}) {
  const content = (
    <>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 text-white">
        <Icon size={21} strokeWidth={2.15} />
      </span>
      <span className="flex-1 text-left text-[1.02rem] font-bold text-white">{label}</span>
      <ArrowUpRight size={18} strokeWidth={2.2} className="text-white/62" />
    </>
  );

  if (internal) {
    return (
      <Link
        href={href}
        className="flex items-center gap-4 rounded-[20px] bg-white/[0.12] px-4 py-4 transition-colors hover:bg-white/[0.16]"
      >
        {content}
      </Link>
    );
  }

  return (
    <a
      href={href}
      className="flex items-center gap-4 rounded-[20px] bg-white/[0.12] px-4 py-4 transition-colors hover:bg-white/[0.16]"
    >
      {content}
    </a>
  );
}

function ContactButton({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-[54px] flex-1 items-center justify-center gap-3 rounded-[18px] bg-white/[0.12] px-5 py-3 text-base font-bold text-white transition-colors hover:bg-white/[0.18]"
    >
      <Icon size={19} strokeWidth={2.2} />
      <span>{label}</span>
    </a>
  );
}

export default function HelpPage() {
  return (
    <main className={`${bodyFont.className} min-h-screen bg-[#0A0B10] px-4 pb-12 pt-[max(1.5rem,env(safe-area-inset-top))] text-white sm:px-6 lg:px-8`}>
      <div className="mx-auto max-w-[42rem]">
        <div className="relative flex items-center justify-center pb-8 pt-2">
          <img
            src="/logo2_clean_transparent.png"
            alt="UG Movies 247"
            className="h-[86px] w-auto object-contain sm:h-[98px]"
          />

          <Link
            href="/"
            aria-label="Close help"
            className="absolute right-0 top-2 inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
          >
            <X size={28} strokeWidth={2.2} />
          </Link>
        </div>

        <div className="rounded-[32px] bg-[#050608] px-1 py-2">
          <section className="rounded-[30px] border border-white/7 bg-[#0A0B10] px-4 pb-7 pt-2 shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:px-6">
            <h1 className={`${headingFont.className} mt-4 text-[2.1rem] font-extrabold tracking-[-0.05em] text-white sm:text-[2.6rem]`}>
              Find Help Online
            </h1>

            <div className="mt-6 space-y-3">
              <InfoCard href={HELP_CENTER_HREF} label="Help Center" icon={Mail} />
              <InfoCard href="/privacy" label="Privacy Statement" icon={FileText} internal />
              <InfoCard href="/terms" label="Terms Of Use" icon={Shield} internal />
            </div>

            <div className="mt-8 border-t border-white/10 pt-8">
              <h2 className={`${headingFont.className} text-[2rem] font-extrabold tracking-[-0.05em] text-white`}>
                We&apos;re here for you.
              </h2>
              <p className="mt-4 text-[1.02rem] leading-8 text-white/76">
                Need help getting back into your account, understanding your subscription, or finding the
                right page? Reach out and we&apos;ll point you in the right direction so you can get back to
                streaming quickly.
              </p>
            </div>

            <div className="mt-8 border-t border-white/10 pt-8">
              <h2 className={`${headingFont.className} text-[1.9rem] font-extrabold tracking-[-0.05em] text-white`}>
                Contact UG Movies 247 Customer Service
              </h2>
              <p className="mt-4 text-[1.02rem] leading-8 text-white/76">
                Call us directly or start a WhatsApp chat using the same UG Movies 247 support line.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <ContactButton href={CALL_HREF} label="Call" icon={Phone} />
                <ContactButton href={WHATSAPP_HREF} label="Chat" icon={MessageCircle} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

