import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { Fraunces, Nunito } from 'next/font/google';
import { Providers } from './providers';
import { ConfirmHost } from '@/components/ui/Confirm';
import { StorageToast } from '@/components/ui/StorageToast';
import './globals.css';

// Warm editorial-casual pairing: a soft optical serif for display, a rounded
// humanist sans for body. Mono (Geist) is reserved for numerals/dimensions.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz', 'SOFT'],
});

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Danmu — Redesign your room without lying to yourself',
  description:
    'A precise, zero-budget interior redesign tool. Lock what exists, ghost what you want, render with your own Google API key.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#FAFAF7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${GeistMono.variable} ${fraunces.variable}`}>
      <body>
        <Providers>
          {children}
          <ConfirmHost />
          <StorageToast />
        </Providers>
      </body>
    </html>
  );
}
