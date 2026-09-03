// @vitest-environment jsdom
//
// § 12's in-session half: resize a desk with the studio OPEN and the lamp on it must
// move now, not on the next reload.
//
// This file exists because of defects 6 and 7 of the nine (`docs/what-is-still-open.md`
// § 12). The reverted attempt had these same hooks, and **both of its store
// subscriptions could be replaced with plain `getState()` reads, and three of its four
// memo identity checks deleted, with the whole 2205-test suite still green.** A
// subscription is invisible to a pure test: the derivation is correct either way, and
// what breaks is only *when React is told*. So the hooks are mounted and the store is
// moved underneath them, one slice at a time.
//
// Each case moves exactly ONE slice, and the slice it moves is not one the hook would
// re-render for by accident. `useRoomScene` subscribes to `positions` / `rotations` /
// `dims`, so a `parentIds`-only write leaves all three referentially identical and
// zustand's default `Object.is` comparison re-renders nothing — unless `parentIds` is
// genuinely subscribed. Same for `room.height` against `parts`.
//
// What this does NOT prove: that the 3D scene paints the new height. `Draggable` writes
// straight to an `Object3D` and there is no R3F under jsdom; the browser probe is the
// only thing that can see that, and it is an item in docs/visual-check.md.

import { describe, expect, it, beforeEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { currentRoomScene, useRoomScene, usePartTransform, useSettledY } from '@/lib/room-scene';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { footprintForLayout } from '@/lib/footprint';
import { duplicateSelection } from '@/components/studio/KeyboardShortcuts';
import { MOUNT_PAD } from '@/lib/physics';
import type { ScenePart } from '@/lib/scene-spec';

const DESK = 'desk-1';
const LAMP = 'lamp-1';

/** Top at 0.75. */
const desk = (): ScenePart =>
  ({
    id: DESK, name: 'Desk', category: 'desk', shape: 'desk-standard', locked: false,
    dimMM: [1400, 700, 750], pos: [0, 0, 0], rot: 0, wallMounted: false,
  }) as ScenePart;

/** 400 mm tall, sitting on the desk's authored top. */
const lamp = (y: number): ScenePart =>
  ({
    id: LAMP, name: 'Table lamp', category: 'lamp', shape: 'lamp-table', locked: false,
    dimMM: [300, 300, 400], pos: [0, y, 0], rot: 0, wallMounted: false,
  }) as ScenePart;

function setUp(parts: ScenePart[], height = 2.5) {
  cleanup();
  useScene.setState({
    parts,
    room: { ...useScene.getState().room, width: 4, depth: 4, height, footprint: footprintForLayout('rect', 4, 4), layoutId: 'rect' },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
}

const yOf = (parts: ScenePart[], id: string) => parts.find((p) => p.id === id)!.pos[1];

beforeEach(() => setUp([desk(), lamp(0.75)]));

describe('useRoomScene follows a resize while the studio is open', () => {
  it('moves the lamp on the very render the desk’s dims change', () => {
    const { result } = renderHook(() => useRoomScene());
    expect(yOf(result.current, LAMP)).toBe(0.75);
    act(() => useStudio.setState({ dims: { [DESK]: [1400, 700, 1100] } }));
    expect(yOf(result.current, LAMP)).toBe(1.1);
  });

  it('is woken by a parentIds write, which touches none of the three transform maps', () => {
    // The desk is already taller and the lamp already sits where a drag left it; the
    // only thing missing is the record of what it was put on. Nothing in
    // `positions` / `rotations` / `dims` changes here, so a `getState()` read of
    // `parentIds` leaves this render stale and the assertion red.
    setUp([desk(), lamp(0)]);
    useStudio.setState({ positions: { [LAMP]: [0, 0.75, 0] }, dims: { [DESK]: [1400, 700, 900] } });
    const { result } = renderHook(() => useRoomScene());
    expect(yOf(result.current, LAMP)).toBe(0.75);
    act(() => useStudio.setState({ parentIds: { [LAMP]: DESK } }));
    expect(yOf(result.current, LAMP)).toBe(0.9);
  });

  it('is woken by a room-height write, which does not touch `parts`', () => {
    // The clamp is a function of the ceiling, so lowering it must move a rider that
    // no longer fits — without any part changing.
    useStudio.setState({ dims: { [DESK]: [1400, 700, 2000] } });
    const { result } = renderHook(() => useRoomScene());
    expect(yOf(result.current, LAMP)).toBe(2); // 2.0 + 0.4 = 2.4, under the 2.48 cap
    act(() => useScene.setState({ room: { ...useScene.getState().room, height: 2.2 } }));
    expect(yOf(result.current, LAMP)).toBeCloseTo(2.2 - MOUNT_PAD - 0.4, 10);
  });

  it('puts the lamp back when the resize is undone', () => {
    const { result } = renderHook(() => useRoomScene());
    act(() => useStudio.setState({ dims: { [DESK]: [1400, 700, 1100] } }));
    expect(yOf(result.current, LAMP)).toBe(1.1);
    act(() => useStudio.setState({ dims: {} }));
    expect(yOf(result.current, LAMP)).toBe(0.75);
  });
});

describe('useSettledY — the per-part half the hot paths read', () => {
  it('is null for a piece that rides nothing', () => {
    const { result } = renderHook(() => useSettledY(DESK));
    expect(result.current).toBeNull();
  });

  it('is null for a rider until its support actually changes height', () => {
    const { result } = renderHook(() => useSettledY(LAMP));
    expect(result.current).toBeNull();
    act(() => useStudio.setState({ dims: { [DESK]: [2600, 700, 750] } })); // width only
    expect(result.current).toBeNull();
    act(() => useStudio.setState({ dims: { [DESK]: [2600, 700, 950] } }));
    expect(result.current).toBe(0.95);
  });

  it('is woken by a parentIds write of its own', () => {
    // Its OWN subscription, not `useRoomScene`'s. This is the hook `Draggable` reads,
    // so it is the 3D scene's only route to the corrected height — and it has a
    // separate copy of every subscription, which is a separate chance to write one as
    // a `getState()` read. Nothing in the three transform maps moves here.
    setUp([desk(), lamp(0)]);
    useStudio.setState({ positions: { [LAMP]: [0, 0.75, 0] }, dims: { [DESK]: [1400, 700, 900] } });
    const { result } = renderHook(() => useSettledY(LAMP));
    expect(result.current).toBeNull();
    act(() => useStudio.setState({ parentIds: { [LAMP]: DESK } }));
    expect(result.current).toBe(0.9);
  });

  it('is woken by a room-height write of its own', () => {
    useStudio.setState({ dims: { [DESK]: [1400, 700, 2000] } });
    const { result } = renderHook(() => useSettledY(LAMP));
    expect(result.current).toBe(2);
    act(() => useScene.setState({ room: { ...useScene.getState().room, height: 2.2 } }));
    expect(result.current).toBeCloseTo(2.2 - MOUNT_PAD - 0.4, 10);
  });
});

describe('currentRoomScene — the non-hook twin every pointer handler reads', () => {
  it('carries the correction, and reads BOTH halves of the context from the stores', () => {
    // `currentSceneContext()` had no test at all, and replacing its body with
    // `{ parentIds: {}, roomHeight: 99 }` left 647 tests green — while it is the only
    // thing feeding `currentRoomScene()`, which `Draggable`'s world snapshot,
    // `duplicateSelection`, `spinSelection`, `wall-actions` and `plan-export` all use.
    setUp([desk(), lamp(0)]);
    useStudio.setState({ positions: { [LAMP]: [0, 0.75, 0] }, dims: { [DESK]: [1400, 700, 900] } });
    // parentIds half: without it the authored lamp is on the floor and nothing infers.
    expect(yOf(currentRoomScene(), LAMP)).toBe(0.75);
    act(() => useStudio.setState({ parentIds: { [LAMP]: DESK } }));
    expect(yOf(currentRoomScene(), LAMP)).toBe(0.9);

    // roomHeight half: the clamp is a function of the ceiling, so a shorter room
    // gives a different answer for the same parts and the same overrides.
    act(() => useStudio.setState({ dims: { [DESK]: [1400, 700, 2000] } }));
    expect(yOf(currentRoomScene(), LAMP)).toBe(2);
    act(() => useScene.setState({ room: { ...useScene.getState().room, height: 2.2 } }));
    expect(yOf(currentRoomScene(), LAMP)).toBeCloseTo(2.2 - MOUNT_PAD - 0.4, 10);
  });
});

describe('a copy of a rider is a rider', () => {
  it('gives the duplicate the relation, so it does not sever from the piece it was cloned from', () => {
    // `duplicateSelection` copies `pos` out of `currentRoomScene()`, which now carries
    // the CORRECTED height, into the new part's AUTHORED position — where
    // `resetTransforms` cannot reach it and `RoomSync` persists it. Without the
    // relation the copy is authored at 0.9 while the desk's authored top is 0.75, so
    // `ridingParents` rejects it: shrink the desk back and the original returns while
    // the copy stays put — two identical lamps on one desk, 150 mm apart.
    //
    // The whole scene is read after each step rather than the map, because the defect
    // is about which LAYER the height came from.
    // A WIDE desk on purpose: `COPY_OFFSETS` puts the first copy 350 mm away on both
    // axes, and on the standard 1400 x 700 desk that leaves 49.7% of the lamp over the
    // edge — just under `MIN_SUPPORT_SHARE`, so `stillOver` correctly declines it and
    // the copy is not a rider at all. Measured, after this case first failed on it.
    const wide = { ...desk(), dimMM: [2400, 2000, 750] } as ScenePart;
    setUp([wide, lamp(0.75)]);
    act(() => useStudio.setState({ dims: { [DESK]: [2400, 2000, 900] }, selection: [LAMP], selectedPartId: LAMP }));
    expect(yOf(currentRoomScene(), LAMP)).toBe(0.9);

    act(() => duplicateSelection());
    const copyId = useScene.getState().parts.map((p) => p.id).find((id) => id !== DESK && id !== LAMP);
    expect(copyId, 'the duplicate was not created, so nothing below is measuring anything').toBeDefined();
    expect(useStudio.getState().parentIds[copyId!], 'the copy rides what the original rides').toBe(DESK);

    // And it behaves like one: put the desk back and BOTH lamps come down together.
    act(() => useStudio.setState({ dims: {} }));
    const back = currentRoomScene();
    expect(yOf(back, LAMP)).toBe(0.75);
    expect(yOf(back, copyId!)).toBe(0.75);
  });
});

describe('usePartTransform composes the correction into the position it returns', () => {
  it('reports the settled Y for the rider and the plain one for its support', () => {
    const parts = [desk(), lamp(0.75)];
    const rider = renderHook(() => usePartTransform(parts[1]));
    const support = renderHook(() => usePartTransform(parts[0]));
    expect(rider.result.current.pos).toEqual([0, 0.75, 0]);

    act(() => useStudio.setState({ dims: { [DESK]: [1400, 700, 1100] } }));
    expect(rider.result.current.pos).toEqual([0, 1.1, 0]);
    // x and z are untouched — the correction is one axis, and a version that rebuilt
    // the whole position from the support would drag the lamp to the desk's centre.
    expect(support.result.current.pos).toEqual([0, 0, 0]);
  });

  it('keeps the x/z of a position override while correcting only Y', () => {
    // The lamp was dragged to the far corner of the desk. Its x/z are the drag's, its
    // Y is the pass's.
    useStudio.setState({ positions: { [LAMP]: [0.5, 0.75, 0.2] } });
    const parts = [desk(), lamp(0.75)];
    const { result } = renderHook(() => usePartTransform(parts[1]));
    expect(result.current.pos).toEqual([0.5, 0.75, 0.2]);
    act(() => useStudio.setState({ dims: { [DESK]: [1400, 700, 900] } }));
    expect(result.current.pos).toEqual([0.5, 0.9, 0.2]);
  });
});
