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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LIGHTINGS } from '@/lib/store';

const root = (...p: string[]) => join(process.cwd(), ...p);

/** A source file with its line endings normalised to `\n`.
 *
 *  `core.autocrlf` is on here, so a file that came out of a checkout has CRLF
 *  endings while one just written by hand has LF — and a regex anchored across a
 *  line break (`,\n\s+height:`) matches the second and not the first. **The
 *  dangerous half is that it is invisible on CI**, which checks out on Linux and
 *  gets LF: the gate stays green while every Windows clone fails, and the two
 *  assertions this bit were passing only because the file they read had never
 *  been through git. Anything below that spans a line break reads through here. */
const readSrc = (...p: string[]) => readFileSync(root(...p), 'utf8').replace(/\r\n/g, '\n');

/** Every file under `dir`, recursively. Needed because one assertion below is
 *  about the ABSENCE of a call site, and "nothing passes this prop" cannot be
 *  checked by reading the files you already thought of. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const CSS = readFileSync(root('app', 'globals.css'), 'utf8');

/** A source file with its comments removed — CSS, TS and JSX alike.
 *
 *  Every negative assertion below has to read code rather than prose, because the
 *  comments in this codebase NAME the thing they tell you not to write: the
 *  ColorPicker note quotes the `width: 220` it replaced, and the shell notes name
 *  the `rail--elastic` modifier and the `?shell=` flag whose deletion they record.
 *  An assertion that reads the explanation fails on the explanation — which two of
 *  these did, the first time they were written. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The body of one CSS rule, by exact selector. */
