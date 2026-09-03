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
import { footFromPart, footInsidePoly, obbGap, obbOverlap } from '@/lib/geometry';
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
/** Big enough that a small notched room runs out of spots for the third of them. */
const SOFA: [Category, Shape, [number, number, number]] = ['sofa', 'sofa', [2200, 900, 800]];

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

  it('leaves real air between them', () => {
    // **This does NOT pin `SPAWN_GAP`, and that is stated rather than implied.** Setting
    // it to 0 leaves this green: the ring step is the piece's own diagonal, so even
    // without the gap two pieces a step apart are not usually corner-to-corner, and the
    // separation that survives is comfortably over any bound this could honestly assert.
    // Tightening the number until the mutation went red would be choosing a threshold to
    // match the measurement it is supposed to be testing.
    //
    // What it does gate is real and worth keeping: `collidesAt` accepts FLUSH contact by
    // design (`footOverlap(..., -0.01)` — "lets flush side-by-side placement read as
    // touching, not colliding"), so every other assertion in this file would pass with
    // pieces jammed edge to edge. This one says there is air.
    for (const kit of [CHAIR, STOOL, BED]) {
      const set = addMany(4, kit, ROOM());
      let closest = Infinity;
      for (let i = 0; i < set.length; i++) {
        for (let j = i + 1; j < set.length; j++) {
          closest = Math.min(closest, obbGap(foot(set[i]), foot(set[j])));
        }
      }
      expect(closest, `${kit[1]}: closest pair is ${closest.toFixed(3)} m apart`).toBeGreaterThan(0.03);
    }
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

  it('an aim the search RETURNS is always a spot in the room', () => {
    // The gate's actual contract, and the assertion above could not reach it: deleting
    // the whole `footInsidePoly` line left the suite green, because in a 6 x 5 L the
    // search succeeds on a candidate that is inside either way.
    //
    // The separation only appears in the SMALL notched rooms — swept, 26 of 1125
    // placements land outside the polygon and every one of them has `aim = undefined`.
    // That is the documented fallback (a piece that will not fit is added anyway at its
    // real size and `lib/clearance.ts` reports it, rather than being silently refused),
    // and it is what `main` does for every click. What must never happen is the search
    // CHOOSING such a spot, which is the only thing this gate can prevent — so the
    // assertion skips the fallback and holds the aims to the polygon.
    let aimed = 0;
    for (const layout of ['rect', 'l', 't', 'u', 'open'] as const) {
      for (const [w, d] of [[6, 5], [4.5, 4], [7.5, 5.6]] as Array<[number, number]>) {
        const room = { width: w, depth: d, height: 2.5, footprint: footprintForLayout(layout, w, d) };
        for (const kit of [BED, CHAIR, STOOL, SOFA]) {
          const parts: ScenePart[] = [];
          for (let i = 0; i < 5; i++) {
            const aim = openSpotForNewPart(kit[0], kit[1], kit[2], room, parts);
            const p = placeNewPart(kit[0], kit[1], kit[2], room, parts, aim);
            const placed = {
              id: `${kit[1]}-${i}`, name: 'x', category: kit[0], shape: kit[1], dimMM: kit[2],
              pos: p.pos, rot: p.rot, locked: false, wallMounted: p.wallMounted,
              circle: isRoundPart(kit[1]) || undefined,
            } as ScenePart;
            if (aim !== undefined) {
              aimed++;
              expect(
                footInsidePoly(foot(placed), room.footprint),
                `${layout} ${w}x${d} ${kit[1]} #${i}: the search chose a spot outside the room`,
              ).toBe(true);
            }
            parts.push(placed);
          }
        }
      }
    }
    // Counted, because a sweep that found no aim at all would pass every assertion in
    // it. 1125 placements were swept to write this; the aimed share is the subject.
    expect(aimed, 'the sweep produced no aims, so it proved nothing').toBeGreaterThan(30);
  });

  it('fans a ROUND piece out too', () => {
    // § 32: roundness is a property of the shape and the add path had it nowhere. The
    // search reads `isRoundPart` for both of its gates for the same reason.
    //
    // **This does NOT pin that, and saying so is the point.** Squaring the foot in
    // either gate leaves the whole suite green, and a sweep of three round shapes over
    // three layouts at two sizes — eighteen combinations, six clicks each — produced
    // BYTE-IDENTICAL placements with the circle and with the box. So the roundness is
    // correct by the same rule the rest of the app follows and is currently
    // unfalsifiable HERE; the circle-versus-box difference is real elsewhere (a 400 mm
    // pot whose box corner sits 135 mm into an L's notch, measured in
    // `lib/footprint.ts`) but the ring never offers a candidate in that band.
    //
    // Left in rather than reverted, because a gate that reads the shape's own answer
    // cannot drift from § 32 and a gate that hard-codes `undefined` silently can. What
    // is not claimed is that a test is watching it.
    const stools = addMany(4, STOOL, L);
    const spots = new Set(stools.map((p) => `${p.pos[0].toFixed(3)},${p.pos[2].toFixed(3)}`));
    expect(spots.size).toBe(4);
    for (const p of stools) {
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

  // **These two pin the ANSWER, not the skip.** Deleting the early return leaves both
  // green, and that is correct rather than a gap: the search would run 127 probes and
  // return the same `undefined`, so the skip is a saving and not a behaviour. An
  // assertion that claimed otherwise would be measuring something that does not exist.

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
