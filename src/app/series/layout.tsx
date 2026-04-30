import { buildPageMetadata } from '@/lib/seo';
import { isAppInReview } from '@/lib/appReview';

export const metadata = buildPageMetadata({
  title: isAppInReview
    ? 'Series Trailers & Details - UG Movies 247'
    : 'Uganda Series Online - Watch Full Episodes on UG Movies 247',
  description: isAppInReview
    ? 'Discover series trailers, translated series details, VJ catalog information, genres, and saved title lists on UG Movies 247.'
    : 'Watch Uganda series, translated series, Luganda VJ series, drama, action, romance, and trending full episodes online on UG Movies 247.',
  path: '/series',
  keywords: isAppInReview
    ? ['series trailers Uganda', 'VJ series trailer catalog', 'translated series discovery']
    : ['uganda series online', 'uganda series full episodes online', 'luganda translated series'],
});

export default function SeriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
