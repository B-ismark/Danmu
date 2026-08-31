import { describe, it, expect, beforeEach } from 'vitest';
import {
  claimPressForGizmo,
  clearGizmoClick,
  consumeGizmoClick,
  holdPress,
  releasePress,
} from '@/lib/gizmo-press';

// `lib/gizmo-press.ts` is module state, so every test starts from a known one.
// `clearGizmoClick` is the only reset the module offers and it is enough: a hold
// is dropped by whoever took it, and every test here that takes one gives it back.
beforeEach(() => {
  clearGizmoClick();
  releasePress('bed');
  releasePress('nightstand');
  releasePress('rug');
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

  it('survives a release that calls releasePress from inside its own teardown', () => {
    // Which is what `Draggable`'s does, by way of the shared teardown. The holder
    // is cleared BEFORE `release` runs, so this is a no-op rather than a second
    // trip through `claimPressForGizmo`.
    let released = 0;
    holdPress('nightstand', () => {
      released += 1;
      releasePress('nightstand');
    });

    expect(() => claimPressForGizmo()).not.toThrow();
    expect(released).toBe(1);
    expect(claimPressForGizmo()).toBeNull();
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
