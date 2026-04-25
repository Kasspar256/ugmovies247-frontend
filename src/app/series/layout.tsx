import { buildPageMetadata } from '@/lib/seo';

export const metadata = buildPageMetadata({
  title: 'Uganda Series Online - Watch Full Episodes on UG Movies 247',
  description:
    'Watch Uganda series, translated series, Luganda VJ series, drama, action, romance, and trending full episodes online on UG Movies 247.',
  path: '/series',
  keywords: ['uganda series online', 'uganda series full episodes online', 'luganda translated series'],
});

export default function SeriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
