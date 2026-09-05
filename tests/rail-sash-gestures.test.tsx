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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

/** jsdom resolves no `var()` and lays nothing out, so every width and every token a
 *  sash reads is 0. Three of the assertions below are about the RELATIONSHIP between
 *  two of those numbers — the rail's measured width against `--rail-closed` — and at
 *  0 against 0 that relationship is not expressible. This installs the numbers a real
 *  browser has, so the test is measuring the guard rather than a pair of zeroes.
 *
 *  The tokens are the app's own values. `--rail-left-tight` (208) sitting BELOW
 *  `--rail-left-min` (228) is not a mistake in the fixture: it is the compact step,
 *  and it is the reason the guard cannot be written against the floor. */
function stubLayout({ railPx }: { railPx: number }): () => void {
  const realCS = window.getComputedStyle.bind(window);
  const realRect = Element.prototype.getBoundingClientRect;
  const TOKENS: Record<string, string> = {
    '--rail-closed': '37px',
    '--rail-left-min': '228px',
    '--rail-right-min': '276px',
    '--rail-left-tight': '208px',
    '--rail-right-tight': '248px',
    '--rail-max-share': '0.4',
  };
  window.getComputedStyle = ((el: Element, pe?: string | null) => {
    const cs = realCS(el, pe ?? undefined);
    return new Proxy(cs, {
      get(t, k) {
        if (k !== 'getPropertyValue') return Reflect.get(t, k);
        return (name: string) => TOKENS[name] ?? t.getPropertyValue(name);
      },
    });
  }) as typeof window.getComputedStyle;
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const w = this.classList?.contains('rail') ? railPx : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: 0, width: w, height: 0, toJSON: () => ({}) } as DOMRect;
  };
  return () => {
    window.getComputedStyle = realCS as typeof window.getComputedStyle;
    Element.prototype.getBoundingClientRect = realRect;
  };
}

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

  it('and a CLICK on an already-open sash stores none either', () => {
    // The sibling of the closed case, and it was found in a browser rather than
    // reasoned: `dblclick` fires two press/release pairs before `onDoubleClick`, and
    // the probe measured the rail at 228px where it expected 208 — the two clicks had
    // each committed the RENDERED width (208 at the compact step), which `DockedShell`
    // then renders as `clamp(var(--rail-left-min), 208px, …)` = 228px. Same 20px jump
    // and the same permanent loss of the compact step as the closed-rail release, one
    // door over.
    useStudio.setState(OPEN);
    mount();
    const undo = stubLayout({ railPx: 208 });

    pressAndRelease(sashEl('left'));
    undo();

    expect(useStudio.getState().railLeftW, 'a click on the divider stored a width').toBeNull();
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

  it('and a drag on the RIGHT sash stores the RIGHT width, not the left one', () => {
    // The side control. Everything in `RailSash` is a lookup keyed on `side` —
    // `WIDTH_PROP`, `FLOOR_TOKEN`, the sign of the delta, the store setter — and the
    // test above drags the left rail, so a hard-coded `'left'` in the release is
    // invisible to it. Both stores are read, because writing BOTH would also pass an
    // assertion that only looked at the right one.
    useStudio.setState(OPEN);
    mount();

    const el = sashEl('right');
    fireEvent.pointerDown(el, { button: 0, clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 840, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 840, pointerId: 1 });

    expect(useStudio.getState().railRightW, 'the right drag stored nothing').not.toBeNull();
    expect(useStudio.getState().railLeftW, 'the right drag wrote the LEFT rail').toBeNull();
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
    // The other door to the same state: the collapse branch removed the property, and on
    // a fresh profile the stored width is already null, so the write that was supposed to
    // restore it changed nothing. (An earlier version of this comment said `toggleRail`
    // guarantees that null on every open. It does not — it opens and closes and touches
    // no width, and `lib/store.ts` carries the reason. Two more copies of that claim sat
    // in `RailSash` and `DockedShell`, one of them as the stated reachability argument
    // for the fix, twenty-eight lines above the test that disproves it.)
    useStudio.setState({ ...OPEN, railLeftOpen: false });
    const shell = mount();
    // 208 is `--rail-left-tight`, what the rail measures once it has opened at the
    // compact step — above `--rail-closed`, so the first move promotes the gesture.
    const undo = stubLayout({ railPx: 208 });

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    // Two moves: the first promotes the opening gesture to a sizing one, the second is the
    // push back past the floor that arms the collapse.
    fireEvent.pointerMove(el, { clientX: 399, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 400 - 500, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 400 - 500, pointerId: 1 });
    undo();

    expect(useStudio.getState().railLeftOpen, 'the push-past-the-floor did not close it').toBe(false);

    // Reopen the way a user would, through the chevron rather than by writing state.
    fireEvent.click(screen.getByRole('button', { name: /show the left panel/i }));

    expect(useStudio.getState().railLeftOpen).toBe(true);
    expect(sashVar(shell, 'left'), 'the shell reopened with no --sash-left, so its grid has no columns').not.toBe('');
  });
});

