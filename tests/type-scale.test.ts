import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from './helpers/source';

// **One type scale and one set of speeds, in `globals.css`, and nowhere else.**
//
// Before this there were twenty-two font sizes in the interface, half a pixel apart —
// 11, 11.5, 12, 12.5, 13, 13.5 all in use side by side — and five transition speeds
// with no rule about which. Nothing was wrong with any one of them, which is exactly
// why they multiplied: a panel copied whichever number its neighbour had, and nobody
// could say what a caption was. The tokens are the answer; this file is what stops the
// literals growing back, because a scale that is merely available is a scale people
// reach past.
//
// Comments are stripped before the sweep (a sentence quoting "11px" is not a font
// size), strings are kept (`fontSize: '12px'` IS one).

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|css)$/.test(name)) out.push(relative(ROOT, p));
  }
  return out;
}
const FILES = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];

/** Where a literal size is correct, and why. Each is a place that is not interface
 *  text set in the app's own type. */
const EXEMPT_FILES: Record<string, string> = {
  // Rendered by satori into a PNG at build time — no stylesheet, no custom properties.
  'app/opengraph-image.tsx': 'satori cannot read CSS custom properties',
};

/** SVG `fontSize="…"` / `fontSize={…}` attributes are in the drawing's own user units
 *  (a plan label is scaled with the plan), not interface type. Only `style` objects and
 *  CSS declarations are interface type. */
const LITERAL_STYLE_SIZE = /fontSize:\s*['"`]?\d/;
const LITERAL_CSS_SIZE = /font-size:\s*\d/;
/** `size + 1` is the brand mark's wordmark tracking its glyph — a proportion, not a step
 *  (`tests/brand-mark.test.ts` owns that lockup). */
const COMPUTED_OK = /fontSize:\s*size \+ 1\b/;

const LITERAL_DURATION = /transition(?:-duration)?:\s*['"`]?[^;'"`\n]*\b\d*\.?\d+m?s\b/;

describe('the type scale', () => {
  const steps = ['micro', 'caption', 'small', 'body', 'lead', 'title', 'display'];
  const px = (name: string) => {
    const m = new RegExp(`--fs-${name}:\\s*([\\d.]+)px;`).exec(CSS);
    expect(m, `--fs-${name} is not a px token in globals.css`).toBeTruthy();
    return Number(m![1]);
  };

  it('has its eight steps, and each is larger than the one before', () => {
    const sizes = steps.map(px);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], `--fs-${steps[i]} must be larger than --fs-${steps[i - 1]}`).toBeGreaterThan(sizes[i - 1]);
    }
    // The fluid headline tops out above `display` and never drops below it.
    const hero = /--fs-hero:\s*clamp\((\d+)px,[^,]+,\s*(\d+)px\);/.exec(CSS);
    expect(hero, '--fs-hero must be a clamp()').toBeTruthy();
    expect(Number(hero![1])).toBeGreaterThan(px('display'));
  });

  it('pins the interface steps, so a nudge to one is a decision and not drift', () => {
    // Pinned as literals on purpose: a check derived from the tokens can only ever
    // agree with them. Half a table pinned is the same defect as none.
    expect(steps.map(px)).toEqual([10.5, 11.5, 12.5, 13.5, 16, 22, 30]);
  });

  it('the smallest step is still legible type', () => {
    // 10.5px is the floor this app's hint text is contrast-checked at (see --ink-3).
    expect(px('micro')).toBeGreaterThanOrEqual(10.5);
  });

  it('every font size in app/ and components/ is a step, not a number', () => {
    expect(FILES.length, 'the sweep found no files — it is reading the wrong place').toBeGreaterThan(80);
    expect(FILES).toContain('components/studio/Inspector.tsx');
    const offenders: string[] = [];
    for (const f of FILES) {
      if (f in EXEMPT_FILES) continue;
      const lines = stripComments(readFileSync(join(ROOT, f), 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (COMPUTED_OK.test(line)) return;
        if (f === 'app/globals.css' && /^\s*--fs-/.test(line)) return;
        if (LITERAL_STYLE_SIZE.test(line) || LITERAL_CSS_SIZE.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, 'use a --fs-* step:\n' + offenders.join('\n')).toEqual([]);
  });
});

describe('the motion tokens', () => {
  it('three speeds, in order', () => {
    const ms = (n: string) => Number(new RegExp(`--dur-${n}:\\s*(\\d+)ms;`).exec(CSS)![1]);
    expect([ms('quick'), ms('base'), ms('slow')]).toEqual([120, 160, 300]);
  });

  it('every transition names a speed rather than a number', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (f in EXEMPT_FILES) continue;
      stripComments(readFileSync(join(ROOT, f), 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (LITERAL_DURATION.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(offenders, 'use --dur-quick / --dur-base / --dur-slow:\n' + offenders.join('\n')).toEqual([]);
  });

  it('reduced motion keeps state feedback at the quick speed', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(CSS)![0];
    expect(block).toContain('transition-duration: var(--dur-quick) !important');
  });
});
