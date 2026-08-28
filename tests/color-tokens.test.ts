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
import { PAPER_0 } from '@/app/manifest';

// app/globals.css states a contrast ratio next to almost every colour it defines,
// and CLAUDE.md turns those into a rule: fills are fills, and only the -ink and
// -text variants clear 4.5:1 as type. Until now none of it was checked — a comment
// claiming a ratio is a comment, and the one place the app's accessibility
// promises live was the one place nothing could fail.
//
// These tests read the stylesheet and hold it to its own word.

const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

// The capture screen, read as text. One assertion below is about its CALL SITES
// rather than about a colour, because the rule it enforces is a rule about how the
// chip helper is used and there are nine uses of it.
const CAPTURE = readFileSync(join(process.cwd(), 'app', 'onboarding', 'capture', 'page.tsx'), 'utf8');

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
const ALIAS = aliasTokens();

/** Every `--name: var(--other)` in the file. A token can be a role NAME for a
 *  colour that already exists — `--on-ink` is `var(--paper)`, `--on-ink-2` is
 *  `var(--ink-4)` — which is how a fill and a text token share one literal without
 *  the two drifting apart. Unresolved, every such token read as null and quietly
 *  skipped whatever was asserted about it. */
function aliasTokens(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of CSS.matchAll(/--([a-z0-9-]+):\s*var\(\s*--([a-z0-9-]+)\s*\)/g)) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** Resolve a token name to what it actually looks like on screen — a tint is
 *  composited over the page, because that is the only way its text is ever seen,
 *  and an alias is followed to what it points at. */
function surface(name: string, depth = 0): Rgb | null {
  const solid = HEX.get(name);
  if (solid) return solid;
  const tint = TINT.get(name);
  const paper = HEX.get('paper');
  if (tint && paper) return over(tint.rgb, tint.alpha, paper);
  // One hop at a time, bounded, so a token that ends up pointing at itself is a
  // null rather than a stack overflow in a test suite.
  const alias = ALIAS.get(name);
  if (alias && depth < 4) return surface(alias, depth + 1);
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
  // Two naming conventions live here and they mean opposite things: `X-ink` is a
  // filled SURFACE (--accent-ink, --ink) while `on-X` is TYPE that sits on X
  // (--on-accent, --on-ink, --on-ink-2). Only the first two suffixes were being
  // collected, so **no `on-*` token was ever checked by this test** — --on-accent
  // matches neither suffix, and --on-ink / --on-ink-2 are aliases and so are not in
  // HEX at all. They are the tokens whose entire job is being legible.
  const named = new Set([...HEX.keys(), ...ALIAS.keys()]);
  const textish = [...named].filter(
    (n) => n.endsWith('-text') || n.endsWith('-ink') || n.startsWith('on-'),
  );

  it('there are some', () => {
    expect(textish.length).toBeGreaterThan(3);
  });

  it.each(textish)('--%s clears 4.5:1 on a surface it is used on', (name) => {
    const fg = surface(name)!;
    // --ink belongs in this list and was missing: it is a real surface that real
    // type sits on (the primary button, and every chip on the capture screen), and
    // it is the whole reason the --on-ink family exists.
    const candidates = ['paper', 'paper-2', 'paper-3', 'on-accent', 'ink']
      .map((n) => surface(n))
      .filter(Boolean) as Rgb[];
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
    // Both studio tabs draw the same alignment guide — the plan from the CSS
    // token, the 3D scene from here — so the two greens have to be one green.
    ['snapEdge', 'snap-edge'],
    ['snapCenter', 'snap-center'],
  ];

  it.each(pairs)('SCENE.%s is --%s', (key, token) => {
    const css = surface(token)!;
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
    const css = surface('paper-0');
    expect(css, '--paper-0 is not a hex token in globals.css').toBeTruthy();
    expect(deltaEOk(css!, parseHex(PAPER_0)!)).toBeLessThan(0.01);
  });

  // The brand mark is rasterised into a favicon, an iOS icon and a share card,
  // none of which can resolve a custom property — so `lib/brand-mark.ts` names its
  // three colours as literals, the same bargain scene-palette and the manifest
  // make. This is the half of that bargain that keeps them honest.
  it.each([
    ['tile', 'paper'],
    ['accent', 'accent'],
    ['piece', 'accent-2'],
  ] as Array<[keyof typeof MARK_COLORS, string]>)('MARK_COLORS.%s is --%s', (key, token) => {
    const css = surface(token);
    expect(css, `--${token} is not a hex token in globals.css`).toBeTruthy();
    expect(deltaEOk(css!, parseHex(MARK_COLORS[key])!)).toBeLessThan(0.01);
  });

  it('the manifest and the layout agree on what colour the app is', () => {
    // app/layout.tsx sets `viewport.themeColor` for the browser chrome and the
    // manifest sets `theme_color` for the installed shell. Two files, one answer —
    // and nothing stopped them diverging before this.
    const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');
    const declared = layout.match(/themeColor:\s*'(#[0-9A-Fa-f]{6})'/)?.[1];
    expect(declared, 'viewport.themeColor is no longer a plain hex in app/layout.tsx').toBeTruthy();
    expect(deltaEOk(parseHex(declared!)!, parseHex(PAPER_0)!)).toBeLessThan(0.01);
  });

  // app/global-error.tsx is the last resort boundary: it renders when the root
  // layout itself failed, so it cannot import a stylesheet or a palette module and
  // inlines its colours. Each one already names its token in a trailing comment —
  // and the file's own header records that three of them had drifted to an earlier
  // palette before being fixed by hand. So the comment is the assertion: every
  // `const NAME = '#hex'; // --token` in there is held to globals.css, which also
  // means a newly added one is covered the moment it is annotated.
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
      const css = surface(token);
      expect(css, `--${token} is not a hex token in globals.css`).toBeTruthy();
      expect(deltaEOk(css!, parseHex(hex)!)).toBeLessThan(0.01);
    });
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