describe('the chevron opens and closes, and owns no width', () => {
  it('a width the user dragged survives a close and a reopen', () => {
    // `STUDIO_PREFS` persists `railLeftW` under "the user set them once and expects
    // them to stick", and a pass through `toggleRail` briefly cleared it on every
    // open. The loss has no undo and the gesture that causes it is a mis-click: the
    // chevron is a 24px button about 5px from a 10px sash. The "fills the screen"
    // surprise it was added to prevent is already bounded by `--rail-max: 40vw`
    // inside `DockedShell`'s own `clamp()`.
    useStudio.setState({ ...OPEN, railLeftW: 460 });
    useStudio.getState().toggleRail('left'); // closes
    expect(useStudio.getState().railLeftW, 'closing threw the width away').toBe(460);
    useStudio.getState().toggleRail('left'); // opens
    expect(useStudio.getState().railLeftW, 'reopening threw the width away').toBe(460);
  });

  it('and touches neither the other rail nor the other rail`s width', () => {
    // One `set` writing more keys than its name is how a rail loses something nobody
    // touched — which is what the cleared-on-open version did, one side at a time.
    useStudio.setState({ ...OPEN, railLeftOpen: false, railLeftW: 300, railRightW: 500 });
    useStudio.getState().toggleRail('left');
    expect(useStudio.getState().railLeftOpen).toBe(true);
    expect(useStudio.getState().railLeftW).toBe(300);
    expect(useStudio.getState().railRightOpen).toBe(true);
    expect(useStudio.getState().railRightW).toBe(500);
  });
});

describe('a move that arrives before the open has laid out is refused, not seeded from', () => {
  // The only test here that fakes layout, and it has to: the guard reads the rail's
  // measured width against `--rail-closed`, and jsdom answers 0 for both, so the
  // comparison is 0-against-0 and the mutant that removes it survives untouched.
  //
  // The guard is "is this still the SHUT width", not "is this under the floor", and
  // that distinction was found in a browser rather than here: at the compact step the
  // rail renders `--rail-left-tight` (208px), which is legitimately BELOW
  // `--rail-left-min` (228px), so a floor comparison refused every real measurement
  // and the drag-a-closed-sash-open gesture stopped working across the whole band.
  it('keeps the rail open when every measurement is still the closed width', () => {
    useStudio.setState({ ...OPEN, railLeftOpen: false });
    mount();
    // The rail still measures `--rail-closed` because React has not re-rendered yet.
    const undo = stubLayout({ railPx: 37 });

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    // The move that arrives too early, and then one far enough left to arm a collapse
    // if the first one had been believed.
    fireEvent.pointerMove(el, { clientX: 399, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: -100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: -100, pointerId: 1 });
    undo();

    expect(
      useStudio.getState().railLeftOpen,
      'the gesture closed the rail it had just opened, from a width the rail cannot have',
    ).toBe(true);
    expect(useStudio.getState().railLeftW).toBeNull();
  });

  it('and a rail at the COMPACT width, which is under its own floor, is accepted', () => {
    // The other half, and the one a floor comparison gets wrong. 208px is a real open
    // width; the gesture must become a sizing one and a drag must commit.
    useStudio.setState({ ...OPEN, railLeftOpen: false });
    mount();
    const undo = stubLayout({ railPx: 208 });

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 401, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 461, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 461, pointerId: 1 });
    undo();

    expect(useStudio.getState().railLeftOpen).toBe(true);
    expect(
      useStudio.getState().railLeftW,
      'a drag from the compact width committed nothing — the guard refused a legal width',
    ).not.toBeNull();
  });
});

