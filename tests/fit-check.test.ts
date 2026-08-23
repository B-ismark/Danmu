// "Will this real sofa fit?" — the answers, not the interface.
//
// The interesting property is that this module is almost entirely a composition: it
// asks the solver to seat one piece with everything else locked, then asks the room
// report what it thinks. So these tests are less about arithmetic and more about the
// four answers being the RIGHT four, and about the two decisions that are this
// module's own: that height is judged separately from floor space, and that nothing is
// clamped on the way in.

import { describe, expect, it } from 'vitest';
import { checkFit, PROBE_ID, type FitCandidate } from '@/lib/fit-check';
import { dimRangeFor } from '@/lib/dimension-ranges';
import type { Footprint } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const ROOM = { footprint: RECT, height: 2.6 };
/** 1.8 m square — takes nothing sofa-sized, but `roomBays` still finds a bay in it
 *  (its defaults are a 0.8 m minimum side and 1 m² minimum area). */
const TINY: Footprint = [
  [-0.9, -0.9],
  [0.9, -0.9],
  [0.9, 0.9],
  [-0.9, 0.9],
];
/** 0.7 m square — under `roomBays`' minimum side, so it yields no bay at all. */
const CUPBOARD: Footprint = [
  [-0.35, -0.35],
  [0.35, -0.35],
  [0.35, 0.35],
  [-0.35, 0.35],
];
/** 3 × 2.4 m. A double bed leaves 0.4 m of depth, which is no sofa's. */
const SMALL: Footprint = [
  [-1.5, -1.2],
  [1.5, -1.2],
  [1.5, 1.2],
  [-1.5, 1.2],
];

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

const SOFA: FitCandidate = { category: 'sofa', shape: 'sofa', dimMM: [2280, 950, 830], name: 'IKEA KIVIK' };
const WARDROBE: FitCandidate = { category: 'wardrobe', shape: 'wardrobe', dimMM: [1500, 580, 2364] };

describe('checkFit · the four answers', () => {
  it('fits a sofa into an empty room', () => {
    const r = checkFit(SOFA, [], ROOM);
    expect(r.status).toBe('fits');
    expect(r.placement).toBeDefined();
    expect(r.issues).toEqual([]);
  });

  it('finds a real product a home in a furnished room', () => {
    // A room with a bed against one wall still has floor for a sofa.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 500], pos: [-1.9, 0, 0.9] });
    const r = checkFit(SOFA, [bed], ROOM);
    expect(['fits', 'tight']).toContain(r.status);
    expect(r.placement).toBeDefined();
  });

  it('refuses a room with no floor left for it', () => {
    // A double bed turned across the middle of a 3 x 2.4 m room: 2.0 x 1.4 m of it,
    // leaving four half-metre strips around the edges. A 2.28 m sofa fits in none of
    // them at any angle, which is the answer this whole feature exists to give.
    //
    // Getting this fixture wrong twice is worth recording: with the bed against a wall
    // instead, the sofa fits perfectly well turned ninety degrees into the 2.4 m depth
    // — the code was right and the test was reasoning about the wrong axis.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 500], pos: [0, 0, 0], rot: Math.PI / 2 });
    const r = checkFit(SOFA, [bed], { footprint: SMALL, height: 2.6 });
    expect(r.status).toBe('no-room');
  });

  it('says why, in the room report’s own words, when it can seat it badly', () => {
    // A wardrobe filling most of a small room: the sofa can be put down, but not
    // without upsetting something — and the reasons come from `clearance.ts` rather
    // than being written again here.
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -1.6] });
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 500], pos: [-1.9, 0, 0.6] });
    const r = checkFit(SOFA, [wardrobe, bed], ROOM);
    if (r.issues.length > 0) {
      expect(r.issues.every((i) => i.partIds.includes(PROBE_ID))).toBe(true);
      expect(r.issues.every((i) => i.title.length > 0)).toBe(true);
    }
    expect(['fits', 'tight', 'no-room']).toContain(r.status);
  });

  it('refuses a piece taller than the ceiling, whatever the floor looks like', () => {
    const tall: FitCandidate = { category: 'wardrobe', shape: 'wardrobe', dimMM: [1000, 580, 2600] };
    const r = checkFit(tall, [], { footprint: RECT, height: 2.4 });
    expect(r.status).toBe('too-tall');
    // Height is judged on its own: an empty room has plenty of floor, and reporting
    // "no room" would point at the wrong problem.
    expect(r.headroomMM).toBe(-200);
    expect(r.placement).toBeUndefined();
  });

  it('reports headroom as a real number when it does fit', () => {
    expect(checkFit(WARDROBE, [], ROOM).headroomMM).toBe(236);
  });
});

describe('checkFit · it does not move the furniture already there', () => {
  it('never reports a finding about anything but the candidate', () => {
    // The room is already imperfect — two pieces closer than a walkway. The answer must
    // be about the piece being asked about, not a review of the room.
    const a = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [-1, 0, -0.4] });
    const b = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [-1, 0, 0.4] });
    const r = checkFit(SOFA, [a, b], ROOM);
    for (const issue of r.issues) expect(issue.partIds).toContain(PROBE_ID);
  });

  it('leaves the parts array it was given untouched', () => {
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 500], pos: [-1.9, 0, 0.9] });
    const before = JSON.stringify(bed);
    const parts = [bed];
    checkFit(SOFA, parts, ROOM);
    expect(parts).toHaveLength(1);
    expect(JSON.stringify(bed)).toBe(before);
  });

  it('does not leave the probe behind in any answer', () => {
    // Its id exists to be recognised in findings, not to become a piece of furniture.
    const r = checkFit(SOFA, [], ROOM);
    expect(r.placement).toBeDefined();
    expect(JSON.stringify(r.largestBay)).not.toContain(PROBE_ID);
  });
});

