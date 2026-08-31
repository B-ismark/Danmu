import { describe, it, expect, beforeEach } from 'vitest';
import {
  claimPressForGizmo,
  clearGizmoClick,
  consumeGizmoClick,
  holdPress,
  releasePress,
} from '@/lib/gizmo-press';

/** The gate's value **at import**, read before any `beforeEach` can touch it.
 *
 *  `tests/drag-click.test.ts` does the same for the same reason, and `Design.md`
 *  states the rule for both: a reset in a `beforeEach` hides a module that started
 *  armed, and one that did would have `Pickable` swallow the FIRST click of the
 *  session — the first selection after a page load would silently do nothing. It
 *  has to be captured at module scope, because the reset below is deliberately
 *  thorough enough to destroy the evidence. */
const ARMED_AT_IMPORT = consumeGizmoClick();

// `lib/gizmo-press.ts` is module state, so every test starts from a known one.
//
// **This used to be three hand-typed ids fed to an id-gated `releasePress`, which
// is not a reset**: a hold under any fourth id survived it, and the module exports
// nothing else that would clear one. It was also inert — emptying the body left all
// twelve tests green, because no test happened to leak. Both halves of that are the
// same defect: a reset that cannot be observed working is a reset nobody can trust,
// and the next test to take a hold and not give it back would have had its
// teardown run by whichever test claimed next.
//
// `claimPressForGizmo` alone is not the answer either, and the ordered pair below
// caught that on its first run: claiming clears a holder under ANY id, but it also
// RUNS its teardown — so the reset would execute the very leaked callback it exists
// to protect the next test from. `holdPress` replaces without running (the property
// pinned two tests further down), so displacing the stale hold with a harmless one
// and claiming that away is the reset: no ids, nothing of the previous test's is
// executed, and the `consumeGizmoClick` disarms the gate the claim just armed.
beforeEach(() => {
  holdPress('__reset__', () => {});
  claimPressForGizmo();
  consumeGizmoClick();
});

describe('holding and handing back a press', () => {
  it('hands the press back to the gizmo and names the piece it took it from', () => {
    let released = 0;
    holdPress('nightstand', () => {
      released += 1;
    });

    expect(claimPressForGizmo()).toBe('nightstand');
    expect(released).toBe(1);
  });

  it('releases exactly once — a second claim in the same gesture finds nothing left', () => {
    let released = 0;
    holdPress('nightstand', () => {
      released += 1;
    });

    claimPressForGizmo();
    expect(claimPressForGizmo()).toBeNull();
    expect(released).toBe(1);
  });

  it('lets only the holder let go', () => {
    let released = 0;
    holdPress('nightstand', () => {
      released += 1;
    });

    // The bed finishing its own gesture must not drop the nightstand's hold — if
    // it did, the gizmo would arrive to find nothing to take the press back from
    // and the nightstand would keep sliding, which is the whole defect again.
    releasePress('bed');

    expect(claimPressForGizmo()).toBe('nightstand');
    expect(released).toBe(1);
  });

  it('is a no-op for the gizmo once the holder has let go the ordinary way', () => {
    let released = 0;
    holdPress('nightstand', () => {
      released += 1;
    });

    releasePress('nightstand');

    expect(claimPressForGizmo()).toBeNull();
    expect(released).toBe(0);
  });

  it('gives a hold back exactly once even when the teardown throws', () => {
    // This is what pins the ORDER inside `claimPressForGizmo` — clearing the holder
    // before running its release. Swapping the two lines is invisible to every
    // other test here, because the real teardown ends by calling `releasePress`
    // itself and so cleans up either way. It stops being invisible the moment the
    // teardown does not reach that line: the hold stays standing, and the next
    // gesture tears the same piece down a second time.
    let released = 0;
    holdPress('nightstand', () => {
      released += 1;
      throw new Error('teardown blew up');
    });

    expect(() => claimPressForGizmo()).toThrow();
    expect(claimPressForGizmo()).toBeNull();
    expect(released).toBe(1);
  });

  it('replaces a stale hold rather than refusing the new one', () => {
    // A press that never released — the piece unmounted mid-gesture, say. The next
    // press must still be the one the gizmo can take back.
    holdPress('rug', () => {});
    holdPress('nightstand', () => {});

    expect(claimPressForGizmo()).toBe('nightstand');
  });

  it('does NOT run the replaced hold’s teardown', () => {
    // The tidy-looking version of `holdPress` — release the stale one before taking
    // the new one — survived a twelve-mutation sweep with every test green, because
    // the only test about replacement passed `() => {}` for both holds and asserted
    // the id alone. In production that closure releases a pointer capture, clears
    // `_gestureOwner` and calls `setDragging(null)`, so tidying up here would do all
    // of that in the middle of the press that has just begun on ANOTHER piece.
    let staleRan = 0;
    holdPress('rug', () => {
      staleRan += 1;
    });
    holdPress('nightstand', () => {});

    expect(staleRan).toBe(0);
    claimPressForGizmo();
    expect(staleRan).toBe(0);
  });
});

