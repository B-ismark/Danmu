import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { Figtree, Fraunces } from 'next/font/google';
import { Providers } from './providers';
import { ConfirmHost } from '@/components/ui/Confirm';
import { StorageToast } from '@/components/ui/StorageToast';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import { AppearanceSync } from '@/components/AppearanceSync';
import { APPEARANCE_BOOT } from '@/lib/appearance';
import { PAPER_0, PAPER_0_DARK } from './manifest';
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

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
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
  title: 'Danmu · Decorate your room in 3D',
  description:
    'Arrange, recolour, restyle and relight furniture in a scaled 3D room in your browser. No account. Your rooms stay on your device.',
  applicationName: 'Danmu',
  openGraph: {
    type: 'website',
    siteName: 'Danmu',
    title: 'Danmu · Decorate your room in 3D',
    description:
      'Pick a footprint, get a scaled 3D room, and redecorate it. Computed on your device. No account.',
  },
  // Stated rather than left to be inferred: without a `twitter` block Next emits
  // no `twitter:card`, and a reader with no card type gets the small square
  // thumbnail treatment — a 1200×630 card cropped to a postage stamp. This is
  // also what Slack and several others read in preference to the og tags.
  twitter: {
    card: 'summary_large_image',
    title: 'Danmu · Decorate your room in 3D',
    description:
      'Pick a footprint, get a scaled 3D room, and redecorate it. Computed on your device. No account.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Draw under the notch and the home indicator, and pad for them ourselves
  // (`env(safe-area-inset-*)` in globals.css). Without it iOS letterboxes the page
  // and the studio's toolbar floats a band above the bottom edge.
  viewportFit: 'cover',
  // Matches --paper-0, the actual page wash, so mobile browser chrome blends
  // with the app instead of introducing a fourth unrelated cream — once per
  // scheme, since night mode has its own wash. Next emits one
  // `<meta name="theme-color" media=…>` per entry, which follows the DEVICE; a
  // pinned Light or Dark re-points them (`applyThemeColor`, lib/appearance.ts).
  // Both values are the manifest's exports, and `tests/color-tokens.test.ts` holds
  // them to the two `--paper-0` declarations in globals.css.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: PAPER_0 },
    { media: '(prefers-color-scheme: dark)', color: PAPER_0_DARK },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning`: the boot script below writes `data-theme` onto this
    // element before React hydrates it, so the server's `<html>` and the client's
    // differ by exactly that attribute, on purpose. It silences this element only.
    <html lang="en" className={`${figtree.variable} ${GeistMono.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        {/* Night mode before first paint — see APPEARANCE_BOOT. Inline because it
            has to run before the stylesheet's first paint and before any bundle;
            allowed by the CSP's existing `'unsafe-inline'` (next.config.mjs). */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT }} />
      </head>
      <body>
        <Providers>
          {children}
          <ConfirmHost />
          <StorageToast />
          <ServiceWorkerRegistrar />
          <AppearanceSync />
        </Providers>
      </body>
    </html>
  );
}