// ─── What a browser found that the four describes above could not ───────────────
//
// Five review lenses and a second independent probe measured these on a real build at
// 1100x900. Three of the four are PRE-EXISTING on `main` and one is this branch's own,
// and they share a single cause: `--rail-${side}-min` is answering three different
// questions. It is the width a DRAG may be clamped to, and it was also being used as the
// origin a collapse is measured from, as the minimum published to assistive tech, and as
// the floor a key press clamps against — while the rail legitimately RENDERS
// `--rail-${side}-tight`, 20px (left) and 28px (right) below it, for the whole
// 1024–1279px band. Every assertion below is a different consequence of that one number.
//
// rAF is made synchronous where a test needs to see what `paint()` wrote. jsdom schedules
// it on a timer, so a test that fires a pointermove and asserts on the next line cannot
// observe the frame at all — which would make the paint gate untestable rather than
// tested, the failure this file's own header warns about.
function syncFrames(): () => void {
  const real = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
  return () => {
    globalThis.requestAnimationFrame = real;
    globalThis.cancelAnimationFrame = realCancel;
  };
}

describe('a gesture that resized nothing leaves no pixel behind either', () => {
  it('a pointermove of ZERO pixels does not paint the clamped width over the rail', () => {
    // The door the click guard did not close. `d.moved` stays false for a straight-down
    // press, correctly, so the release commits nothing — but `paint()` used to be
    // scheduled on every move regardless, and `d.pending` is clamped UP to the drag
    // floor, so it wrote `228px` over a 208px rail. Because the release then stores
    // nothing, no render follows, the shell's layout effect never runs, and the literal
    // stays for the session. Measured in a browser: 208 → 228 and stuck there.
    useStudio.setState(OPEN);
    const shell = mount(1100);
    const undo = stubLayout({ railPx: 208 });
    const frames = syncFrames();

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 400, pointerId: 1 });

    expect(sashVar(shell, 'left'), 'a move of zero pixels painted a width').not.toMatch(/^\d/);

    fireEvent.pointerUp(el, { clientX: 400, pointerId: 1 });
    frames();
    undo();

    expect(useStudio.getState().railLeftW, 'a press that moved nothing stored a width').toBe(null);
    expect(sashVar(shell, 'left'), 'the release left a painted width standing').not.toMatch(/^\d/);
  });

  it('and a double-click puts the variable back even when the store does not change', () => {
    // A2, and it is this branch's own. `reset()` writes `null` over a width that is
    // ALREADY null, which zustand compares equal, so nothing renders and the layout
    // effect never runs. On `main` the same gesture recovered — but only because the
    // click-commit bug had stored 228 for the `null` to differ from. Two defects holding
    // each other up: removing one exposed that the reset never worked on its own.
    useStudio.setState(OPEN);
    const shell = mount(1100);
    const undo = stubLayout({ railPx: 208 });
    const frames = syncFrames();
    const el = sashEl('left');

    // Paint a width the way a real drag does, then hand it back with a double-click.
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 480, pointerId: 1 });
    expect(sashVar(shell, 'left'), 'the drag painted nothing to recover from').toMatch(/^\d/);
    fireEvent.pointerUp(el, { clientX: 480, pointerId: 1 });
    fireEvent.doubleClick(el);
    frames();
    undo();

    expect(useStudio.getState().railLeftW, 'the reset left a width stored').toBe(null);
    expect(sashVar(shell, 'left'), 'the reset left the painted width on the element').not.toMatch(/^\d/);
  });
});