describe('the live-measure tags carry legible text', () => {
  // components/three/MeasureGuides.tsx draws two DOM overlays over the canvas while
  // a piece is being dragged: a gap label on each guide line and the piece's own
  // size tag. Both are 10–11px bold — normal-size text under WCAG, so 4.5:1, not
  // the 3:1 that large text gets.
  //
  // The gap label used to paint `--on-accent` (#FFFFFF) on `SCENE.accentHover`, the
  // sage `--accent-2`. That is 3.89:1. It passed every gate here because nothing in
  // this file knew the pair existed: the harvester reads ratio claims out of
  // globals.css, and this pairing is made in a component, between a CSS token and a
  // `lib/scene-palette.ts` constant.
  const onAccent = surface('on-accent')!;
  const ink = surface('ink')!;
  const paper0 = surface('paper-0')!;

  it('has both halves of each pair to check', () => {
    for (const [name, c] of [['on-accent', onAccent], ['ink', ink], ['paper-0', paper0]] as const) {
      expect(c, name).toBeTruthy();
    }
  });

  it('reads as --ink on --paper-0 while the placement is legal', () => {
    expect(contrastRatio(ink, paper0)).toBeGreaterThanOrEqual(4.5);
  });

  it('reads as --on-accent on the refusal fill', () => {
    expect(contrastRatio(onAccent, parseHex(SCENE.invalid)!)).toBeGreaterThanOrEqual(4.5);
  });

  it('could not have read as --on-accent on the sage fill, which is why it does not', () => {
    // The tripwire, and it is pointed the other way on purpose. If someone darkens
    // `--accent-2` far enough for white to clear 4.5:1 on it, this goes red and
    // sends them here — at which point painting the tag on the accent again is a
    // choice made in the open rather than a regression nothing can see.
    expect(contrastRatio(onAccent, parseHex(SCENE.accentHover)!)).toBeLessThan(4.5);
  });
});

describe('the live-measure tags are checked in the COMPONENT, not only in the tokens', () => {
  // Everything above compares tokens to tokens. All of it passes with
  // MeasureGuides.tsx reverted to the exact pairing it was written to retire —
  // `color: 'var(--on-accent)'` over `background: color`, white on the sage accent
  // at 3.89:1 — because none of it reads the component. Worse, the sage tripwire up
  // there asserts that pairing is under 4.5:1, which was TRUE while the bug shipped:
  // its green state was the buggy state.
  //
  // A regex over source, deliberately and named as such: the assertion is about how
  // two values are PAIRED inside one style object, which no import can expose.
  const SRC = readFileSync(join(process.cwd(), 'components', 'three', 'MeasureGuides.tsx'), 'utf8');

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
});

