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
  isRoundPart,
} from '@/lib/scene-spec';

const ROOM = (w = 6, d = 5) => ({
  width: w, depth: d, height: 2.5, footprint: footprintForLayout('rect', w, d),
});

const BED: [Category, Shape, [number, number, number]] = ['bed', 'bed-double', [1600, 2000, 500]];
const CHAIR: [Category, Shape, [number, number, number]] = ['chair', 'chair-dining', [450, 500, 900]];
/** Round, and NOT tabletop-prone — so it exercises the circle gate without also
 *  exercising the stacking one, which is a different test below. */
const STOOL: [Category, Shape, [number, number, number]] = ['chair', 'stool', [350, 350, 450]];
/** Round AND tabletop-prone: the family that built the tower. */
const LAMP_FLOOR: [Category, Shape, [number, number, number]] = ['lamp', 'lamp-floor', [350, 350, 1500]];

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
      dimMM: dim, pos, rot, locked: false, wallMounted, circle: isRoundPart(shape) || undefined,
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

describe('a room that is not centred on the origin', () => {
  /** The same 6 x 5 rectangle, translated. Every `footprintForLayout` room is centred on
   *  the origin by construction, which is why no fixture in this file could see the
   *  defect below — but `footprintBounds`' own docblock says a footprint "is no longer
   *  guaranteed centred on the origin (walls can be dragged independently)". */
  const OFFSET = (dx: number, dz: number) => ({
    width: 6, depth: 5, height: 2.5,
    footprint: footprintForLayout('rect', 6, 5).map(([x, z]) => [x + dx, z + dz] as [number, number]),
  });

  it('fans out around the ROOM, not around the world origin', () => {
    // Measured on the original: with the room at x ∈ [4, 10], z ∈ [4.5, 9.5] every one
    // of the 126 candidates fell outside it, `intoRoom` clamped each of them back to the
    // same wall inset, and four dining chairs landed on one point — the § H.3 defect
    // verbatim, inside the function written to close it.
    const chairs = addMany(4, CHAIR, OFFSET(7, 7));
    const spots = new Set(chairs.map((c) => `${c.pos[0].toFixed(3)},${c.pos[2].toFixed(3)}`));
    expect(spots.size, `four chairs landed on ${spots.size} spot(s)`).toBe(4);
    for (let i = 0; i < chairs.length; i++) {
      for (let j = i + 1; j < chairs.length; j++) {
        expect(obbOverlap(foot(chairs[i]), foot(chairs[j]))).toBe(false);
      }
    }
  });

  it('keeps them inside that room, not inside where the room would have been', () => {
    const room = OFFSET(7, 7);
    for (const c of addMany(4, CHAIR, room)) {
      expect(footInsidePoly(foot(c), room.footprint), `${c.id} is not in the room`).toBe(true);
    }
  });
});

describe('a footprint with a notch — the gate the rectangles could not exercise', () => {
  const L = { width: 6, depth: 5, height: 2.5, footprint: footprintForLayout('l', 6, 5) };

  it('never puts a piece in the part of the bounding box the room cuts away', () => {
    // `footInsidePoly` is the reason this function does not simply trust `intoRoom`,
    // whose inset is a BOUNDING BOX inset and cannot see an L's notch. Every other
    // fixture in this file is a rectangle, where the two answers are identical and the
    // gate could be deleted with the suite still green — the `wallOutwardNormal` scar
    // exactly: real assertions, a fixture unable to express the defect.
    const beds = addMany(3, BED, L);
    for (const bed of beds) {
      expect(footInsidePoly(foot(bed), L.footprint), `${bed.id} is in the notch`).toBe(true);
    }
  });

  it('seats a ROUND piece by its circle, not by the box it is drawn inside', () => {
    // § 32: roundness is a property of the shape and the add path had it nowhere. The
    // gate here is the same rule one function over — a square foot on a round piece is
    // rejected where the circle fits, so the notch turns away a piece that every other
    // gate in the app seats, and enough such rejections run the search out of rings.
    const stools = addMany(4, STOOL, L);
    const spots = new Set(stools.map((p) => `${p.pos[0].toFixed(3)},${p.pos[2].toFixed(3)}`));
    expect(spots.size).toBe(4);
    for (const p of stools) {
      // `circle` really is set on the placed part — if it were not, this assertion
      // would be measuring a box and agreeing with the defect.
      expect(p.circle, 'the fixture is not testing a circle at all').toBe(true);
      expect(footInsidePoly(foot(p), L.footprint), `${p.id} is in the notch`).toBe(true);
    }
  });
});