describe('a rail born below its own floor is not a rail being closed', () => {
  it('the RIGHT sash does not collapse on a press that travels two pixels', () => {
    // `d.collapse = raw < d.floor - SNAP_PAST_FLOOR` was true before the pointer moved at
    // all: the right rail renders 248px at the compact step against a floor of 276px, and
    // 248 < 276 − 24. So the first move in ANY direction armed the close and the release
    // shut the Inspector. Two pixels rather than zero on purpose — a zero-delta gesture is
    // refused by the no-move guard, which would make this pass without the fix under test.
    useStudio.setState(OPEN);
    mount(1100);
    const undo = stubLayout({ railPx: 248 });
    const frames = syncFrames();

    const el = sashEl('right');
    fireEvent.pointerDown(el, { button: 0, clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 902, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 902, pointerId: 1 });
    frames();
    undo();

    expect(useStudio.getState().railRightOpen, 'a two-pixel press closed the right rail').toBe(true);
    // …and it stored nothing, which is the half this test was one assertion short of.
    // The gesture asked for 246px; the clamp handed it the 276px floor and the release
    // committed that — 28px WIDER than the rail the pointer was narrowing, stored, so
    // the compact step never applied to that rail again. Same harm as the keyboard
    // shrink, on the input the branch's first pass left raw. See `narrowest` and the
    // reachable-widths note in `onPointerMove`.
    expect(useStudio.getState().railRightW, 'a two-pixel NARROWING drag stored a wider rail').toBeNull();
  });

  it('but a real push past where it started still collapses it', () => {
    // The other end of the pair. A guard that refused every collapse would satisfy the
    // test above on its own, which is the failure mode this file has already had once.
    useStudio.setState(OPEN);
    mount(1100);
    const undo = stubLayout({ railPx: 248 });
    const frames = syncFrames();

    const el = sashEl('right');
    fireEvent.pointerDown(el, { button: 0, clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 1100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 1100, pointerId: 1 });
    frames();
    undo();

    expect(
      useStudio.getState().railRightOpen,
      'pushing the right sash well past its start did not close it',
    ).toBe(false);
  });
});

describe('the separator publishes a range its own value fits inside', () => {
  it('aria-valuenow is not below aria-valuemin at the compact width', () => {
    // Measured on both builds: now 208 / min 228 on the left and 248 / 276 on the right,
    // for the whole compact band. The file's own comment says a closed rail publishes no
    // value rather than an impossible one; this is the same impossibility, open.
    useStudio.setState(OPEN);
    mount(1100);
    const undo = stubLayout({ railPx: 208 });
    // `metrics` is state, and the press-release path calls `sync()`. Nothing here is
    // asserting the gesture — it is how the component is made to measure under the stub.
    pressAndRelease(sashEl('left'));
    const el = sashEl('left');
    const now = Number(el.getAttribute('aria-valuenow'));
    const min = Number(el.getAttribute('aria-valuemin'));
    undo();

    expect(now, 'the stub did not reach the component').toBe(208);
    expect(min, 'aria-valuemin is above the value the rail is actually at').toBeLessThanOrEqual(now);
  });
});