describe('the reset this file runs between tests', () => {
  // These two are an ORDERED PAIR and only mean anything together: the first leaves
  // a hold standing under an id nothing else here uses, and the second asserts the
  // next test did not inherit it. Vitest runs a file's tests in declaration order
  // and `vitest.config.ts` sets no `sequence.shuffle`, so the order is a fact rather
  // than a hope.
  //
  // They exist because the first version of the `beforeEach` was three hand-typed
  // ids fed to an id-gated `releasePress` — not a reset, since a hold under any
  // fourth id survived it — AND was inert: emptying its body left every test green.
  // A reset nobody can watch working is the same defect as a check that cannot fail.
  it('leaves a hold standing on purpose', () => {
    holdPress('leaked-by-the-test-above', () => {
      throw new Error('the reset let a stale teardown run');
    });

    expect(true).toBe(true);
  });

  it('has cleared it before this test starts', () => {
    expect(claimPressForGizmo()).toBeNull();
  });

  it('starts the session with the click gate disarmed', () => {
    expect(ARMED_AT_IMPORT).toBe(false);
  });
});

describe('the click a gizmo gesture ends with', () => {
  it('is armed even when the press landed on no furniture at all', () => {
    // The ring passing over bare floor, or over the turned piece's OWN body. There
    // is no holder to take the press back from, and the click still arrives — on
    // the piece itself it is not harmless, because a plain click is
    // `selectionForPick`, which drills into a merged group.
    expect(claimPressForGizmo()).toBeNull();
    expect(consumeGizmoClick()).toBe(true);
  });

  it('is true once and then false', () => {
    claimPressForGizmo();

    expect(consumeGizmoClick()).toBe(true);
    expect(consumeGizmoClick()).toBe(false);
  });

  it('is false when no gizmo gesture happened', () => {
    expect(consumeGizmoClick()).toBe(false);
  });

  it('is dropped by the next press when no click ever came', () => {
    // A rotate released over bare floor produces no click at all, and a gate left
    // standing would swallow the next real one. Nothing slips through the gap:
    // every click on a piece is preceded by a press on it, and `Draggable`'s
    // `onPointerDown` calls `clearGizmoClick`.
    claimPressForGizmo();
    clearGizmoClick();

    expect(consumeGizmoClick()).toBe(false);
  });

  it('is not consumed by handing the press back a second time', () => {
    // `claimPressForGizmo` arms; only `consumeGizmoClick` and `clearGizmoClick`
    // disarm. Two claims in one gesture (there are none, but the module must not
    // depend on that) still leave one click gated, not zero.
    claimPressForGizmo();
    claimPressForGizmo();

    expect(consumeGizmoClick()).toBe(true);
  });
});
