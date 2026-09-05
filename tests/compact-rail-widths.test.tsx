// @vitest-environment jsdom
//
// The `compact` step, rendered — the middle of `useStudioLayout`'s three layouts, and
// until now the one no test in this repository could reach.
//
// `tests/helpers/setup.ts` answers `matchMedia` with `matches: false` for every query, so
// every component test ever run here rendered the WIDE shell. `stackedViewport()` opened
// the other end by answering `true` to every `max-width` query — which pins both of
// `useStudioLayout`'s queries to true and therefore pins the layout to `stacked`. Two
// blanket answers reach two of three steps; the middle one was unreachable by
// construction, in the helper written to make branches reachable. `viewportAt(px)` parses
// the width out of the query instead, and that is what this file stands on.
//
// **What is actually different about `compact`, derived rather than assumed:** exactly one
// thing, `DockedShell`'s `--sash-left` / `--sash-right`, which resolve to
// `var(--rail-*-tight)` between 1024 and 1279px and to `var(--rail-*)` above. Nothing else
// in the app branches on it — `StudioHelp`'s "Catalog, in the left rail" asks
// `layout === 'stacked'`, and `compact` takes the same answer as `wide` there, correctly.
//
// **Why this is not a duplicate of `tests/reflow.test.ts`.** That file asserts the tight
// tokens are sane — narrower than the ordinary floors, wide enough for the lighting row,
// reachable by the container queries — and it does all of it by reading source text and
// `globals.css`. It never renders anything, so it cannot see the template string that
// chooses between the two tokens. Deleting the `layout === 'compact'` arm of `railWidth`
// leaves every assertion in that file green: the tokens are still declared, still sane,
// still unreferenced by any literal a grep can find. This is the test that goes red.
//
// **Two mutants survive this file on purpose, named rather than tuned away.** Moving
// `STACK_WIDTH` to 1024 or `COMPACT_WIDTH` to 1278 leaves all four tests green, because
// the widths below are DERIVED from those constants and travel with them. That is the
// trade this file chose: a hard-coded 1100 would kill both mutants and would, the next
// time a breakpoint moved, quietly measure `wide` under a name that says `compact` — a
// green that means nothing beats a red that means the wrong thing. What the constants'
// VALUES answer to is `tests/reflow.test.ts`, which derives the container-query ceiling
// from `COMPACT_WIDTH` and the rail's own token arithmetic.
//
// **What it cannot see.** jsdom has no layout and no cascade, so `var(--rail-left-tight)`
// here is a string this shell asked for, not a width anything resolved. That the tight
// rail's contents actually FIT at 208px is `reflow.test.ts`'s arithmetic and, past that, a
// browser's job — see `docs/visual-check.md`. Nothing below observes a pixel.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { viewportAt } from './helpers/mount';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('compact-rails-room'));

const { StudioShell } = await import('@/components/studio/StudioShell');
const { NarrowViewportBanner } = await import('@/components/studio/NarrowViewportBanner');

// The two thresholds, read out of the module that owns them rather than typed here.
// `STACK_WIDTH` and `COMPACT_WIDTH` are module-private, and `tests/reflow.test.ts` already
// reaches them this way for the same reason: a hard-coded 1100 in this file would be a
// second source of truth for where the step is, and moving the breakpoint would leave this
// measuring `wide` under a name that says `compact`.
const BANNER = readFileSync(
  join(process.cwd(), 'components', 'studio', 'NarrowViewportBanner.tsx'),
  'utf8',
);
const threshold = (name: string) => {
  const m = new RegExp(`${name} = (\\d+)`).exec(BANNER);
  expect(m, `${name} is no longer declared in NarrowViewportBanner.tsx`).not.toBeNull();
  return Number(m![1]);
};
const STACK_MAX = threshold('STACK_WIDTH');
const COMPACT_MAX = threshold('COMPACT_WIDTH');

/** The middle of the compact band, and one past its top. Derived, so both move with the
 *  constants; asserted below, because a regex that matched the wrong line would otherwise
 *  send every test here to a step it was not named for. */
const COMPACT_PX = Math.round((STACK_MAX + 1 + COMPACT_MAX) / 2);
const WIDE_PX = COMPACT_MAX + 1;

let restore: (() => void) | null = null;
const railLeftW = useStudio.getState().railLeftW;
const railRightW = useStudio.getState().railRightW;

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
  useStudio.setState({ railLeftW, railRightW });
});

/** Mount the real shell at a given viewport width and hand back the grid that carries the
 *  sash variables. Through `StudioShell` rather than `DockedShell` directly, because
 *  `DockedShell` takes `layout` as a PROP — handing it one would skip `useStudioLayout`
 *  entirely and gate the renderer while leaving the decision untested, which is the
 *  "gate the caller, not just the function" shape. */
