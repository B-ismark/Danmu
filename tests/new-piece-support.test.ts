// A new piece is asked what it stands on at the turn and outline it will have.
//
// `placeNewPart` used to ask `findSupportDetailed` about an unturned box, because the
// probe's turn and outline were optional and it passed neither. So a monitor turned to
// face a side wall was tested along the wrong axis, and a table lamp by the square
// around it. Both are shown below in the band where the two readings disagree — each
// test first proves the fixture is in that band, since a spot where the box and the
// real outline agree would pass with the defect back in.
//
// The probe's two parameters are required now. That makes every caller SAY something,
// and no more: `undefined` still compiles, which is what the two callers that took the
// default were passing in effect. So the Inspector's model swap, the other one, has its
// own test — `tests/seat-swap.test.tsx`, for the outline and the turn both.

import { describe, expect, it } from 'vitest';
import { findSupportDetailed } from '@/lib/physics';
import { placeNewPart, type ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

const part = (o: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
  ({ name: o.id, rot: 0, locked: false, ...o }) as ScenePart;

const FP: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const ROOM = { width: 6, depth: 4, height: 2.6, footprint: FP };

describe('placeNewPart asks with the new piece’s own outline and turn', () => {
  it('a table lamp more than half over a coffee table’s corner stands on it', () => {
    const coffee = part({ id: 'coffee', category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [0, 0, 0] });
    const lampDim: [number, number, number] = [250, 250, 500];
    // 50 mm in from the corner on both axes: 49% of the square around the lamp is over
    // the table, and more than half of the lamp.
    const at: [number, number] = [0.55 - 0.05, 0.3 - 0.05];
    const self = { id: 'probe', category: 'lamp', shape: 'lamp-table' } as const;
    expect(findSupportDetailed([coffee], self, at[0], at[1], lampDim, 0, undefined)).toBeNull();
    expect(findSupportDetailed([coffee], self, at[0], at[1], lampDim, 0, true)?.id).toBe('coffee');

    const r = placeNewPart('lamp', 'lamp-table', lampDim, ROOM, [coffee], at);
    expect(r.pos[0]).toBeCloseTo(at[0], 9);
    expect(r.pos[2]).toBeCloseTo(at[1], 9);
    expect(r.pos[1]).toBeCloseTo(0.42, 9);
    expect(r.supportId).toBe('coffee');
  });

  it('a monitor turned to face a side wall is tested along its own axis', () => {
    // A desk against the east wall, turned to face into the room: 1.4 m along z.
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [3 - 0.35 - 0.02, 0, 0], rot: -Math.PI / 2 });
    const monDim: [number, number, number] = [600, 200, 400];
    const at: [number, number] = [2.8, 0.68];

    const r = placeNewPart('monitor', 'monitor', monDim, ROOM, [desk], at);
    // It takes the east wall's heading, so its 600 mm runs along z — off the desk's
    // end by 280 mm of it, where unturned it would be 200 mm deep across that end.
    expect(r.rot).toBeCloseTo(-Math.PI / 2, 9);
    const self = { id: 'probe', category: 'monitor', shape: 'monitor' } as const;
    expect(findSupportDetailed([desk], self, r.pos[0], r.pos[2], monDim, 0, undefined)).toBeNull();
    expect(findSupportDetailed([desk], self, r.pos[0], r.pos[2], monDim, r.rot, undefined)?.id).toBe('desk');

    expect(r.pos[1]).toBeCloseTo(0.75, 9);
    expect(r.supportId).toBe('desk');
  });
});
