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
import { MARK_COLORS } from '@/lib/brand-mark';
import { PAPER_0, PAPER_0_DARK } from '@/app/manifest';

// app/globals.css states a contrast ratio next to almost every colour it defines,
// and CLAUDE.md turns those into a rule: fills are fills, and only the -ink and
// -text variants clear 4.5:1 as type. Until now none of it was checked — a comment
// claiming a ratio is a comment, and the one place the app's accessibility
// promises live was the one place nothing could fail.
//
// These tests read the stylesheet and hold it to its own word — once per theme.

const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

// The capture screen, read as text. One assertion below is about its CALL SITES
// rather than about a colour, because the rule it enforces is a rule about how the
// chip helper is used and there are nine uses of it.
const CAPTURE = readFileSync(join(process.cwd(), 'app', 'onboarding', 'capture', 'page.tsx'), 'utf8');

// ── Reading the palettes ───────────────────────────────────────────────────────
//
// There are two palettes now, and the parser used to read the whole FILE: every
// `--name: #hex` anywhere, last one winning. With night mode in the same file that
// silently turns every light-theme assertion into a dark-theme one (the dark block
// comes later) and checks the light theme not at all. So each palette is read out
// of its own block, and the dark one is LAYERED over the light one exactly as the
// cascade does it: anything the dark block does not restate (the sky, the halos,
// the aliases) is inherited.

/** The CSS with every comment blanked to spaces, so brace-matching cannot be fooled
 *  by a `{` in prose while offsets stay aligned with the raw text. */
const BLANKED = CSS.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

/** The raw text (comments kept — the ratio claims live in them) between the braces
 *  of the first block whose selector is `open`, searched from `from`. */
function block(open: string, from = 0): { raw: string; bare: string } {
  const at = BLANKED.indexOf(open, from);
  if (at === -1) return { raw: '', bare: '' };
  const start = BLANKED.indexOf('{', at) + 1;
  let depth = 1;
  let i = start;
  for (; i < BLANKED.length && depth > 0; i++) {
    if (BLANKED[i] === '{') depth++;
    else if (BLANKED[i] === '}') depth--;
  }
  return { raw: CSS.slice(start, i - 1), bare: BLANKED.slice(start, i - 1) };
}

/** Every declaration in a block body, in order, whitespace-normalised. */
function declarations(bare: string): Array<[string, string]> {
  return bare
    .split(';')
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((d) => {
      const colon = d.indexOf(':');
      return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()] as [string, string];
    });
}

const LIGHT_BLOCK = block('\n:root {');
const DARK_BLOCK = block(':root[data-theme="dark"] {');
const MIRROR_BLOCK = block(
  ':root:not([data-theme="light"]) {',
  BLANKED.indexOf('@media (prefers-color-scheme: dark)'),
);

type Palette = {
  theme: 'light' | 'dark';
  /** The block this theme itself declares, comments and all. */
  own: string;
  hex: Map<string, Rgb>;
  tint: Map<string, { rgb: Rgb; alpha: number }>;
  /** `--on-ink: var(--paper)` — a role NAME for a colour that already exists, which
   *  is how a fill and a text token share one literal without drifting apart. */
  alias: Map<string, string>;
  /** A token as it looks on screen: a tint composited over THIS theme's paper, an
   *  alias followed (bounded, so a cycle is a null rather than a stack overflow). */
  surface: (name: string) => Rgb | null;
};

function palette(theme: Palette['theme'], own: string, ...layers: string[]): Palette {
  const hex = new Map<string, Rgb>();
  const tint = new Map<string, { rgb: Rgb; alpha: number }>();
  const alias = new Map<string, string>();
  for (const bare of layers) {
    for (const [prop, value] of declarations(bare)) {
      if (!prop.startsWith('--')) continue;
      const name = prop.slice(2);
      // A later layer replaces the token whatever KIND it was — a hex in light
      // restated as an alias in dark must stop being that hex.
      hex.delete(name);
      tint.delete(name);
      alias.delete(name);
      const h = /^#[0-9A-Fa-f]{3,8}$/.test(value) ? parseHex(value) : null;
      const t = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(value);
      const a = /^var\(\s*--([a-z0-9-]+)\s*\)$/.exec(value);
      if (h) hex.set(name, h);
      else if (t) tint.set(name, { rgb: { r: +t[1], g: +t[2], b: +t[3] }, alpha: +t[4] });
      else if (a) alias.set(name, a[1]);
    }
  }
  const surface = (name: string, depth = 0): Rgb | null => {
    const solid = hex.get(name);
    if (solid) return solid;
    const t = tint.get(name);
    const paper = hex.get('paper');
    if (t && paper) return over(t.rgb, t.alpha, paper);
    const to = alias.get(name);
    if (to && depth < 4) return surface(to, depth + 1);
    return null;
  };
  return { theme, own, hex, tint, alias, surface: (n) => surface(n) };
}

