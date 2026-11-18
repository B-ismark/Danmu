// @vitest-environment jsdom
//
// The floor is selected by clicking it, like a wall. Reported as: "there's no way to
// change the texture for the floor since there's no way to select it" — its finish
// lived only in a shut section of the left rail.
//
// jsdom because useStudio persists through zustand's `persist`, which wants
// localStorage.

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { applySnapshot, type Snapshot } from '@/lib/history';
import { stripComments } from './helpers/source';

const read = (f: string) => stripComments(readFileSync(f, 'utf8'));

beforeEach(() => {
  useStudio.getState().setSelected(null);
});

describe('the floor is one of four exclusive selections', () => {
  it('selecting the floor clears a piece and a wall', () => {
    const s = useStudio.getState();
    s.setSelected('p1');
    s.setSelectedFloor(true);
    expect(useStudio.getState()).toMatchObject({ selectedFloor: true, selectedPartId: null, selection: [], selectedWall: null });
    s.setSelectedWall(2);
    s.setSelectedFloor(true);
    expect(useStudio.getState()).toMatchObject({ selectedFloor: true, selectedWall: null });
  });

  it('every other way of selecting clears the floor', () => {
    const s = useStudio.getState();
    for (const pick of [
      () => s.setSelected('p1'),
      () => s.setSelected(null), // Esc, a click beyond the room, the empty panel
      () => s.setSelection(['p1', 'p2'], 'p1'),
      () => s.setSelectedWall(0),
      () => s.toggleInSelection('p3'),
    ]) {
      s.setSelectedFloor(true);
      pick();
      expect(useStudio.getState().selectedFloor).toBe(false);
    }
  });

  it('undo puts the floor back as selected, and an older snapshot without it reads as not', () => {
    const sc = useScene.getState();
    const t = useStudio.getState();
    const snap: Snapshot = {
      positions: t.positions, rotations: t.rotations, dims: t.dims, parentIds: t.parentIds,
      parts: sc.parts, room: sc.room, lighting: t.lighting, hour: t.hour, hidden: t.hidden, pinned: t.pinned,
      selectedPartId: null, selection: [], selectedWall: null, selectedFloor: true,
    };
    applySnapshot(snap);
    expect(useStudio.getState().selectedFloor).toBe(true);
    applySnapshot({ ...snap, selectedFloor: undefined } as unknown as Snapshot);
    expect(useStudio.getState().selectedFloor).toBe(false);
  });
});

describe('a click on the room is a click, not the end of a look around', () => {
  const shell = read('components/three/RoomShell.tsx');

  it('the floor and every wall select through the same still-click gate', () => {
    // The eyedropper's pick sits between the gate and the select, so a pick is a still
    // click too: a look-around that ends over a wall must not paint the selection.
    expect(shell).toMatch(/onClick=\{[^}]*\{\s*e\.stopPropagation\(\);\s*if \(!isStillClick\(e\)\) return;\s*if \(isPickingColor\(\)\) return pickColor\(\{ kind: 'floor' \}\);\s*setSelectedFloor\(true\);/);
    expect(shell).toMatch(/if \(!isStillClick\(e\)\) return;\s*(?:\/\/[^\n]*\s*)*if \(isPickingColor\(\)\) return pickColor\(\{ kind: 'wall', index: i \}\);\s*setSelectedWall\(i\);/);
  });

  it('spends the gizmo gate before anything can return early', () => {
    // Otherwise a rotate released over the floor (delta > 2) would leave the gate
    // armed, and it would eat the next ordinary click.
    const body = shell.slice(shell.indexOf('function isStillClick'));
    const gate = body.indexOf('consumeGizmoClick()');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf('travelledPastClick(e)'));
    expect(body).toMatch(/if \(travelledPastClick\(e\)\) return false;/);
  });

  it('a click is two pixels of travel for a mouse, ten for a finger or pen', async () => {
    const { travelledPastClick, STILL_PX, STILL_TOUCH_PX } = await import('@/lib/still-click');
    expect(STILL_PX).toBe(2);
    // A finger wobbles on a tap; 2 px there made the floor and walls feel dead.
    expect(STILL_TOUCH_PX).toBe(10);
    const at = (delta: number, pointerType: string) => travelledPastClick({ delta, nativeEvent: { pointerType } });
    expect(at(2, 'mouse')).toBe(false);
    expect(at(3, 'mouse')).toBe(true);
    expect(at(10, 'touch')).toBe(false);
    expect(at(11, 'touch')).toBe(true);
    expect(at(10, 'pen')).toBe(false);
    expect(at(11, 'pen')).toBe(true);
  });

  it('the eyedropper on a piece in 3D obeys the same line: an orbit ending on it is not a pick', () => {
    const pick = read('components/three/Pickable.tsx');
    expect(pick).toMatch(/if \(isPickingColor\(\)\) \{\s*if \(travelledPastClick\(e\)\) return;\s*pickColor\(\{ kind: 'part', id: partId \}\);/);
  });

  it('the panel opens on the floor when it is selected', () => {
    const insp = read('components/studio/Inspector.tsx');
    expect(insp).toMatch(/if \(selectedFloor\) return <FloorInspector \/>;/);
    expect(insp).toMatch(/function FloorInspector\(\)[\s\S]*?<FloorFinishEditor \/>/);
    // And a selected wall carries the walls' finish beside its colour.
    expect(insp).toMatch(/function WallInspector[\s\S]*?<WallFinishEditor titled=\{false\} \/>[\s\S]*?Move wall/);
  });
});
