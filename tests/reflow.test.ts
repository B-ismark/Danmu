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

  it('is what the four-option set in a narrow container actually uses', () => {
    // Lighting broke for real: 272px shared four ways, with "Evening" overrunning
    // its 68px segment and printing over "Day".
    //
    // This used to cover a second file. The capture screen had a four-option "Wall
    // to shoot" picker in a 360px rail — headroom rather than a fix, fitting a
    // 320px phone by about 22px on a webfont that may not have loaded — and it is
    // gone, along with the four-bay grid it drove: the wall is now worked out from
    // the photo (`lib/capture-slots.ts`) instead of asked for. The Segmented left
    // on that screen picks Upload or Camera, two options inside `.chrome-bar`,
    // which wraps at every width. So the guard is dropped there because the
    // control it guarded no longer exists, not because it started failing.
    for (const f of [join('components', 'studio', 'ViewOptions.tsx')]) {
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

describe('the canvas tool cluster reflows instead of mangling', () => {
  const SRC = readFileSync(root('components', 'studio', 'TransformToolbar.tsx'), 'utf8');
  const CHROME = readFileSync(root('components', 'studio', 'CanvasChrome.tsx'), 'utf8');

  it('hands its two groups to the cluster instead of boxing them together', () => {
    // This is the whole bug. `CanvasTools` wraps; a wrapper div here presented
    // both groups to it as ONE unwrappable item, so the snap pill was compressed
    // instead of moving to a second row — and a compressed pill wrapped
    // `Snap · Coarse` onto two lines inside a `height: 30` border.
    expect(SRC, 'the two groups must be siblings in the cluster').toMatch(/<Fragment>/);
    expect(SRC, 'no inline-flex wrapper may come back around them').not.toMatch(/display: 'inline-flex', gap: 8/);
    // And the cluster it hands them to has to actually wrap.
    expect(/export function CanvasTools[\s\S]*?^}/m.exec(CHROME)?.[0]).toMatch(/flexWrap: 'wrap'/);
  });

  it('keeps the snap pill whole and lets it take a row of its own', () => {
    // One short phrase in a fixed-height fully-rounded border has no graceful
    // narrow form, so it must not be given one.
    const pill = /function SnapCycleButton[\s\S]*$/.exec(SRC)?.[0] ?? '';
    expect(pill).toMatch(/flexShrink: 0/);
    expect(pill).toMatch(/whiteSpace: 'nowrap'/);
    expect(pill, 'a bare text node is an anonymous flex item nothing can address').toMatch(
      /<span>Snap · \{cur\.label\}<\/span>/,
    );
  });

  it('lets the mode labels give ground before the toolbar clips them', () => {
    // `.toolbar` is `overflow: hidden`, so once the row is too narrow for three
    // labelled buttons something is cut. Shrinkable buttons with an ellipsising
    // label choose WHAT: the icon and the keycap survive, the word truncates.
    // Everything above `SnapCycleButton` is the mode toolbar.
    const modes = SRC.slice(0, SRC.indexOf('function SnapCycleButton'));
    expect(modes, 'a flex item will not shrink below its own content without this').toMatch(/minWidth: 0/);
    expect(modes, 'the label needs its own element to ellipsise in').toMatch(/textOverflow: 'ellipsis'/);
    expect(modes, 'the icon identifies the mode once the word is cut').toMatch(/flexShrink: 0/);
  });

  it('gives every fixed-height button and chip a nowrap label at the source', () => {
    // `.ds-btn` and `.ds-chip` both state their own `height`, and most of their
    // labels are a bare text node beside an icon — an anonymous flex item, which
    // no per-site style can reach. Only the class can.
    expect(rule('.ds-btn')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.ds-chip')).toMatch(/white-space:\s*nowrap/);
  });

  it('lets a button whose label is a sentence opt out of that nowrap', () => {
    // The pair is the signal, and `height: auto` alone is NOT enough — the class
    // still wins and clips. This button lost its trailing chevron on a phone until
    // it said both.
    const src = readFileSync(root('app', 'onboarding', 'welcome', 'page.tsx'), 'utf8');
    const sentence = /height: 'auto'[^}]*/.exec(src)?.[0] ?? '';
    expect(sentence, 'the sentence button must say `whiteSpace: normal` too').toMatch(/whiteSpace: 'normal'/);
  });

  it('keeps the centred tool cluster out from under the right-hand one', () => {
    // Both clusters sit at the same `top` and nothing made them aware of each
    // other, so the 3D tab printed undo/redo over "Snap · Fine" and the 2D tab
    // printed "Comfort zones" over the zoom toolbar.
    expect(CHROME, 'the view cluster has to publish its width').toMatch(/--canvas-reserve-right/);
    // As padding inside the span, never as an opposing offset: `left` + `right`
    // both carrying the reserve is what collapsed the 2D tab's cluster to 0px.
    const tools = /export function CanvasTools[\s\S]*?^}/m.exec(CHROME)?.[0] ?? '';
    expect(tools).toMatch(/paddingRight:/);
    expect(tools, 'a reserve on both offsets can make the box cross itself').not.toMatch(
      /left: `calc\([^`]*RESERVE/,
    );
    // And a floor, so a right-hand cluster wider than the canvas cannot collapse
    // the tools from the other direction.
    expect(tools).toMatch(/MIN_TOOLS/);
  });

  it('lets the plan toolbar fold rather than clip its last controls', () => {
    // ~450px of zoom / rotate / fit in a `.toolbar`, which is `overflow: hidden`.
    // Without a wrap the Fit button was simply cut off at the border.
    const src = readFileSync(root('components', 'studio', 'PlanChrome.tsx'), 'utf8');
    const bar = /function PlanViewControls[\s\S]*?<div className="toolbar"[^>]*>/.exec(src)?.[0] ?? '';
    expect(bar).toMatch(/flexWrap: 'wrap'/);
    // Its dividers have no content, so without a cross-axis size they were 1×0 —
    // present in the DOM and invisible on screen.
    expect(src).toMatch(/width: 1, flexShrink: 0, alignSelf: 'stretch'/);
  });
});