describe('a key that asks for less never delivers more', () => {
  it('ArrowLeft on a left rail already under its drag floor stores nothing', () => {
    // The only one of the four that PERSISTS. 208 − 16 = 192, clamped up to the 228px
    // floor, stored — so the shrink key widened the rail by 20px and pinned it out of the
    // compact step permanently. `Home` did the same thing, which is worse, because `Home`
    // means "smallest".
    useStudio.setState(OPEN);
    mount(1100);
    const undo = stubLayout({ railPx: 208 });
    const el = sashEl('left');

    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(useStudio.getState().railLeftW, 'ArrowLeft widened and stored the rail').toBe(null);

    fireEvent.keyDown(el, { key: 'Home' });
    expect(useStudio.getState().railLeftW, 'Home widened and stored the rail').toBe(null);
    undo();
  });

  it('while ArrowRight, which asked for more, still resizes it', () => {
    // The accept half. A guard that refused every key press would satisfy the test above,
    // and this file has already shipped one guard that refused everything.
    useStudio.setState(OPEN);
    mount(1100);
    const undo = stubLayout({ railPx: 208 });

    fireEvent.keyDown(sashEl('left'), { key: 'ArrowRight' });
    undo();

    expect(useStudio.getState().railLeftW, 'ArrowRight stored no width at all').toBe(228);
  });
});

describe('when no drag is live, the element says what the store says', () => {
  it('a drag that lands on the width already stored still leaves a CLAMPED value', () => {
    // The reachable hole in that rule, and the one that pins it. `paint()` writes a raw
    // `228px`; the shell renders a stored width as
    // `clamp(var(--rail-left-min), 228px, var(--rail-max))`. Drag to a width the rail is
    // already stored at and zustand compares the two equal — no render, no layout effect,
    // and the raw value stands. A raw px is not bounded by `--rail-max`, which is the
    // token that keeps most of the window for the room when the window gets smaller: the
    // rail would hold 520px on a laptop that opened the same browser profile.
    useStudio.setState({ ...OPEN, railLeftW: 228 });
    const shell = mount(1100);
    const undo = stubLayout({ railPx: 208 });
    const frames = syncFrames();

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    // 208 measured + 20 = 228, which is both the drag floor and what is already stored.
    fireEvent.pointerMove(el, { clientX: 420, pointerId: 1 });
    expect(sashVar(shell, 'left'), 'the drag painted nothing, so this proves nothing').toBe('228px');
    fireEvent.pointerUp(el, { clientX: 420, pointerId: 1 });
    frames();
    undo();

    expect(useStudio.getState().railLeftW, 'the drag did not commit the width it ended on').toBe(228);
    expect(sashVar(shell, 'left'), 'the raw preview outlived the gesture, unclamped').toContain('clamp(');
  });
});

describe('a width written from outside a gesture still reaches the element', () => {
  it('setRailWidth from anywhere repaints --sash-left', () => {
    // The gate on `DockedShell`'s two bare `useStudio(...)` calls, which read nothing and
    // therefore look deletable. They are the shell's only subscription to a rail width now
    // that `applySashWidths` takes its values from `getState()` at call time: the layout
    // effect carries no dependency array, so it runs after every render and never once
    // without one. Delete either line and the shell paints correctly on mount and then
    // never again — a store write from a keyboard shortcut, a restored preference or any
    // future caller lands in the store and stops there.
    useStudio.setState(OPEN);
    const shell = mount(1100);

    expect(sashVar(shell, 'left'), 'the mount paint is already a number, so this proves nothing').not.toContain(
      '320px',
    );
    act(() => useStudio.setState({ railLeftW: 320 }));
    expect(sashVar(shell, 'left'), 'a width written outside a gesture never reached the DOM').toContain('320px');

    // The side control: one subscription covers one property, and `railWidth` is a lookup
    // keyed on `side`. Deleting only the right-hand line passes the assertion above.
    act(() => useStudio.setState({ railRightW: 360 }));
    expect(sashVar(shell, 'right'), 'the right rail has its own subscription and its own hole').toContain('360px');
  });
});

