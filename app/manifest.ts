import type { MetadataRoute } from 'next';

// The web manifest, served at /manifest.webmanifest. Without one a service worker
// makes the app offline-capable but not installable — and "installable" is what
// makes an offline decoration studio worth having on a tablet you carry into the
// room you are decorating.
//
// The two colours are hex literals for the same reason `lib/scene-palette.ts`
// holds hex literals: a manifest is JSON read by the OS, so it cannot resolve
// `var(--paper-0)`. They are therefore deliberate duplicates of the tokens in
// app/globals.css, and `tests/color-tokens.test.ts` reads the stylesheet and
// fails if they drift — a literal asserted against a literal would not.
//
// `--paper-0`, not `--paper`: it is the page wash behind every surface, and it is
// already what `viewport.themeColor` in app/layout.tsx uses. A splash screen and
// the browser chrome disagreeing about which cream the app is would be worse than
// either choice on its own.
//
// An `--ink` constant lived here briefly with nothing in the manifest using it — a
// value that exists only for its own test, which is the thing `tests/helpers/`
// exists to keep out of shipped code. `PAPER_0_DARK` below is not that: the root
// layout's dark theme-color reads it.
export const PAPER_0 = '#F4EFE4';
/** Night mode's `--paper-0`. Not used by the manifest itself — `theme_color` takes
 *  one colour, no media query, and an installed app's splash is drawn before any
 *  page script could choose — but `viewport.themeColor` in app/layout.tsx gives the
 *  browser chrome one colour per scheme, and the pair is kept here together so the
 *  test that pins them to globals.css reads one file. */
export const PAPER_0_DARK = '#17150F';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Danmu · Decorate your room in 3D',
    short_name: 'Danmu',
    description:
      'Arrange, recolour, restyle and relight furniture in a scaled 3D room in your browser. No account. Your rooms stay on your device.',
    // `/` is the rooms page, and its empty state is the first-run screen: a fresh
    // install has no rooms, and that page says what to do with none.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: PAPER_0,
    theme_color: PAPER_0,
    // `any` keeps the studio usable when a tablet is turned — the 3D viewport and
    // the floor plan both want width, and locking to portrait would fight that.
    orientation: 'any',
    icons: [
      {
        // The existing app/icon.svg, which Next serves at /icon.svg. One SVG
        // rather than a PNG ladder: it is the only icon in the repo, and
        // inventing rasterised sizes we do not have files for would be a
        // manifest that lies about what it can render.
        src: '/icon.svg',
        type: 'image/svg+xml',
        sizes: 'any',
        purpose: 'any',
      },
    ],
  };
}
