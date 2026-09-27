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

  it('keeps --edge as the boundary of the chrome on glass', () => {
    const chrome = all.find(([sel]) => sel.startsWith('.split--glass #studio-canvas .canvas-chrome'));
    expect(chrome![1]).toMatch(/border-color:\s*var\(--edge\)/);
  });

  it('puts the sash in the middle of the gap between two panes', () => {
    expect(CSS).toMatch(/\.split--glass \.rail-sash--left \{ right: calc\(-5px - var\(--pane-gap\) \/ 2\); \}/);
    expect(CSS).toMatch(/\.split--glass \.rail-sash--right \{ left: calc\(-5px - var\(--pane-gap\) \/ 2\); \}/);
  });
});

describe('a row of number fields fits its longest number', () => {
  it('sizes from the longest value, in mono characters plus the field chrome', () => {
    expect(fieldMinWidth(['6.00', '5.00', '2.60'])).toBe('calc(4 * 0.6 * var(--fs-body) + 30px)');
    expect(fieldMinWidth(['12.5', '600.0', '2'])).toBe('calc(5 * 0.6 * var(--fs-body) + 30px)');
    // An empty field still has a caret to show.
    expect(fieldMinWidth(['', '', ''])).toBe('calc(1 * 0.6 * var(--fs-body) + 30px)');
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

describe("the plan's zoom bar folds as two groups", () => {
  const plan = src('components/studio/PlanChrome.tsx');
  const bar = plan.slice(plan.indexOf('export function PlanViewControls'), plan.indexOf('export function ComfortLegend'));

  it('zoom, then turn + fit, and no rule between them to strand', () => {
    expect(bar.match(/className="toolbar plan-view-bar__group"/g)).toHaveLength(2);
    // The outer bar is not a toolbar: a wrapped row keeps its full width, and a
    // surface drawn around it would show that width as an empty strip.
    expect(bar).toMatch(/className="plan-view-bar" role="group"/);
    expect(bar).not.toMatch(/background: 'var\(--hairline\)'/);
    const second = bar.slice(bar.lastIndexOf('plan-view-bar__group'));
    expect(second).toMatch(/rotate-ccw/);
    expect(second).toMatch(/Fit/);
    expect(second).not.toMatch(/Zoom in/);
  });

  it('keeps each group on one line while the bar wraps', () => {
    expect(CSS).toMatch(/\.plan-view-bar \{[^}]*flex-wrap: wrap;/);
    // `.toolbar` is `inline-flex` and does not wrap; nothing here may make it.
    expect(CSS).not.toMatch(/\.plan-view-bar__group \{[^}]*flex-wrap: wrap/);
  });
});