function rule(selector: string): string {
  // Escaped for the regex, and `[^{]*` before `{` so `.chrome-bar` does not match
  // `.chrome-bar--tight`.
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchored at column 0 first, and that is not tidiness -- it is the difference
  // between reading a rule and reading an override of it. A selector appears twice
  // whenever a container query narrows it, and every container query in this file
  // sits ABOVE the base rules, so an unanchored match returns the query's copy and
  // its two or three relief declarations. An assertion about `.rail-section-toggle`
  // asked for its padding and got ' padding-left: 12px; ' out of the 240px block.
  // Silent, and it fails in the direction that looks like the CSS being wrong.
  //
  // `.rail-footer` hit this first and grew its own column-0 scan inline; this is
  // that fix moved into the helper, so the next caller does not have to know.
  const anchored = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(CSS);
  const m = anchored ?? new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(CSS);
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
    // Comments stripped, the same guard the deleted sun-graph assertion used: the note above that
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

  it('has no call site left, which is a decision and not an oversight', () => {
    // `wrap` and `minItem` are currently used by NOTHING. The lighting set was
    // their last consumer, and it is icon-only now — five glyphs on a plain
    // `flex-wrap` row, with the name on hover and on focus instead of beside the
    // icon (`components/studio/LightingPicker.tsx`). Every remaining `Segmented`
    // in the app passes `stretch` or nothing.
    //
    // They are kept anyway, and this test is the record of why so the next
    // dead-code sweep does not have to guess: `wrap` is the answer to a bug class
    // this file exists for — a row of WORDS in a rail whose width no media query
    // can name — and the argument for it is worth more than the ~15 lines it
    // costs. The moment a set of labelled segments goes back into a rail, this is
    // what it should use rather than being re-invented.
    //
    // Asserted as zero rather than left implicit, so that a new call site makes
    // this test fail and the reader is sent to the two rail-floor assertions
    // below, which would then need to account for it.
    const callers = ['components', 'app']
      .flatMap((dir) => walk(root(dir)))
      .filter((f) => /\.tsx$/.test(f) && !f.endsWith('primitives.tsx'))
      .filter((f) => /^\s+(wrap|minItem=)/m.test(codeOnly(readFileSync(f, 'utf8'))));
    expect(callers, 'a Segmented now passes wrap/minItem — re-derive the rail floors below').toEqual([]);
  });

  it('keeps the lighting set inside the narrowest rail', () => {
    // Re-derived from the control that replaced the segmented one. It is five
    // 32px targets with 4px gaps — 5×32 + 4×4 = 176px — and the tight rail is
    // 208px with `.section`'s 16px of padding each side, so 176px of content.
    // Exactly fits, which is the point: the icon row was sized to the rail rather
    // than the rail widened for it.
    //
    // Read out of the source rather than restated, because a hand-typed 176 here
    // would be the "displayed measurement that is not derived" this repo keeps
    // finding. If someone bumps the buttons to 34px this fails, which is correct
    // — that is the change that would start clipping.
    const picker = readSrc('components', 'studio', 'LightingPicker.tsx');
    const size = Number(/\n\s+width: (\d+),\n\s+height: \1,/.exec(picker)![1]);
    const gap = Number(/flexWrap: 'wrap', gap: (\d+)/.exec(picker)![1]);
    const count = LIGHTINGS.length;
    const needed = count * size + (count - 1) * gap;
    expect(railFloor('rail-left') - 32).toBeGreaterThanOrEqual(needed);
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

  // A third guard stood here: the sun graph's `<svg>` had a 272-wide viewBox left
  // over from the popover it used to live in, and this test held its height to an
  // `aspectRatio` so the drawing filled its box instead of being letterboxed into
  // two mismatched bands. Both the graph and `SunControls.tsx` are gone — the sun
  // is four fixed presets now (see `lib/solar.ts`) — so the guard goes with the
  // element rather than being kept pointing at a file that does not exist.
  //
  // The lesson it recorded is still live and belongs to whoever draws the next
  // SVG in a rail: a viewBox whose numbers came from one container's width is a
  // coincidence, not a layout.

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

  it('keeps the header action OUTSIDE the disclosure button', () => {
    // The header used to BE the <button>. A section-level control — Room's Re-scan
    // link — cannot live inside it: interactive content nested in a <button> is
    // invalid HTML and a `jsx-a11y` failure, and at `--max-warnings 0` that is a red
    // build rather than a warning. So the row is a <div className="rail-section-head">
    // holding a `.rail-section-toggle` button and the action as its SIBLING.
    //
    // Read as source shape rather than rendered DOM because this file is a node
    // suite with no jsdom, and because the mistake it guards against is a diff that
    // looks harmless: moving `{action}` up two lines.
    const HEAD_OPEN = '<div className="rail-section-head">';
    const from = SRC.indexOf(HEAD_OPEN);
    expect(from, 'no rail-section-head row in RailSection').toBeGreaterThan(-1);
    const row = SRC.slice(from + HEAD_OPEN.length);
    expect(row, 'the disclosure must be the .rail-section-toggle button').toMatch(
      /<button[^>]*className="rail-section-toggle"/,
    );
    const btnStart = row.indexOf('<button');
    const btnEnd = row.indexOf('</button>');
    expect(btnStart, 'no disclosure button inside the header row').toBeGreaterThan(-1);
    expect(btnEnd, 'the disclosure button is not closed').toBeGreaterThan(btnStart);
    const toggle = row.slice(btnStart, btnEnd);
    expect(toggle, '{action} must not be nested inside the disclosure button').not.toContain('{action}');
    expect(row.slice(btnEnd), '{action} must render after the disclosure button').toContain('{action}');
  });

  it("keeps the header's leading strip inside the disclosure button", () => {
    // The header used to BE the button, so its 16px leading padding was pressable.
    // Splitting the row put that padding on the wrapping <div> and the button at
    // `padding: 0`, which silently turned the strip at the start of every section
    // header into dead space — a hit-target regression no gate can see and that
    // reads as the header being fussy to click. Found in review.
    //
    // So the toggle carries the vertical padding and the LEADING inline padding,
    // and the row carries only `padding-right`, which is the action button's side.
    const toggle = rule('.rail-section-toggle');
    expect(toggle, 'no .rail-section-toggle rule in globals.css').toBeTruthy();
    expect(toggle, 'the leading strip must be inside the button').toContain('padding: 11px 0 11px 16px');
    const head = rule('.rail-section-head');
    expect(head, 'no .rail-section-head rule in globals.css').toBeTruthy();
    expect(head, 'the row must not re-add a leading pad in front of the button').toContain(
      'padding-right: 16px',
    );
    expect(head, 'a shorthand here would put dead space back').not.toMatch(/padding:\s/);
  });

  it('states its padding in CSS, where a container query can reach it', () => {
    // Inline padding is padding the rail's own container queries cannot narrow.
    // RailSection is what the LEFT rail is built from, so while its padding was
    // stated inline the 240px relief below reached the Inspector and nothing else.
    expect(SRC).toMatch(/className="rail-section-head"/);
    expect(SRC).toMatch(/className="rail-section-body"/);
    expect(SRC, 'padding belongs in globals.css now').not.toMatch(/padding: '[^']*16px/);
    // Sliced with indexOf rather than matched with a regex. The first version used
    // /\{([^}]*)\}/, which stops at the end of the query's FIRST rule — so a second
    // rule inside the same query was invisible to every assertion below. That went
    // unnoticed while the block held exactly one rule, and the hit-target fix above
    // adds two more. A newline-anchored regex is the obvious repair and it is a trap
    // in this repo: the checkout is CRLF, so the pattern has to carry an optional CR
    // and the escaping does not survive being written by a script. String arithmetic
    // cannot get that wrong.
    const QUERY = '@container rail (max-width: 240px) {';
    const qAt = CSS.indexOf(QUERY);
    expect(qAt, 'no 240px container query in globals.css').toBeGreaterThan(-1);
    const bodyFrom = qAt + QUERY.length;
    // The closing brace of the query itself is the only one at column 0 after it.
    const closeAt = CSS.indexOf('\n}', bodyFrom);
    expect(closeAt, 'the 240px container query is never closed').toBeGreaterThan(bodyFrom);
    const tight = CSS.slice(bodyFrom, closeAt);
    expect(tight).toContain('.rail-section-body');
    // The header's padding lives on two elements now, so BOTH need the relief.
    expect(tight, 'the header row keeps its own padding at 240px').toContain('.rail-section-head');
    expect(tight, 'the disclosure keeps its leading pad at 240px').toContain('.rail-section-toggle');
  });
});

