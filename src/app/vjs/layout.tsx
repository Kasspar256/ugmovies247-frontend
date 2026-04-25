import { buildPageMetadata } from '@/lib/seo';

export const metadata = buildPageMetadata({
  title: 'Ugandan VJ Movies Online - VJ Junior, VJ Emmy, VJ Jingo & More',
  description:
    'Browse translated movies by Ugandan VJs including VJ Junior, VJ Emmy, VJ Jingo, VJ Ice P, VJ Mark, VJ Tom, and more on UG Movies 247.',
  path: '/vjs',
  keywords: ['VJ Junior movies', 'VJ Emmy movies', 'VJ Jingo movies', 'Luganda VJ movies'],
});

export default function VjsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
