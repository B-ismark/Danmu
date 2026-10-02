// @vitest-environment jsdom
//
// The laptop studio's Glasshouse skin (8b), and the two reflows it made visible.
//
// What a stylesheet test can hold here is the set of decisions, not the look: that the
// docked shell is the one wearing it, that no rail takes a `backdrop-filter` (which
// would make the rail the containing block for the four `position: fixed` things
// inside it — see the note in `globals.css`), that the wash can never be darker than a
// paper token every text colour already clears, and that someone who asked for less
// transparency gets solid panes. Whether it LOOKS like glass is `docs/visual-check.md`.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { fieldMinWidth } from '@/components/ui/NumberField';
import { viewportAt } from './helpers/mount';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('glass-skin-room'));

const { StudioShell } = await import('@/components/studio/StudioShell');

const CSS = readFileSync('app/globals.css', 'utf8');
const src = (f: string) => readFileSync(f, 'utf8');

/** Every top-level-or-nested rule as [selector, body], comments stripped. Rough, and
 *  enough: this stylesheet has no nested braces inside a declaration. */
function rules(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) out.push([m[1].trim(), m[2]]);
  return out;
}

let restore: (() => void) | null = null;
afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
});

describe('the docked shell wears the glass, and only the docked shell', () => {
  it.each([1100, 1440])('at %ipx the split is a glass split', (px) => {
    restore = viewportAt(px);
    const { container } = render(
      <StudioShell loadingLabel="Building the room">
        <main id="studio-canvas" />
      </StudioShell>,
    );
    const split = container.querySelector('.split');
    expect(split, `no .split at ${px}px`).not.toBeNull();
    expect(split!.classList.contains('split--glass')).toBe(true);
  });

  it('a tablet and a phone have no docked split to skin', () => {
    for (const px of [800, 390]) {
      restore = viewportAt(px, { touch: true });
      const { container } = render(
        <StudioShell loadingLabel="Building the room">
          <main id="studio-canvas" />
        </StudioShell>,
      );
      expect(container.querySelector('.split--glass'), `at ${px}px`).toBeNull();
      cleanup();
      restore();
      restore = null;
    }
  });
});

