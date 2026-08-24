import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { Fraunces, Nunito } from 'next/font/google';
import { Providers } from './providers';
import { ConfirmHost } from '@/components/ui/Confirm';
import { StorageToast } from '@/components/ui/StorageToast';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import { SITE_URL } from '@/lib/site-url';
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
// so it needs to unfurl as something.
//
// It now unfurls with a picture: `app/opengraph-image.tsx`, rasterised at build
// time. That file is not a screenshot and deliberately never will be — the reason
// this card carried no image for so long was that inventing a render of "your
// room" would be a claim the app has not earned, and that still holds. It is a
// brand card: the mark, the name, the sentence, three true claims.
//
// No `images` entry here, and none wanted. The file conventions
// (`opengraph-image`, `apple-icon`, `icon.svg`) are discovered by Next and turned
// into tags with their real content-hashed urls; naming them again in this object
// would be a second, hand-maintained answer that goes stale the moment one is
// renamed. `metadataBase` is the one thing the convention cannot work out for
// itself — see `lib/site-url.ts` for why it is resolved rather than written down.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
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
  // Stated rather than left to be inferred: without a `twitter` block Next emits
  // no `twitter:card`, and a reader with no card type gets the small square
  // thumbnail treatment — a 1200×630 card cropped to a postage stamp. This is
  // also what Slack and several others read in preference to the og tags.
  twitter: {
    card: 'summary_large_image',
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
          <ServiceWorkerRegistrar />
        </Providers>
      </body>
    </html>
  );
}
