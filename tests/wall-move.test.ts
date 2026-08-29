import { describe, expect, it } from 'vitest';
import { attachedToWall, carryAttached } from '../lib/wall-move';
import { footprintForLayout, offsetWall, wallOutwardNormal } from '../lib/footprint';
import type { ScenePart } from '../lib/scene-spec';
import { WALL_GAP } from '../lib/layout-rules';

// A 4 x 4 rectangle. footprintForLayout('rect') winds [-hw,-hd] → [hw,-hd] →
// [hw,hd] → [-hw,hd], so edge 0 is the North wall (z = -2) and edge 1 the East
// wall (x = +2).
const ROOM = footprintForLayout('rect', 4, 4);
const NORTH = 0;
const EAST = 1;

function part(over: Partial<ScenePart> & { id: string }): ScenePart {
  return {
    category: 'other',
    name: over.id,
    shape: 'box',
    pos: [0, 0, 0],
    rot: 0,
    dimMM: [1000, 600, 800],
    locked: false,
    ...over,
  };
}

/** Standing against the North wall: back face WALL_GAP off the plaster. */
const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 800], pos: [0, 0, -2 + WALL_GAP + 0.45] });
/** In the middle of the floor. */
const table = part({ id: 'table', shape: 'coffee-table', pos: [0, 0, 0], dimMM: [1000, 600, 400] });
/** Mounted IN the North wall. */
const window0 = part({ id: 'window', shape: 'window', wallMounted: true, pos: [0.5, 1.2, -2], dimMM: [1200, 100, 1200] });
/** Against the East wall, not the North one. */
const shelf = part({ id: 'shelf', category: 'shelf', shape: 'bookshelf', rot: -Math.PI / 2, dimMM: [1600, 300, 1800], pos: [2 - WALL_GAP - 0.15, 0, 0.4] });

describe('attachedToWall', () => {
  it('takes what is against the wall and what is mounted in it', () => {
    const ids = attachedToWall([sofa, table, window0, shelf], ROOM, NORTH);
    expect(ids).toEqual(['sofa', 'window']);
  });

  it('leaves furniture on a neighbouring wall alone — that wall stretches, it does not travel', () => {
    expect(attachedToWall([sofa, shelf], ROOM, EAST)).toEqual(['shelf']);
  });

  it('ignores a piece further off the wall than the tolerance', () => {
    const adrift = part({ id: 'adrift', pos: [0, 0, -2 + 0.4 + 0.3], dimMM: [1000, 600, 800] });
    expect(attachedToWall([adrift], ROOM, NORTH)).toEqual([]);
  });

  it('counts a piece already overlapping the wall', () => {
    const through = part({ id: 'through', pos: [0, 0, -2 + 0.2], dimMM: [1000, 600, 800] });
    expect(attachedToWall([through], ROOM, NORTH)).toEqual(['through']);
  });

  it('does not claim a piece that is close to the wall\'s LINE but past its end', () => {
    // Wall 0 spans x ∈ [-2, 2]. This sits at x = 6, z = -2: zero distance from the
    // infinite line the wall lies on, nowhere near the wall.
    const far = part({ id: 'far', pos: [6, 0, -2 + WALL_GAP + 0.4], dimMM: [1000, 600, 800] });
    expect(attachedToWall([far], ROOM, NORTH)).toEqual([]);
  });

  it('assigns a wall-mounted piece to one wall only — the one apertures.ts would cut', () => {
    // A window near the NE corner belongs to whichever edge is nearest, and to
    // exactly one, or its hole and its glass would end up on different walls.
    const corner = part({ id: 'corner', shape: 'window', wallMounted: true, pos: [1.9, 1.2, -2], dimMM: [900, 100, 1200] });
    const north = attachedToWall([corner], ROOM, NORTH);
    const east = attachedToWall([corner], ROOM, EAST);
    expect(north.length + east.length).toBe(1);
  });
});

