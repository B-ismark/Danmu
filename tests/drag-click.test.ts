import { describe, it, expect, beforeEach } from 'vitest';
import { clearDragClick, consumeDragClick, suppressClickAfterDrag } from '@/lib/drag-click';

// The gate that stops the DOM click ending a 3D drag from collapsing the
// selection that drag just carried.
//
// The property worth stating out loud is the one that is now STRUCTURAL rather
// than tested: `consumeDragClick` takes no part id, so it cannot ask whether the
// arriving click belongs to the piece that was dragged. It used to, and that is
// exactly how a click raycasting onto a different piece ate the flag and
// selected itself. A test cannot catch a comparison that no longer exists — the
// signature is the guard. What is left to check is the lifecycle.

// Read at IMPORT, before any test or `beforeEach` can touch it. The flag is
// module state, so a reset in `beforeEach` hides the value it started at — and a
// gate that starts armed would swallow the first click of the session, which is a
// real failure no later assertion can see. Consuming here also leaves the module
// closed for the tests below, whatever it held.
const ARMED_AT_IMPORT = consumeDragClick();

beforeEach(() => {
  clearDragClick();
});

describe('drag-click — the click a drag ends with', () => {
  it('starts closed, before anything has been dragged', () => {
    expect(ARMED_AT_IMPORT).toBe(false);
  });

  it('is closed until a drag arms it', () => {
    expect(consumeDragClick()).toBe(false);
  });

  it('swallows exactly one click', () => {
    suppressClickAfterDrag();
    expect(consumeDragClick()).toBe(true);
    // The next real click on any piece must get through.
    expect(consumeDragClick()).toBe(false);
  });

  it('does not stay armed when no click ever arrives', () => {
    // A gesture released off-mesh produces no click at all. The next press
    // clears the flag, so the click that press leads to is not swallowed.
    suppressClickAfterDrag();
    clearDragClick();
    expect(consumeDragClick()).toBe(false);
  });

  it('re-arms after being consumed', () => {
    suppressClickAfterDrag();
    consumeDragClick();
    suppressClickAfterDrag();
    expect(consumeDragClick()).toBe(true);
  });
});
