import { describe, it, expect } from 'vitest';
import { analyzeRoom, freeFloorFraction } from '@/lib/clearance';
import { pointInObb, pointInPoly, polygonArea, type OBB, type Poly } from '@/lib/geometry';
import { SHAPES, type ScenePart } from '@/lib/scene-spec';
import { dimRangeFor, ROOM_HEIGHT_M } from '@/lib/dimension-ranges';
import { partInsideRoom, type Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const ROOM = { footprint: RECT, height: 2.8 };

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return {
    id: `${p.category}-${++n}`,
    name: p.category,
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

describe('analyzeRoom', () => {
  it('flags furniture inside a door swing', () => {
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -1.95], wallMounted: true });
    const blocker = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0.3, 0, -1.5] });
    const { issues } = analyzeRoom([door, blocker], ROOM);
    const hit = issues.find((i) => i.id.startsWith('door-'));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('error');
    expect(hit!.partIds).toContain(blocker.id);
  });

  it('does not flag a clear door', () => {
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -1.95], wallMounted: true });
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.4] });
    const { issues } = analyzeRoom([door, sofa], ROOM);
    expect(issues.find((i) => i.id.startsWith('door-'))).toBeUndefined();
  });

  it('warns about a pinched walkway between bulky pieces', () => {
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.5] });
    // Wardrobe 0.3m in front of the sofa face — squeeze zone.
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, 0.25] });
    const { issues } = analyzeRoom([sofa, wardrobe], ROOM);
    expect(issues.find((i) => i.id.startsWith('walk-'))).toBeDefined();
  });

  it('stays quiet when bulky pieces touch (deliberate composition) or sit far apart', () => {
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.5] });
    const far = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -1.6] });
    const { issues } = analyzeRoom([sofa, far], ROOM);
    expect(issues.find((i) => i.id.startsWith('walk-'))).toBeUndefined();
  });

  it('warns when storage has no room to open', () => {
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -1.65], rot: 0 });
    // Bed right in front of the wardrobe doors.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0, 0, -0.4] });
    const { issues } = analyzeRoom([wardrobe, bed], ROOM);
    expect(issues.find((i) => i.id.startsWith('front-'))).toBeDefined();
  });

  it('warns when a double bed loses both side strips', () => {
    // Bed pushed into a corner: one side is the wall, other side blocked.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [-1.9, 0, 0], rot: 0 });
    const shelf = part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800], pos: [-0.55, 0, 0], rot: 0 });
    const { issues } = analyzeRoom([bed, shelf], ROOM);
    expect(issues.find((i) => i.id.startsWith('bed-'))).toBeDefined();
  });

  it('reports free floor share', () => {
    const { freeFloorShare } = analyzeRoom([], ROOM);
    expect(freeFloorShare).toBe(1);
  });

  // ── Regressions found by the audit ──────────────────────────────────────

  it('flags two pieces occupying the same floor', () => {
    // obbGap returns 0 both for "pushed flush together" (deliberate) and for
    // "in the same place" (a mistake), and the walkway rule skips everything at or
    // under 12 cm as touching — so interpenetrating parts produced NO finding and
    // the panel said "Everything fits". buildSceneFromRoom does no part-vs-part
    // resolution, so a detected scene can genuinely arrive like this.
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] });
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0.3, 0, 0.2] });
    const hit = analyzeRoom([sofa, bed], ROOM).issues.find((i) => i.id.startsWith('clash-'));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('error');
  });

  it('stays quiet for pieces that merely touch', () => {
    // A sofa with its back flush to a wardrobe is a composition, not a clash.
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -1.7] });
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, -0.925] });
    expect(analyzeRoom([wardrobe, sofa], ROOM).issues.find((i) => i.id.startsWith('clash-'))).toBeUndefined();
  });

  it('does not call a stack a clash', () => {
    // A laptop resting on a desk shares the desk's footprint on purpose.
    const desk = part({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0, 0] });
    const laptop = part({ category: 'monitor', shape: 'laptop', dimMM: [340, 240, 220], pos: [0, 0.75, 0] });
    expect(analyzeRoom([desk, laptop], ROOM).issues.find((i) => i.id.startsWith('clash-'))).toBeUndefined();
  });

  it('does not call a tucked-in chair a clash', () => {
    // Seating pushed under a table or desk shares its footprint ON PURPOSE, and
    // the chair back rises above the top so the vertical test cannot separate
    // them. Four chairs round a dining table is the most ordinary arrangement
    // there is — reporting four errors on it would make the panel cry wolf.
    const table = part({ category: 'table', shape: 'coffee-table', dimMM: [1400, 800, 750], pos: [0, 0, 0] });
    const chairs = [0.5, -0.5].map((z) =>
      part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, z] }),
    );
    const { issues } = analyzeRoom([table, ...chairs], ROOM);
    expect(issues.find((i) => i.id.startsWith('clash-'))).toBeUndefined();
  });

  it('still flags a chair buried in a table', () => {
    // The exemption is for tucking in, not for a chair standing in the same
    // place as the table.
    const table = part({ category: 'table', shape: 'coffee-table', dimMM: [1400, 800, 750], pos: [0, 0, 0] });
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0] });
    expect(analyzeRoom([table, chair], ROOM).issues.find((i) => i.id.startsWith('clash-'))).toBeDefined();
  });

  it('does not flag furniture that only clips a corner', () => {
    // A 3 cm bump where two pieces meet is a nudge away from tidy, not "one of
    // them has to move".
    // a spans x -2…0, b spans -0.03…1.97 — a 3 cm bite out of a 1.44 m² bed.
    const a = part({ category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 880], pos: [-1, 0, 0] });
    const b = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0.97, 0, 0] });
    expect(analyzeRoom([a, b], ROOM).issues.find((i) => i.id.startsWith('clash-'))).toBeUndefined();
  });

  it('flags a piece taller than the ceiling instead of shrinking it', () => {
    const low = { ...ROOM, height: 2.4 };
    const tall = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1800, 600, 2600], pos: [0, 0, -1.6] });
    const hit = analyzeRoom([tall], low).issues.find((i) => i.id.startsWith('tall-'));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('error');
    // …and stays quiet when it does fit.
    expect(analyzeRoom([tall], ROOM).issues.find((i) => i.id.startsWith('tall-'))).toBeUndefined();
  });

  it('sees an obstacle at the EDGE of a wardrobe front, not just its centre', () => {
    // faceClearance used to probe one ray from the middle of the face, so anything
    // off to one side reported the doors fully clear.
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -1.65], rot: 0 });
    // A chair against the LEFT third of the wardrobe front — never under its centre.
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [-0.8, 0, -1.1] });
    const hit = analyzeRoom([wardrobe, chair], ROOM).issues.find((i) => i.id.startsWith('front-'));
    expect(hit).toBeDefined();
  });

  // ── Round footprints ────────────────────────────────────────────────────
  // The clash rule is NOT where this shows up, and it would be misleading to
  // write a test implying otherwise: the tucked-chair exemption already lets a
  // chair reach 85% of its own footprint into a table before anything is said, so
  // a corner overlap of ~20% was never going to be reported either way. Where the
  // bounding square really bit the user is `collidesAt` — see
  // tests/scene-build.test.ts — and here, in what a round piece covers.

  it('still flags a chair standing in the middle of a round table', () => {
    const table = part({ category: 'table', shape: 'coffee-table', dimMM: [1200, 1200, 750], pos: [0, 0, 0], circle: true });
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850], pos: [0, 0, 0] });
    expect(analyzeRoom([table, chair], ROOM).issues.find((i) => i.id.startsWith('clash-'))).toBeDefined();
  });

  it('counts a round piece as a circle when reporting floor coverage', () => {
    // Rugs are excluded from the blocker set, so use something that is not one.
    const square = part({ category: 'ottoman', shape: 'ottoman', dimMM: [1400, 1400, 400], pos: [0, 0, 0] });
    const circle = part({ ...square, id: 'c', circle: true } as never);
    const squareCover = 1 - analyzeRoom([square], ROOM).freeFloorShare;
    const circleCover = 1 - analyzeRoom([circle], ROOM).freeFloorShare;
    expect(squareCover).toBeGreaterThan(0);
    // π/4 of the square, to within the raster.
    expect(circleCover / squareCover).toBeCloseTo(Math.PI / 4, 2);
  });

  it('counts overlapping furniture once when reporting floor coverage', () => {
    // The old sum double-counted a chair pushed under a desk and ignored rotation,
    // then clamped at 0 — so a busy room reported "100% covered".
    const desk = part({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0, 0] });
    const same = part({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0, 0] });
    const one = analyzeRoom([desk], ROOM).freeFloorShare;
    const two = analyzeRoom([desk, same], ROOM).freeFloorShare;
    expect(two).toBeCloseTo(one, 2);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1);
  });
});

