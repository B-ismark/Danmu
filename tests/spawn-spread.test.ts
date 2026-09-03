// § H.3: every Library click dropped its piece at the room centre, facing the same way.
//
// Measured before the fix: three beds at `pos [0,0,0] rot 0`, stacked inside one
// another. Both halves of that have one cause — with no aim point `placeNewPart` reads
// `ax = az = 0`, so the piece is placed in the middle AND asks `snapToWall` which wall
// is nearest the middle, which is the same wall every time. Moving the aim fixes the
// heading for free, which is why "fan out from the drop point" was the only one of the
// three answers put to the user that could fix the yaw at all.
//
// Answered 2026-09-03: fan out, with a legality gate.
//
// The caller half — that `spawn` actually passes the aim it is given — is
// `tests/spawn-spread-wired.test.tsx`. A gate on a pure function says nothing about the
// screen that calls it, which cost a whole feature one cycle ago.

import { describe, expect, it } from 'vitest';
import { footprintForLayout } from '@/lib/footprint';
import { footFromPart, footInsidePoly, obbOverlap } from '@/lib/geometry';
import {
  openSpotForNewPart,
  placeNewPart,
  type Category,
  type ScenePart,
  type Shape,
} from '@/lib/scene-spec';

const ROOM = (w = 6, d = 5) => ({
  width: w, depth: d, height: 2.5, footprint: footprintForLayout('rect', w, d),
});

const BED: [Category, Shape, [number, number, number]] = ['bed', 'bed-double', [1600, 2000, 500]];
const CHAIR: [Category, Shape, [number, number, number]] = ['chair', 'chair-dining', [450, 500, 900]];

/** Add `n` of the same thing the way `CatalogPanel.spawn` does — one at a time, each
 *  seeing the ones before it, which is the whole reason the loop is sequential. */
function addMany(
  n: number,
  [cat, shape, dim]: [Category, Shape, [number, number, number]],
  room = ROOM(),
): ScenePart[] {
  const parts: ScenePart[] = [];
  for (let i = 0; i < n; i++) {
    const aim = openSpotForNewPart(cat, shape, dim, room, parts);
    const { pos, rot, wallMounted } = placeNewPart(cat, shape, dim, room, parts, aim);
    parts.push({
      id: `${cat}-${i}`, name: `${cat} ${i}`, category: cat, shape,
      dimMM: dim, pos, rot, locked: false, wallMounted,
    } as ScenePart);
  }
  return parts;
}

const foot = (p: ScenePart) => footFromPart(p.pos, p.rot, p.dimMM, p.circle);

describe('the first piece into an empty room is placed exactly as it always was', () => {
  it('asks for no aim at all', () => {
    // `undefined`, not `[0, 0]`. They resolve the same today, and returning a point
    // would make this function responsible for a default that `placeNewPart` owns.
    expect(openSpotForNewPart(...BED, ROOM(), [])).toBeUndefined();
  });

  it('lands where the unaimed call has always landed', () => {
    const room = ROOM();
    const aimed = placeNewPart(...BED, room, [], openSpotForNewPart(...BED, room, []));
    const plain = placeNewPart(...BED, room, []);
    expect(aimed.pos).toEqual(plain.pos);
    expect(aimed.rot).toEqual(plain.rot);
  });
});

describe('three of the same piece are three pieces, not one piece three times', () => {
  it('gives every bed its own footprint', () => {
    const beds = addMany(3, BED);
    expect(beds).toHaveLength(3);
    for (let i = 0; i < beds.length; i++) {
      for (let j = i + 1; j < beds.length; j++) {
        expect(
          obbOverlap(foot(beds[i]), foot(beds[j])),
          `${beds[i].id} and ${beds[j].id} overlap — that is the defect this closes`,
        ).toBe(false);
      }
    }
  });

  it('keeps every one of them inside the room', () => {
    // `footInsidePoly`, not `outsideShare`: the latter samples 10% in from the edges
    // and forgives a piece 20 mm through the plaster.
    const poly = footprintForLayout('rect', 6, 5);
    for (const bed of addMany(3, BED)) {
      expect(footInsidePoly(foot(bed), poly), `${bed.id} is not fully in the room`).toBe(true);
    }
  });

  it('stops them all facing the same way', () => {
    // The half of the complaint a "leave stacked" or "nearest wall" answer could not
    // have fixed: from the middle of a room the nearest wall does not vary.
    const rots = new Set(addMany(3, BED).map((b) => Math.round((b.rot * 180) / Math.PI)));
    expect(rots.size).toBeGreaterThan(1);
  });

  it('does the same for a small piece, at a step its own size', () => {
    // A fixed step would either overlap beds or scatter chairs across the room, so the
    // step is `hypot(w, d) + gap`. Four chairs must be four chairs…
    const chairs = addMany(4, CHAIR);
    for (let i = 0; i < chairs.length; i++) {
      for (let j = i + 1; j < chairs.length; j++) {
        expect(obbOverlap(foot(chairs[i]), foot(chairs[j]))).toBe(false);
      }
    }
    // …and they must stay near each other rather than being flung to the corners: the
    // furthest pair is within a couple of steps of a 0.77 m step, not across a 6 m room.
    const far = Math.max(
      ...chairs.flatMap((a) => chairs.map((b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]))),
    );
    expect(far).toBeLessThan(3);
  });
});

describe('nothing already in the room moves to make space', () => {
  it('places around what is there, not through it', () => {
    const room = ROOM();
    const sofa: ScenePart = {
      id: 'sofa-1', name: 'Sofa', category: 'sofa', shape: 'sofa', dimMM: [2200, 900, 800],
      pos: [0, 0, 0], rot: 0, locked: false, wallMounted: false,
    } as ScenePart;
    const aim = openSpotForNewPart(...CHAIR, room, [sofa]);
    expect(aim, 'the middle is occupied, so an aim point is owed').toBeDefined();
    const placed = placeNewPart(...CHAIR, room, [sofa], aim);
    const chair = { ...sofa, id: 'chair-1', shape: CHAIR[1], category: CHAIR[0], dimMM: CHAIR[2], pos: placed.pos, rot: placed.rot } as ScenePart;
    expect(obbOverlap(foot(chair), foot(sofa))).toBe(false);
    expect(sofa.pos).toEqual([0, 0, 0]);
  });
});

describe('a room with no room left still takes the piece', () => {
  it('adds it rather than refusing, and lets the room report say so', () => {
    // Rule 2's shape: a piece that does not fit keeps its real size and position and
    // `lib/clearance.ts` reports it. Silently declining to add what the user asked for
    // would be the same defect wearing a different coat.
    //
    // A 2.4 x 2.4 room with a 2.2 m sofa across it: nothing the search tries is clear.
    const tight = { width: 2.4, depth: 2.4, height: 2.5, footprint: footprintForLayout('rect', 2.4, 2.4) };
    const sofa: ScenePart = {
      id: 'sofa-1', name: 'Sofa', category: 'sofa', shape: 'sofa', dimMM: [2200, 900, 800],
      pos: [0, 0, 0], rot: 0, locked: false, wallMounted: false,
    } as ScenePart;
    expect(openSpotForNewPart(...BED, tight, [sofa])).toBeUndefined();
    // …and the caller still gets a placement out of `placeNewPart`.
    expect(placeNewPart(...BED, tight, [sofa], undefined).pos).toHaveLength(3);
  });
});
