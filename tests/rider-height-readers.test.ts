// @vitest-environment jsdom
//
// § 12's second half, and the half a `resolveParts`-only fix would have missed.
//
// A piece's position is read on two paths and only one of them is the list.
// `components/three/Draggable.tsx` writes `ref.current.position` straight to its own
// object3D from a per-part subscription, and `components/three/Dressing.tsx` follows one
// owner through `usePartTransform` — neither goes anywhere near `resolveParts`. So a
// derivation added to the list readers alone would have left a lamp seated in the 2D
// plan and floating in the 3D scene: two code paths for one observable fact, which is
// the shape CLAUDE.md keeps naming.
//
// jsdom because `useStudio` is wrapped in zustand's `persist` and wants localStorage,
// and because a hook needs a renderer. No page is mounted and no shims are needed —
// `renderHook` on the hook itself is the narrowest thing that can observe it.
//
// `Draggable` cannot be mounted here at all (it renders `<mesh>`; there is no R3F shim
// in this repo and CLAUDE.md says not to add one), so its half is gated at source in
// `tests/room-scene.test.ts` and named as unverified-by-eye in `docs/visual-check.md`.
import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { usePartTransform, useSettledY } from '@/lib/room-scene';
import { resetSettleMemo } from '@/lib/transforms';
import type { ScenePart } from '@/lib/scene-spec';

const part = (o: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
  ({ name: o.id, rot: 0, locked: false, ...o }) as ScenePart;

const DESK = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0, 0] });
const LAMP = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [300, 300, 400], pos: [0, 0.75, 0] });

beforeEach(() => {
  resetSettleMemo();
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
  useScene.setState({ parts: [DESK, LAMP] });
});

describe('the per-part readers see the same derived height as the list', () => {
  it('leaves the stored Y alone while nothing has been resized', () => {
    const { result } = renderHook(() => useSettledY('lamp'));
    expect(result.current).toBeUndefined();
  });

  // The headline. `usePartTransform` is what `Dressing` follows its owner by, so a
  // nightstand's books have to come down with the nightstand.
  it('gives usePartTransform the derived Y after the support is resized', () => {
    useStudio.setState({ dims: { desk: [1400, 700, 400] } });
    resetSettleMemo();
    const { result } = renderHook(() => usePartTransform(LAMP));
    expect(result.current.pos[1], 'the lamp is on the shrunk desk').toBeCloseTo(0.4, 9);
    expect(result.current.pos[0], 'x and z are untouched').toBe(0);
    expect(result.current.pos[2]).toBe(0);
  });

  // The x/z half asserted separately above and again here on the OVERRIDE, because a
  // derivation that rebuilt the whole triple from the authored pos would pass the test
  // above and silently discard a drag.
  it('keeps a position override in x and z while deriving only the Y', () => {
    useStudio.setState({
      positions: { lamp: [0.3, 0.75, -0.2] },
      dims: { desk: [1400, 700, 400] },
    });
    resetSettleMemo();
    const { result } = renderHook(() => usePartTransform(LAMP));
    expect(result.current.pos).toEqual([0.3, 0.4, -0.2]);
  });

  it('reports the same number through useSettledY as usePartTransform applies', () => {
    useStudio.setState({ dims: { desk: [1400, 700, 1100] } });
    resetSettleMemo();
    const y = renderHook(() => useSettledY('lamp')).result.current;
    const t = renderHook(() => usePartTransform(LAMP)).result.current;
    expect(y).toBeCloseTo(1.1, 9);
    expect(t.pos[1]).toBe(y);
  });

  // A piece with nothing under it stays where it is on this path too — the same § 37
  // boundary the pure tests pin, asserted through the hook because the hook is what the
  // 3D scene actually reads.
  it('does not seat a floating piece on the per-part path either', () => {
    const floater = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [300, 300, 400], pos: [0, 1.4, 0] });
    useScene.setState({ parts: [DESK, floater] });
    useStudio.setState({ dims: { desk: [1400, 700, 400] } });
    resetSettleMemo();
    const { result } = renderHook(() => usePartTransform(floater));
    expect(result.current.pos[1]).toBeCloseTo(1.4, 9);
  });
});