describe('a rail section reflows instead of clipping', () => {
  const SRC = readFileSync(root('components', 'studio', 'RailSection.tsx'), 'utf8');

  it('lets the title shrink and ellipsise rather than shoving the meta out', () => {
    // `flex: 1` sizes the BOX. Without `minWidth: 0` the span refuses to go below
    // its own text and pushes the meta through the rail's `overflow: hidden` — no
    // scrollbar, no ellipsis, nothing to notice. The four properties are one
    // mechanism; any of them on its own does nothing.
    const title = /className="section-title"[^>]*>/.exec(SRC);
    expect(title, 'no section-title span in RailSection').toBeTruthy();
    for (const prop of ['minWidth: 0', "overflow: 'hidden'", "textOverflow: 'ellipsis'", "whiteSpace: 'nowrap'"]) {
      expect(title![0], `the title needs ${prop} to ellipsise`).toContain(prop);
    }
  });

  it('holds the meta at its natural width', () => {
    // The meta is the derived half — a count, a theme name. A clipped number is
    // lost outright, where a clipped word is still recognisable from its start.
    const meta = /className="section-meta"[^>]*>/.exec(SRC);
    expect(meta, 'no section-meta span in RailSection').toBeTruthy();
    expect(meta![0]).toContain('flexShrink: 0');
  });

  it('states its padding in CSS, where a container query can reach it', () => {
    // Inline padding is padding the rail's own container queries cannot narrow.
    // RailSection is what the LEFT rail is built from, so while its padding was
    // stated inline the 240px relief below reached the Inspector and nothing else.
    expect(SRC).toMatch(/className="rail-section-head"/);
    expect(SRC).toMatch(/className="rail-section-body"/);
    expect(SRC, 'padding belongs in globals.css now').not.toMatch(/padding: '[^']*16px/);
    const tight = /@container rail \(max-width: 240px\) \{([^}]*)\}/.exec(CSS);
    expect(tight, 'no 240px container query in globals.css').toBeTruthy();
    expect(tight![1]).toContain('.rail-section-head');
    expect(tight![1]).toContain('.rail-section-body');
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

describe('the inspector folds its options away', () => {
  const INSPECTOR = readFileSync(root('components', 'studio', 'Inspector.tsx'), 'utf8');

  it('discloses colour and surface props through RailSection, not always-on grids', () => {
    // Selecting a part used to open 24 swatches, 5 finish chips and 5 prop
    // chips at once — every option, no decision. The fold is the LEFT rail's
    // own component, so the app keeps exactly one disclosure, not one per rail.
    expect(INSPECTOR).toMatch(/import \{ RailSection \} from '\.\/RailSection'/);
    expect(INSPECTOR).toMatch(/<RailSection[\s\S]{0,80}title=\{label\}/);
    expect(INSPECTOR).toMatch(/<RailSection title="On the surface"/);
  });

  it('names the state in the collapsed row — the summary is the point of the fold', () => {
    // A folded row that said only "Colour" would force the expand just to see
    // where you stand. RailSection's meta is the derived state: swatch + name +
    // finish for paint, "Suggested · 3" for props.
    expect(INSPECTOR).toMatch(/finishLabel=\{part\.finish/);
    expect(INSPECTOR).toMatch(/meta=\{summary\}/);
  });

  it('keeps Finish inside the Colour decision', () => {
    // Five near-synonym chips competing with the real verbs was a section
    // looking for a reason; as half of the material decision they are one
    // click away, and the choice still shows in the collapsed summary.
    expect(INSPECTOR).not.toMatch(/Section label="Finish"/);
    expect(INSPECTOR).toMatch(/function FinishChips/);
  });
});