describe('chrome that stands on a photograph, not on the page', () => {
  // Every other contrast promise in this file is a promise about two colours the
  // stylesheet owns. The capture screen's chips are not: they sit on a photograph
  // of the user's living room, so the background is unknown and unknowable, and
  // the honest question is not "what is the ratio" but "is there a tone that
  // defeats us".
  //
  // Two protections, and neither covers the range alone. The chip's ground is a
  // solid --ink, which reads clearly against a bright photo and vanishes against a
  // dark one. The boundary --edge-on-ink is near-paper, which does the opposite.
  // The chip is legible where the BETTER of the two clears WCAG 1.4.11's 3:1.
  const ink = surface('ink')!;
  const paper = surface('paper')!;
  const edgeTint = TINT.get('edge-on-ink');

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
    // failed it: 1.92:1 and 2.02:1 against their own worst photo tone, on the
    // chips whose whole job is to be noticed. Worse, it is not reachable by a
    // heavier boundary; a mid-dark ground and a light edge sit too close together
    // in luminance, and even a solid --paper edge on --warn tops out at 2.18:1.
    //
    // Both of those grounds are still asserted below, so this is not merely a
    // style rule: it is the reason the rule exists.
    for (const name of ['warn', 'success-text']) {
      const bad = surface(name)!;
      expect(bad, `--${name} is not a colour token any more`).toBeTruthy();
      const edge = over(edgeTint!.rgb, edgeTint!.alpha, bad);
      expect(
        worstOverAllPhotos(bad, edge).ratio,
        `--${name} would be a legal chip ground after all — re-read this test`,
      ).toBeLessThan(3);
    }

    // And the mechanical half: nothing in the capture screen spreads photoChrome()
    // and then sets a background. Read from the source because the rule is about
    // call sites, and there are nine of them.
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

  it('the signal colours are legible on the ground that replaced those chips', () => {
    // The colour moved from the ground to the type, so these two now carry the whole
    // signal and owe the full 4.5:1 at 11px. --warn itself is 3.01:1 on --ink and
    // --warn-text is darker still, which is why neither could simply be reused.
    for (const name of ['on-ink-warn', 'on-ink-success']) {
      const fg = surface(name)!;
      expect(fg, `--${name} is not a colour token in globals.css`).toBeTruthy();
      expect(contrastRatio(fg, ink), `--${name} on --ink`).toBeGreaterThanOrEqual(4.5);
    }
    // …and they must still read as a WARNING and a SUCCESS rather than as two
    // arbitrary pastels: same hue family as the tokens they stand in for. OKLCH hue
    // is the only axis that claim is about, so lightness and chroma are free.
    expect(Math.abs(toOklch(surface('on-ink-warn')!).h - toOklch(surface('warn')!).h)).toBeLessThan(8);
    expect(
      Math.abs(toOklch(surface('on-ink-success')!).h - toOklch(surface('success-text')!).h),
    ).toBeLessThan(8);
  });

  it('--on-ink-2 is quiet but still type, on the ground it names', () => {
    const quiet = surface('on-ink-2')!;
    expect(quiet, '--on-ink-2 does not resolve to a colour').toBeTruthy();
    // It is used at 10.5px, so it is small text and owes the full 4.5:1.
    expect(contrastRatio(quiet, ink)).toBeGreaterThanOrEqual(4.5);
    // …and it has to be visibly quieter than --on-ink, or the tier is theatre.
    expect(contrastRatio(quiet, ink)).toBeLessThan(contrastRatio(paper, ink) - 2);
    // It is an alias of --ink-4 so that one edit moves both. Asserted, because the
    // whole point of the alias is that they cannot drift.
    expect(ALIAS.get('on-ink-2'), '--on-ink-2 should alias --ink-4').toBe('ink-4');
  });
});