const LIGHT = palette('light', LIGHT_BLOCK.raw, LIGHT_BLOCK.bare);
const DARK = palette('dark', DARK_BLOCK.raw, LIGHT_BLOCK.bare, DARK_BLOCK.bare);
const THEMES = [
  ['light', LIGHT],
  ['dark', DARK],
] as const;

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

describe.each(THEMES)('the %s palette parses at all', (_t, P) => {
  it('finds the tokens this suite is about', () => {
    // A guard on the guard: if the file's format changes and these stop matching,
    // every test below would pass by finding nothing.
    expect(P.hex.size).toBeGreaterThan(15);
    expect(P.tint.size).toBeGreaterThan(3);
    for (const name of ['paper', 'ink', 'accent', 'accent-text', 'danger', 'warn-text', 'on-accent']) {
      expect(P.surface(name), name).not.toBeNull();
    }
  });
});

describe('the two palettes are read apart', () => {
  it('each theme sees its own paper, and the dark one inherits what it does not restate', () => {
    expect(LIGHT.hex.get('paper')).toEqual(parseHex('#FFFCF5'));
    expect(deltaEOk(LIGHT.surface('paper')!, DARK.surface('paper')!)).toBeGreaterThan(0.3);
    // The sky is the user's light, not the app's paper: not restated, so inherited.
    expect(DARK.hex.get('sky-noon')).toBeTruthy();
    expect(DARK.hex.get('sky-noon')).toEqual(LIGHT.hex.get('sky-noon'));
  });
});

describe("night mode's palette", () => {
  const dark = declarations(DARK_BLOCK.bare);
  const mirror = declarations(MIRROR_BLOCK.bare);
  const light = declarations(LIGHT_BLOCK.bare);

  it('is written twice, identically — the attribute block and the media-query mirror', () => {
    // CSS cannot OR `[data-theme="dark"]` with `prefers-color-scheme: dark`, so the
    // palette exists twice. A token fixed in one copy and not the other is a theme
    // that differs between "Dark" and "System on a dark device", which nobody
    // testing one of them would ever see.
    expect(dark.length).toBeGreaterThan(60);
    expect(mirror, 'the mirror is stale — run `node scripts/sync-dark-palette.mjs`').toEqual(dark);
  });

  it('tells the browser which scheme each palette is, for scrollbars and form controls', () => {
    expect(light).toContainEqual(['color-scheme', 'light']);
    expect(dark).toContainEqual(['color-scheme', 'dark']);
  });

  it('restates every colour the light theme declares, except the ones that are not the app', () => {
    // A light colour token the dark block forgets is a cream patch on a dark page —
    // invisible to every contrast test here, because they only measure what is
    // listed. The exceptions are the room's sky (the user's light) and the two
    // tokens built to stand on a PHOTOGRAPH, whose ground does not change.
    const FIXED = /^--(sky-|piece-halo-|scrim-photo$)/;
    const colourish = /#[0-9A-Fa-f]{3,8}\b|rgba?\(|gradient\(/;
    const lightColours = light.filter(([p, v]) => p.startsWith('--') && colourish.test(v) && !FIXED.test(p)).map(([p]) => p);
    const restated = new Set(dark.map(([p]) => p));
    expect(lightColours.length).toBeGreaterThan(60);
    expect(lightColours.filter((p) => !restated.has(p)), 'colour tokens with no night-mode value').toEqual([]);
    // …and the dark block invents nothing the light theme lacks, or a component
    // reading it is broken in light.
    const lightNames = new Set(light.map(([p]) => p));
    expect(dark.map(([p]) => p).filter((p) => !lightNames.has(p))).toEqual([]);
  });

  it('is a warm dark: not black, and the same warm hue as the light paper', () => {
    const paper0 = DARK.surface('paper-0')!;
    expect(relativeLuminance(paper0), '--paper-0 is pure black').toBeGreaterThan(0.005);
    for (const name of ['paper-0', 'paper', 'paper-2', 'paper-3']) {
      const c = toOklch(DARK.surface(name)!);
      expect(c.c, `--${name} has no warmth at all`).toBeGreaterThan(0.005);
      const hue = Math.abs(c.h - toOklch(LIGHT.surface('paper')!).h);
      expect(Math.min(hue, 360 - hue), `--${name} is not the light paper's hue`).toBeLessThan(25);
    }
  });

  it('raises a surface by LIGHTENING it, the way elevation reads in the dark', () => {
    const L = ['paper-0', 'paper', 'paper-2', 'paper-3'].map((n) => relativeLuminance(DARK.surface(n)!));
    for (let i = 1; i < L.length; i++) expect(L[i]).toBeGreaterThan(L[i - 1]);
  });
});