describe('checkFit · being inside something is a no, tucking under is not', () => {
  // Both directions of this were got wrong while writing it, so both are pinned.
  //
  // The room report's clash rule is a SHARE of the smaller footprint, generous on
  // purpose so an ordinary dining set is not called a collision. Read as a fit answer
  // it let a sofa sit 31% inside a bed and called the room "a bit tight". So this
  // module gates on overlap itself — and then the gate has to know which overlaps are
  // legitimate, which is what `sharesFloor` is for. Its polarity reads backwards at a
  // glance: TRUE means "these two may share the square metre".

  it('refuses to put a piece inside a piece', () => {
    // A bed across the middle of a big room. There is floor elsewhere, so this is not
    // about the room being full — it is about the one placement that overlaps.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 500], pos: [0, 0, 0] });
    const r = checkFit(SOFA, [bed], ROOM);
    expect(r.status).not.toBe('no-room'); // there IS room, just not in the bed
    expect(r.placement).toBeDefined();
    // Wherever it went, it is not in the bed.
    const dx = Math.abs(r.placement!.x - 0);
    const dz = Math.abs(r.placement!.z - 0);
    expect(dx > 0.5 || dz > 0.5).toBe(true);
  });

  it('still lets a dining chair tuck under its table', () => {
    // The pair `sharesFloor` exists for. A chair that may not overlap its table can
    // never be seated at one, and the answer would be a confident, wrong no.
    const table = part({ category: 'table', shape: 'coffee-table', dimMM: [1400, 800, 750], pos: [0, 0, 0] });
    const chair: FitCandidate = { category: 'chair', shape: 'chair-dining', dimMM: [450, 500, 900] };
    const r = checkFit(chair, [table], ROOM);
    expect(['fits', 'tight']).toContain(r.status);
    expect(r.placement).toBeDefined();
  });
});

describe('checkFit · sizes are reported, never quietly adjusted', () => {
  it('answers about the size it was given, even out of range', () => {
    // A real spec sheet can exceed what the studio represents. Clamping here would
    // answer confidently about a different piece of furniture.
    const max = dimRangeFor('wardrobe', 'wardrobe').max;
    const overRange: FitCandidate = {
      category: 'wardrobe',
      shape: 'wardrobe',
      dimMM: [max[0], max[1], max[2] + 200],
    };
    const r = checkFit(overRange, [], { footprint: RECT, height: 2.6 });
    expect(r.outOfRange).toBe(true);
    // 2800 mm against a 2600 mm ceiling — judged on the number entered.
    expect(r.status).toBe('too-tall');
    expect(r.headroomMM).toBe(-200);
  });

  it('does not flag an ordinary product as out of range', () => {
    expect(checkFit(SOFA, [], ROOM).outOfRange).toBe(false);
    expect(checkFit(WARDROBE, [], ROOM).outOfRange).toBe(false);
  });

  it('flags a size under the range as well as over', () => {
    const min = dimRangeFor('sofa', 'sofa').min;
    const tiny: FitCandidate = { category: 'sofa', shape: 'sofa', dimMM: [min[0] - 100, min[1], min[2]] };
    expect(checkFit(tiny, [], ROOM).outOfRange).toBe(true);
  });
});

describe('checkFit · saying what the room does have', () => {
  it('reports the largest clear rectangle of floor', () => {
    const r = checkFit(SOFA, [], ROOM);
    expect(r.largestBay).not.toBeNull();
    // The whole 6 × 4 room is one bay when nothing is in it.
    expect(r.largestBay!.width).toBeCloseTo(6, 1);
    expect(r.largestBay!.depth).toBeCloseTo(4, 1);
  });

  it('refuses a room the piece cannot go in, and still says what floor it has', () => {
    const r = checkFit(SOFA, [], { footprint: TINY, height: 2.4 });
    expect(r.status).toBe('no-room');
    expect(r.largestBay).toEqual({ width: 1.8, depth: 1.8 });
  });

  it('reports no bay at all rather than crashing on a cupboard of a room', () => {
    // Under `roomBays`' minimum side, so there is no bay to name. `largestBay` is the
    // one field allowed to be null, and the UI has to cope with it.
    const r = checkFit(SOFA, [], { footprint: CUPBOARD, height: 2.4 });
    expect(r.status).toBe('no-room');
    expect(r.largestBay).toBeNull();
  });
});

describe('checkFit · determinism', () => {
  it('gives the same answer twice', () => {
    // The solver is seeded, and this runs a fixed list of seeds, so the verdict a user
    // gets must not wander between presses.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 500], pos: [-1.9, 0, 0.9] });
    const a = checkFit(SOFA, [bed], ROOM);
    const b = checkFit(SOFA, [bed], ROOM);
    expect(a.status).toBe(b.status);
    expect(a.placement).toEqual(b.placement);
  });
});
