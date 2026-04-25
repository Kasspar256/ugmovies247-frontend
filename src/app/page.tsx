import type { Metadata } from 'next';
import Link from 'next/link';
import { Manrope, Sora } from 'next/font/google';
import { ArrowRight, Check } from 'lucide-react';
import { getArtworkImageProps } from '@/lib/artwork';
import PublicLandingMenu from '@/components/public/PublicLandingMenu';
import {
  buildPageMetadata,
  organizationJsonLd,
  SITE_DESCRIPTION,
  SITE_TITLE,
  websiteJsonLd,
} from '@/lib/seo';

const headingFont = Sora({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
});

const bodyFont = Manrope({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
});

export const metadata: Metadata = {
  ...buildPageMetadata({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    path: '/',
    keywords: [
      'watch Ugandan movies online',
      'Luganda translated movies',
      'VJ movies Uganda',
      'Uganda movie streaming',
    ],
  }),
};

const browseRedirect = encodeURIComponent('/browse');
const signInHref = `/login?redirect=${browseRedirect}`;
const getStartedHref = `/signup?redirect=${browseRedirect}`;

const posterWall = [
  'https://image.tmdb.org/t/p/original/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg',
  'https://image.tmdb.org/t/p/original/aabwWZWx6z1aYP4PX2ADvbDKktd.jpg',
  'https://image.tmdb.org/t/p/original/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg',
  'https://image.tmdb.org/t/p/original/ubP2OsF3GlfqYPvXyLw9d78djGX.jpg',
  'https://image.tmdb.org/t/p/original/705nQHqe4JGdEisrQmVYmXyjs1U.jpg',
  'https://image.tmdb.org/t/p/original/7iMBZzVZtG0oBug4TfqDb9ZxAOa.jpg',
] as const;

const desktopPosterWall = [
  'https://image.tmdb.org/t/p/original/74xTEgt7R36Fpooo50r9T25onhq.jpg',
  'https://image.tmdb.org/t/p/original/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
  'https://image.tmdb.org/t/p/original/NNxYkU70HPurnNCSiCjYAmacwm.jpg',
  'https://image.tmdb.org/t/p/original/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg',
  'https://image.tmdb.org/t/p/original/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
  'https://image.tmdb.org/t/p/original/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg',
] as const;

const bulletPoints = [
  'Watch movies and series on any device, anywhere.',
  'Fresh new additions added regularly',
  'Premium access from UGX 2,000. Cancel anytime.',
] as const;

function PosterTile({
  src,
  index,
  className = '',
}: {
  src: string;
  index: number;
  className?: string;
}) {
  const artwork = getArtworkImageProps(src, 'card');
  const offsets = ['mt-0', 'mt-8', 'mt-2', '-mt-3', 'mt-6', 'mt-1'] as const;
  const offsetClass = offsets[index % offsets.length];

  return (
    <div
      className={`overflow-hidden rounded-[22px] border border-white/10 bg-[#11141C] shadow-[0_22px_48px_rgba(0,0,0,0.32)] ${offsetClass} ${className}`}
    >
      <div className="aspect-[0.7] w-full overflow-hidden">
        <img
          src={artwork.src}
          srcSet={artwork.srcSet}
          sizes="(max-width: 768px) 31vw, (max-width: 1200px) 15vw, 180px"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
          loading={index < 6 ? 'eager' : 'lazy'}
          decoding="async"
        />
      </div>
    </div>
  );
}

function BulletItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#D90429]/15 text-[#ff5b74]">
        <Check size={16} strokeWidth={3} />
      </span>
      <span className="text-[15px] leading-7 text-white/88 sm:text-base">{text}</span>
    </li>
  );
}

