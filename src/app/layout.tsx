import './globals.css';
import AuthGate from '@/components/AuthGate';
import EnvironmentBadge from '@/components/EnvironmentBadge';

export const metadata = {
  title: 'UgMovies247 | Premium VJ Translated Movies',
  description: 'The ultimate VJ translated movie streaming platform in Uganda.'
};

export const viewport = {
  themeColor: '#0B0C10',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="bg-[#0B0C10] text-white antialiased min-h-screen pb-16 md:pb-0">
        <main className="w-full mx-auto min-h-screen relative bg-[#0B0C10]">
          <AuthGate>{children}</AuthGate>
          <EnvironmentBadge />
        </main>
      </body>
    </html>
  );
}
