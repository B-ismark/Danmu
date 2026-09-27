// @vitest-environment jsdom
//
// The room size panel's one standing line: which piece is holding a width or depth
// up. It is there because pressing DOWN at that floor is correctly inert, and an
// arrow that does nothing needs a sentence. It used to show whenever any piece raised
// the floor at all, so a furnished 6 m room carried "Width stops at 2.4 m" under its
// fields permanently: a tip, not an explanation. It speaks only at the floor now.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { roomAxisRange } from '@/lib/dimension-ranges';
import { boundsToUnit, formatDim, toMM } from '@/lib/units';
import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio, type DimUnit } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('floor-hint-room'));

const { RoomDimsEditor } = await import('@/components/studio/RoomDimsEditor');

const RUG: ScenePart = {
  id: 'rug-1',
  name: 'Area rug',
  category: 'rug',
  shape: 'rug',
  dimMM: [2400, 1600, 10],
  pos: [0, 0.005, 0],
  rot: 0,
  locked: false,
} as ScenePart;

/** The field's own floor, from the same call the arrows are bounded by. */
const widthFloor = (u: DimUnit) => boundsToUnit(RUG.dimMM[0], roomAxisRange('width').max * 1000, u).min;

function mount(width: number, unit: DimUnit) {
  cleanup();
  useScene.setState({
    parts: [RUG],
    room: {
      ...useScene.getState().room,
      width,
      depth: 5,
      height: 2.6,
      footprint: footprintForLayout('rect', width, 5),
      layoutId: 'rect',
    },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [], selectedPartId: null });
  useSettings.setState({ dimUnit: unit });
  return render(<RoomDimsEditor />);
}

beforeEach(() => cleanup());

describe('the furniture floor is said only where the arrow stops', () => {
  it('a room well above the rug says nothing', () => {
    const { container } = mount(6, 'm');
    expect(container.textContent).not.toMatch(/Area rug/);
  });

  it.each(['m', 'ft'] as DimUnit[])('a room at the rug names it, in %s', (unit) => {
    // Stored at the field's floor in THIS unit, which in feet is 2408 mm and not 2400:
    // the field reads 7.9 there and its down arrow is already inert.
    const min = widthFloor(unit);
    const { container } = mount(toMM(min, unit) / 1000, unit);
    expect(container.textContent).toContain(`“Area rug” needs ${min} ${unit}, so the width stops there.`);
    // Depth is 5 m against a 1.6 m rug, nowhere near its floor.
    expect(container.textContent).not.toMatch(/the depth stops/);
  });

  it('a room the rug already overhangs gives the rug its size, not a need', () => {
    // A 2.4 m rug in a 2.0 m room pins the floor to 2.0 m. "Needs 2 m" would be
    // false; the rug is 2.4 m and does not fit.
    const { container } = mount(2, 'm');
    // At display precision, as `floorRefusal` states the same fact: a size, not a bound.
    expect(container.textContent).toContain(`“Area rug” is ${formatDim(RUG.dimMM[0], 'm')} m and already does not fit, so the width stops here.`);
    expect(container.textContent).not.toMatch(/needs/);
  });
});
