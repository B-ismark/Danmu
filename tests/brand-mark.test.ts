import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MARK_COLORS,
  MARK_FILL_OPACITY,
  MARK_LINES,
  MARK_PIECE,
  MARK_SOLID,
  MARK_STROKE_WIDTH,
  MARK_TILE_RADIUS,
  MARK_VIEWBOX,
  markDataUri,
  markSvg,
} from '@/lib/brand-mark';

// `app/icon.svg` is the one consumer of the mark that cannot import it: Next's
// favicon convention is a static file, and a static file cannot import
// TypeScript. So it is a hand-kept copy, and this is what makes a copy safe.
//
// It is not a hypothetical. Before `lib/brand-mark.ts` existed the mark was
// written out twice — here and in `DanmuMark` — and the two had drifted a 1.7 vs
// 1.8 stroke width and a 0.14 vs 0.16 fill opacity apart, with the outline split
// across two `<path>` elements in one and combined in the other. Nobody saw it,
// because nobody ever looks at a 16px favicon beside a 1200px share card.

// Comments stripped: the file's own header explains WHY it may not use
// `currentColor`, so a naive substring search over the whole text finds the word
// in the prose forbidding it. Every assertion below is about markup.
const ICON = readFileSync(join(process.cwd(), 'app', 'icon.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/** The value of one attribute on the first element in `icon.svg` that has it. */
function attr(name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(ICON)?.[1];
}

/** Every `d="…"` in icon.svg, in document order. */
function paths(): string[] {
  return [...ICON.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}

describe('app/icon.svg is the mark, not a drawing of it', () => {
  it('draws exactly the two authored paths, in order', () => {
    // Two, not three: the outline and its interior ridges are ONE path in
    // `MARK_LINES` precisely so the two cannot carry different stroke widths,
    // which is how they drifted last time.
    expect(paths()).toEqual([MARK_SOLID, MARK_LINES]);
  });

  it('uses the authored viewBox', () => {
    expect(attr('viewBox')).toBe(MARK_VIEWBOX);
  });

  it('uses the authored stroke width, fill opacity and tile radius', () => {
    expect(attr('stroke-width')).toBe(String(MARK_STROKE_WIDTH));
    expect(attr('opacity')).toBe(String(MARK_FILL_OPACITY));
    expect(attr('rx')).toBe(String(MARK_TILE_RADIUS));
  });

  it('places the piece of furniture where the module says', () => {
    const rect = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"/.exec(ICON);
    expect(rect, 'no furniture rect in icon.svg').toBeTruthy();
    const [, x, y, width, height, rx] = rect!;
    expect({
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
      rx: Number(rx),
    }).toEqual(MARK_PIECE);
  });

  it('carries only the three brand colours', () => {
    // Colour is the consumer's, not the module's — but an icon may only reach for
    // one of the three the module publishes. A fourth hex here is a mark painted
    // in something that is not in the palette.
    const hexes = new Set([...ICON.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase()));
    const allowed = new Set(Object.values(MARK_COLORS).map((c) => c.toUpperCase()));
    expect([...hexes].filter((h) => !allowed.has(h))).toEqual([]);
  });

  it('strokes in the accent, since a favicon has no inherited colour to take', () => {
    // `currentColor` in a favicon resolves to plain black. The on-screen mark
    // deliberately DOES use currentColor; this one deliberately cannot.
    expect(attr('stroke')).toBe(MARK_COLORS.accent);
    expect(ICON).not.toContain('currentColor');
  });
});

describe('markSvg', () => {
  it('is a standalone document, so an <img> can render it', () => {
    const svg = markSvg();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    // `fill="none"` on the stroked path, or resvg floods the silhouette black.
    expect(svg).toContain('fill="none"');
  });

  it('scales the box without touching the geometry', () => {
    const svg = markSvg({ size: 132 });
    expect(svg).toContain('width="132"');
    expect(svg).toContain('height="132"');
    // The viewBox is what makes the paths size-independent; if this ever changed
    // with `size`, every consumer would need its own copy of the coordinates.
    expect(svg).toContain(`viewBox="${MARK_VIEWBOX}"`);
    expect(svg).toContain(MARK_SOLID);
  });

  it('drops the tile on request, for a surface that already has one', () => {
    expect(markSvg({ tile: true })).toContain(`rx="${MARK_TILE_RADIUS}"`);
    // The furniture rect has its own rx, so absence of the TILE is what to assert.
    expect(markSvg({ tile: false })).not.toContain(`fill="${MARK_COLORS.tile}"`);
  });

  it('takes a stroke colour, since that is the one thing consumers disagree on', () => {
    expect(markSvg({ stroke: '#123456' })).toContain('stroke="#123456"');
  });
});

describe('markDataUri', () => {
  it('escapes the hash in every colour', () => {
    // The one character that MUST be escaped: unescaped, `#` starts a fragment and
    // the SVG silently truncates at the first fill — a share card with an empty
    // box where the logo goes, and nothing anywhere reporting an error.
    const uri = markDataUri();
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(uri).not.toContain('#');
    expect(uri).toContain('%23');
  });

  it('round-trips back to exactly what markSvg produced', () => {
    const opts = { size: 64, tile: false } as const;
    expect(decodeURIComponent(markDataUri(opts).slice('data:image/svg+xml,'.length))).toBe(markSvg(opts));
  });
});
