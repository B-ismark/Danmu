import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { Fraunces, Nunito } from 'next/font/google';
import { Providers } from './providers';
import { ConfirmHost } from '@/components/ui/Confirm';
import { StorageToast } from '@/components/ui/StorageToast';
import './globals.css';

// Warm editorial-casual pairing: a soft optical serif for display, a rounded
// humanist sans for body. Mono (Geist) is reserved for numerals/dimensions.
// The CSS variable must NOT be named --font-display: globals.css defines
// `--font-display: var(--font-fraunces), 'Fraunces', …`, and a custom property
// that references itself is cyclic — the browser discards the entire value,
// fallbacks included, and every heading silently falls back to body sans.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz', 'SOFT'],
});

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

// Danmu spreads by word of mouth — a shared link is the whole marketing surface,
// so it needs to unfurl as something. openGraph carries no image file: there is
// no public/ directory and no photoreal render to point at, and inventing a
// screenshot claim would be worse than a text-only card.
export const metadata: Metadata = {
  title: 'Danmu — Decorate your room in real 3D',
  description:
    'A warm, local-first interior decoration studio. Arrange, recolour, restyle and relight furniture in a scaled 3D room — right in your browser. No account, nothing leaves your device.',
  applicationName: 'Danmu',
  openGraph: {
    type: 'website',
    siteName: 'Danmu',
    title: 'Danmu — Decorate your room in real 3D',
    description:
      'Pick a footprint, get a scaled 3D room, and redecorate it. Real dimensions, computed on your device. No account, no uploads.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches --paper-0, the actual page wash, so mobile browser chrome blends
  // with the app instead of introducing a fourth unrelated cream.
  themeColor: '#EFE9DD',
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
