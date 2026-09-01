// § 12 — a rider stays at the size the room was BUILT at, after a reload.
//
// The defect is a SEQUENCE, not a function: `buildSceneFromRoom` ends on
// `settleHeights`, which answers entirely in `dimMM`; a resize writes a `dims`
// override and never touches `dimMM`; the load applies those overrides afterwards
// and nothing settles again. So every assertion here reproduces the sequence — build
// against authored sizes, then apply saved ones — rather than calling `settleRiders`
// on a hand-made pair and checking it returns the number it was given.
//
// The reason that matters: a fixture built at the ANSWER cannot express this defect.
// Hand a lamp a `pos[1]` that is already right and every arrangement of this code
// passes, including the broken one.

import { describe, it, expect } from 'vitest';
import { settleRiders } from '@/lib/rider-settle';
import { settleHeights } from '@/lib/layout-settle';
import { resolveParts } from '@/lib/transforms';
import type { ScenePart } from '@/lib/scene-spec';

const ROOM_H = 2.8;

const part = (o: Partial<ScenePart> & Pick<ScenePart, 'id'>): ScenePart =>
  ({
    name: o.id,
    category: 'other',
    shape: 'box',
    pos: [0, 0, 0],
    rot: 0,
    dimMM: [400, 400, 400],
    ...o,
  }) as ScenePart;

/** A desk with a table lamp standing on it, both authored consistently — i.e. the
 *  state `buildSceneFromRoom` leaves behind, with the lamp already settled onto the
 *  desk's AUTHORED top. */
function deskAndLamp(deskH = 750) {
  return [
    part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, deskH], pos: [0, 0, 0] }),
    part({
      id: 'lamp',
      category: 'lamp',
      shape: 'lamp-table',
      dimMM: [200, 200, 400],
      pos: [0, deskH / 1000, 0],
    }),
  ];
}

describe('§ 12 · a rider follows the surface it stands on when that surface is resized', () => {
  it('reproduces the defect before asserting the fix', () => {
    // The exact load sequence, with nothing settling after the override lands.
    const parts = deskAndLamp(750);
    const dims: Record<string, [number, number, number]> = { desk: [1400, 700, 400] };
    const asDrawn = resolveParts(parts, { dims });
    const lamp = asDrawn.find((p) => p.id === 'lamp')!;
    // The desk is 400 mm tall now and the lamp is still standing at 750 mm.
    expect(lamp.pos[1]).toBeCloseTo(0.75, 5);
    expect(lamp.pos[1] - 0.4, 'the gap the user sees, in metres').toBeCloseTo(0.35, 5);
  });

  it('puts the lamp back on the shrunk desk', () => {
    const parts = deskAndLamp(750);
    const dims: Record<string, [number, number, number]> = { desk: [1400, 700, 400] };
    const out = settleRiders(parts, { dims }, ROOM_H);
    const lamp = out.parts.find((p) => p.id === 'lamp')!;
    expect(lamp.pos[1], 'the lamp should sit on the 400 mm desk top').toBeCloseTo(0.4, 5);
    expect(out.moved.map((m) => m.id)).toEqual(['lamp']);
    expect(out.moved[0].from).toBeCloseTo(0.75, 5);
  });

  it('follows a desk that grew, not only one that shrank', () => {
    // The asymmetric case: a fix that only ever drops things passes the test above.
    const parts = deskAndLamp(750);
    const out = settleRiders(parts, { dims: { desk: [1400, 700, 1100] } }, ROOM_H);
    expect(out.parts.find((p) => p.id === 'lamp')!.pos[1]).toBeCloseTo(1.1, 5);
  });

  it('leaves a room nobody has resized completely alone, by identity', () => {
    const parts = deskAndLamp(750);
    const out = settleRiders(parts, {}, ROOM_H);
    // Identity, not deep equality: the caller skips the store write on this, and a
    // fresh array every load would make `useScene`'s subscribers fire on every room
    // open and re-persist a scene that did not change.
    expect(out.parts).toBe(parts);
    expect(out.moved).toEqual([]);
  });
});

describe('§ B.16 · the objection that kept this unfixed, answered rather than overruled', () => {
  it('NEVER creates a position override for a piece the user has not moved', () => {
    // This is the whole reason the fix was recorded as a decision: an override pins
    // its value against a re-detect and persists it, so writing one to correct a
    // DISPLAY fault stamps the user's room. The lamp here has no override and must
    // still have none afterwards.
    const parts = deskAndLamp(750);
    const positions: Record<string, [number, number, number]> = {};
    const out = settleRiders(parts, { dims: { desk: [1400, 700, 400] }, positions }, ROOM_H);
    expect(out.moved.map((m) => m.id), 'the lamp did move — so the fix ran').toEqual(['lamp']);
    expect(Object.keys(out.positions), 'and it moved without minting an override').toEqual([]);
    expect(out.positions, 'the map is returned by identity when untouched').toBe(positions);
  });

  it('corrects an override that already exists, keeping x and z', () => {
    // The other half: a lamp the user HAS dragged is already pinned, so correcting
    // its Y adds no pinning that was not there a moment ago — and leaving it would
    // mean a dragged lamp floats where an undragged one does not, which is the worse
    // outcome and the harder one to report.
    const parts = deskAndLamp(750);
    const positions: Record<string, [number, number, number]> = { lamp: [0.3, 0.75, -0.2] };
    const out = settleRiders(parts, { dims: { desk: [1400, 700, 400] }, positions }, ROOM_H);
    expect(out.positions.lamp).toEqual([0.3, 0.4, -0.2]);
    expect(Object.keys(out.positions), 'still exactly one override, the one that was there').toEqual(['lamp']);
    // The authored layer is untouched in this branch.
    expect(out.parts, 'no authored write when the override took the fix').toBe(parts);
  });
});

describe('§ 12 · the fix is the same answer the builder already gives', () => {
  it('agrees with settleHeights run on the resolved parts', () => {
    // Not a tautology restated: it pins that `settleRiders` resolves FIRST and settles
    // second. Swap the order — settle the authored parts and then resolve — and this
    // goes red, because that is precisely the sequence the defect is.
    const parts = deskAndLamp(750);
    const o = { dims: { desk: [1400, 700, 400] as [number, number, number] } };
    const independent = settleHeights(resolveParts(parts, o), ROOM_H);
    const out = settleRiders(parts, o, ROOM_H);
    const lamp = out.parts.find((p) => p.id === 'lamp')!;
    expect(lamp.pos[1]).toBeCloseTo(independent.find((f) => f.id === 'lamp')!.y, 6);
  });
});