describe('opening a rail publishes a width inside its own range', () => {
  /** The rail's measured width depends on whether it is OPEN, which the fixed-width stub
   *  above cannot express — and that difference is the whole subject here. 37px is
   *  `--rail-closed`; 208px is `--rail-left-tight`, what the compact step renders. */
  function stubTogglingLayout(): () => void {
    const realCS = window.getComputedStyle.bind(window);
    const realRect = Element.prototype.getBoundingClientRect;
    const TOKENS: Record<string, string> = {
      '--rail-closed': '37px',
      '--rail-left-min': '228px',
      '--rail-left-tight': '208px',
      '--rail-max-share': '0.4',
    };
    window.getComputedStyle = ((el: Element, pe?: string | null) => {
      const cs = realCS(el, pe ?? undefined);
      return new Proxy(cs, {
        get(t, k) {
          if (k !== 'getPropertyValue') return Reflect.get(t, k);
          return (name: string) => TOKENS[name] ?? t.getPropertyValue(name);
        },
      });
    }) as typeof window.getComputedStyle;
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      if (!this.classList?.contains('rail')) return realRect.call(this);
      const w = useStudio.getState().railLeftOpen ? 208 : 37;
      return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: 0, width: w, height: 0, toJSON: () => ({}) } as DOMRect;
    };
    return () => {
      window.getComputedStyle = realCS as typeof window.getComputedStyle;
      Element.prototype.getBoundingClientRect = realRect;
    };
  }

  it('Enter on a closed sash does not publish aria-valuenow below aria-valuemin', () => {
    // The same impossible-slider defect the compact step had, through the door nobody
    // opened: while a rail is shut its measured width is `--rail-closed` (37px), and
    // NEITHER toggle path calls `sync`. So the render that opens the rail starts
    // publishing the trio again from a measurement taken while it was closed — 37 against
    // a minimum of 208 — and a ResizeObserver closes it a frame later, in a browser that
    // has one. `open` is a dependency of the measuring effect for this reason.
    // BEFORE the mount, and that is the whole fixture: the attribute is rendered from
    // `metrics`, which the measuring effect writes on mount. Installed afterwards, the
    // mount measures jsdom's real 0px, the toggle republishes 0 against a floor of 0,
    // and `0 <= 0` passes — the guard is never reached and the mutation survives. It
    // did, and this comment is the record of it.
    useStudio.setState({ ...OPEN, railLeftOpen: false });
    const undo = stubTogglingLayout();
    mount(1100);
    const el = sashEl('left');

    // Closed, the trio is not published at all — so the assertion below is about a value
    // that appeared, not about one that was always there.
    expect(el.getAttribute('aria-valuenow'), 'a shut rail published a width').toBeNull();

    fireEvent.keyDown(el, { key: 'Enter' });
    undo();

    expect(useStudio.getState().railLeftOpen, 'Enter did not open the rail, so nothing was measured').toBe(true);
    const now = Number(el.getAttribute('aria-valuenow'));
    const min = Number(el.getAttribute('aria-valuemin'));
    const max = Number(el.getAttribute('aria-valuemax'));
    expect(Number.isFinite(now) && Number.isFinite(min), 'the trio is incomplete on an open rail').toBe(true);
    // **The VALUE, not the ordering**, and the difference is a mutation that survived:
    // `narrowest()` is `min(floor, width)`, so `valuemin <= valuenow` is true of the
    // stale closed measurement too — 37 within [37, 440] is a perfectly ordered range
    // describing a rail that is 208px wide. Asserting the width the rail is actually
    // rendering is what catches an effect that did not re-measure.
    expect(now, 'the open rail still publishes the width it had while SHUT').toBe(208);
    expect(min, 'the published minimum is the closed width, not the open one').toBe(208);
    expect(now, `aria-valuenow ${now} is above aria-valuemax ${max}`).toBeLessThanOrEqual(max);
  });
});

