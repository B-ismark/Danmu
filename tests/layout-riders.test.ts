import { describe, it, expect } from 'vitest';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';
import { lockedForSolve, makeRng, movableFor, randomizeStart, solveLayout } from '@/lib/layout-solve';
import { applyPlacements } from '@/lib/layout-shuffle';
import { ridingParents } from '@/lib/rigid-parent';
import { footArea, footFromPart, footIntersectionArea, localToWorld } from '@/lib/geometry';
import { MIN_SUPPORT_SHARE, verticalExtent } from '@/lib/physics';

// A piece standing ON another piece is not a place the search gets to choose.
//
// ── What this file is guarding, and why nothing else could ──────────────────
//
// Every hard term in `costBreakdown` accumulates inside `if (!obstacle[i]) continue`
// and `isObstacle` requires `pos[1] < 0.05`, so a piece resting on furniture is
// invisible to `overlap`, `outside`, `door`, `access` and `navigation` — all five of
// `HARD_TERMS`, which is the entire list `isCleanShuffle` reads. `lib/clearance.ts`
// is silent for the same reason. And the 2D plan draws a lamp ON a nightstand and a
// lamp INSIDE a bed as the same rectangle, because it is looking down.
//
// So the defect this file exists for had no gate anywhere in the app, and the
// measurement below is the only thing that can go red. Read the assertions in that
// light: several of them are ABOUT the fixture rather than about the code, and they
// are there because a fixture that cannot express the defect is the failure this
// repo keeps finding.

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape'>): ScenePart => ({
  name: over.id,
  pos: [0, 0, 0],
  rot: 0,
  dimMM: [500, 500, 500],
  locked: false,
  ...over,
});

const foot = (p: ScenePart) => footFromPart(p.pos, p.rot, p.dimMM, p.circle);
const topOf = (p: ScenePart) => verticalExtent(p.category, p.shape, p.dimMM, p.pos[1])[1];

/** Is `child` still standing on `parent`, geometrically? Deliberately NOT
 *  `ridingParents` — asserting a function against itself proves nothing, and this
 *  is the question a person looking at the room would ask. */
function restsOn(child: ScenePart, parent: ScenePart): boolean {
  const c = foot(child);
  const shared = footIntersectionArea(c, foot(parent));
  return shared / footArea(c) >= MIN_SUPPORT_SHARE && Math.abs(child.pos[1] - topOf(parent)) < 0.01;
}

/** Every piece standing above the floor with nothing under it — the state § 18 is
 *  about, named the way a user would see it: a lamp hanging in mid-air. */
function orphans(parts: ScenePart[]): string[] {
  const rides = ridingParents(parts);
  return parts
    .filter((p) => !p.wallMounted && p.pos[1] > 0.05 && !(p.id in rides))
    .map((p) => `${p.name} at y=${p.pos[1].toFixed(2)}`);
}

describe('ridingParents — who is standing on what', () => {
  const stand = part({ id: 'stand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] });

  it('names the piece a lamp is standing on', () => {
    const lamp = part({
      id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.55, 0],
    });
    expect(ridingParents([stand, lamp])).toEqual({ lamp: 'stand' });
  });

  // THE RUG HOLE. `isPhysicallySupported` compares the child's y against the
  // parent's top with a 50 mm tolerance, and a rug's top is 5 mm — so a bare
  // adjacency test makes every sofa in the app a rider of the rug it stands on, and
  // `movableFor` would then refuse to move the sofa at all. The only thing that
  // stops it is `findSupportDetailed` refusing to hand a rug out as a support.
  it('does not make a sofa the rider of the rug it stands on', () => {
    const rug = part({ id: 'rug', category: 'rug', shape: 'rug', dimMM: [2000, 3000, 5] });
    const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 880] });
    // The fixture has to be able to FAIL: the sofa must genuinely sit over the rug,
    // and the rug's top must be inside the adjacency tolerance of the sofa's y.
    expect(footIntersectionArea(foot(sofa), foot(rug)) / footArea(foot(sofa))).toBeGreaterThan(MIN_SUPPORT_SHARE);
    expect(Math.abs(sofa.pos[1] - topOf(rug))).toBeLessThan(0.05);
    expect(ridingParents([rug, sofa])).toEqual({});
  });

  // THE BELOW-TEST. `findSupportDetailed` returns the highest top whose footprint
  // covers the mover, above or below — so asked about a nightstand parked in front
  // of a wardrobe it answers "the wardrobe", and without the adjacency test the
  // nightstand becomes a rider that no solve may move.
  it('does not make a piece the rider of the tall thing it is standing in front of', () => {
    const wardrobe = part({ id: 'ward', category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2100] });
    const near = part({ id: 'near', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] });
    expect(footIntersectionArea(foot(near), foot(wardrobe)) / footArea(foot(near))).toBeGreaterThan(MIN_SUPPORT_SHARE);
    expect(topOf(wardrobe)).toBeGreaterThan(1);
    expect(ridingParents([wardrobe, near])).toEqual({});
  });

  it('does not claim a lamp left hanging above the nightstand is riding it', () => {
    const lamp = part({
      id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.75, 0],
    });
    expect(ridingParents([stand, lamp])).toEqual({});
  });

  it('never makes a wall-mounted piece a rider', () => {
    const tv = part({
      id: 'tv', category: 'tv', shape: 'tv', dimMM: [1450, 90, 830], pos: [0, 0.55, 0], wallMounted: true,
    });
    expect(ridingParents([stand, tv])).toEqual({});
  });

  it('a piece on the floor rides nothing', () => {
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850] });
    expect(ridingParents([stand, chair])).toEqual({});
  });
});