export default function LandingPage() {
  const homepageSchemas = [websiteJsonLd(), organizationJsonLd()];

  return (
    <main className={`${bodyFont.className} relative min-h-screen overflow-hidden bg-[#08090D] text-white`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageSchemas) }}
      />
      <div className="absolute inset-0">
        <div className="mx-auto grid h-full max-w-7xl grid-cols-3 gap-3 px-4 pb-20 pt-28 opacity-[0.97] sm:gap-4 sm:px-6 sm:pt-32 md:grid-cols-6 lg:px-10 lg:pb-24 lg:pt-24">
          {posterWall.map((poster, index) => (
            <PosterTile key={`${poster}-${index}`} src={poster} index={index} />
          ))}
          {desktopPosterWall.map((poster, index) => (
            <PosterTile
              key={`${poster}-${index + posterWall.length}`}
              src={poster}
              index={index + posterWall.length}
              className="hidden md:block"
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,9,13,0.06)_0%,rgba(8,9,13,0.14)_16%,rgba(8,9,13,0.34)_40%,rgba(8,9,13,0.68)_72%,#08090D_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(217,4,41,0.16),transparent_36%)]" />
      </div>

      <header className="absolute inset-x-0 top-0 z-30 px-4 pt-[max(1.15rem,env(safe-area-inset-top))] sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-4">
          <Link href="/" className="flex items-center lg:-translate-y-2">
            <img
              src="/logo2_clean_transparent.png"
              alt="UG Movies 247"
              className="h-[102px] w-auto max-w-none object-contain sm:h-[122px] lg:h-[136px]"
            />
          </Link>

          <div className="mt-3 flex items-center gap-2 sm:gap-3">
            <PublicLandingMenu />
            <Link
              href={signInHref}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[18px] bg-white/18 px-4 text-[0.96rem] font-black tracking-[0.01em] text-white shadow-[0_16px_38px_rgba(0,0,0,0.28)] backdrop-blur-md transition-colors hover:bg-white/26 sm:min-h-[48px] sm:px-5"
            >
              Sign In
            </Link>
          </div>
        </div>
      </header>

      <section className="relative z-10 flex min-h-screen items-end px-4 pb-8 pt-24 sm:px-6 sm:pb-10 sm:pt-28 lg:px-10 lg:pb-14 lg:pt-28">
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[0.95fr_0.52fr] lg:items-end">
          <div className="mx-auto w-full max-w-[24rem] text-center drop-shadow-[0_14px_38px_rgba(0,0,0,0.58)] lg:mx-0 lg:max-w-[31rem] lg:text-left">
            <h1
              className={`${headingFont.className} text-[2.38rem] font-extrabold leading-[0.96] tracking-[-0.055em] text-white sm:text-[2.95rem] lg:text-[4.15rem]`}
            >
              Ready for premium entertainment?
            </h1>

            <ul className="mx-auto mt-6 max-w-[23rem] space-y-4 text-left lg:mx-0">
              {bulletPoints.map((point) => (
                <BulletItem key={point} text={point} />
              ))}
            </ul>
          </div>

          <div className="w-full">
            <div className="rounded-[30px] border border-white/18 bg-white/[0.045] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-[18px] sm:p-6">
              <p className="text-center text-[1.05rem] leading-8 text-white/84 sm:text-[1.15rem]">
                Create your UG Movies 247 account and start streaming with a smoother premium experience.
              </p>

              <div className="mt-5">
                <Link
                  href={getStartedHref}
                  className="inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-5 py-3 text-sm font-black uppercase tracking-[0.22em] text-white transition-colors hover:bg-[#ef163b]"
                >
                  Get Started
                  <ArrowRight size={18} strokeWidth={2.6} />
                </Link>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[0.82rem] font-semibold text-white/68">
                <Link href="/category/luganda-translated-movies" className="transition-colors hover:text-white">
                  Luganda Movies
                </Link>
                <span className="hidden h-1 w-1 rounded-full bg-white/30 sm:block" aria-hidden="true" />
                <Link href="/vjs" className="transition-colors hover:text-white">
                  VJ Movies
                </Link>
                <span className="hidden h-1 w-1 rounded-full bg-white/30 sm:block" aria-hidden="true" />
                <Link href="/privacy" className="transition-colors hover:text-white">
                  Privacy Policy
                </Link>
                <span className="hidden h-1 w-1 rounded-full bg-white/30 sm:block" aria-hidden="true" />
                <Link href="/terms" className="transition-colors hover:text-white">
                  Terms of Use
                </Link>
                <span className="hidden h-1 w-1 rounded-full bg-white/30 sm:block" aria-hidden="true" />
                <Link href="/help" className="transition-colors hover:text-white">
                  Help
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
