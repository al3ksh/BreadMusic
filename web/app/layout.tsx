import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { CookieNotice } from '@/components/legal/CookieNotice';

export const metadata: Metadata = {
  title: 'Bread — Discord Music Bot',
  description: 'Music playback, audio filters, games, and economy — all in one Discord bot. Manage everything from the dashboard.',
  icons: [
    { rel: 'icon', url: '/assets/breadiconpng.png?v=3', type: 'image/png', sizes: 'any' },
    { rel: 'apple-touch-icon', url: '/assets/breadicon.png?v=3' }
  ],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <ToastProvider>
          {children}
          <CookieNotice />
        </ToastProvider>
      </body>
    </html>
  );
}
