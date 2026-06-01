'use client';

import { type ComponentType } from 'react';
import { FileText, Mail, MessageCircle, Scale, Send, Trash2 } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { isAppInReview } from '@/lib/appReview';

const EMAIL_SUBJECT = encodeURIComponent('UG Movies 247 Support Request');
const EMAIL_BODY = encodeURIComponent(
  "Hello UG Movies 247 Support,\r\n\r\nI'd like help with the platform. Please advise on the next steps.\r\n\r\nThank you."
);
const EMAIL_LINK = `mailto:info@ugmovies247.com?subject=${EMAIL_SUBJECT}&body=${EMAIL_BODY}`;
const COMMUNITY_LINK = 'https://t.me/+8d6j762RBs8zYjY0';
const DEVELOPER_MESSAGE = encodeURIComponent(
  "Hello, I'm reaching out from UG Movies 247. I'd like assistance or to discuss something related to the platform. Please advise on the next steps."
);
const DEVELOPER_WHATSAPP_LINK = `https://wa.me/27836376772?text=${DEVELOPER_MESSAGE}`;

function SupportAction({
  href,
  label,
  description,
  icon: Icon,
  accentClass,
}: {
  href: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  accentClass: string;
}) {
  const isMailTo = href.startsWith('mailto:');
  const isInternal = href.startsWith('/');

  return (
    <a
      href={href}
      target={isMailTo || isInternal ? undefined : '_blank'}
      rel={isMailTo || isInternal ? undefined : 'noreferrer'}
      className="flex items-center gap-4 rounded-[24px] border border-white/10 bg-[#11141C]/75 px-4 py-4 transition-colors hover:border-white/20"
    >
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${accentClass}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-white">{label}</div>
        <div className="mt-1.5 text-sm leading-6 text-white/54">{description}</div>
      </div>
    </a>
  );
}

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-16 text-white md:px-8 md:pb-16 md:pt-[118px] lg:px-10">
      <MobilePageHeader title="Support" fallbackHref="/profile" />

      <div className="mx-auto max-w-3xl">
        <div className="hidden md:block">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
            Support
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">Support</h1>
        </div>

        <section className="mt-6 rounded-[28px] border border-white/10 bg-[#11141C]/82 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.32)]">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
            Support
          </div>
          <div className="mt-3 text-[15px] leading-7 text-white/68">
            {isAppInReview
              ? 'Use these options for account help, privacy information, and trailer catalog support.'
              : 'Use these options for account help, platform questions, and community access.'}
          </div>

          <div className="mt-5 space-y-3">
            {isAppInReview ? (
              <div className="rounded-[24px] border border-sky-500/20 bg-sky-500/10 px-4 py-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-500/20 bg-sky-500/10 text-sky-200">
                    <Mail size={20} />
                  </div>
                  <div>
                    <div className="text-base font-semibold text-white">Email support</div>
                    <div className="mt-1.5 text-sm leading-6 text-white/64">info@ugmovies247.com</div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <SupportAction
                  href={EMAIL_LINK}
                  label="Email support"
                  description="Write to info@ugmovies247.com for account, billing, and platform support."
                  icon={Mail}
                  accentClass="border border-sky-500/20 bg-sky-500/10 text-sky-200"
                />
                <SupportAction
                  href={COMMUNITY_LINK}
                  label="Join the community"
                  description="Open the Telegram community for announcements and discussion."
                  icon={Send}
                  accentClass="border border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
                />
              </>
            )}
          </div>
        </section>

        {!isAppInReview && (
          <section className="mt-4 rounded-[28px] border border-white/10 bg-[#11141C]/76 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
              Contact Developer
            </div>
            <div className="mt-3 text-[15px] leading-7 text-white/68">
              Use this direct line when you specifically need to reach the developer.
            </div>

            <div className="mt-5">
              <SupportAction
                href={DEVELOPER_WHATSAPP_LINK}
                label="Developer on WhatsApp"
                description="Open a direct WhatsApp conversation with the professional prefilled message."
                icon={MessageCircle}
                accentClass="border border-green-500/20 bg-green-500/10 text-green-300"
              />
            </div>
          </section>
        )}

        <section className="mt-4 rounded-[28px] border border-white/10 bg-[#11141C]/72 p-5 shadow-[0_16px_34px_rgba(0,0,0,0.24)]">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
            Legal
          </div>
          <div className="mt-3 text-[15px] leading-7 text-white/68">
            Review the legal policies that govern privacy, platform access, and copyright notices.
          </div>

          <div className="mt-5 space-y-3">
            <SupportAction
              href="/terms"
              label="Terms & Conditions"
              description={
                isAppInReview
                  ? 'Read the rules for accounts, trailer discovery, catalog access, and acceptable use.'
                  : 'Read the rules for accounts, subscriptions, billing, streaming, and acceptable use.'
              }
              icon={Scale}
              accentClass="border border-white/10 bg-white/5 text-white"
            />
            <SupportAction
              href="/privacy"
              label="Privacy Policy"
              description="See what information we collect, how it is used, and how deletion requests work."
              icon={FileText}
              accentClass="border border-white/10 bg-white/5 text-white"
            />
            <SupportAction
              href="/account-deletion"
              label="Account Deletion"
              description="See how to delete your app account and request deletion from the web."
              icon={Trash2}
              accentClass="border border-white/10 bg-white/5 text-white"
            />
            <SupportAction
              href="/dmca"
              label="DMCA"
              description="Read the copyright notice policy for rights holders and authorized agents."
              icon={FileText}
              accentClass="border border-white/10 bg-white/5 text-white"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
