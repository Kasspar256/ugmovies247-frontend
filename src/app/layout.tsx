import './globals.css';
import AuthGate from '@/components/AuthGate';
import AndroidBackButtonHandler from '@/components/AndroidBackButtonHandler';
import AppChrome from '@/components/AppChrome';
import EnvironmentBadge from '@/components/EnvironmentBadge';
import MobileBottomNav from '@/components/MobileBottomNav';
import MovieRequestDeepLinkHandler from '@/components/MovieRequestDeepLinkHandler';
import { PlaybackProvider } from '@/components/player/PlaybackProvider';
import { buildPageMetadata, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from '@/lib/seo';

export const metadata = {
  ...buildPageMetadata({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    path: '/',
  }),
  applicationName: SITE_NAME,
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: 'black-translucent',
  },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/siteicon.png', type: 'image/png', sizes: '512x512' },
    ],
    shortcut: ['/favicon.png'],
    apple: [{ url: '/siteicon.png', sizes: '512x512', type: 'image/png' }],
  },
  category: 'entertainment',
};

export const viewport = {
  themeColor: '#0B0C10',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-screen overflow-x-hidden bg-[#0B0C10] text-white antialiased">
        <PlaybackProvider>
          <AndroidBackButtonHandler />
          <MovieRequestDeepLinkHandler />
          <main className="w-full mx-auto min-h-screen relative bg-[#0B0C10]">
            <AuthGate>
              <AppChrome>{children}</AppChrome>
            </AuthGate>
            <EnvironmentBadge />
          </main>
          <MobileBottomNav />
        </PlaybackProvider>
      </body>
    </html>
  );
}