describe('the glass rules', () => {
  const all = rules(CSS);

  it('never puts a backdrop-filter on a rail or anything that holds one', () => {
    const offenders = all.filter(
      ([sel, body]) => /backdrop-filter:\s*(?!none)/.test(body) && /\.rail\b|\.split--glass\s*>|\.split--glass\s*\{|^\.split--glass$/.test(sel),
    );
    expect(offenders.map(([s]) => s)).toEqual([]);
  });

  it('does blur the chrome that floats over the room', () => {
    const chrome = all.find(([sel]) => sel.startsWith('.split--glass #studio-canvas .canvas-chrome'));
    expect(chrome, 'no glass rule for the canvas chrome').toBeDefined();
    expect(chrome![1]).toMatch(/backdrop-filter:\s*var\(--glass-blur\)/);
  });

  it('builds the wash from paper tokens only, so no pane sits on anything darker than --paper-3', () => {
    const wash = /--studio-wash:\s*([^;]+);/.exec(CSS);
    expect(wash).not.toBeNull();
    const stops = wash![1].match(/var\(--[a-z0-9-]+\)/g) ?? [];
    expect(stops.length).toBeGreaterThanOrEqual(2);
    for (const stop of stops) expect(stop).toMatch(/^var\(--paper(-2|-3)?\)$/);
    // And no colour typed into it beside the tokens.
    expect(wash![1]).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('keeps the panes solid for someone who asked for less transparency', () => {
    const at = CSS.indexOf('@media (prefers-reduced-transparency: reduce)');
    expect(at).toBeGreaterThan(-1);
    const block = CSS.slice(at, CSS.indexOf('\n}\n', at));
    expect(block).toMatch(/\.split--glass > \.rail \{ background: var\(--paper\); \}/);
    expect(block).toMatch(/backdrop-filter: none;/);
  });

  it('keeps --edge on a standalone control on glass, and a container rim on a pill', () => {
    const edge = all.find(([sel, body]) => sel.startsWith('.split--glass #studio-canvas .canvas-chrome') && /border-color:\s*var\(--edge\)/.test(body));
    expect(edge, 'no --edge rule for the chrome on glass').toBeDefined();
    expect(edge![0]).toMatch(/\.toolbar/);
    expect(edge![0]).toMatch(/\.ds-btn/);
    // A pill is a container, not a control: it must not be handed a control's edge.
    expect(edge![0]).not.toMatch(/chrome-pill|gizmo|chrome-legend/);
  });

  it('puts the sash in the middle of the gap between two panes', () => {
    expect(CSS).toMatch(/\.split--glass \.rail-sash--left \{ right: calc\(-5px - var\(--pane-gap\) \/ 2\); \}/);
    expect(CSS).toMatch(/\.split--glass \.rail-sash--right \{ left: calc\(-5px - var\(--pane-gap\) \/ 2\); \}/);
  });
});

describe('a row of number fields fits its longest number', () => {
  it('sizes from the longest value, in mono characters plus the field chrome', () => {
    expect(fieldMinWidth(['6.00', '5.00', '2.60'])).toBe('calc(4 * 0.6 * var(--field-fs) + 30px)');
    expect(fieldMinWidth(['12.5', '600.0', '2'])).toBe('calc(5 * 0.6 * var(--field-fs) + 30px)');
    // An empty field still has a caret to show.
    expect(fieldMinWidth(['', '', ''])).toBe('calc(1 * 0.6 * var(--field-fs) + 30px)');
  });

  it('agrees with the padding NumberField actually draws', () => {
    // 8px left, 20px right for the stepper, two 1px borders: 30.
    const nf = src('components/ui/NumberField.tsx');
    expect(nf).toMatch(/const PAD_LEFT = 8;/);
    expect(nf).toMatch(/const PAD_RIGHT = 20;/);
    expect(nf).toMatch(/padding: `0 \$\{PAD_RIGHT\}px 0 \$\{PAD_LEFT\}px`/);
  });

  it.each(['components/studio/RoomDimsEditor.tsx', 'components/studio/Inspector.tsx'])(
    '%s lays its size fields out in a reflowing row',
    (file) => {
      const s = src(file);
      expect(s).toMatch(/className="fields-row" style=\{\{ \['--field-min' as string\]: fieldMinWidth\(local\)/);
      expect(s).not.toMatch(/gridTemplateColumns: 'repeat\(3, 1fr\)'/);
    },
  );

  it('the row reflows at the width its fields need', () => {
    expect(CSS).toMatch(/\.fields-row \{[^}]*repeat\(auto-fit, minmax\(min\(var\(--field-min, 64px\), 100%\), 1fr\)\)/);
  });
});

describe("the plan's zoom bar is two pills", () => {
  const plan = src('components/studio/PlanChrome.tsx');
  const bar = plan.slice(plan.indexOf('export function PlanViewControls'), plan.indexOf('export function ComfortLegend'));

  it('zoom, then turn + fit, each its own labelled pill with no wrapper around both', () => {
    expect(bar.match(/<div className="chrome-pill" role="group" aria-label="[^"]+"/g)).toHaveLength(2);
    // A wrapper made both pills ONE flex item, so on a cramped canvas the pair dropped
    // below undo/redo as a block and folded again inside it: three rows, not two.
    expect(bar).toMatch(/return \([\s\S]*?<>\s*<div className="chrome-pill"/);
    expect(bar).not.toMatch(/plan-view-bar/);
    const second = bar.slice(bar.lastIndexOf('className="chrome-pill"'));
    expect(second).toMatch(/rotate-ccw/);
    expect(second).toMatch(/Fit/);
    expect(second).not.toMatch(/Zoom in/);
    // The one rule sits INSIDE a pill, beside Fit, so nothing can strand it.
    expect(bar.match(/chrome-pill__rule/g)).toHaveLength(1);
    expect(second).toMatch(/chrome-pill__rule/);
  });

  it('quiet buttons inside the capsule: no outlined control inside a rimmed one', () => {
    expect(bar).not.toMatch(/variant="outline"/);
    expect(bar).not.toMatch(/className="ds-btn/);
  });

  it('holds the readouts to a width, so + and − do not shift as a digit arrives', () => {
    expect(bar).toMatch(/chrome-pill__readout chrome-pill__readout--zoom/);
    expect(bar).toMatch(/chrome-pill__readout chrome-pill__readout--deg/);
    expect(CSS).toMatch(/\.chrome-pill__readout \{[^}]*font-variant-numeric: tabular-nums;/);
    expect(CSS).toMatch(/\.chrome-pill__readout--zoom \{ min-width: 9ch; \}/);
    expect(CSS).toMatch(/\.chrome-pill__readout--deg \{ min-width: 4ch; \}/);
  });
});

describe('everything floating over the room is one pill family', () => {
  it.each([
    ['components/studio/UndoRedo.tsx', /<div className="chrome-pill" role="group" aria-label="Edit history">/],
    ['components/studio/TransformToolbar.tsx', /<div className="chrome-pill chrome-seg" role="group"/],
    ['components/studio/CatalogPanel.tsx', /<div className="chrome-pill">\s*<button[\s\S]*?className="chrome-pill__text"/],
    ['app/room/[roomId]/plan/page.tsx', /<div className="chrome-pill">\s*<button[\s\S]*?className="chrome-pill__text"/],
  ])('%s', (file, re) => {
    expect(src(file)).toMatch(re);
  });

  it('the pill is a rimmed capsule that holds its width, and the mode strip alone may shrink', () => {
    const pill = ruleBody(/^\.chrome-pill$/);
    expect(pill).toMatch(/border-radius: var\(--r-full\);/);
    expect(pill).toMatch(/border: 1px solid var\(--hairline-strong\);/);
    expect(pill).toMatch(/flex-shrink: 0;/);
    const seg = ruleBody(/^\.chrome-seg$/);
    expect(seg).toMatch(/flex-shrink: 1;/);
    expect(seg).toMatch(/min-width: 0;/);
    expect(seg).toMatch(/overflow: hidden;/);
  });

  it('a chosen mode is a dark capsule, and no rule divides the modes', () => {
    expect(ruleBody(/^\.chrome-seg__btn\[aria-pressed="true"\]$/)).toMatch(/background: var\(--ink\); color: var\(--on-ink\);/);
    expect(src('components/studio/TransformToolbar.tsx')).not.toMatch(/borderLeft/);
  });

  it('a word button is level with its icon neighbours, and thumb-height on a phone', () => {
    // The base rule; the phone's lives in its own media block, below.
    expect(CSS).toMatch(/\n\.chrome-pill__text \{[^}]*height: 30px;/);
    expect(CSS).toMatch(/@media \(max-width: 599px\) \{ \.chrome-pill__text \{ height: 40px; \} \}/);
  });

  it('keeps a focus ring inside a clipping pill', () => {
    expect(ruleBody(/^\.chrome-seg__btn:focus-visible$/)).toMatch(/outline-offset: -2px;/);
  });

  it('frosts the pills, the gizmo and the legend over the room on a laptop', () => {
    const chrome = rules(CSS).find(([sel]) => sel.startsWith('.split--glass #studio-canvas .canvas-chrome :is(') && /backdrop-filter/.test(rules(CSS).find(([s2]) => s2 === sel)![1]));
    for (const cls of ['.chrome-pill', '.chrome-legend', '.gizmo']) expect(chrome![0]).toContain(cls);
  });
});

/** The body of the one rule whose selector matches, exactly. */
function ruleBody(sel: RegExp): string {
  const hit = rules(CSS).filter(([s]) => sel.test(s));
  expect(hit, `rules matching ${sel}`).toHaveLength(1);
  return hit[0][1];
}