function shellAt(px: number): HTMLElement {
  restore = viewportAt(px);
  const { container } = render(
    <StudioShell loadingLabel="Building the room">
      <div data-testid="surface" />
    </StudioShell>,
  );
  const split = container.querySelector('.split');
  expect(split, `no .split at ${px}px — the shell never got past its own \`ready\` gate`).not.toBeNull();
  return split as HTMLElement;
}

const sash = (el: HTMLElement, side: 'left' | 'right') =>
  el.style.getPropertyValue(`--sash-${side}`).trim();

describe('the compact step, at a width that is actually in it', () => {
  it('is a real band, wider than stacked and no wider than compact', () => {
    // The premise every assertion below rests on. Without it a mis-parse — the wrong
    // constant, a renamed one, a regex that caught a comment — would still produce two
    // numbers and this file would measure the same step twice under two names.
    expect(STACK_MAX).toBeLessThan(COMPACT_MAX);
    expect(COMPACT_PX).toBeGreaterThan(STACK_MAX);
    expect(COMPACT_PX).toBeLessThanOrEqual(COMPACT_MAX);
    expect(WIDE_PX).toBeGreaterThan(COMPACT_MAX);
  });

  it('hands the rails their tight tokens across the whole band, and stops at both ends', () => {
    // BOTH ENDS, not a comfortable width in the middle. A step 256px wide is invisible to
    // an off-by-one anywhere near its edges — `<=` for `>` in the shim's width comparison,
    // `<` for `<=` in a threshold — and the midpoint is exactly where such a mutation
    // survives. The two ends and the two pixels outside them are four different answers
    // from one derivation, so nothing here can be satisfied by measuring one step twice.
    for (const px of [STACK_MAX + 1, COMPACT_MAX]) {
      const compact = shellAt(px);
      expect(sash(compact, 'left'), `at ${px}px`).toBe('var(--rail-left-tight)');
      expect(sash(compact, 'right'), `at ${px}px`).toBe('var(--rail-right-tight)');
      cleanup();
      restore?.();
    }

    const wide = shellAt(WIDE_PX);
    expect(sash(wide, 'left'), `at ${WIDE_PX}px`).toBe('var(--rail-left)');
    expect(sash(wide, 'right'), `at ${WIDE_PX}px`).toBe('var(--rail-right)');
    cleanup();
    restore?.();

    // And one pixel below the band there are no sash variables at all, because a stacked
    // shell is one column and has no rail widths to hand out. This is the assertion that
    // makes the two above mean `compact` specifically: without it, a shim that answered
    // `stacked` for every width would still have to be caught by the absence of a token
    // rather than by the presence of the wrong one.
    const stacked = shellAt(STACK_MAX);
    expect(sash(stacked, 'left'), `at ${STACK_MAX}px`).toBe('');
    expect(sash(stacked, 'right'), `at ${STACK_MAX}px`).toBe('');
  });

  it('and a dragged rail keeps the width it was dragged to, because a preference outranks a step', () => {
    // The third arm of `railWidth`, and the one a reader is most likely to assume away:
    // the compact step frees ~94px by narrowing the rails, so it looks like something that
    // should win. It does not — a width the user dragged is a decision, and the step is a
    // default. Untested until now, and silent either way.
    useStudio.setState({ railLeftW: 300 });
    const compact = shellAt(COMPACT_PX);
    expect(sash(compact, 'left')).toBe('clamp(var(--rail-left-min), 300px, var(--rail-max))');

    // The asymmetry is the control. Asserting only the dragged rail would pass just as well
    // if the compact step had stopped firing altogether, since `var(--rail-left)` is not
    // what was checked; the UNdragged rail in the SAME render still taking its tight token
    // is what says the step is alive and lost on purpose.
    expect(sash(compact, 'right')).toBe('var(--rail-right-tight)');
  });

  it('is not a touch device, which is a different question the same shim could get wrong', () => {
    // `viewportAt` answers `false` to any query with no width feature in it, so that
    // simulating a narrow viewport does not quietly also simulate a coarse pointer. That
    // guard is one `return seen` and nothing above could see it: mutating it to `return
    // true` left all three tests green, because none of them mounts anything that asks a
    // non-width question. `NarrowViewportBanner` asks two — `(hover: none) and (pointer:
    // coarse)` and the 400px floor — and answering the first one `true` puts a modal
    // saying the studio will not lay out over a 1151px window that lays out fine.
    restore = viewportAt(COMPACT_PX);
    render(<NarrowViewportBanner />);
    expect(screen.queryByRole('dialog'), `the studio gate is up at ${COMPACT_PX}px`).toBeNull();
  });
});
