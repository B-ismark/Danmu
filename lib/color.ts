// Colour arithmetic — contrast, and a perceptual space to reason in.
//
// Two jobs, both of which the codebase was doing in prose.
//
// **Contrast.** `app/globals.css` states a ratio next to almost every token
// (`--accent-text: #B03F1E; /* 5.54:1 on --paper */`), and `CLAUDE.md` turns those
// into a rule: fills are fills, and only the `-ink` / `-text` variants clear 4.5:1
// as type. Nothing checked any of it. A comment claiming a ratio is a comment.
//
// **A space where "same colour" means something.** `lib/scene-palette.ts` exists
// because Three.js materials and a 2D canvas cannot read a custom property, so its
// values are hand-copied duplicates of the CSS tokens. Comparing those for exact
// string equality is brittle in one direction and blind in the other; comparing
// them in OKLab says what is actually meant — that nobody can see the difference.
//
// OKLab is Björn Ottosson's 2020 space. It is used here rather than CIELAB because
// its lightness axis is genuinely perceptual for screen colours, which is what
// makes "rotate the hue and keep the lightness" a safe operation on a palette:
// no rotation can produce a theme that fails the contrast the original passed.

export type Rgb = { r: number; g: number; b: number };
export type Oklab = { L: number; a: number; b: number };
export type Oklch = { L: number; c: number; h: number };

/** `#rgb` or `#rrggbb` → 0..255 channels. Null for anything else, so a caller
 *  parsing a stylesheet can tell a colour from a gradient. */
export function parseHex(hex: string): Rgb | null {
  const s = hex.trim().replace(/^#/, '');
  if (s.length === 3) {
    const [r, g, b] = s.split('').map((c) => parseInt(c + c, 16));
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  if (s.length !== 6) return null;
  const n = parseInt(s, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** sRGB transfer function, 0..255 → linear 0..1. */
function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(c: Rgb): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG contrast ratio, 1..21. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a translucent colour over an opaque one — what a `--*-tint` actually
 *  looks like, and therefore what its text has to be checked against. */
export function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

// ─── OKLab / OKLCH ──────────────────────────────────────────────────────────

export function rgbToOklab(c: Rgb): Oklab {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb(c: Oklab): Rgb {
  const l = (c.L + 0.3963377774 * c.a + 0.2158037573 * c.b) ** 3;
  const m = (c.L - 0.1055613458 * c.a - 0.0638541728 * c.b) ** 3;
  const s = (c.L - 0.0894841775 * c.a - 1.291485548 * c.b) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function oklabToOklch({ L, a, b }: Oklab): Oklch {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

export function oklchToOklab({ L, c, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { L, a: c * Math.cos(rad), b: c * Math.sin(rad) };
}

export const toOklch = (c: Rgb): Oklch => oklabToOklch(rgbToOklab(c));
export const fromOklch = (c: Oklch): Rgb => oklabToRgb(oklchToOklab(c));

/** Perceptual distance in OKLab. Roughly: under 0.01 nobody can tell, under 0.02
 *  nobody notices without a swatch beside it. */
export function deltaEOk(a: Rgb, b: Rgb): number {
  const x = rgbToOklab(a);
  const y = rgbToOklab(b);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

/** Rotate a colour's hue while holding its lightness and chroma.
 *
 *  The operation a theme generator wants: at constant L and C, no rotation can
 *  make a colour that fails a contrast the original passed, because WCAG
 *  luminance and OKLab lightness move together. That is the whole reason to keep
 *  a palette in this space rather than in HSL, where rotating hue at "constant
 *  lightness" swings real luminance by a factor of three. */
export function rotateHue(c: Rgb, degrees: number): Rgb {
  const p = toOklch(c);
  return fromOklch({ ...p, h: (((p.h + degrees) % 360) + 360) % 360 });
}
