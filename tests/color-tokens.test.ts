import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  contrastRatio,
  deltaEOk,
  fromOklch,
  over,
  parseHex,
  rotateHue,
  toOklch,
  relativeLuminance,
  type Rgb,
} from './helpers/color';
import { SCENE } from '@/lib/scene-palette';

// app/globals.css states a contrast ratio next to almost every colour it defines,
// and CLAUDE.md turns those into a rule: fills are fills, and only the -ink and
// -text variants clear 4.5:1 as type. Until now none of it was checked — a comment
// claiming a ratio is a comment, and the one place the app's accessibility
// promises live was the one place nothing could fail.
//
// These tests read the stylesheet and hold it to its own word.

const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

/** Every `--name: #hex` in the file. */
function hexTokens(): Map<string, Rgb> {
  const out = new Map<string, Rgb>();
  for (const m of CSS.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/g)) {
    const rgb = parseHex(m[2]);
    if (rgb) out.set(m[1], rgb);
  }
  return out;
}

/** …and every `--name: rgba(r, g, b, a)`, which is what a tint is. */
function tintTokens(): Map<string, { rgb: Rgb; alpha: number }> {
  const out = new Map<string, { rgb: Rgb; alpha: number }>();
  for (const m of CSS.matchAll(/--([a-z0-9-]+):\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/g)) {
    out.set(m[1], {
      rgb: { r: Number(m[2]), g: Number(m[3]), b: Number(m[4]) },
      alpha: Number(m[5]),
    });
  }
  return out;
}

const HEX = hexTokens();
const TINT = tintTokens();

/** Resolve a token name to what it actually looks like on screen — a tint is
 *  composited over the page, because that is the only way its text is ever seen. */
function surface(name: string): Rgb | null {
  const solid = HEX.get(name);
  if (solid) return solid;
  const tint = TINT.get(name);
  const paper = HEX.get('paper');
  if (tint && paper) return over(tint.rgb, tint.alpha, paper);
  return null;
}

describe('the stylesheet parses at all', () => {
  it('finds the tokens this suite is about', () => {
    // A guard on the guard: if the file's format changes and these regexes stop
    // matching, every test below would pass by finding nothing.
    expect(HEX.size).toBeGreaterThan(15);
    expect(TINT.size).toBeGreaterThan(3);
    for (const name of ['paper', 'ink', 'accent', 'accent-text', 'danger', 'warn-text', 'on-accent']) {
      expect(surface(name), name).not.toBeNull();
    }
  });
});

describe('globals.css keeps its own contrast promises', () => {
  // The comments are written as "5.54:1 on --paper" — a claim with both numbers
  // and both colours in it, which is exactly enough to check.
  const claims: Array<{ token: string; ratio: number; on: string }> = [];
  for (const line of CSS.split('\n')) {
    const decl = /--([a-z0-9-]+):/.exec(line);
    if (!decl) continue;
    for (const m of line.matchAll(/([\d.]+):1 (?:with|on) (--[a-z0-9-]+|white)/g)) {
      claims.push({ token: decl[1], ratio: Number(m[1]), on: m[2].replace(/^--/, '') });
    }
  }

  it('states enough claims to be worth checking', () => {
    expect(claims.length).toBeGreaterThan(5);
  });

  it.each(claims.map((c) => [`--${c.token} is ${c.ratio}:1 on ${c.on}`, c] as const))(
    '%s',
    (_label, claim) => {
      const fg = surface(claim.token);
      const bg = claim.on === 'white' ? { r: 255, g: 255, b: 255 } : surface(claim.on);
      expect(fg, claim.token).not.toBeNull();
      expect(bg, claim.on).not.toBeNull();
      const actual = contrastRatio(fg!, bg!);
      // The comment is a rounded figure, so it is held to a rounding, not to the
      // digit. What matters is that it is not off by a tenth in the direction
      // that would make a failing pair look like a passing one.
      expect(actual).toBeGreaterThanOrEqual(claim.ratio - 0.05);
      expect(actual).toBeLessThan(claim.ratio + 0.5);
    },
  );
});

