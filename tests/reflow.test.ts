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

/** The px floor a rail token clamps to, following one level of `var()`.
 *
 *  The floors are tokens of their own now (`--rail-left-min`), because a rail the
 *  user has *dragged* has to be held to the same floor as one the stylesheet
 *  sized — and a pointer handler can only do that by naming the token. This
 *  resolves either shape, so the assertions below keep asking the question they
 *  were written to ask rather than the question the syntax happens to allow. */
function railFloor(name: string): number {
  const first = /clamp\(\s*([^,]+),/.exec(token(name));
  expect(first, `--${name} is not a clamp()`).toBeTruthy();
  const arg = first![1].trim();
  const indirect = /^var\(\s*(--[\w-]+)\s*\)$/.exec(arg);
  const resolved = indirect ? token(indirect[1].slice(2)) : arg;
  const px = /^(\d+(?:\.\d+)?)px$/.exec(resolved);
  expect(px, `--${name}'s floor does not resolve to a px length (got \`${arg}\`)`).toBeTruthy();
  return Number(px![1]);
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

  it('holds its widest control to a ceiling, so the control cannot pin the floor', () => {
    // The colour picker is that control. It used to declare `width: 220`, which
    // made the rail's floor a hostage: one pixel narrower and the picker was cut
    // off silently, because `.rail` has no overflow of its own to hang a
    // scrollbar on. As `min(220px, 100%)` it asks for 220 and accepts less.
    //
    // Matching the whole declaration rather than the first `width:` in the file
    // matters: `/width:\s*(\d+)/` went on passing after the change by finding a
    // 14px swatch further down, and an assertion that reads the wrong number is
    // worse than no assertion.
    const src = readFileSync(root('components', 'ui', 'ColorPicker.tsx'), 'utf8');
    const capped = /width: 'min\((\d+)px, 100%\)'/.exec(src);
    expect(capped, 'ColorPicker should cap its width with min(), not state a bare one').toBeTruthy();
    // Comments stripped, like the sun-graph assertion below: the note above that
    // declaration NAMES the `width: 220` it is telling you not to write, and a
    // negative assertion that reads prose fails on the explanation.
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code, 'a three-digit pixel width in here re-pins the rail floor').not.toMatch(/width: \d{3}\b/);

    // A fluid control that never gets near what it asks for is a different bug,
    // so the floor still has to leave it most of its ideal. `.section` is
    // `padding: 14px 16px`.
    expect(railFloor('rail-right') - 32).toBeGreaterThanOrEqual(Number(capped![1]));
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
    const floor = railFloor('rail-left');
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

describe('the canvas is not resized once per frame of a window drag', () => {
  // `react-use-measure` routes its ResizeObserver through `debounce.scroll` and
  // the window `resize` EVENT through `debounce.resize` — not the split the names
  // imply. R3F's defaults are `{ scroll: 50, resize: 0 }`, so element resizes (a
  // rail collapsing, a sash drag) were already debounced and dragging the window's
  // own edge was not. With `frameloop="demand"` plus SSAO and SMAA, each of those
  // intermediate widths buys a full effect chain.
  const SRC = readFileSync(root('components', 'three', 'Room.tsx'), 'utf8');
  const debounce = /resize=\{\{\s*debounce:\s*\{([^}]*)\}/.exec(SRC);

  it('debounces the window-resize path, which shipped at zero', () => {
    expect(debounce, 'the <Canvas> should declare resize={{ debounce: { … } }}').toBeTruthy();
    const resize = /resize:\s*(\d+)/.exec(debounce![1]);
    expect(resize, 'no `resize` entry in the debounce config').toBeTruthy();
    expect(Number(resize![1])).toBeGreaterThan(0);
  });

  it('restates the observer debounce it would otherwise drop to zero', () => {
    // R3F spreads this object over its defaults, so `debounce` is replaced whole
    // rather than merged. Omitting `scroll` here does not inherit 50 — it takes
    // the ResizeObserver's own debounce to 0 and makes the element-resize path
    // worse than it was before this line existed.
    const scroll = /scroll:\s*(\d+)/.exec(debounce![1]);
    expect(scroll, 'the scroll entry carries the ResizeObserver debounce').toBeTruthy();
    expect(Number(scroll![1])).toBeGreaterThan(0);
  });
});

describe('the studio shells', () => {
  const DOCKED = readFileSync(root('components', 'studio', 'shells', 'DockedShell.tsx'), 'utf8');
  const SASH = readFileSync(root('components', 'studio', 'shells', 'RailSash.tsx'), 'utf8');

  it.each([
    ['shells/DockedShell.tsx', DOCKED],
    ['shells/OverlayShell.tsx', readFileSync(root('components', 'studio', 'shells', 'OverlayShell.tsx'), 'utf8')],
  ])('%s measures the stacked room in dvh, not vh', (_f, src) => {
    // These rows sit inside a `100dvh` wrapper. `vh` includes the collapsing URL
    // bar, so the row was sized against a taller viewport than its own container.
    expect(src).not.toMatch(/[^d]vh\b/);
  });

  it('renders a dragged width inside the token bounds rather than instead of them', () => {
    // A 520px rail dragged on a monitor must still be a ceiling on a laptop.
    expect(DOCKED).toMatch(/clamp\(var\(--rail-\$\{side\}-min\), \$\{stored\}px, var\(--rail-max\)\)/);
  });

  it('gives the sash the window-splitter role and its keys', () => {
    expect(SASH).toMatch(/role="separator"/);
    expect(SASH).toMatch(/aria-valuenow/);
    expect(SASH, 'a separator that cannot be focused cannot be operated').toMatch(/tabIndex=\{0\}/);
    for (const key of ['Enter', 'Home', 'End', 'ArrowRight', 'ArrowLeft']) {
      expect(SASH, `the splitter pattern binds ${key}`).toContain(`'${key}'`);
    }
  });

  it('drags by writing CSS, never React state', () => {
    // A setState per pointermove re-renders the piece tree, the inspector and the
    // R3F tree ~60×/second while the user is judging a panel width.
    expect(SASH).toMatch(/requestAnimationFrame\(paint\)/);
    expect(SASH).toMatch(/style\.setProperty\(WIDTH_PROP\[side\]/);
    expect(SASH, 'the ResizeObserver must stand down mid-drag or it re-renders anyway').toMatch(
      /if \(drag\.current\) return;/,
    );
  });

  it('takes its floor and ceiling from tokens', () => {
    // A number copied into a pointer handler is a floor that stops moving when
    // the stylesheet's does.
    expect(SASH).toMatch(/--rail-left-min/);
    expect(SASH).toMatch(/--rail-max-share/);
    expect(SASH, 'no invented pixel floors').not.toMatch(/floor = \d/);
  });
});

describe('the elastic rail asks about itself', () => {
  it('is a query container, and only under its own modifier', () => {
    // Scoped to `.rail--elastic`: it is a candidate, and the shell it is measured
    // against has to stay unchanged.
    expect(rule('.rail--elastic')).toMatch(/container-type:\s*inline-size/);
    expect(rule('.rail')).not.toMatch(/container-type/);
  });

  it('actually queries it', () => {
    const blocks = CSS.match(/@container rail \(max-width: \d+px\)/g) ?? [];
    expect(blocks.length, 'a container with no queries is a declaration, not a behaviour').toBeGreaterThan(0);
    // Inline `grid-template-columns` outranks any author rule, query or not —
    // same reason `.row-grid` carries one.
    expect(CSS).toMatch(/\.rail-triple \{ grid-template-columns: 1fr 1fr !important; \}/);
  });

  it('has a hook in the rail to reflow', () => {
    expect(readFileSync(root('components', 'studio', 'Inspector.tsx'), 'utf8')).toMatch(/className="rail-triple"/);
  });

  it('only goes tighter than the shipping floor where the contents reflow', () => {
    // The tight tokens exist so lowering them cannot quietly move the layout that
    // ships; they must be narrower than the ordinary floors, or they are pointless.
    for (const side of ['left', 'right']) {
      const tight = Number(/^(\d+)px$/.exec(token(`rail-${side}-tight`))![1]);
      const floor = railFloor(`rail-${side}`);
      expect(tight).toBeLessThan(floor);
    }
    // And the left one still has to hold the four-mood lighting set two-up, which
    // is the same derivation the token floor answers to.
    const minItem = Number(
      /minItem=\{(\d+)\}/.exec(readFileSync(root('components', 'studio', 'ViewOptions.tsx'), 'utf8'))![1],
    );
    const tightLeft = Number(/^(\d+)px$/.exec(token('rail-left-tight'))![1]);
    expect(tightLeft - 32).toBeGreaterThanOrEqual(minItem * 2);
  });
});