// ── Contrast, per theme ────────────────────────────────────────────────────────

describe.each(THEMES)('globals.css keeps its own contrast promises (%s)', (_t, P) => {
  // The comments are written as "5.54:1 on --paper" — a claim with both numbers
  // and both colours in it, which is exactly enough to check. Each theme's claims
  // are read from its OWN block and measured against its own palette.
  const claims: Array<{ token: string; ratio: number; on: string }> = [];
  for (const line of P.own.split('\n')) {
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
      const fg = P.surface(claim.token);
      const bg = claim.on === 'white' ? WHITE : P.surface(claim.on);
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

describe.each(THEMES)('text tokens are usable as text (%s)', (theme, P) => {
  // The rule CLAUDE.md states, enforced. Every -text / -ink token has to clear
  // 4.5:1 somewhere real; a fill does not, which is exactly why they are separate
  // tokens and why using one for the other is the mistake this prevents.
  // Two naming conventions live here and they mean opposite things: `X-ink` is a
  // filled SURFACE (--accent-ink, --ink) while `on-X` is TYPE that sits on X
  // (--on-accent, --on-ink, --on-ink-2). Only the first two suffixes were being
  // collected, so **no `on-*` token was ever checked by this test** — --on-accent
  // matches neither suffix, and --on-ink / --on-ink-2 are aliases and so are not in
  // the hex map at all. They are the tokens whose entire job is being legible.
  const named = new Set([...P.hex.keys(), ...P.alias.keys(), ...P.tint.keys()]);
  const textish = [...named].filter(
    (n) => n.endsWith('-text') || n.endsWith('-ink') || n.startsWith('on-'),
  );

  it('there are some', () => {
    expect(textish.length).toBeGreaterThan(3);
  });

  it.each(textish)('--%s clears 4.5:1 on a surface it is used on', (name) => {
    const fg = P.surface(name)!;
    // --ink belongs in this list and was missing: it is a real surface that real
    // type sits on (the primary button, and every chip on the capture screen), and
    // it is the whole reason the --on-ink family exists.
    const candidates = ['paper', 'paper-2', 'paper-3', 'on-accent', 'ink']
      .map((n) => P.surface(n))
      .filter(Boolean) as Rgb[];
    // In the light theme --*-ink tokens are button SURFACES carrying near-white
    // type, so white counts as one of their backgrounds. In the dark one nothing is
    // white — --on-accent is the dark paper — and offering white as a candidate
    // would let a token pass on a ground the theme never paints.
    if (theme === 'light') candidates.push(WHITE);
    const best = Math.max(...candidates.map((bg) => contrastRatio(fg, bg)));
    expect(best).toBeGreaterThanOrEqual(4.5);
  });

  // The harvester above checks what a comment chose to claim, and the loop above
  // asks only for SOME legible ground. Neither says the body-text tokens are legible
  // on every paper a panel can be, which is the promise a theme actually makes: any
  // type token on any surface. Small text, so the full 4.5:1, on all four.
  const TYPE = ['ink', 'ink-2', 'ink-3', 'accent-text', 'danger-text', 'warn-text', 'success-text', 'locked'];
  const PAPERS = ['paper-0', 'paper', 'paper-2', 'paper-3'];
  it.each(TYPE.flatMap((t) => PAPERS.map((p) => [t, p] as const)))('--%s is type on --%s', (fg, bg) => {
    const ratio = contrastRatio(P.surface(fg)!, P.surface(bg)!);
    expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  // The grounds a CONTROL stands on. --paper-3 is not one: it is itself a fill (a
  // hover, a kbd cap, a skeleton bar), and the light theme's --edge reads 2.92:1 on
  // it — measured here first, and left out on that basis rather than by oversight.
  it.each(PAPERS.slice(0, 3))('--edge bounds a control on --%s at 3:1 (WCAG 1.4.11)', (bg) => {
    // CLAUDE.md: anything interactive gets --edge as its boundary. It is a tint, so
    // it is measured composited over the ground it actually sits on.
    const ground = P.surface(bg)!;
    const e = P.tint.get('edge')!;
    expect(e, '--edge is not an rgba() tint').toBeTruthy();
    expect(contrastRatio(over(e.rgb, e.alpha, ground), ground)).toBeGreaterThanOrEqual(3);
  });

  it('the accent-button type is legible on the accent-button surface', () => {
    // --on-accent sits on --accent-ink: the pair the primary call to action is made
    // of. Near-white on moss in light, dark paper on lifted moss in dark.
    expect(contrastRatio(P.surface('accent-ink')!, P.surface('on-accent')!)).toBeGreaterThanOrEqual(4.5);
  });

  it('the fills are NOT quietly usable as text, or the distinction is theatre', () => {
    // --accent is documented "NOT for text". If it ever cleared 4.5:1 on paper,
    // the separate --accent-text token would be pure ceremony and would drift.
    expect(contrastRatio(P.surface('accent')!, P.surface('paper')!)).toBeLessThan(4.5);
    expect(contrastRatio(P.surface('success')!, P.surface('paper')!)).toBeLessThan(4.5);
  });
});

describe('scene-palette really does match the CSS', () => {
  // The previous guard asserted SCENE.accent === '#E2613A' — a literal against a
  // literal, both inside the test's own reach. Changing the token in globals.css
  // and forgetting scene-palette left it green, which is the entire failure it was
  // written to catch. This reads the stylesheet.
  //
  // Against the LIGHT palette only, and on purpose: the 3D room does not theme. Its
  // walls and furniture are the user's room under its own light.
  const pairs: Array<[keyof typeof SCENE, string]> = [
    ['accent', 'accent'],
    ['accentHover', 'accent-2'],
    ['invalid', 'danger'],
    ['glass', 'paper'],
    ['locked', 'locked'],
  ];

  it.each(pairs)('SCENE.%s is --%s', (key, token) => {
    const css = LIGHT.surface(token)!;
    const scene = parseHex(SCENE[key])!;
    // Perceptual, not textual: what is being asserted is that nobody can see a
    // difference between the 3D layer and the panel that edits it.
    expect(deltaEOk(css, scene)).toBeLessThan(0.01);
  });
});

describe('the layers that cannot read a custom property', () => {
  // After Three.js materials and the plan canvas there are two more, and neither
  // was checked. Same failure mode as scene-palette, so the same guard: read the
  // stylesheet.

  it('the web manifest paints its splash with --paper-0', () => {
    // A manifest is JSON parsed by the OS for the splash screen and the
    // task-switcher card, so `var(--paper-0)` is not available to it.
    const css = LIGHT.surface('paper-0');
    expect(css, '--paper-0 is not a hex token in globals.css').toBeTruthy();
    expect(deltaEOk(css!, parseHex(PAPER_0)!)).toBeLessThan(0.01);
  });

  it("night mode's browser chrome is night mode's --paper-0", () => {
    const css = DARK.surface('paper-0');
    expect(css, 'the dark block declares no --paper-0').toBeTruthy();
    expect(deltaEOk(css!, parseHex(PAPER_0_DARK)!)).toBeLessThan(0.01);
  });

  // The brand mark is rasterised into a favicon, an iOS icon and a share card,
  // none of which can resolve a custom property — so `lib/brand-mark.ts` names its
  // three colours as literals, the same bargain scene-palette and the manifest
  // make. This is the half of that bargain that keeps them honest. Light only: a
  // raster has one palette.
  it.each([
    ['tile', 'paper'],
    ['accent', 'accent'],
    ['piece', 'accent-2'],
  ] as Array<[keyof typeof MARK_COLORS, string]>)('MARK_COLORS.%s is --%s', (key, token) => {
    const css = LIGHT.surface(token);
    expect(css, `--${token} is not a hex token in globals.css`).toBeTruthy();
    expect(deltaEOk(css!, parseHex(MARK_COLORS[key])!)).toBeLessThan(0.01);
  });

  it('the manifest and the layout agree on what colour the app is, once per scheme', () => {
    // app/layout.tsx sets `viewport.themeColor` for the browser chrome and the
    // manifest sets `theme_color` for the installed shell. Two files, one answer —
    // and nothing stopped them diverging before this. With night mode the layout
    // names one colour per scheme, and both must be the manifest's own exports
    // rather than a second pair of literals.
    const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/media:\s*'\(prefers-color-scheme: light\)',\s*color:\s*PAPER_0\s*}/);
    expect(layout).toMatch(/media:\s*'\(prefers-color-scheme: dark\)',\s*color:\s*PAPER_0_DARK\s*}/);
    expect(layout).toMatch(/import\s*{\s*PAPER_0,\s*PAPER_0_DARK\s*}\s*from\s*'\.\/manifest'/);
    expect(layout, 'a hex literal crept back into themeColor').not.toMatch(/color:\s*'#/);
  });

  // app/global-error.tsx is the last resort boundary: it renders when the root
  // layout itself failed, so it cannot import a stylesheet or a palette module and
  // inlines its colours. Each one already names its token in a trailing comment —
  // and the file's own header records that three of them had drifted to an earlier
  // palette before being fixed by hand. So the comment is the assertion: every
  // `const NAME = '#hex'; // --token` in there is held to globals.css, which also
  // means a newly added one is covered the moment it is annotated. Light only, by
  // the same reasoning as the raster: it renders with no stylesheet to theme it.
  describe('app/global-error.tsx, which cannot import anything', () => {
    const SRC = readFileSync(join(process.cwd(), 'app', 'global-error.tsx'), 'utf8');
    const annotated = [...SRC.matchAll(/const\s+([A-Z_0-9]+)\s*=\s*'(#[0-9A-Fa-f]{6})';\s*\/\/\s*--([a-z0-9-]+)/g)].map(
      (m) => [m[1], m[2], m[3]] as const,
    );

    it('annotates its colours at all, so there is something to check', () => {
      // If this file stops naming its tokens, the guard below silently checks
      // nothing — the one way a test like this fails open.
      expect(annotated.length).toBeGreaterThanOrEqual(5);
    });

    it.each(annotated)('%s is --%s', (_name, hex, token) => {
      const css = LIGHT.surface(token);
      expect(css, `--${token} is not a hex token in globals.css`).toBeTruthy();
      expect(deltaEOk(css!, parseHex(hex)!)).toBeLessThan(0.01);
    });
  });
});

describe('OKLCH round trips', () => {
  it('survives a conversion to OKLCH and back', () => {
    for (const P of [LIGHT, DARK]) {
      for (const [name, rgb] of P.hex) {
        const back = fromOklch(toOklch(rgb));
        expect(deltaEOk(rgb, back), name).toBeLessThan(1e-6);
      }
    }
  });

  it('holds luminance across a hue rotation, which HSL does not', () => {
    // The property that makes OKLCH the right space for generating themes: rotate
    // the hue and the contrast the colour passed, it still passes.
    const accent = LIGHT.surface('accent')!;
    const paper = LIGHT.surface('paper')!;
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
    const white = toOklch(WHITE);
    expect(white.L).toBeCloseTo(1, 3);
    expect(white.c).toBeLessThan(1e-6);
    const black = toOklch({ r: 0, g: 0, b: 0 });
    expect(black.L).toBeCloseTo(0, 6);
  });

  it('computes the luminance WCAG defines, not an approximation of it', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 9);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 9);
    // The canonical worked example: #777777 on white is 4.48:1 — just under the
    // bar, which is why it is the one everybody quotes.
    expect(contrastRatio(parseHex('#777777')!, WHITE)).toBeCloseTo(4.48, 1);
  });
});

