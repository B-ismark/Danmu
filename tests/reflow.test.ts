// The layout invariants that fail SILENTLY when they break.
//
// Overflow here goes wrong in two opposite ways, and neither raises anything.
// A container that clips — `.toolbar`, `.rail`, a rail section's scroll box, all
// `overflow: hidden` — eats whatever crosses its edge with no scrollbar and no
// ellipsis: that took ~56px off the left of the old "Look" popover, a 300px card
// opened inside a 260px rail. An element with NO overflow of its own does the
// reverse and prints over its neighbours: `flex: 1 1 0` with `minWidth: 0` sizes
// the box and not the text, so four lighting moods sharing 272px gave "Evening"
// 68px for 82px of word. Neither failed typecheck, lint, or a single test, and
// the second reads as a font bug rather than a layout one.
//
// These assertions cannot check that the layout looks right — nothing here can.
// They check that the mechanisms which make it reflow are still declared, because
// each is a single property that reads as harmless to delete.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = (...p: string[]) => join(process.cwd(), ...p);
const CSS = readFileSync(root('app', 'globals.css'), 'utf8');

/** The body of one CSS rule, by exact selector. */
function rule(selector: string): string {
  // Escaped for the regex, and `[^{]*` before `{` so `.chrome-bar` does not match
  // `.chrome-bar--tight`.
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(CSS);
  expect(m, `no rule for \`${selector}\` in globals.css`).toBeTruthy();
  return m![1];
}

/** The declared value of a custom property on `:root`. */
function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(CSS);
  expect(m, `--${name} is not declared in globals.css`).toBeTruthy();
  return m![1].trim();
}

describe('.chrome-bar reflows instead of overflowing', () => {
  const body = rule('.chrome-bar');

  it('wraps unconditionally, not inside a media query', () => {
    // The studio's bar holds a logo, a breadcrumb, a user-typed room name, a save
    // hint, two tabs and three controls — about 900px of nowrap content whose real
    // width no media query can name. It wrapped below 720px once, which is 200px
    // past where it started spilling.
    expect(body).toMatch(/flex-wrap:\s*wrap/);
  });

  it('sizes with min-height, never a fixed height', () => {
    // `height` is what makes a wrapped second row overlap the content under it.
    // `min-height` still centres a single row at exactly the same size, which is
    // why the swap is invisible until the bar actually needs two rows.
    expect(body).toMatch(/min-height:/);
    expect(body, 'a fixed height cannot hold a wrapped row').not.toMatch(/(^|[^-])height:\s*\d/);
  });

  it('has a trailing group that survives the wrap', () => {
    // `margin-left: auto`, because a `flex: 1` spacer stays behind on row one and
    // leaves the controls it was pushing hanging off the left of row two.
    expect(rule('.chrome-bar__end')).toMatch(/margin-left:\s*auto/);
  });
});

