// @vitest-environment jsdom
//
// What a sash GESTURE leaves behind — the store write and the two custom properties the
// studio grid reads as its columns. `tests/compact-rail-widths.test.tsx` renders the same
// shell and asserts which token each rail is handed; nothing anywhere asked what happens
// after somebody presses the divider.
//
// Three defects lived in that gap and all three are silent:
//
//  · a press-and-release on a CLOSED sash committed the width it opened to, which is the
//    rendered token — 208px at the compact step — and `DockedShell` then renders a stored
//    number as `clamp(var(--rail-left-min), 208px, …)` = 228px. The rail jumped 20px wider
//    on a gesture that moved nothing, and `railLeftW` became a number for good, so the
//    compact step never applied to that rail again and the value persisted;
//  · `removeProperty('--sash-left')` followed by `setRailWidth(side, null)` on a rail whose
//    width was ALREADY null: React writes a style key only when the value it last rendered
//    differs, so it never restored a property it did not know had been removed. The
//    variable is declared nowhere else, so the next open resolved
//    `grid-template-columns: var(--sash-left) 1fr …` against nothing — invalid at
//    computed-value time, which is `none`, which stacks the rails and the canvas one per
//    row. Double-click reset took the same path;
//  · the first move of an opening gesture re-seeded from `measure()` behind `if (m)`, which
//    passes for the CLOSED rail's 37px and seeds a width below the rail's own floor.
//
// **What this file cannot see, and it is most of the pixels.** jsdom has no layout, so
// `getBoundingClientRect()` is all zeros and `getComputedStyle` resolves no `var()`. Every
// measurement here is 0, which is exactly why the assertions below read the STORE and the
// property STRING rather than a width. The 208 → 228 arithmetic is `docs/visual-check.md`'s
// and a browser's; that a no-move release stores nothing at all is this file's.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { viewportAt } from './helpers/mount';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('sash-gestures-room'));

const { StudioShell } = await import('@/components/studio/StudioShell');

// Pointer capture, which jsdom does not implement and `RailSash` calls unguarded on every
// press. It stays here rather than in `tests/helpers/setup.ts` because this is the only
// file that needs it, which is the rule that file states about itself.
beforeEach(() => {
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
});

/** Well inside the compact band, so the token a rail is handed is the tight one — the
 *  width the no-move release used to store. Not derived from `NarrowViewportBanner`'s
 *  constants the way `compact-rail-widths.test.tsx` derives its own, because nothing here
 *  asserts WHICH token: these tests ask whether a gesture wrote anything, and they hold at
 *  any width in any of the three layouts that has a sash at all. */
const WIDE_PX = 1400;

const OPEN = { railLeftOpen: true, railRightOpen: true, railLeftW: null, railRightW: null };

let restore: (() => void) | null = null;
const before = {
  railLeftW: useStudio.getState().railLeftW,
  railRightW: useStudio.getState().railRightW,
  railLeftOpen: useStudio.getState().railLeftOpen,
  railRightOpen: useStudio.getState().railRightOpen,
};

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
  useStudio.setState(before);
});