describe.each(THEMES)('the live-measure tags carry legible text (%s)', (_t, P) => {
  // components/three/DragTag.tsx draws a DOM overlay over the canvas while a piece
  // is being dragged: the piece's own size tag. (It drew a gap label on each wall
  // guide too, until those lines went.) It is 11px bold — normal-size text under WCAG, so 4.5:1, not
  // the 3:1 that large text gets.
  //
  // The gap label used to paint `--on-accent` (#FFFFFF) on `SCENE.accentHover`, the
  // sage `--accent-2`. That is 3.89:1. It passed every gate here because nothing in
  // this file knew the pair existed: the harvester reads ratio claims out of
  // globals.css, and this pairing is made in a component, between a CSS token and a
  // `lib/scene-palette.ts` constant.
  const onAccent = P.surface('on-accent')!;
  const ink = P.surface('ink')!;
  const paper0 = P.surface('paper-0')!;

  it('has both halves of each pair to check', () => {
    for (const [name, c] of [['on-accent', onAccent], ['ink', ink], ['paper-0', paper0]] as const) {
      expect(c, name).toBeTruthy();
    }
  });

  it('reads as --ink on --paper-0 while the placement is legal', () => {
    expect(contrastRatio(ink, paper0)).toBeGreaterThanOrEqual(4.5);
  });

  it('reads as --on-accent on the refusal fill, --danger', () => {
    // The fill used to be `SCENE.invalid` — the LIGHT red, fixed, because the scene
    // palette does not theme — under `--on-accent`, which does. In night mode that
    // put dark paper on the light theme's red at ~3:1. The tag is DOM chrome, so it
    // takes the token and inverts with everything else.
    expect(contrastRatio(onAccent, P.surface('danger')!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the sage tripwire', () => {
  it('could not have read as --on-accent on the sage fill, which is why it does not', () => {
    // The tripwire, and it is pointed the other way on purpose. If someone darkens
    // `--accent-2` far enough for white to clear 4.5:1 on it, this goes red and
    // sends them here — at which point painting the tag on the accent again is a
    // choice made in the open rather than a regression nothing can see. Light only:
    // dark type on amber is legible, so in night mode it is not a trap to guard.
    expect(contrastRatio(LIGHT.surface('on-accent')!, parseHex(SCENE.accentHover)!)).toBeLessThan(4.5);
  });
});

describe('the live-measure tags are checked in the COMPONENT, not only in the tokens', () => {
  // Everything above compares tokens to tokens. All of it passes with
  // DragTag.tsx (then MeasureGuides.tsx) reverted to the exact pairing it was written to retire —
  // `color: 'var(--on-accent)'` over `background: color`, white on the sage accent
  // at 3.89:1 — because none of it reads the component. Worse, the sage tripwire up
  // there asserts that pairing is under 4.5:1, which was TRUE while the bug shipped:
  // its green state was the buggy state.
  //
  // A regex over source, deliberately and named as such: the assertion is about how
  // two values are PAIRED inside one style object, which no import can expose.
  const SRC = readFileSync(join(process.cwd(), 'components', 'three', 'DragTag.tsx'), 'utf8');

  it('never paints --on-accent unconditionally', () => {
    // The fixed form is `color: live.valid ? 'var(--ink)' : 'var(--on-accent)'`, so
    // white is reachable only on the refusal fill. An unconditional one is the bug.
    expect(SRC).not.toMatch(/color:\s*'var\(--on-accent\)'/);
  });

  it('never uses the guide colour as a text background', () => {
    // `color` here is the accent/sage the guide line is drawn in. `background: color`
    // put 10px bold white on it.
    expect(SRC).not.toMatch(/background:\s*color,/);
  });

  it('and still paints white somewhere, so the assertions above are not vacuous', () => {
    expect(SRC).toContain('var(--on-accent)');
  });

  it('puts the refusal on the themed --danger, not the fixed scene red', () => {
    // The pair the token test above measures is only the pair on screen if the
    // component paints it. `SCENE.invalid` as a background is the night-mode bug.
    expect(SRC).toMatch(/background:\s*valid\s*\?\s*'var\(--paper-0\)'\s*:\s*'var\(--danger\)'/);
    expect(SRC).not.toMatch(/background:[^,\n]*SCENE\.invalid/);
  });
});

/** The worst photograph for a pair of chrome colours, in closed form.
 *
 *  Not a sweep. This started as 256 greys with a comment claiming that covered
 *  every photograph that can exist — WCAG contrast being a function of relative
 *  luminance alone, so a grey of luminance L standing in for every colour of that
 *  luminance. The first half of that is true and the conclusion does not follow:
 *  256 greys visit 256 points on the luminance axis, and 8-bit RGB reaches
 *  millions — (255, 0, 0) has luminance 0.2126, which is no grey's. The sample
 *  missed the true worst case by 0.06% (3.1090 against 3.1071), harmless today and
 *  not harmless against a 3.57% margin over the 3:1 bar: a later nudge could put
 *  the real worst under 3 while the sampled one still read over it. A check that
 *  cannot see the case it is about is the recurring defect in this repo.
 *
 *  So it is solved instead. With offset luminances a and b (the WCAG +0.05), the
 *  darker protection scores p/a against a photo of offset luminance p and the
 *  lighter scores b/p; the better of the two is worst where they cross, at
 *  p = sqrt(a*b), giving sqrt(b/a). Exact, one line, and the completeness claim
 *  disappears rather than needing to be defended. Checked against a 200,000-step
 *  sweep on two different grounds: agrees to four decimals on both. */
function worstOverAllPhotos(a: Rgb, b: Rgb): { ratio: number; luminance: number } {
  const la = relativeLuminance(a) + 0.05;
  const lb = relativeLuminance(b) + 0.05;
  const lo = Math.min(la, lb);
  const hi = Math.max(la, lb);
  return { ratio: Math.sqrt(hi / lo), luminance: Math.sqrt(lo * hi) - 0.05 };
}

describe.each(THEMES)('chrome that stands on a photograph, not on the page (%s)', (_t, P) => {
  // Every other contrast promise in this file is a promise about two colours the
  // stylesheet owns. The capture screen's chips are not: they sit on a photograph
  // of the user's living room, so the background is unknown and unknowable, and
  // the honest question is not "what is the ratio" but "is there a tone that
  // defeats us".
  //
  // Two protections, and neither covers the range alone. The chip's ground is a
  // solid --ink, which reads clearly against a bright photo and vanishes against a
  // dark one. The boundary --edge-on-ink is the opposite tone, which does the
  // opposite. The chip is legible where the BETTER of the two clears WCAG 1.4.11's
  // 3:1. In night mode --ink is cream and the boundary near-black — the pair swaps
  // ends, and the photograph has to be survived all over again.
  const ink = P.surface('ink')!;
  const paper = P.surface('paper')!;
  const edgeTint = P.tint.get('edge-on-ink');

  it('--edge-on-ink is declared as a tint this suite can actually resolve', () => {
    // If the token is renamed, deleted, or restated as a hex, every assertion
    // below would otherwise skip its own subject and stay green.
    expect(edgeTint, '--edge-on-ink is not an rgba() token in globals.css').toBeTruthy();
    expect(edgeTint!.alpha).toBeGreaterThan(0);
    expect(edgeTint!.alpha).toBeLessThanOrEqual(1);
  });

  it('the chip and its boundary together survive every possible photo', () => {
    // This one assertion is also what stops a later tidy-up deleting the border as
    // decoration: drop it and the worst case falls to 1.00:1. There is deliberately
    // no companion assertion that each protection is individually insufficient,
    // because that cannot fail — for ANY single colour there is a photo at its own
    // luminance where contrast is 1.00:1, so `worst(one colour) < 3` is a tautology.
    // The non-tautological version of it — that at each protection's worst tone the
    // other one clears 3:1 — is already implied by this one.
    const edge = over(edgeTint!.rgb, edgeTint!.alpha, ink);
    const { ratio, luminance } = worstOverAllPhotos(ink, edge);
    expect(
      ratio,
      `worst photo is luminance ${luminance.toFixed(5)}, where the best of chip and boundary is only ${ratio.toFixed(4)}:1`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('and no chip may swap that ground out from under the guarantee', () => {
    // The guarantee above is about ONE ground. Three chips used to override it —
    // the clash warning to --warn and the two quality flags to --warn and
    // --success-text — which put them outside the assertion entirely, and they
    // failed it: 1.93:1 and 2.03:1 against their own worst photo tone, on the
    // chips whose whole job is to be noticed. Worse, it is not reachable by a
    // heavier boundary; a mid-dark ground and a light edge sit too close together
    // in luminance, and even a solid --paper edge on --warn tops out at 2.19:1.
    //
    // Both of those grounds are still asserted below, so this is not merely a
    // style rule: it is the reason the rule exists.
    for (const name of ['warn', 'success-text']) {
      const bad = P.surface(name)!;
      expect(bad, `--${name} is not a colour token any more`).toBeTruthy();
      const edge = over(edgeTint!.rgb, edgeTint!.alpha, bad);
      expect(
        worstOverAllPhotos(bad, edge).ratio,
        `--${name} would be a legal chip ground after all — re-read this test`,
      ).toBeLessThan(3);
    }
  });

  it('the signal colours are legible on the ground that replaced those chips', () => {
    // The colour moved from the ground to the type, so these two now carry the whole
    // signal and owe the full 4.5:1 at 11px. --warn itself is 3.49:1 on --ink and
    // --warn-text is darker still, which is why neither could simply be reused.
    for (const name of ['on-ink-warn', 'on-ink-success']) {
      const fg = P.surface(name)!;
      expect(fg, `--${name} is not a colour token in globals.css`).toBeTruthy();
      expect(contrastRatio(fg, ink), `--${name} on --ink`).toBeGreaterThanOrEqual(4.5);
    }
    // …and they must still read as a WARNING and a SUCCESS rather than as two
    // arbitrary pastels: same hue family as the tokens they stand in for. OKLCH hue
    // is the only axis that claim is about, so lightness and chroma are free.
    expect(Math.abs(toOklch(P.surface('on-ink-warn')!).h - toOklch(P.surface('warn')!).h)).toBeLessThan(8);
    expect(
      Math.abs(toOklch(P.surface('on-ink-success')!).h - toOklch(P.surface('success-text')!).h),
    ).toBeLessThan(8);
  });

  it('--on-ink-2 is quiet but still type, on the ground it names', () => {
    const quiet = P.surface('on-ink-2')!;
    expect(quiet, '--on-ink-2 does not resolve to a colour').toBeTruthy();
    // It is used at 10.5px, so it is small text and owes the full 4.5:1.
    expect(contrastRatio(quiet, ink)).toBeGreaterThanOrEqual(4.5);
    // …and it has to be visibly quieter than --on-ink, or the tier is theatre.
    expect(contrastRatio(quiet, ink)).toBeLessThan(contrastRatio(paper, ink) - 2);
    // It is an alias of --ink-4 so that one edit moves both. Asserted, because the
    // whole point of the alias is that they cannot drift.
    expect(P.alias.get('on-ink-2'), '--on-ink-2 should alias --ink-4').toBe('ink-4');
  });
});

describe('the capture screen keeps its chips on the guaranteed ground', () => {
  it('nothing spreads photoChrome() and then sets a background', () => {
    // The mechanical half of the rule above: read from the source because the rule
    // is about call sites, and there are nine of them.
    const SPREAD = '...photoChrome(';
    let at = CAPTURE.indexOf(SPREAD);
    let seen = 0;
    while (at !== -1) {
      // The style object ends at the first `}}` after the spread.
      const close = CAPTURE.indexOf('}}', at);
      const objectBody = CAPTURE.slice(at, close === -1 ? at + 300 : close);
      expect(
        objectBody,
        'a photoChrome() call site overrides `background`, which escapes the silhouette guarantee above',
      ).not.toContain('background:');
      seen += 1;
      at = CAPTURE.indexOf(SPREAD, at + SPREAD.length);
    }
    // Without this the loop passes over an empty file, which is the shape of
    // "iterates over whatever it found" that green-by-vacancy comes from.
    expect(seen, 'no photoChrome() spread found — has the helper been renamed?').toBeGreaterThanOrEqual(3);
  });
});