describe('the rail footer holds the selection, add and revert in ONE row', () => {
  const SRC = readSrc('components', 'studio', 'RailFooter.tsx');
  const CAT = readSrc('components', 'studio', 'CatalogPanel.tsx');
  // Counting and DERIVING both read the comment-stripped source, not just the
  // negative assertions `codeOnly` was written for.
  //
  // Everything below reaches into these two files for a number — how many wrappers,
  // how many label spans, what size the square is — and both files explain
  // themselves at length in docblocks that quote the very declarations being
  // counted. Measured on the tree this went in on: raw and stripped agree at 3, 2,
  // 1 and 1, so this is latent rather than live. It is fixed anyway, because the
  // failure is asymmetric. A comment that quotes a wrapper it is explaining takes
  // the count to 4 and the test fails for a reason that has nothing to do with the
  // row — annoying, and findable. But delete a control and quote it in the note
  // recording why, and the count STAYS 3: the test goes on passing about a control
  // that is no longer rendered, which is this file's own recurring defect one level
  // up.
  //
  // `codeOnly`'s comment already records two assertions that failed this way, and
  // `layout` made the third while writing the piece row's own width assertion — a
  // naive grep for the row's `IconButton`s returns four, because one is a JSX
  // comment quoting `{hover && <IconButton/>}`. Three instances of one shape is
  // the point at which "use the helper" stops being a preference.
  const CODE = codeOnly(SRC);
  const CATCODE = codeOnly(CAT);

  // There was a local `baseRule` here with a docblock explaining that the shared
  // `rule()` takes the first match and so returns the 240px container query's
  // relief block instead of the base rule. That was true when it was written and
  // stopped being true in the same commit: the column-0 scan moved INTO `rule()`,
  // and this copy plus its explanation stayed behind claiming the helper still had
  // the bug. Prose describing behaviour that changed is the defect no gate sees,
  // so the copy is deleted rather than re-worded — `rule()` is the one scan.

  it('states its box model in CSS, where the container query can reach it', () => {
    // Same argument as `.rail-section-head`: while the old footer stated
    // `padding: 12px 16px` inline in PartTree, the 240px relief below could not
    // narrow it, so the one row in the rail holding two controls side by side was
    // the one row that never gave any padding back.
    expect(SRC).toContain('className="rail-footer"');
    expect(SRC, "padding belongs in globals.css now").not.toContain("padding: '12px 16px'");
    const footer = rule('.rail-footer');
    expect(footer).toContain('padding: 12px 16px');
    // Never squeezed out by a tall Inspector above it. A footer that can shrink to
    // nothing is a footer that silently is not there.
    expect(footer).toContain('flex-shrink: 0');
  });

  /** The line three separate reports called a horizontal scrollbar.
   *
   *  `.rail-footer` had `border-top: 1px solid var(--hairline)`. It rendered
   *  immediately under the Inspector's last control — an OUTLINED "Delete from
   *  scene" button — spanning the rail's full width, with a 32px round revert
   *  button beside it. That reads as a scrollbar, and it was reported as one three
   *  times while two sessions looked for an overflow that did not exist.
   *
   *  It is deleted, not restyled, and the tone does its job alone: the footer is
   *  `--paper-2` against the rail's `--paper`, a real surface step rather than a
   *  1px rule. So this asserts BOTH halves — no border, and the tone still there —
   *  because deleting the border and the background together would leave the
   *  pinned row visually continuous with the scrolling panel above it, which is a
   *  different defect reached by "fixing" this one. */
  it('separates itself from the scrolling panel by tone, not by a rule that reads as a scrollbar', () => {
    const footer = rule('.rail-footer');
    expect(footer, 'a 1px hairline here is read as a horizontal scrollbar').not.toContain('border');
    // The tone is what carries the pinning now, so it is load-bearing rather than
    // decorative. `--paper-2` is 0.858 L against `--paper` at 0.941.
    expect(footer).toContain('background: var(--paper-2)');
  });

  it('is in the 240px padding relief with the rest of the rail', () => {
    const OPEN = '@container rail (max-width: 240px) {';
    const at = CSS.indexOf(OPEN);
    expect(at, 'no 240px container query in globals.css').toBeGreaterThan(-1);
    const body = CSS.slice(at + OPEN.length, CSS.indexOf('}', at));
    expect(body).toContain('.rail-footer');
  });

  it('lets every label ellipsise rather than widening the rail', () => {
    // `.ds-btn` is `white-space: nowrap`, so at the narrowest right rail two labels
    // plus a 32px square push the row past the rail, and `.rail` is
    // `overflow: hidden` — no scrollbar, no ellipsis, no clue. `flex: 1` sizes the
    // BOX and `minWidth: 0` is what lets it go below its own text; the pair is one
    // mechanism and either half alone does nothing.
    //
    // Three wrappers, not two: the selection slot is Delete for a piece and Done
    // for a wall, written as two branches of one slot because the store makes those
    // two selections mutually exclusive.
    const wrappers = CODE.match(/style=\{\{ flex: 1, minWidth: 0 \}\}/g) ?? [];
    expect(wrappers, 'every labelled button in the row needs the flex/minWidth pair').toHaveLength(3);

    // And the label needs its OWN element or the ellipsis has nowhere to happen: a
    // bare text node beside an icon is an anonymous flex item, which is what
    // `.ds-btn`'s comment in globals.css says no per-site rule can reach.
    expect(rule('.ds-btn')).toContain('white-space: nowrap');
    expect(CODE).toContain('<span style={LABEL}>Delete</span>');
    expect(CODE).toContain('<span style={LABEL}>Done</span>');
    expect(CATCODE).toMatch(/<span style=\{\{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 \}\}>/);
  });

  /** The row's fixed demand against the narrowest rail it can be given.
   *
   *  This is the assertion the labels were shortened FOR, and the reason they read
   *  "Delete" and "Add" rather than "Delete from scene" and "Add a piece": every
   *  term except the text itself is read out of the file that states it, and
   *  whatever is left over is all the two labels get. Put either long label back
   *  and this goes red — which is the only honest form of "they did not fit", since
   *  the version of that claim I could type by hand is a number in a comment.
   *
   *  The per-character figure IS an estimate — 12px `--font-sans` at 700, and
   *  nothing in node can measure a font — so it is named rather than buried, and a
   *  browser is still the real check. What is DERIVED is the half that drifts: the
   *  paddings, the gaps, the icon sizes, the square, and the labels themselves. */
  it('fits its fixed geometry inside the narrowest rail, with room for the labels', () => {
    const footer = rule('.rail-footer');
    const padX = Number(/padding: \d+px (\d+)px/.exec(footer)![1]);
    const gap = Number(/gap: (\d+)px/.exec(footer)![1]);
    // Anchored on the icon name: the trash glyph's own `size={12}` comes first in
    // the file, so a bare /size=\{(\d+)\}/ reads 12 and silently under-counts the
    // widest fixed item in the row by 20px. Anchoring is not enough on its own,
    // either — `[\s\S]*?` crosses comments, so a docblock between the two that
    // mentions any `size={n}` would be read as the square's. Hence CODE.
    const square = Number(/icon="rotate-ccw"[\s\S]*?size=\{(\d+)\}/.exec(CODE)![1]);

    const btn = rule('.ds-btn');
    const btnPadX = Number(/padding: 0 (\d+)px/.exec(btn)![1]);
    const btnGap = Number(/gap: (\d+)px/.exec(btn)![1]);
    const trash = Number(/name="trash" size=\{(\d+)\}/.exec(CODE)![1]);
    const plus = Number(/name=\{open \? 'x' : 'plus'\} size=\{(\d+)\}/.exec(CATCODE)![1]);

    // Two labelled buttons, one 32px square, two gaps between the three, and the
    // footer's own padding at both ends.
    const fixed =
      2 * padX + 2 * gap + square +
      (2 * btnPadX + btnGap + trash) +
      (2 * btnPadX + btnGap + plus);
    const floor = railFloor('rail-right');
    const room = floor - fixed;

    // The longest each label ever renders. Delete is the wider of the two selection
    // branches; Add swaps to "Close" while the panel is open, which is the state
    // you are NOT looking at while the row is at its widest.
    const slot = [...CODE.matchAll(/<span style=\{LABEL\}>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(slot.length, 'the selection slot lost a branch').toBe(2);
    const add = /textOverflow: 'ellipsis'[^>]*>\s*\{open \? '([^']+)' : '([^']+)'\}/.exec(CATCODE)!;
    const chars =
      Math.max(...slot.map((l) => l.length)) + Math.max(add[1].length, add[2].length);

    const PX_PER_CHAR = 7; // estimate: 12px --font-sans at 700
    expect(
      room,
      `the row's fixed parts take ${fixed}px of the ${floor}px rail, leaving ${room}px for ${chars} characters`,
    ).toBeGreaterThanOrEqual(chars * PX_PER_CHAR);
  });

  it('is the ONLY --paper-2 band at the foot of the right rail', () => {
    // Two bands — a panel's own footer and this one — same tone, same `12px 16px`,
    // one under the other: that reads as one footer that had wrapped. The upper one
    // also carried the same 1px `--hairline` three separate reports called a
    // horizontal scrollbar, so deleting it from `.rail-footer` alone moved the
    // defect one element up rather than fixing it. Both the piece panel and the
    // WALL panel had one, and only the piece one was ever reported.
    const insp = codeOnly(readSrc('components', 'studio', 'Inspector.tsx'));
    expect(
      insp,
      'a panel inside the rail must not end with a --paper-2 band of its own',
    ).not.toMatch(/borderTop: '1px solid var\(--hairline\)',\s*padding: '12px 16px'/);
    // The half-finished-move catcher, the same shape as the PartTree one below: the
    // band deleted but the delete path left behind in the panel it moved out of.
    expect(insp, 'Delete belongs to the rail footer now').not.toContain('removeParts');
  });

  it('gives the revert a real target and does not reuse the Re-scan glyph', () => {
    // Once a control loses its words the glyph IS the name, so two different verbs
    // may not share one. `refresh` is Re-scan’s, in the left rail’s Room header,
    // and it is also CATEGORY_ICON.fan.
    expect(CODE).toContain('icon="rotate-ccw"');
    expect(CODE, 'refresh is the Re-scan glyph now').not.toContain('icon="refresh"');
    // IconButton floors at 24px so nothing falls under WCAG 2.5.8. 32 is the app’s
    // icon-target size, and the size LightingPicker’s own rail budget is derived
    // from two describes above.
    expect(SRC).toContain('size={32}');
  });

  it('no longer leaves the Add button in the left rail', () => {
    // The assertion that catches a half-finished move: the footer deleted from
    // PartTree but the trigger still rendered there, so the studio grows a third
    // way into the same panel.
    const tree = readSrc('components', 'studio', 'PartTree.tsx');
    expect(tree, 'PartTree must not reference AddPiecesButton any more').not.toContain(
      'AddPiecesButton',
    );
    const right = readSrc('components', 'studio', 'shells', 'shell-parts.tsx');
    expect(right).toContain('<RailFooter />');
  });
});

describe('the catalog panel clears the cluster it docks beside', () => {
  const SRC = readSrc('components', 'studio', 'CatalogPanel.tsx');
  const CHROME = readSrc('components', 'studio', 'CanvasChrome.tsx');

  it('measures the top-right cluster rather than assuming one height', () => {
    // `CanvasView` wraps — on the 2D tab it is undo/redo AND the whole zoom /
    // rotate / fit toolbar, which folds into two rows on a cramped canvas. The
    // panel used to begin at a flat `top: 54` (12 + a 30px control + 12), which
    // slides it under a folded cluster. Derived now, with a fallback that
    // reproduces the old number for the frame before the ResizeObserver reports.
    expect(SRC).toContain('var(--canvas-view-height');
    expect(SRC, 'a flat top: 54 is the bug this replaced').not.toContain('top: 54,');
    // And the other half: something has to publish it.
    expect(CHROME).toContain("'--canvas-view-height'");
    expect(CHROME).toContain('setProperty(heightProp');
  });

  it('docks on the same side as its triggers', () => {
    // Both triggers are on the right now. Pressing a control on one side to have a
    // list appear on the other is a trip across the whole product.
    expect(SRC).toContain('right: 12,');
    expect(SRC, 'the panel follows its trigger to the right edge').not.toContain('left: 12,');
  });
});

describe('the studio shells', () => {
  const DOCKED = readFileSync(root('components', 'studio', 'shells', 'DockedShell.tsx'), 'utf8');
  const SASH = readFileSync(root('components', 'studio', 'shells', 'RailSash.tsx'), 'utf8');

  it.each([
    ['shells/DockedShell.tsx', DOCKED],
    ['StudioShell.tsx', readFileSync(root('components', 'studio', 'StudioShell.tsx'), 'utf8')],
  ])('%s measures the stacked room in dvh, not vh', (_f, src) => {
    // These rows sit inside a `100dvh` wrapper. `vh` includes the collapsing URL
    // bar, so the row was sized against a taller viewport than its own container.
    expect(src).not.toMatch(/[^d]vh\b/);
  });

  it('is the only shell — the prototype switch is gone, not merely unused', () => {
    // Three shells were compared behind a dev-only `?shell=` flag. Two lost. A
    // flag left behind after its comparison is a second layout nobody measures
    // again, and `shell-variant.ts` forced `'current'` in production, so the two
    // losers were unreachable code that still had to typecheck and be read.
    for (const gone of ['shell-variant.ts', 'shells/ElasticShell.tsx', 'shells/OverlayShell.tsx']) {
      expect(existsSync(root('components', 'studio', ...gone.split('/'))), `${gone} should be deleted`).toBe(false);
    }
    expect(codeOnly(readFileSync(root('components', 'studio', 'StudioShell.tsx'), 'utf8'))).not.toMatch(
      /useShellVariant|\?shell=/,
    );
  });

  it('always offers the sash on a three-column layout', () => {
    // The sash used to be opt-in per variant. It ships now, so the only thing that
    // withholds it is the stacked layout, where a vertical divider between rails
    // stacked BELOW the room would resize nothing.
    expect(DOCKED).not.toMatch(/sashable/);
    expect(DOCKED, 'the sash is gated on layout alone').toMatch(/\{!stacked && \(\s*<RailSash/);
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

describe('the rail asks about itself', () => {
  it('is a query container, unconditionally', () => {
    // This spent one round behind a `.rail--elastic` modifier, because an A/B whose
    // control drifts measures nothing. The comparison is over and this won, so it
    // is on `.rail` itself — and the modifier must not come back, since a rail
    // whose contents cannot ask about the rail is what `--rail-*-tight` and every
    // dragged-narrow width would be lying about.
    expect(rule('.rail')).toMatch(/container-type:\s*inline-size/);
    expect(rule('.rail')).toMatch(/container-name:\s*rail/);
    expect(codeOnly(CSS), 'the prototype modifier should be gone, not merely unselected').not.toMatch(/rail--elastic/);
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
    // The tight tokens are the `compact` step (1024–1279px), not a lower version of
    // the wide widths — a 1920px window has no reason to lose 94px of Inspector.
    // They must be narrower than the ordinary floors, or the step does nothing.
    for (const side of ['left', 'right']) {
      const tight = Number(/^(\d+)px$/.exec(token(`rail-${side}-tight`))![1]);
      const floor = railFloor(`rail-${side}`);
      expect(tight).toBeLessThan(floor);
    }
    // And the TIGHT left one still has to hold the lighting row on one line —
    // the same derivation the ordinary floor answers to above, against the
    // narrower token. This is the assertion `--rail-left-tight` exists for: it is
    // applied to nothing at runtime, and its only consumer is this file holding
    // it below the width its contents need.
    //
    // 208px − 32px of `.section` padding = 176px, and the row needs exactly 176.
    // Zero slack is deliberate and is why this is measured rather than eyeballed.
    const picker = readSrc('components', 'studio', 'LightingPicker.tsx');
    const size = Number(/\n\s+width: (\d+),\n\s+height: \1,/.exec(picker)![1]);
    const gap = Number(/flexWrap: 'wrap', gap: (\d+)/.exec(picker)![1]);
    const needed = LIGHTINGS.length * size + (LIGHTINGS.length - 1) * gap;
    const tightLeft = Number(/^(\d+)px$/.exec(token('rail-left-tight'))![1]);
    expect(tightLeft - 32).toBeGreaterThanOrEqual(needed);
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

describe('a capture card holds its own chrome', () => {
  const SRC = readFileSync(root('app', 'onboarding', 'capture', 'page.tsx'), 'utf8');

  it('sizes its cards from a floor rather than a column count', () => {
    // `repeat(auto-fill, minmax(min(Npx, 100%), 1fr))` — the inner `min` is what
    // stops the floor becoming a floor the container cannot meet, which is the
    // same trick `Segmented`'s wrap mode uses.
    const m = /minmax\(min\((\d+)px, 100%\), 1fr\)/.exec(SRC);
    expect(m, 'the gallery grid should auto-fill from a floor').toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(200);
  });

  it('does not pin a second opaque overlay to the same edge as the first', () => {
    // `photoChrome()` is opaque on purpose — a translucent pill over an unknown
    // photograph cannot promise a contrast ratio — so two of them pinned to
    // opposite ends of one edge do not blend when they meet. They print over each
    // other. Measured at 11px/700: the wall label runs ~159px and the three action
    // chips ~189px, and the narrowest card gives 224px of content. That is 132px
    // of overlap, and the buttons landed on top of the wall name. One wrapping row
    // now holds both, which is what rule 4 asks for: reflow, do not spill.
    expect(SRC.match(/top: 8,\s*\n?\s*right: 8/g) ?? []).toEqual([]);
  });

  it('pairs space-between with wrap everywhere it uses it', () => {
    // `space-between` alone is a squeeze instruction: it distributes slack, and
    // when there is none it lets the items overlap rather than moving one down.
    const hits = [...SRC.matchAll(/justifyContent: 'space-between'/g)];
    expect(hits.length).toBeGreaterThan(0);
    for (const m of hits) {
      const around = SRC.slice(Math.max(0, m.index - 240), m.index + 240);
      expect(around, `space-between at index ${m.index} has no flexWrap near it`).toContain(
        "flexWrap: 'wrap'",
      );
    }
  });
});

describe('a piece row keeps enough width to read the piece name', () => {
  it('leaves the name a legible share of the narrowest shipping rail', () => {
    // The silent cost of a row action. `.row-action` is `opacity: 0`, NOT
    // `display: none`, so every button in a row holds its width whether it is
    // visible or not — and each new one costs its own 24px *plus* a 8px flex gap.
    // The name is the flex child with `minWidth: 0`, so it absorbs the whole cost
    // by ellipsising: no overflow, no error, no failing test. Just shorter names.
    //
    // Adding the Lock button took the name from 90px to 58px at `--rail-left-min`.
    // That is recorded here as arithmetic rather than as a comment, because the
    // next button is the one that makes a name unreadable and nothing else in the
    // suite would notice.
    const row = rule('.list-row');
    const gap = Number(/gap:\s*(\d+)px/.exec(row)![1]);
    const padX = Number(/padding:\s*\d+px (\d+)px/.exec(row)![1]);

    // `codeOnly`, for the reason its own comment gives — and this assertion is the
    // third to need it. The row's JSX comment quotes the `<IconButton/>` shape it
    // replaced, so counting buttons in the raw source found four where there are
    // three, and the count read as a real measurement.
    const tree = codeOnly(readSrc('components', 'studio', 'PartTree.tsx'));
    // The row renderer ONLY. `PartTree.tsx` holds several components and seven
    // `IconButton`s between them; slicing to end-of-file counted all seven and
    // reported a name width of −70px, which is how this bound came to be measured
    // rather than assumed.
    const from = tree.indexOf('function PartRow(');
    expect(from, 'PartRow is not declared in PartTree.tsx').toBeGreaterThan(-1);
    const next = tree.indexOf('\nfunction ', from + 1);
    const partRow = tree.slice(from, next === -1 ? undefined : next);
    const buttons = [...partRow.matchAll(/<IconButton\b/g)].length;
    const glyph = Number(/justifyContent: 'center', width: (\d+), flexShrink: 0/.exec(partRow)![1]);

    // 32px of `.section` padding, the same figure the rail assertions above use.
    const content = railFloor('rail-left') - 32;
    const children = buttons + 2; // status glyph + name + the actions
    const nameWidth = content - padX * 2 - gap * (children - 1) - glyph - buttons * 24;

    // ~8 characters of 13px Nunito. Chosen, not derived — a derived floor would
    // move with the thing it is supposed to constrain and could never go red.
    expect(
      nameWidth,
      `a piece name gets ${nameWidth}px at --rail-left-min with ${buttons} row actions`,
    ).toBeGreaterThanOrEqual(56);
  });
});
