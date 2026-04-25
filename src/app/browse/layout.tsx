import { buildPageMetadata } from '@/lib/seo';

export const metadata = buildPageMetadata({
  title: 'Browse Movies & Series - UG Movies 247',
  description:
    'Browse latest movies, Uganda translated movies, Luganda translated films, VJ movies, series, and trending entertainment on UG Movies 247.',
  path: '/browse',
  keywords: ['latest movies Uganda', 'trending ugandan movies', 'uganda translated movies', 'VJ movies Uganda'],
});

export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