describe('a drag that asks for less never delivers more', () => {
  it('narrowing the LEFT rail below its own floor stores nothing', () => {
    // The side control for the two-pixel right-sash pair above, and the same defect:
    // 208px rendered against a 228px floor, so the clamp turned a 2px narrowing into a
    // stored 228. Both sides, because every width in `RailSash` is a lookup keyed on
    // `side` and a fix applied to one branch of such a table is this repo's own scar.
    useStudio.setState(OPEN);
    mount(1100);
    const undo = stubLayout({ railPx: 208 });
    const frames = syncFrames();

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 398, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 398, pointerId: 1 });
    frames();
    undo();

    expect(useStudio.getState().railLeftW, 'a narrowing drag stored a wider rail').toBeNull();
    expect(useStudio.getState().railLeftOpen, 'it closed the rail instead').toBe(true);
  });

  it('while a drag that reaches a storable width still commits it', () => {
    // The accept half, and this file has already shipped one guard that refused
    // everything. 208 + 90 = 298, which is above the 228px floor, so it is a width the
    // shell can render as itself rather than as the floor.
    useStudio.setState(OPEN);
    mount(1100);
    const undo = stubLayout({ railPx: 208 });
    const frames = syncFrames();

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 490, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 490, pointerId: 1 });
    frames();
    undo();

    expect(useStudio.getState().railLeftW, 'a real widening drag stored nothing').toBe(298);
  });

  it('and narrowing from ABOVE the floor still reaches the floor', () => {
    // The third case, and the one that says the rule is about reachable widths rather
    // than about refusing to narrow: a rail already stored at 400 may be dragged down
    // to 228, because 228 is a width the shell renders as itself. Without this the
    // pair above is satisfied by a `RailSash` that never narrows anything at all.
    useStudio.setState({ ...OPEN, railLeftW: 400 });
    mount(1100);
    const undo = stubLayout({ railPx: 400 });
    const frames = syncFrames();

    const el = sashEl('left');
    fireEvent.pointerDown(el, { button: 0, clientX: 400, pointerId: 1 });
    // 400 − 190 = 210, under the 228px floor, so the clamp is what answers — and here
    // it is allowed to, because the rail STARTED above the floor.
    fireEvent.pointerMove(el, { clientX: 210, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 210, pointerId: 1 });
    frames();
    undo();

    expect(useStudio.getState().railLeftW, 'a narrowing drag from above the floor did not reach it').toBe(228);
  });
});

describe('aria-valuemin is the width the rail can reach, at every step', () => {
  it('is the rendered width at the compact step and the drag floor above it', () => {
    // The ordering `valuemin <= valuenow` is true by construction now — `narrowest()`
    // is `min(floor, width)` — so asserting it would be asserting nothing. The VALUE is
    // the claim, and it was wrong in two directions at once: reading the drag floor put
    // the value ABOVE `aria-valuenow` for the whole compact step, and reading the tight
    // token put it BELOW anything reachable above that step, since the tight tokens sit
    // on bare `:root` and apply at every width. A rail at 400px advertising a minimum of
    // 208 gives a screen-reader user 20px of travel that ArrowLeft silently refuses.
    // The stub goes up BEFORE the mount, unlike every other test here: the attribute is
    // rendered from `metrics`, which only the measuring effect writes, and that effect
    // runs once on mount. A stub installed afterwards is read by `measure()` on the next
    // gesture and never by the mount.
    useStudio.setState(OPEN);
    let undo = stubLayout({ railPx: 208 });
    mount(1100);
    expect(sashEl('left').getAttribute('aria-valuemin'), 'the compact step advertises the drag floor').toBe('208');
    // …and the value it publishes is the rendered width, so the pair is a real pair
    // rather than one number asserted twice.
    expect(sashEl('left').getAttribute('aria-valuenow')).toBe('208');
    undo();

    cleanup();
    useStudio.setState({ ...OPEN, railLeftW: 400 });
    undo = stubLayout({ railPx: 400 });
    mount(1100);
    expect(sashEl('left').getAttribute('aria-valuemin'), 'a wide rail advertises a minimum it cannot reach').toBe(
      '228',
    );
    expect(sashEl('left').getAttribute('aria-valuenow')).toBe('400');
    undo();
  });
});
