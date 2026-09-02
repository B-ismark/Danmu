// @vitest-environment jsdom
//
// § 14 — "selecting a member of a group individually by clicking it doesn't work, though
// it works when you click it in the layer list."
//
// The cause, found by instrumenting the real 3D tab rather than by reading: the drill-in
// asks `selectionForPick` whether the pick came from INSIDE the group, using the
// selection AS THE PRESS LANDED — and that value was a ref on `Pickable`, stamped in that
// component's own `onPointerDown`. Once a piece is selected the gizmo appears, and R3F
// cannot see the gizmo (drei's `TransformControls` is a `<primitive>` with no handlers),
// so its invisible translate plane takes the press and R3F dispatches nothing to the mesh
// underneath. The DOM click still arrives. So `onClick` ran with a value left over from
// the last press that DID reach it — `[]`, from before anything was selected — and the
// predicate concluded "outside" and handed back the whole group. Every time.
//
// So the property under test is not "it records the selection". It is **that it records
// the selection even when nothing downstream ever sees the press.**

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { armPressSelection, selectionAtPress, resetPressSelection } from '@/lib/press-selection';

const press = () => window.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

describe('§ 14 · the selection as the press landed', () => {
  beforeEach(() => resetPressSelection());
  afterEach(() => resetPressSelection());

  it('is empty before anything has been pressed', () => {
    expect(selectionAtPress()).toEqual([]);
  });

  it('records what was selected when the press began', () => {
    let sel: string[] = ['a', 'b'];
    armPressSelection(() => sel);
    press();
    expect(selectionAtPress()).toEqual(['a', 'b']);
    sel = ['c'];
    expect(selectionAtPress(), 'and does not follow the live value between presses').toEqual(['a', 'b']);
    press();
    expect(selectionAtPress()).toEqual(['c']);
  });

  it('still records when a handler stops the event — the whole point', () => {
    // THE regression. A listener that swallows the press stands in for the gizmo's
    // translate plane. Registered on a child in the BUBBLE phase, which is where every
    // React and R3F handler lives; the recorder is in the capture phase, so the press is
    // already recorded by the time anything can stop it.
    const child = document.createElement('div');
    document.body.appendChild(child);
    child.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    });

    armPressSelection(() => ['bed', 'ns-l', 'ns-r']);
    child.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

    expect(
      selectionAtPress(),
      'a press swallowed before it reached the mesh must still be recorded, or the ' +
        'drill-in reads a stale value and can never conclude "inside"',
    ).toEqual(['bed', 'ns-l', 'ns-r']);
    child.remove();
  });

  it('registers one listener however many pieces arm it', () => {
    // Every `Pickable` in the scene calls this on mount. Two listeners would not be
    // wrong on their own — they would record the same thing — but the count is what the
    // idempotence claim rests on, and a second listener would also survive the first
    // component's unmount and go on reading a dead closure.
    let calls = 0;
    const read = () => {
      calls++;
      return ['x'];
    };
    armPressSelection(read);
    armPressSelection(read);
    armPressSelection(read);
    press();
    expect(calls, 'three arms, one listener, one read per press').toBe(1);
  });

  it('reads the selection lazily, at press time, not when it was armed', () => {
    // `armPressSelection` runs once on mount, long before any press. Capturing the value
    // rather than the function would freeze the selection at mount — which for the first
    // `Pickable` to mount is always `[]`, i.e. exactly the defect this replaced.
    let sel: string[] = [];
    armPressSelection(() => sel);
    sel = ['later'];
    press();
    expect(selectionAtPress()).toEqual(['later']);
  });
});