describe('text tokens are usable as text', () => {
  // The rule CLAUDE.md states, enforced. Every -text / -ink token has to clear
  // 4.5:1 somewhere real; a fill does not, which is exactly why they are separate
  // tokens and why using one for the other is the mistake this prevents.
  const textish = [...HEX.keys()].filter((n) => n.endsWith('-text') || n.endsWith('-ink'));

  it('there are some', () => {
    expect(textish.length).toBeGreaterThan(3);
  });

  it.each(textish)('--%s clears 4.5:1 on a surface it is used on', (name) => {
    const fg = surface(name)!;
    const candidates = ['paper', 'paper-2', 'paper-3', 'on-accent'].map((n) => surface(n)).filter(Boolean) as Rgb[];
    // --*-ink tokens are button SURFACES carrying white type, so white counts as
    // one of their backgrounds.
    candidates.push({ r: 255, g: 255, b: 255 });
    const best = Math.max(...candidates.map((bg) => contrastRatio(fg, bg)));
    expect(best).toBeGreaterThanOrEqual(4.5);
  });

  it('white type on the accent button surface is legible', () => {
    // --on-accent is #FFFFFF and sits on --accent-ink. This is the pair the
    // primary call to action is made of, so it is worth its own line.
    expect(contrastRatio(surface('accent-ink')!, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(4.5);
  });

  it('the fills are NOT quietly usable as text, or the distinction is theatre', () => {
    // --accent is documented "NOT for text". If it ever cleared 4.5:1 on paper,
    // the separate --accent-text token would be pure ceremony and would drift.
    expect(contrastRatio(surface('accent')!, surface('paper')!)).toBeLessThan(4.5);
    expect(contrastRatio(surface('success')!, surface('paper')!)).toBeLessThan(4.5);
  });
});

describe('scene-palette really does match the CSS', () => {
  // The previous guard asserted SCENE.accent === '#E2613A' — a literal against a
  // literal, both inside the test's own reach. Changing the token in globals.css
  // and forgetting scene-palette left it green, which is the entire failure it was
  // written to catch. This reads the stylesheet.
  const pairs: Array<[keyof typeof SCENE, string]> = [
    ['accent', 'accent'],
    ['accentHover', 'accent-2'],
    ['invalid', 'danger'],
    ['locked', 'locked'],
  ];

  it.each(pairs)('SCENE.%s is --%s', (key, token) => {
    const css = surface(token)!;
    const scene = parseHex(SCENE[key])!;
    // Perceptual, not textual: what is being asserted is that nobody can see a
    // difference between the 3D layer and the panel that edits it.
    expect(deltaEOk(css, scene)).toBeLessThan(0.01);
  });
});

describe('OKLCH round trips', () => {
  it('survives a conversion to OKLCH and back', () => {
    for (const [name, rgb] of HEX) {
      const back = fromOklch(toOklch(rgb));
      expect(deltaEOk(rgb, back), name).toBeLessThan(1e-6);
    }
  });

  it('holds luminance across a hue rotation, which HSL does not', () => {
    // The property that makes OKLCH the right space for generating themes: rotate
    // the hue and the contrast the colour passed, it still passes.
    const accent = surface('accent')!;
    const paper = surface('paper')!;
    const base = contrastRatio(accent, paper);
    for (let deg = 30; deg < 360; deg += 30) {
      const spun = rotateHue(accent, deg);
      // In-gamut rotations only — a colour pushed outside sRGB clips, and a
      // clipped colour is a different colour.
      if (spun.r < -1 || spun.g < -1 || spun.b < -1 || spun.r > 256 || spun.g > 256 || spun.b > 256) continue;
      expect(Math.abs(contrastRatio(spun, paper) - base)).toBeLessThan(0.6);
    }
  });

  it('agrees with the known OKLab landmarks', () => {
    // White is L = 1 with no chroma; mid grey sits near 0.6.
    const white = toOklch({ r: 255, g: 255, b: 255 });
    expect(white.L).toBeCloseTo(1, 3);
    expect(white.c).toBeLessThan(1e-6);
    const black = toOklch({ r: 0, g: 0, b: 0 });
    expect(black.L).toBeCloseTo(0, 6);
  });

  it('computes the luminance WCAG defines, not an approximation of it', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 9);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 9);
    // The canonical worked example: #777777 on white is 4.48:1 — just under the
    // bar, which is why it is the one everybody quotes.
    expect(contrastRatio(parseHex('#777777')!, { r: 255, g: 255, b: 255 })).toBeCloseTo(4.48, 1);
  });
});