describe('carryAttached', () => {
  const ids = ['sofa', 'window'];
  const parts = [sofa, table, window0, shelf];

  it('moves carried pieces by the wall delta along the wall normal, and nothing else', () => {
    const after = offsetWall(ROOM, NORTH, 0.5); // push North out 500 mm
    const moves = carryAttached(ids, parts, ROOM, after, wallOutwardNormal(ROOM, NORTH), 0.5);
    expect(moves.map((m) => m.id).sort()).toEqual(['sofa', 'window']);
    const bySofa = moves.find((m) => m.id === 'sofa')!;
    // North's outward normal is -Z, so pushing it out moves the sofa to lower z.
    expect(bySofa.pos[2]).toBeCloseTo(sofa.pos[2] - 0.5, 10);
    expect(bySofa.pos[0]).toBeCloseTo(sofa.pos[0], 10);
    // Height is never touched by a horizontal wall move.
    expect(bySofa.pos[1]).toBe(sofa.pos[1]);
    const byWindow = moves.find((m) => m.id === 'window')!;
    expect(byWindow.pos[2]).toBeCloseTo(-2.5, 10);
    expect(byWindow.pos[1]).toBe(window0.pos[1]);
  });

  it('carries them inward too, keeping the gap to the wall', () => {
    const after = offsetWall(ROOM, NORTH, -0.5);
    const moves = carryAttached(ids, parts, ROOM, after, wallOutwardNormal(ROOM, NORTH), -0.5);
    const bySofa = moves.find((m) => m.id === 'sofa')!;
    expect(bySofa.pos[2]).toBeCloseTo(sofa.pos[2] + 0.5, 10);
    // Still against its wall after the move — the gap is what makes it "attached".
    expect(attachedToWall([{ ...sofa, pos: bySofa.pos }], after, NORTH)).toEqual(['sofa']);
  });

  it('refuses to carry a floor piece out of the room, but never blocks a wall-mounted one', () => {
    // An L-shape: pushing a wall can shorten a neighbouring edge, so a carried
    // piece can end up over the notch rather than over floor.
    const L = footprintForLayout('l', 6, 6);
    // Deliberately impossible: a huge delta so the carried position lands outside
    // whatever the polygon becomes.
    const after = offsetWall(L, 0, 0.4);
    const inside = part({ id: 'inside', pos: [0, 0, -3 + WALL_GAP + 0.4], dimMM: [1000, 600, 800] });
    const glass = part({ id: 'glass', shape: 'window', wallMounted: true, pos: [0, 1.2, -3], dimMM: [1000, 100, 1200] });
    const carried = carryAttached(
      ['inside', 'glass'],
      [inside, glass],
      L,
      after,
      wallOutwardNormal(L, 0),
      -20, // pull the wall 20 m in: no floor piece can follow that and stay inside
    );
    expect(carried.map((m) => m.id)).toEqual(['glass']);
  });

  it('is a no-op for an empty selection or a zero step', () => {
    expect(carryAttached([], parts, ROOM, ROOM, [0, -1], 0.5)).toEqual([]);
    expect(carryAttached(ids, parts, ROOM, ROOM, [0, -1], 0)).toEqual([]);
  });
});

