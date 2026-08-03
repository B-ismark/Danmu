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
// One export, not two: an `--ink` constant lived here briefly with nothing in the
// manifest using it — a value that exists only for its own test, which is the thing
// `tests/helpers/` exists to keep out of shipped code.
export const PAPER_0 = '#EFE9DD';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Danmu — Decorate your room in real 3D',
    short_name: 'Danmu',
    description:
      'A warm, local-first interior decoration studio. Arrange, recolour, restyle and relight furniture in a scaled 3D room — right in your browser. No account, nothing leaves your device.',
    // `/` and not `/workspace`: a fresh install has no rooms, and the landing
    // page is the only screen that reads correctly with none.
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
