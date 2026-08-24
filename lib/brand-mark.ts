// The Danmu mark, once.
//
// The mark is the room the studio builds: a soft isometric dollhouse volume with
// one piece of furniture standing in it. It is drawn in four places that cannot
// share a rendering path —
//
//   · `DanmuMark` (components/ui/primitives.tsx), React + CSS custom properties,
//   · `app/icon.svg`, a static file because that is Next's favicon convention,
//   · `app/apple-icon.tsx`, rasterised at build time for an iOS home screen,
//   · `app/opengraph-image.tsx`, rasterised at build time for a shared link,
//
// — and by the time the third and fourth were wanted, the first two had already
// drifted: 1.7 vs 1.8 stroke, 0.14 vs 0.16 fill, and the outline split across two
// `<path>` elements in one and combined in the other. Nobody noticed, because
// nobody ever sees a 16px favicon and a 1200px share card side by side.
//
// So the GEOMETRY lives here and the COLOUR does not. That split is the same one
// `lib/scene-palette.ts` makes and for the same reason: a consumer that can read
// `var(--accent)` should, and one that cannot needs a literal — but neither has
// any business inventing its own path data. `tests/brand-mark.test.ts` holds
// `app/icon.svg` to these values, since a static file is the one consumer that
// cannot import them.
//
// Why the mark differs in colour between consumers, deliberately:
//   · on screen it strokes with `currentColor`, so it inherits the text colour of
//     whatever bar it sits in and stays legible in either theme;
//   · as an icon it strokes with the accent, because a favicon has no inherited
//     colour to take (an SVG icon's `currentColor` resolves to plain black) and
//     because at 16px on unknown browser chrome the terracotta is what reads.

/** Everything is authored in a 32×32 box, the size the favicon is smallest at. */
export const MARK_VIEWBOX = '0 0 32 32';
export const MARK_SIZE = 32;

/** The volume itself, filled at low opacity so the mark has a body and not just
 *  an outline. */
export const MARK_SOLID = 'M6 21.5 16 26l10-4.5V11L16 6.5 6 11z';

/** One path, not two: the silhouette, the two ridges that make it read as a
 *  corner rather than a flat hexagon, and the vertical they meet on. Splitting it
 *  is how the favicon's copy came to carry a different stroke width from the
 *  header's. */
export const MARK_LINES = 'M6 21.5V11l10-4.5L26 11v10.5L16 26zM6 11l10 4.5L26 11M16 15.5V26';

/** The one piece of furniture. A rect rather than a path so it stays obviously a
 *  block at 16px, where anything with a profile turns to mush. */
export const MARK_PIECE = { x: 12.6, y: 17.9, width: 6.8, height: 4.2, rx: 1.6 } as const;

export const MARK_STROKE_WIDTH = 1.8;
export const MARK_FILL_OPACITY = 0.16;

/** Corner radius of the rounded tile the mark sits on when it needs its own
 *  background — a favicon and an iOS icon both do, a mark inside the app's own
 *  bar does not. Authored for the 32-unit box and scaled with it. */
export const MARK_TILE_RADIUS = 9;

/** Colours a rasteriser or a static file has to be told, because it cannot read
 *  `app/globals.css`. Deliberate duplicates of `--paper`, `--accent` and
 *  `--accent-2`; `tests/color-tokens.test.ts` reads the stylesheet and fails if
 *  they drift, the same guard `lib/scene-palette.ts` and `app/manifest.ts` are
 *  under. */
export const MARK_COLORS = {
  /** `--paper` — the tile the mark sits on. */
  tile: '#FBF8F2',
  /** `--accent` — the volume's fill and, for an icon, its stroke. */
  accent: '#E2613A',
  /** `--accent-2` — the piece of furniture. */
  piece: '#5E8B6E',
} as const;

/** The mark as a standalone SVG document.
 *
 *  For the two build-time rasterisers, which need something they can hand to an
 *  `<img>`: Satori draws `<img src="data:image/svg+xml,…">` through resvg, which
 *  is a complete SVG renderer, where its own support for inline `<svg>` children
 *  covers a subset. One code path for both, and the same path data the app draws.
 *
 *  `tile: false` gives a transparent background, for a mark that already has a
 *  surface under it. */
export function markSvg({
  size = MARK_SIZE,
  tile = true,
  stroke = MARK_COLORS.accent,
}: { size?: number; tile?: boolean; stroke?: string } = {}): string {
  const { x, y, width, height, rx } = MARK_PIECE;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MARK_VIEWBOX}">`,
    tile
      ? `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${MARK_TILE_RADIUS}" fill="${MARK_COLORS.tile}"/>`
      : '',
    `<path d="${MARK_SOLID}" fill="${MARK_COLORS.accent}" opacity="${MARK_FILL_OPACITY}"/>`,
    `<path d="${MARK_LINES}" fill="none" stroke="${stroke}" stroke-width="${MARK_STROKE_WIDTH}"`,
    ` stroke-linecap="round" stroke-linejoin="round"/>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${MARK_COLORS.piece}"/>`,
    `</svg>`,
  ].join('');
}

/** `markSvg` as a data URI.
 *
 *  `encodeURIComponent`, not base64: it keeps the payload readable in a built
 *  file and it is shorter for markup, which is mostly ASCII. The `#` in every
 *  colour is the one character that MUST be escaped — unescaped it starts a
 *  fragment and the document silently truncates at the first fill. */
export function markDataUri(opts?: Parameters<typeof markSvg>[0]): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(opts))}`;
}
