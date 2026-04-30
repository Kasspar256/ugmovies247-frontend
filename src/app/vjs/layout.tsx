import { buildPageMetadata } from '@/lib/seo';
import { isAppInReview } from '@/lib/appReview';

export const metadata = buildPageMetadata({
  title: isAppInReview
    ? 'Ugandan VJ Trailer Catalog - VJ Junior, VJ Emmy, VJ Jingo & More'
    : 'Ugandan VJ Movies Online - VJ Junior, VJ Emmy, VJ Jingo & More',
  description: isAppInReview
    ? 'Browse trailer catalog entries by Ugandan VJs including VJ Junior, VJ Emmy, VJ Jingo, VJ Ice P, VJ Mark, VJ Tom, and more on UG Movies 247.'
    : 'Browse translated movies by Ugandan VJs including VJ Junior, VJ Emmy, VJ Jingo, VJ Ice P, VJ Mark, VJ Tom, and more on UG Movies 247.',
  path: '/vjs',
  keywords: isAppInReview
    ? ['VJ trailers Uganda', 'VJ trailer catalog', 'Luganda VJ trailer discovery']
    : ['VJ Junior movies', 'VJ Emmy movies', 'VJ Jingo movies', 'Luganda VJ movies'],
});

export default function VjsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