describe('repeated clicks do not build a tower', () => {
  // Found by instrumenting the search rather than by reading it, and it is the § H.3
  // complaint in its worst form. `collidesAt` permits stacking ON PURPOSE — a lamp
  // belongs on a desk — so two pieces at one x/z with non-overlapping vertical extents
  // read as clear. For a tabletop-prone family that is a ladder: `placeNewPart` rests
  // each new piece on the one before it, `clear(undefined)` says yes every time, and an
  // aim is never asked for. Four clicks of one Library row measured, before the gate:
  //
  //    potted plant   y = 0.00, 0.90, 1.80, 2.70   (ceiling 2.50)
  //    floor lamp     y = 0.00, 1.50, 3.00, 4.50   (ceiling 2.50)
  //
  // A 1.5 m floor lamp based at 4.50 m in a 2.5 m room is § 31's "nothing physically
  // impossible should be encouraged", so that is the gate — not a rule against stacking,
  // which would put a table lamp on the floor beside the desk it should be standing on.

  it('never bases a piece where its top would pass the ceiling', () => {
    const room = ROOM();
    for (const kit of [LAMP_FLOOR, STOOL, BED]) {
      for (const p of addMany(4, kit, room)) {
        const top = p.pos[1] + p.dimMM[2] / 1000;
        expect(top, `${kit[1]} ${p.id} tops out at ${top.toFixed(2)} m`).toBeLessThanOrEqual(room.height + 1e-6);
      }
    }
  });

  it('spreads the ones that were towering across the floor instead', () => {
    // The other half. A gate that merely REFUSED the fourth lamp would satisfy the
    // assertion above while leaving three of them in a stack.
    const lamps = addMany(4, LAMP_FLOOR);
    const onFloor = lamps.filter((l) => l.pos[1] === 0);
    expect(onFloor, 'the lamps are still standing on each other').toHaveLength(4);
    const spots = new Set(lamps.map((l) => `${l.pos[0].toFixed(3)},${l.pos[2].toFixed(3)}`));
    expect(spots.size).toBe(4);
  });
});

describe('the ceiling family, which this search cannot help', () => {
  const FAN: [Category, Shape, [number, number, number]] = ['fan', 'fan', [1000, 1000, 300]];

  it('asks for no aim, because ceilingSpot would discard one', () => {
    // Not an oversight and not a fix: `placeNewPart` sends a fan through `ceilingSpot`,
    // which returns the bounds midpoint and reads the aim ONLY when that point is
    // outside the footprint. In a rectangle every candidate resolves to the same place,
    // so running the ring search is 127 probes to return what ring zero already said.
    // An earlier docblock claimed the fan-out covered this family; it never could.
    const room = ROOM();
    const fan: ScenePart = {
      id: 'fan-1', name: 'Fan', category: 'fan', shape: 'fan', dimMM: [1000, 1000, 300],
      pos: [0, 2.2, 0], rot: 0, locked: false, wallMounted: true,
    } as ScenePart;
    expect(openSpotForNewPart(...FAN, room, [fan])).toBeUndefined();
  });

  it('and the aim really is discarded, which is why', () => {
    // The evidence for the claim above, in this file rather than in a comment. If
    // `ceilingSpot` ever starts honouring an aim, this goes red and the skip should go.
    const room = ROOM();
    expect(placeNewPart(...FAN, room, [], [2.5, 1.7]).pos)
      .toEqual(placeNewPart(...FAN, room, [], undefined).pos);
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