describe('the studio rails give ground', () => {
  // Fixed at 260 + 320 the rails cost 580px of chrome on every screen, so the
  // narrowest viewport that still gets three columns gave the 3D room — the
  // product — less width than either panel beside it.
  it.each(['rail-left', 'rail-right'])('--%s clamps rather than sitting still', (name) => {
    expect(token(name)).toMatch(/^clamp\(/);
  });

  it('leaves the inspector room for the widest control it holds', () => {
    // The colour picker is that control, and it states its own width. A floor
    // below `picker + section padding` is a rail that clips its own contents at
    // every viewport, which no breakpoint would reveal.
    const picker = /width:\s*(\d+)/.exec(readFileSync(root('components', 'ui', 'ColorPicker.tsx'), 'utf8'));
    expect(picker, 'ColorPicker no longer declares a width — re-derive this floor').toBeTruthy();
    // `.section` is `padding: 14px 16px`.
    const needed = Number(picker![1]) + 32;
    const floor = Number(/clamp\(\s*(\d+)px/.exec(token('rail-right'))![1]);
    expect(floor).toBeGreaterThanOrEqual(needed);
  });

  it('does not clamp the closed rail — a reopen toggle is one fixed size', () => {
    expect(token('rail-closed')).toMatch(/^\d+px$/);
  });
});

describe('Segmented can lay its options out on more than one row', () => {
  const SRC = readFileSync(root('components', 'ui', 'primitives.tsx'), 'utf8');

  it('offers a wrap mode at all', () => {
    // `stretch` divides ONE row evenly, which only helps while the row is wide
    // enough for every label. Four `icon + word` segments want ~340px, and what
    // a too-narrow one does is print over the segment beside it.
    expect(SRC).toMatch(/wrap\?:\s*boolean/);
    expect(SRC, 'wrap mode should auto-fit its columns, not assume a count').toMatch(
      /repeat\(auto-fit,\s*minmax\(min\(\$\{minItem\}px,\s*100%\),\s*1fr\)\)/,
    );
  });

  it('is what the two four-option sets in narrow containers actually use', () => {
    // Lighting had already broken — 272px shared four ways, with "Evening"
    // overrunning its 68px segment. The capture picker had not: four short labels
    // fit a 320px phone by about 22px, which is a margin that depends on the
    // webfont having loaded. One is a fix and one is headroom; both want the same
    // mode, and both are here so a later edit cannot quietly drop either.
    for (const f of [
      join('components', 'studio', 'ViewOptions.tsx'),
      join('app', 'onboarding', 'capture', 'page.tsx'),
    ]) {
      expect(readFileSync(root(f), 'utf8'), `${f} should pass wrap to Segmented`).toMatch(/^\s+wrap$/m);
    }
  });

  it('keeps the four-mood lighting set inside the narrowest rail', () => {
    const minItem = Number(/minItem=\{(\d+)\}/.exec(readFileSync(root('components', 'studio', 'ViewOptions.tsx'), 'utf8'))![1]);
    const floor = Number(/clamp\(\s*(\d+)px/.exec(token('rail-left'))![1]);
    // Two columns is the layout this set is meant to fall back to. One column
    // would be four full-width rows of a mood picker, which is a list, not a
    // segmented control.
    expect(floor - 32).toBeGreaterThanOrEqual(minItem * 2);
  });
});

describe('a floating card is capped against the window, not just stated', () => {
  // Each of these is anchored to one edge and grows toward the other, so a bare
  // pixel width grows straight off screen. Browser zoom reaches these widths on a
  // laptop, which is the case the viewport gate deliberately stopped blocking.
  it.each([
    ['components/studio/StudioHelp.tsx', /width:\s*'min\(\d+px,\s*calc\(100vw/],
    ['components/studio/HelpCard.tsx', /width:\s*'min\(\d+px,\s*calc\(100vw/],
    ['components/studio/RoomSwitcher.tsx', /maxWidth:\s*'min\(\d+px,\s*calc\(100vw/],
  ])('%s caps its width', (file, pattern) => {
    expect(readFileSync(root(...file.split('/')), 'utf8')).toMatch(pattern);
  });

  it("the sun graph's height follows its width", () => {
    // Its viewBox is 272 wide because the popover it used to live in had exactly
    // 272px of content. That coincidence is gone, so a pinned `height` would let
    // the default `xMidYMid meet` letterbox the drawing and show the element's
    // own background above and below the night rect as two mismatched bands.
    // `preserveAspectRatio="none"` is the other way to fill the box and is not
    // allowed here: it scales the axes independently, so the "sun right now"
    // marker becomes an ellipse.
    const src = readFileSync(root('components', 'studio', 'SunControls.tsx'), 'utf8');
    const raw = /<svg\s+viewBox=\{`0 0 \$\{GRAPH_W\} \$\{GRAPH_H\}`\}[\s\S]*?\n {6}>/.exec(src);
    expect(raw, 'the day-path <svg> is no longer recognisable — re-derive this').toBeTruthy();
    // Comments stripped, because the reasoning above the tag NAMES the attribute
    // it is telling you not to use — and a negative assertion that reads prose
    // fails on the explanation rather than on the code.
    const tag = raw![0]
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(tag).not.toMatch(/height=\{GRAPH_H\}/);
    expect(tag).not.toMatch(/preserveAspectRatio=/);
    expect(tag).toMatch(/aspectRatio: `\$\{GRAPH_W\} \/ \$\{GRAPH_H\}`/);
  });

  it('the room report measures its own width so it can clamp its left edge', () => {
    // A CSS `min()` in the style plus a constant in `place()` would be two answers
    // to one question, and `left` is computed from the width — so the constant is
    // the one that would be wrong.
    const src = readFileSync(root('components', 'studio', 'RoomTools.tsx'), 'utf8');
    expect(src).toMatch(/const width = Math\.min\(PANEL_W,\s*window\.innerWidth/);
    expect(src, 'left must be clamped at BOTH edges').toMatch(/const left = Math\.max\(\s*\d+,\s*Math\.min\(/);
  });
});