describe('polygonArea', () => {
  it('measures the rectangle', () => {
    expect(polygonArea(RECT)).toBe(24);
  });
});

// ─── freeFloorFraction ──────────────────────────────────────────────────────
// The implementation was rewritten from cell-major (every cell against every
// part, recomputing trig in the innermost loop) to part-major (each part over its
// own bounding box, trig hoisted). Same union, ~50-200× less work. These tests
// pin the "same union" half: the reference below is the shape of the old loop, so
// a divergence fails here rather than quietly changing what the room report says.

const CELL = 0.05;

function referenceFreeFloor(parts: OBB[], poly: Poly): number {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  let inside = 0;
  let covered = 0;
  for (let z = minZ + CELL / 2; z < maxZ; z += CELL) {
    for (let x = minX + CELL / 2; x < maxX; x += CELL) {
      if (!pointInPoly(x, z, poly)) continue;
      inside++;
      for (const b of parts) {
        if (pointInObb(x, z, b)) { covered++; break; }
      }
    }
  }
  if (inside === 0) return 1;
  return Math.max(0, Math.min(1, 1 - covered / inside));
}

/** Seeded PRNG — a flaky geometry test is worse than no geometry test. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const L_ROOM: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 0],
  [1, 0],
  [1, 2],
  [-3, 2],
];

describe('freeFloorFraction', () => {
  it('is 1 for an empty room', () => {
    expect(freeFloorFraction([], RECT)).toBe(1);
  });

  it('matches the cell-major reference over random scenes, rotations included', () => {
    const rand = rng(20260730);
    for (let iter = 0; iter < 24; iter++) {
      const poly = iter % 3 === 0 ? L_ROOM : RECT;
      const parts: OBB[] = [];
      for (let k = 0; k < 1 + Math.floor(rand() * 6); k++) {
        parts.push({
          cx: -3 + rand() * 6,
          cz: -2 + rand() * 4,
          hw: 0.15 + rand() * 0.8,
          hd: 0.15 + rand() * 0.8,
          rot: rand() * Math.PI * 2,
        });
      }
      expect(freeFloorFraction(parts, poly)).toBeCloseTo(referenceFreeFloor(parts, poly), 12);
    }
  });

  it('counts a part that hangs outside the room only where it is inside', () => {
    // Half over the edge: it may not claim floor the room does not have.
    const half: OBB = { cx: -3, cz: 0, hw: 1, hd: 1, rot: 0 };
    const inside: OBB = { cx: -1, cz: 0, hw: 1, hd: 1, rot: 0 };
    const outside = 1 - freeFloorFraction([half], RECT);
    const whole = 1 - freeFloorFraction([inside], RECT);
    expect(outside).toBeCloseTo(whole / 2, 2);
  });

  it('reaches 0 when furniture covers the whole floor', () => {
    const slab: OBB = { cx: 0, cz: 0, hw: 4, hd: 3, rot: 0 };
    expect(freeFloorFraction([slab], RECT)).toBe(0);
  });

  it('does not double-count overlapping parts', () => {
    const a: OBB = { cx: 0, cz: 0, hw: 0.7, hd: 0.4, rot: 0 };
    const b: OBB = { cx: 0.1, cz: 0.05, hw: 0.7, hd: 0.4, rot: 0.3 };
    const both = freeFloorFraction([a, b], RECT);
    expect(both).toBeGreaterThanOrEqual(freeFloorFraction([a, b, b], RECT) - 1e-12);
    expect(both).toBeLessThan(freeFloorFraction([a], RECT));
  });
});

describe('analyzeRoom · taller than the room', () => {
  // The lowest legal ceiling. `ROOM` above is 2.8 m, where nothing in the catalog
  // is too tall — which is exactly why this pass could skip a whole class of part
  // for as long as it did.
  const LOW = { footprint: RECT, height: 1.8 };

  it('reports a wall-mounted piece that cannot hang clear of floor and ceiling', () => {
    // The catalog curtain is 2200 mm tall. `heightForNewCeiling` clamps its centre
    // into [h/2 + PAD, H - h/2 - PAD] = [1.12, 0.68] — ends crossed, so Math.max
    // wins, it pins at 1.12 m and 42 cm stands through the slab. This loop used to
    // open with `if (p.wallMounted) continue`, so the one case `physics.ts` names
    // when it promises "clearance.ts reports it" was the case it skipped.
    const curtain = part({ category: 'curtain', shape: 'curtain', dimMM: [1600, 80, 2200], pos: [0, 1.12, -1.9], wallMounted: true });
    const hit = analyzeRoom([curtain], LOW).issues.find((i) => i.rule === 'tall');
    expect(hit).toBeDefined();
    expect(hit!.partIds).toEqual([curtain.id]);
    expect(hit!.detail).toContain('hang');
  });

  it('still reports a floor-standing piece, and words it for something that stands', () => {
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1000, 600, 2200], pos: [0, 1.1, -1.7] });
    const hit = analyzeRoom([wardrobe], LOW).issues.find((i) => i.rule === 'tall');
    expect(hit).toBeDefined();
    expect(hit!.detail).toContain('stand up');
  });

  it('says nothing about a wall-mounted piece that fits', () => {
    const tv = part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.2, -1.95], wallMounted: true });
    expect(analyzeRoom([tv], LOW).issues.find((i) => i.rule === 'tall')).toBeUndefined();
  });
});

describe('analyzeRoom · a piece that cannot be made to fit at all', () => {
  // "Danmu keeps the real size rather than shrinking it for you" is an instruction:
  // it tells the user the shrinking is theirs to do. For a door under a low ceiling
  // it is an instruction they cannot carry out — `door` has a height floor of
  // 1980 mm and the shortest legal room is 1800, so between those two numbers there
  // is no legal door, and the Inspector refuses every value the message invites.
  const LOW_ROOM = { footprint: RECT, height: 1.8 };

  it('a door in the shortest legal room is told it does not go shorter, not to shrink it', () => {
    // Not a chosen fixture: 1980 is `dimRangeFor('door','door').min[2]`, so this is
    // the door at its own minimum. There is no smaller one to test with.
    const min = dimRangeFor('door', 'door').min[2];
    expect(min / 1000).toBeGreaterThan(ROOM_HEIGHT_M.min);

    const door = part({ category: 'door', shape: 'door', dimMM: [900, 45, min], pos: [0, min / 2000, -1.98], wallMounted: true });
    const hit = analyzeRoom([door], LOW_ROOM).issues.find((i) => i.rule === 'tall');
    expect(hit).toBeDefined();
    expect(hit!.detail).toContain('does not go any shorter than 198 cm');
    // The half that matters. The old sentence asked for something impossible here.
    expect(hit!.detail).not.toContain('as short as this piece goes, and that would fit');
  });

  it('a wardrobe over the same ceiling keeps the invitation, because it can be shrunk', () => {
    // Floor is 1600 mm, under the room's 1800, so shrinking really is available and
    // the message should say so — and name the number rather than imply one. This is
    // the negative control for the test above: same room, same overheight, opposite
    // wording, so a branch stuck on either answer fails one of the two.
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1000, 600, 2200], pos: [0, 1.1, -1.7] });
    const hit = analyzeRoom([wardrobe], LOW_ROOM).issues.find((i) => i.rule === 'tall');
    expect(hit).toBeDefined();
    expect(hit!.detail).toContain('160 cm is as short as this piece goes, and that would fit');
    expect(hit!.detail).not.toContain('does not go any shorter');
  });

  it('every shape whose own floor clears the lowest ceiling is offered the shrink', () => {
    // The sweep, because picking examples is how the door was missed in the first
    // place. For each shape, put it in the shortest legal room at a height that is
    // over the ceiling, and require the wording to follow the shape's OWN floor
    // rather than a list of names. A shape added later with a 2 m floor starts
    // reporting honestly with no edit here.
    let shrinkable = 0;
    let stuck = 0;
    for (const shape of SHAPES) {
      const r = dimRangeFor('other', shape);
      const tall = Math.max(r.min[2], LOW_ROOM.height * 1000 + 1);
      if (tall > r.max[2]) continue; // cannot be made overheight at all
      const p = part({ category: 'other', shape, dimMM: [r.min[0], r.min[1], tall], pos: [0, tall / 2000, 0] });
      const hit = analyzeRoom([p], LOW_ROOM).issues.find((i) => i.rule === 'tall');
      expect(hit).toBeDefined();
      if (r.min[2] / 1000 > LOW_ROOM.height) {
        expect(hit!.detail).toContain('does not go any shorter');
        stuck++;
      } else {
        expect(hit!.detail).toContain('as short as this piece goes, and that would fit');
        shrinkable++;
      }
    }
    // Literals, not `SHAPES.length` arithmetic: a count derived from the same list
    // the loop walks cannot fail when the list is gutted. Both sides must be
    // non-zero or one of the two branches is going untested.
    expect(stuck).toBe(1);
    expect(shrinkable).toBe(12);
  });
});

describe('the clash bar is closed on the side the solver charges from', () => {
  // A one-directional property cannot see this. `tests/layout-conformance.test.ts`
  // asserts "flagged ⇒ the solver charges more", so a layout the solver prices and
  // the report is SILENT about slips straight through it — and that is exactly what
  // a `<` → `<=` flip on `clashShare` produced. It was made to align the tucked bar
  // (0.85) with the solver's excess-above-tolerance, which is 0 there; but the same
  // comparison serves `CLASH_SHARE` (0.5), where the solver has no tolerance and
  // charges the share outright.
  //
  // 0.5 is not a measure-zero boundary the way 0.85 is. Round millimetre dimensions
  // on the 10 mm drag grid hit it exactly, so this is a room a user can build.
  it('reports two ordinary pieces overlapping by exactly half', () => {
    const a = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0] });
    // 250 mm apart: the intersection is 0.5 × 0.25 m² against a 0.25 m² foot, so the
    // share is exactly 0.5 in IEEE double rather than near it.
    const b = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0.25] });
    const { issues } = analyzeRoom([a, b], ROOM);
    const clash = issues.filter((i) => i.rule === 'clash');
    expect(clash.length, 'half a chair inside another chair is a collision worth saying').toBe(1);
    expect(clash[0].partIds).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it('and stays quiet a hair below it', () => {
    // The other half, so the assertion above cannot be satisfied by a rule that
    // fires on any contact at all.
    const a = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0] });
    const b = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0.26] });
    expect(analyzeRoom([a, b], ROOM).issues.filter((i) => i.rule === 'clash')).toEqual([]);
  });
});

// ─── Outside the room ───────────────────────────────────────────────────────
//
// The drag has refused these placements since H.16 and nothing REPORTED one, so a
// piece that got outside by any other route -- seeded that way, resized after it
// was placed, or left behind when a wall moved past it -- sat there in silence.
// `freeFloorShare` was the nearest thing to a witness and it DISCARDS the outside
// portion rather than counting it, so a sofa half out of the room read as a room
// with MORE free floor than it has.

describe('a piece that is not in the room', () => {
  const sofa = (x: number, z = 0, rot = 0) =>
    part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [x, 0, z], rot });
  const outside = (parts: ScenePart[]) => analyzeRoom(parts, ROOM).issues.filter((i) => i.rule === 'outside' || i.rule === 'overhang');

  it('says so when the centre is off the plan, and calls it an error', () => {
    // x = 3.2 in a room that ends at x = 3: there is no floor under the middle of
    // it. Nothing else in the room, so nothing else can be raising this.
    const s = sofa(3.2);
    const hits = outside([s]);
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe('error');
    expect(hits[0].title).toBe('Outside the room');
    expect(hits[0].partIds).toEqual([s.id]);
  });

  it('and distinguishes sticking out from standing outside', () => {
    // Centre in, corners out -- 2.2 m of sofa centred 400 mm from the east wall, so
    // about 700 mm crosses it. A different sentence and a different severity,
    // because the remedy differs: this one turns or slides, the one above has to
    // come back into the room entirely.
    //
    // The two are the whole magnitude instrument and they cost nothing, being the
    // two halves of the containment predicate that is evaluated anyway. Both
    // assertions are here because a rule that reported one severity for both would
    // satisfy either of them alone.
    const s = sofa(0, 0, Math.PI / 2);
    const hits = outside([sofa(2.6, 0)]);
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe('error');
    expect(hits[0].title).toBe('Sticks out of the room');
    expect(outside([s])).toEqual([]);
  });

  it('is quiet about a piece against the wall it belongs to', () => {
    // The half that stops this being a rule that fires on everything, and it is
    // placed to be load-bearing rather than comfortable. Turned side-on the sofa is
    // 950 mm deep, so flush against the east wall its centre sits at
    // 3 - 0.475 = 2.525; this is 1 mm PAST that, so a millimetre of it is through the
    // plaster. `ROOM_FIT_SLACK_MM` is 10 mm off each dimension, which is 5 mm per
    // face, and it is the only reason this is quiet -- set the slack to 0 and this
    // is the assertion that goes red. A snapped corner landing exactly on the
    // boundary is a polygon-test coin flip, and that is what the slack exists for.
    expect(outside([sofa(2.526, 0, Math.PI / 2)])).toEqual([]);
  });

  it('and reports twenty millimetres through the plaster', () => {
    // The other end of `ROOM_FIT_SLACK_MM`, and it was missing: the assertion above
    // pins the slack from BELOW -- set it to 0 and the flush sofa is flagged -- and
    // nothing pinned it from above. Widening it to 200 mm forgives 100 mm per face
    // and the whole battery stayed green, which is the same one-sided defect as a
    // breakpoint with only a floor.
    //
    // 20 mm is the number CLAUDE.md names when it says why `outsideShare` is the
    // wrong instrument here: its samples sit 10% in from the edges and read 0% for a
    // piece this far out. This rule reads it as a finding.
    const s = sofa(2.545, 0, Math.PI / 2);
    const hits = outside([s]);
    expect(hits.length, '20 mm through the wall is out of the room').toBe(1);
    expect(hits[0].severity).toBe('error');
  });

  it('forgives a rug its overhang, and only its overhang', () => {
    // Overhang is what a rug is FOR -- under the furniture, up to the skirting,
    // across an L's missing corner -- so a rug is outside only when its CENTRE is
    // out. What is deliberately NOT shared from the drag is its rug branch's other
    // two conditions: `roomIsWideEnough` and `!shovedIntoRoom` are questions about a
    // GESTURE, and neither means anything about a piece standing still.
    const overhanging = part({ category: 'rug', shape: 'rug', dimMM: [2000, 1400, 10], pos: [2.6, 0, 0] });
    expect(outside([overhanging]), 'a rug is allowed over the boundary').toEqual([]);

    const gone = part({ category: 'rug', shape: 'rug', dimMM: [2000, 1400, 10], pos: [3.6, 0, 0] });
    const hits = outside([gone]);
    expect(hits.length, 'but not off the plan altogether').toBe(1);
    expect(hits[0].severity).toBe('error');
  });

  it('agrees with the drag about the same placement', () => {
    // The two-sources-of-truth half, and the reason `roomContainment` is shared
    // rather than restated: a report and a gesture disagreeing about one piece reads
    // as whichever half you happen to be looking at being broken. Swept over the
    // whole east half of the room at 100 mm, both answers taken from the production
    // functions, so the two cannot be reconciled by editing this file.
    let compared = 0;
    for (let x = 1.5; x <= 4.5; x += 0.1) {
      const s = sofa(x, 0, Math.PI / 2);
      const flagged = outside([s]).length > 0;
      // `partInsideRoom` is the drag's own strict branch; a sofa is not a rug, so
      // the drag's disjunction reduces to exactly this.
      expect(flagged, `x = ${x.toFixed(1)}`).toBe(!partInsideRoom(s.pos, s.rot, s.dimMM, RECT));
      compared++;
    }
    // Both answers must appear, or the sweep agrees by never disagreeing about
    // anything: a range entirely inside the room would pass with the rule deleted.
    expect(compared).toBe(31);
    expect(outside([sofa(1.5, 0, Math.PI / 2)])).toEqual([]);
    expect(outside([sofa(4.5, 0, Math.PI / 2)]).length).toBe(1);
  });
});