describe('movableFor still searches over a rider — on purpose', () => {
  // A DECISION PIN, not a property. The obvious repair for the defect this file is
  // about is to make a rider immovable, and `carryRiders` records the measurements
  // that decided against it: `randomizeStart` draws from the RNG once per movable
  // piece, so removing the two lamps reseeds the whole `u` preset and moves four
  // baselines plus a real assertion. Anyone reaching for that one-line change lands
  // here first.
  it('leaves a lamp on a nightstand in the search, and lets carryRiders overwrite it', () => {
    const stand = part({ id: 'stand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] });
    const lamp = part({
      id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.55, 0],
    });
    expect(ridingParents([stand, lamp]), 'the fixture is a rider at all').toEqual({ lamp: 'stand' });
    expect(movableFor([stand, lamp], [false, false])).toEqual([true, true]);
  });
});

// ── The measurement § 18 is about ────────────────────────────────────────────
//
// `u` is the bedroom preset: a bed, a wardrobe, two nightstands and a bedside lamp
// on each. Eight seeds, one solve each — `shuffleRoom` runs up to twelve solves per
// press and this needs the solver, not the offer pipeline.
describe('a shuffle carries the lamp with the nightstand', () => {
  const parts = defaultScene('u', 6, 5);
  const footprint = footprintForLayout('u', 6, 5);
  const locked = lockedForSolve(parts, {}, null);
  const movable = movableFor(parts, locked);

  it('the fixture is the room this is about', () => {
    const rides = ridingParents(parts);
    // Two lamps, each on a nightstand. Named rather than counted, so a preset that
    // stops seeding them fails here instead of quietly making every sweep below
    // vacuous.
    expect(Object.keys(rides).length, `riders: ${JSON.stringify(rides)}`).toBe(2);
    for (const [child, parent] of Object.entries(rides)) {
      expect(parts.find((p) => p.id === child)!.category).toBe('lamp');
      expect(parts.find((p) => p.id === parent)!.category).toBe('nightstand');
    }
    expect(orphans(parts)).toEqual([]);
  });

  it('leaves nobody hanging in mid-air, over eight seeds', () => {
    const rides = ridingParents(parts);
    const supportIdx = [...new Set(Object.values(rides))].map((id) => parts.findIndex((p) => p.id === id));
    let supportsMoved = 0;
    for (let seed = 0; seed < 8; seed++) {
      const start = randomizeStart(parts, footprint, movable, makeRng(seed));
      const result = solveLayout(parts, footprint, locked, { seed, mode: 'shuffle', start });
      const after = applyPlacements(parts, result);
      const byId = new Map(after.map((p) => [p.id, p]));

      expect(orphans(after), `seed ${seed}`).toEqual([]);
      for (const [childId, parentId] of Object.entries(rides)) {
        expect(restsOn(byId.get(childId)!, byId.get(parentId)!), `seed ${seed}: ${childId} on ${parentId}`).toBe(true);
      }

      // THE POSITIVE CONTROL. Every assertion above is satisfied by a solve that
      // moved nothing, and a shuffle that moves nothing is refused by
      // `isCleanShuffle` long before a user sees it — so without this the sweep
      // would pass just as happily against a solver that had been turned off.
      if (supportIdx.some((i) => result.moved.includes(i))) supportsMoved++;
    }
    expect(supportsMoved, 'the nightstands must actually be getting moved').toBeGreaterThan(4);
  }, 60000);

  it('reports the lamp as moved, and does not offer a reason for it', () => {
    const rides = ridingParents(parts);
    const lampIds = new Set(Object.keys(rides));
    // Seed 3 is one where the search moves a nightstand; asserted rather than
    // assumed, because on a seed where nothing moved both halves below are vacuous.
    const start = randomizeStart(parts, footprint, movable, makeRng(3));
    const result = solveLayout(parts, footprint, locked, { seed: 3, mode: 'shuffle', start });
    const movedIds = new Set(result.moved.map((i) => parts[i].id));
    expect([...new Set(Object.values(rides))].some((id) => movedIds.has(id)), 'seed 3 must move a nightstand').toBe(
      true,
    );

    // In `moved`, because `applyPlacements` reads exactly this list and a lamp left
    // out of it stays behind on the old nightstand's spot.
    for (const id of lampIds) expect(movedIds.has(id), `${id} must be in moved`).toBe(true);
    // …and not in `moves`, because `explain` credits a move to whichever term gains
    // most when that one piece is put back, and a rider gains nothing on any term.
    for (const m of result.moves) expect(lampIds.has(parts[m.index].id)).toBe(false);
  }, 60000);
});

// ── The preset cannot express a rider that is not centred ────────────────────
//
// `defaultScene` puts each bedside lamp at its nightstand's own x and z, so its
// local offset is [0, 0] — and a rider at the pivot lands in the same world spot
// whatever angle you carry it at. Every assertion in the sweep above therefore
// survives a `carryRiders` that ignores the support's rotation entirely, which is
// the "a fixture cannot express its defect" shape: the room is real, the assertions
// are real, and the arithmetic they are meant to guard is invisible in it.
//
// A monitor at the back edge of a desk is the asymmetric case. Turn the desk and
// the monitor has to swing around the desk's pivot; get the angle wrong and it ends
// up over the middle of the desk, or off it entirely, while still passing a share
// test against a desk that is much bigger than it is.
describe('an off-centre rider swings around its support', () => {
  const desk = part({
    id: 'desk', name: 'Desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [-1.2, 0, -1.6],
  });
  // Against the desk's back edge: 250 mm behind its centre, in the desk's own frame.
  const OFFSET: [number, number] = [0, -0.25];
  const monitor = part({
    id: 'mon', name: 'Monitor', category: 'monitor', shape: 'monitor', dimMM: [600, 200, 450],
    pos: [desk.pos[0] + OFFSET[0], 0.75, desk.pos[2] + OFFSET[1]],
  });
  const room = footprintForLayout('rect', 6, 4);

  it('the fixture is off-centre, unlike the preset', () => {
    // Both halves stated, because the point of this block is the difference.
    const seeded = defaultScene('u', 6, 5);
    const rides = ridingParents(seeded);
    for (const [child, parent] of Object.entries(rides)) {
      const c = seeded.find((p) => p.id === child)!;
      const s = seeded.find((p) => p.id === parent)!;
      expect(Math.hypot(c.pos[0] - s.pos[0], c.pos[2] - s.pos[2])).toBeLessThan(1e-9);
    }
    expect(Math.hypot(OFFSET[0], OFFSET[1])).toBeGreaterThan(0.2);
    expect(ridingParents([desk, monitor])).toEqual({ mon: 'desk' });
  });

  it('lands where the desk’s own frame puts it, at whatever angle the desk ended on', () => {
    const parts = [desk, monitor];
    const locked = lockedForSolve(parts, {}, null);
    const movable = movableFor(parts, locked);
    let turned = 0;
    for (let seed = 0; seed < 6; seed++) {
      const start = randomizeStart(parts, room, movable, makeRng(seed));
      const result = solveLayout(parts, room, locked, { seed, mode: 'shuffle', start });
      const after = applyPlacements(parts, result);
      const [d, m] = after;
      // Derived from the desk's FINAL transform and the authored offset —
      // `localToWorld` is a geometry primitive, not the code under test, and the
      // offset comes from the fixture rather than from `snapshotDescendants`.
      const [wx, wz] = localToWorld(d.rot, OFFSET[0], OFFSET[1]);
      expect(m.pos[0], `seed ${seed} x`).toBeCloseTo(d.pos[0] + wx, 6);
      expect(m.pos[2], `seed ${seed} z`).toBeCloseTo(d.pos[2] + wz, 6);
      expect(m.rot, `seed ${seed} yaw`).toBeCloseTo(d.rot, 6);
      // The control: an angle of 0 makes `localToWorld` the identity and the whole
      // assertion above a translation test.
      if (Math.abs(d.rot) > 0.1) turned++;
    }
    expect(turned, 'the desk must actually be ending up turned').toBeGreaterThan(2);
  }, 60000);
});