describe('offsetWall moves the selected edge and nothing else', () => {
  // This describe used to be titled `wallOutwardNormal`, and its one case — *"points
  // out of the room on every edge, and agrees with offsetWall"* — asserted only the
  // second half of its own name. It compared `offsetWall`'s displacement against
  // `wallOutwardNormal`, and `offsetWall` IS `wallOutwardNormal` plus an addition, so
  // it could not fail. It swept the U, where three of eight normals were reversed at
  // the time, and passed; it stayed green under both mutations that put the centroid
  // flip back. A green from a gate that cannot go red is worse than no gate at all,
  // because the name promises exactly the coverage it does not provide.
  //
  // Which way a normal points is swept honestly in `tests/footprint.test.ts`
  // (`wallOutwardNormal points out of the ROOM, not away from a point`), against the
  // polygon rather than against the function under test. Repeating it here would be a
  // second copy of that sweep and the beginning of the next drift. What is left for
  // this file is the half `offsetWall` owns and nothing else knows: pushing a wall is
  // a TRANSLATION of that wall's own two corners, and every other corner stays put.
  // Four rather than five: `footprintForLayout` returns the same rectangle for
  // `open` as for `rect` (one switch branch, three labels), so an `open` case here
  // would be a second copy of the `rect` one under a different name. Checked, not
  // assumed. (The direction sweep in `tests/footprint.test.ts` does name all five, so
  // it carries that duplicate; raised by danmu-62 as a coverage asymmetry between the
  // two files, and this is the answer rather than a matching duplicate here.)
  const LAYOUTS = ['rect', 'l', 't', 'u'] as const;

  it.each(LAYOUTS)('translates both corners of the edge and no others, on a %s', (layout) => {
    const poly = footprintForLayout(layout, 5, 5);
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const moved = offsetWall(poly, i, 0.25);
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        expect(moved[k], `${layout} edge ${i}: corner ${k} must not have moved`).toEqual(poly[k]);
      }
      const da = [moved[i][0] - poly[i][0], moved[i][1] - poly[i][1]];
      const db = [moved[j][0] - poly[j][0], moved[j][1] - poly[j][1]];
      // Both ends by the SAME vector: a wall that moves is a wall, not a hinge.
      expect(db[0], `${layout} edge ${i}`).toBeCloseTo(da[0], 10);
      expect(db[1], `${layout} edge ${i}`).toBeCloseTo(da[1], 10);
      // …by exactly the distance asked for, square to the wall's own run. Both are
      // `offsetWall`'s contract and neither is readable off the normal alone.
      expect(Math.hypot(da[0], da[1]), `${layout} edge ${i}`).toBeCloseTo(0.25, 10);
      const ex = poly[j][0] - poly[i][0];
      const ez = poly[j][1] - poly[i][1];
      expect(da[0] * ex + da[1] * ez, `${layout} edge ${i}`).toBeCloseTo(0, 10);
    }
  });
});

describe('the ceiling family belongs to the room, not to an edge of it', () => {
  /** `wallMounted` means "this piece's geometry is centred on its origin" and is true
   *  for a ceiling fan and a pendant. `ridesWall` is the narrower question this module
   *  actually asks — the `wall-*` anchors and only those — and `ridesWall`'s own
   *  docblock already named the pendant as the case that must not be slid onto a wall.
   *  Both sites here read the wider flag, which cost the same piece twice. */
  const pendant = part({
    id: 'pendant',
    category: 'lamp',
    shape: 'lamp-pendant',
    wallMounted: true,
    pos: [0, 2.45, -0.5],
    dimMM: [350, 350, 400],
  });

  it('does not claim a pendant hanging 1.5 m clear of the wall', () => {
    // `attachedToWall`'s mounted branch hands the question to `nearestEdge`, which
    // always names SOME wall — so the flag made every ceiling piece attached to
    // whichever edge happened to be nearest, and a wall drag carried it sideways off
    // whatever it hangs over. The geometric branch answers 1.325 m and declines.
    expect(attachedToWall([pendant, table], ROOM, NORTH)).toEqual([]);

    // The control: a piece genuinely IN that wall is still claimed, so this is not
    // "the branch stopped working".
    expect(attachedToWall([pendant, window0], ROOM, NORTH)).toEqual(['window']);
  });

  it('will not carry a pendant out of the room it hangs in', () => {
    // The wall-rider exemption from the was-inside/now-inside test exists because a
    // rider's footprint sits ON the boundary, where containment is a coin flip. Gated
    // on `wallMounted` it covered the ceiling family too — so a pendant could be
    // carried anywhere with nothing testing whether it still fitted. Here the North
    // wall is dragged 3.5 m past the pendant, which would land it at z = +3.0 in a
    // room that now ends at z = +2.
    const outward = wallOutwardNormal(ROOM, NORTH);
    const after = offsetWall(ROOM, NORTH, -3.5);
    const carried = carryAttached(['pendant'], [pendant], ROOM, after, outward, -3.5);
    expect(carried).toEqual([]);

    // …and the exemption still holds for something that really does ride the wall,
    // which is what stops this being a fix that just turns the branch off.
    const kept = carryAttached(['window'], [window0], ROOM, after, outward, -3.5);
    expect(kept.map((c) => c.id)).toEqual(['window']);
  });
});