function mount(px = WIDE_PX): HTMLElement {
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

const sashEl = (side: 'left' | 'right') => screen.getByLabelText(`Resize the ${side} panel`);
const sashVar = (el: HTMLElement, side: 'left' | 'right') => el.style.getPropertyValue(`--sash-${side}`).trim();

/** One press, one release, at the same x. `pointerId` is carried because `RailSash`
 *  releases capture with it. */
function pressAndRelease(el: HTMLElement, x = 400) {
  fireEvent.pointerDown(el, { button: 0, clientX: x, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: x, pointerId: 1 });
}

describe('a press that moves nothing writes nothing', () => {
  it('opening a closed rail by its sash stores NO width', () => {
    useStudio.setState({ ...OPEN, railLeftOpen: false });
    mount();

    pressAndRelease(sashEl('left'));

    // The store, not a pixel. On the broken build `measure()` answered with the rendered
    // width and this was that number — 0 here, because jsdom has no layout, and 208 in a
    // browser at the compact step. Either way it is a number where `null` is the only
    // honest answer: the rail is at its token default and no drag has happened.
    expect(useStudio.getState().railLeftW, 'a gesture that moved nothing stored a width').toBeNull();
    // And it really did open, so the assertion above is not passing because the press was
    // ignored altogether.
    expect(useStudio.getState().railLeftOpen).toBe(true);
  });

  it('and the same press on the RIGHT rail, which has its own token and its own floor', () => {
    // Both sides, because `RailSash` is one component parameterised by `side` and every
    // width, floor and property name in it is a lookup keyed on that parameter. A fix
    // applied to one branch of such a table is the repo's own recurring defect.
    useStudio.setState({ ...OPEN, railRightOpen: false });
    mount();

    pressAndRelease(sashEl('right'));

    expect(useStudio.getState().railRightW).toBeNull();
    expect(useStudio.getState().railRightOpen).toBe(true);
  });

  it('but a real drag on an open rail DOES store one', () => {
    // The control, and without it every assertion above is satisfied by a `setRailWidth`
    // that is never called — which is a different app, not a fix.
    useStudio.setState(OPEN);
    mount();

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 460, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 460, pointerId: 1 });

    expect(useStudio.getState().railLeftW, 'a real drag stored nothing').not.toBeNull();
  });
});

describe('the grid never loses the variable it reads its columns from', () => {
  it('a double-click on a rail that was never dragged leaves --sash-left standing', () => {
    // The one-gesture form of the property loss, and it needs no drag and no collapse: on
    // a fresh profile `railLeftW` is already null, so the old `reset()` removed the
    // property and then wrote a null over a null, which React saw as no change.
    useStudio.setState(OPEN);
    const shell = mount();
    const beforeReset = sashVar(shell, 'left');
    expect(beforeReset, 'the shell never carried --sash-left to begin with').not.toBe('');

    fireEvent.doubleClick(sashEl('left'));

    expect(sashVar(shell, 'left'), 'reset() removed --sash-left and nothing put it back').toBe(beforeReset);
  });

  it('and so does grabbing a closed sash open and pushing it shut again', () => {
    // The other door to the same state: the collapse branch removes the property, and
    // `toggleRail` has just guaranteed the stored width is null, so the write that was
    // supposed to restore it changes nothing.
    useStudio.setState({ ...OPEN, railLeftOpen: false });
    const shell = mount();

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    // Two moves: the first promotes the opening gesture to a sizing one, the second is the
    // push back past the floor that arms the collapse.
    fireEvent.pointerMove(el, { clientX: 399, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 400 - 500, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 400 - 500, pointerId: 1 });

    expect(useStudio.getState().railLeftOpen, 'the push-past-the-floor did not close it').toBe(false);

    // Reopen the way a user would, through the chevron rather than by writing state.
    fireEvent.click(screen.getByRole('button', { name: /show the left panel/i }));

    expect(useStudio.getState().railLeftOpen).toBe(true);
    expect(sashVar(shell, 'left'), 'the shell reopened with no --sash-left, so its grid has no columns').not.toBe('');
  });
});

describe('opening a rail hands it back to its token', () => {
  it('clears a dragged width, so a reopen is the design and not the last drag', () => {
    // The third agent's own change to `toggleRail`, which nothing pinned. It is the
    // reason the two defects above became reachable rather than rare, so it is asserted
    // here beside them rather than left as a property somebody has to infer from a diff.
    useStudio.setState({ ...OPEN, railLeftW: 460 });
    useStudio.getState().toggleRail('left'); // closes
    expect(useStudio.getState().railLeftW, 'closing threw the width away').toBe(460);
    useStudio.getState().toggleRail('left'); // opens
    expect(useStudio.getState().railLeftW).toBeNull();
  });

  it('and leaves the OTHER rail alone', () => {
    // One `set` writing two keys is how a rail loses a width nobody touched.
    useStudio.setState({ ...OPEN, railLeftOpen: false, railLeftW: null, railRightW: 500 });
    useStudio.getState().toggleRail('left');
    expect(useStudio.getState().railRightW).toBe(500);
  });
});
