import { describe, it, expect } from 'vitest';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';
import { lockedForSolve, makeRng, movableFor, randomizeStart, solveLayout, withRiders } from '@/lib/layout-solve';
import { applyPlacements } from '@/lib/layout-shuffle';
import { ridingParents } from '@/lib/rigid-parent';
import { footArea, footFromPart, footIntersectionArea, localToWorld } from '@/lib/geometry';
import { MIN_SUPPORT_SHARE, verticalExtent } from '@/lib/physics';
import { isObstacle } from '@/lib/layout-rules';
import { costBreakdown, DEFAULT_WEIGHTS, NAV_CELL, prepare, type LayoutContext } from '@/lib/layout-score';

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
    .filter((p) => !p.wallMounted && p.pos[1] > 0 && !(p.id in rides))
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
    // ON the rug, not beside it: at `pos[1] = 0` the floor clause one line earlier
    // refuses the sofa and `findSupportDetailed` is never called, so the rug refusal
    // this test is named for is not reached and deleting it stays green. Measured.
    const sofa = part({
      id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 880], pos: [0, 0.005, 0],
    });
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
    // OFF THE FLOOR, which is what makes this reach the clause it is named for. With
    // the lamp at `pos[1] = 0` the floor clause refuses it first and the below-test
    // is never asked: measured, dropping the `Math.abs` — so the comparison becomes
    // one-sided and everything BELOW a support counts as riding it — left all
    // seventeen assertions in this file green. What that lets through is not
    // hypothetical: a bedside lamp standing in front of a wardrobe becomes the
    // wardrobe's rider, and `carryRiders` teleports it to wherever the wardrobe went.
    const near = part({
      id: 'near', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.55, 0],
    });
    expect(footIntersectionArea(foot(near), foot(wardrobe)) / footArea(foot(near))).toBeGreaterThan(MIN_SUPPORT_SHARE);
    expect(topOf(wardrobe), 'the wardrobe top is far ABOVE it, not below').toBeGreaterThan(near.pos[1] + 1);
    expect(ridingParents([wardrobe, near])).toEqual({});
  });

  it('does not claim a lamp left hanging above the nightstand is riding it', () => {
    const lamp = part({
      id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.75, 0],
    });
    expect(ridingParents([stand, lamp])).toEqual({});
  });

  // …and the band PINNED, not merely exercised. The 200 mm gap above is four times
  // `SUPPORT_Y_EPS`, so widening the tolerance to 0.19 left every assertion in this
  // file green and a lamp floating 150 mm over its nightstand would have been
  // declared a rider and carried. A pair either side of the bar is what holds it:
  // a one-ended test on a tolerance is a tolerance free at one end.
  it('holds the adjacency band from both sides', () => {
    const at = (y: number) =>
      ridingParents([stand, part({
        id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, y, 0],
      })]);
    expect(topOf(stand), 'the fixture straddles the real top').toBeCloseTo(0.55, 9);
    expect(at(0.599), '49 mm proud — settle noise, still resting on it').toEqual({ lamp: 'stand' });
    expect(at(0.601), '51 mm proud — in the air').toEqual({});
  });

  it('never makes a wall-mounted piece a rider', () => {
    // A MIRROR, not the 1450 mm television this used to use. That television does not
    // fit on a 450 mm nightstand, so the test was refused on footprint and never
    // reached the clause it is named for — decoration with a note beside it, which is
    // still decoration.
    const mirror = part({
      id: 'mirror', category: 'mirror', shape: 'mirror', dimMM: [300, 30, 900], pos: [0, 0.55, 0],
      wallMounted: true,
    });
    expect(
      footIntersectionArea(foot(mirror), foot(stand)) / footArea(foot(mirror)),
      'it does sit over the nightstand',
    ).toBeGreaterThan(MIN_SUPPORT_SHARE);
    expect(mirror.pos[1]).toBeCloseTo(topOf(stand), 9);
    expect(ridingParents([stand, mirror])).toEqual({});
  });

  // …and the one that actually reaches the anchor test. A 1450 mm television does
  // not fit on a 450 mm nightstand, so the test above is refused on FOOTPRINT and
  // deleting `isFloorStanding` survived it. A pendant is the case that matters
  // anyway: it hangs, so `pos[1]` is its mesh CENTRE rather than its bottom, and
  // reading a centre as a bottom is the confusion `verticalExtent` exists to end.
  // Hung at 550 mm over a nightstand whose top is 550 mm, the arithmetic agrees
  // exactly and the anchor is the only thing that says no.
  it('never makes a hanging pendant the rider of what is under it', () => {
    const pendant = part({
      id: 'pend', category: 'lamp', shape: 'lamp-pendant', dimMM: [300, 300, 400], pos: [0, 0.55, 0],
    });
    // The fixture has to be able to fail on every other clause.
    expect(footIntersectionArea(foot(pendant), foot(stand)) / footArea(foot(pendant))).toBeGreaterThan(
      MIN_SUPPORT_SHARE,
    );
    expect(pendant.pos[1]).toBeCloseTo(topOf(stand), 6);
    expect(ridingParents([stand, pendant])).toEqual({});
  });

  // ASYMMETRY. Every other fixture here is at yaw 0, where a rotated footprint and
  // an unrotated one are the same rectangle — so dropping the child's own angle
  // from the support probe is invisible in all of them. This nightstand is narrow
  // and this rider is long: end-on it covers two thirds of its own footprint and
  // rides; turned across, barely a quarter, and it does not.
  it('measures the rider footprint at the angle the rider is actually at', () => {
    const narrow = part({ id: 'narrow', category: 'nightstand', shape: 'nightstand', dimMM: [450, 200, 550] });
    const along = part({
      id: 'bar', category: 'other', shape: 'box', dimMM: [700, 150, 100], pos: [0, 0.55, 0],
    });
    const across = part({ ...along, rot: Math.PI / 2 });
    expect(ridingParents([narrow, along]), 'end-on it rides').toEqual({ bar: 'narrow' });
    expect(ridingParents([narrow, across]), 'turned across it does not').toEqual({});
  });

  it('a piece on the floor rides nothing', () => {
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850] });
    expect(ridingParents([stand, chair])).toEqual({});
  });

  // THE ON-THE-FLOOR TEST, reached — and BOTH directions of it, which is the half
  // that took a second pass. The two tests above are refused by the below-test long
  // before this clause is asked, so deleting it survived them both. The case it
  // guards needs a support SHORT enough that a piece standing on the FLOOR is inside
  // the 50 mm adjacency band of its top, and not a rug (which `findSupportDetailed`
  // refuses for its own reasons). A 40 mm mat is that case.
  //
  // The pair is the point. A chair whose bottom is at 0 is standing on the floor,
  // 40 mm inside the mat, and is not riding it. Lift the same chair onto the mat and
  // it is, and moving the mat has to take it along. A one-ended version of this
  // passed against `p.pos[1] <= SUPPORT_Y_EPS`, which refused both.
  it('does not make a piece on the floor the rider of the 40 mm mat it stands inside', () => {
    const mat = part({ id: 'mat', category: 'other', shape: 'box', dimMM: [1200, 1200, 40] });
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850] });
    // The fixture has to be able to fail: the mat must be a legal support that the
    // chair sits inside the adjacency band of.
    expect(topOf(mat)).toBeCloseTo(0.04, 6);
    expect(Math.abs(chair.pos[1] - topOf(mat))).toBeLessThan(0.05);
    expect(footIntersectionArea(foot(chair), foot(mat)) / footArea(foot(chair))).toBeGreaterThan(MIN_SUPPORT_SHARE);
    expect(ridingParents([mat, chair])).toEqual({});
  });

  it('does make it a rider once it is standing ON the mat', () => {
    const mat = part({ id: 'mat', category: 'other', shape: 'box', dimMM: [1200, 1200, 40] });
    const chair = part({
      id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850], pos: [0, 0.04, 0],
    });
    expect(ridingParents([mat, chair])).toEqual({ chair: 'mat' });
  });

  // The same clause from ABOVE. A 40 mm mat only pins `p.pos[1] <= 0` down to 40 mm,
  // so widening it to 0.03 stayed green and a rider on a 20 mm platform silently
  // stopped being one. Zero is the value the comment argues for; this is what makes
  // the argument checkable.
  it('a rider on a 20 mm platform is still a rider', () => {
    const shim = part({ id: 'shim', category: 'other', shape: 'box', dimMM: [1200, 1200, 20] });
    const chair = part({
      id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850], pos: [0, 0.02, 0],
    });
    expect(ridingParents([shim, chair])).toEqual({ chair: 'shim' });
  });

  // A round rider is measured as an ellipse, not the square around it. Nothing else
  // here is round, so dropping `p.circle` from the support probe was free: the
  // bounding square overstates a circle's area by ~27%, and a share computed against
  // the wrong denominator denies a lamp a support it genuinely rides.
  it('measures a round rider as the circle it draws', () => {
    const small = part({ id: 'small', category: 'nightstand', shape: 'nightstand', dimMM: [360, 360, 550] });
    const round = part({
      id: 'round', category: 'lamp', shape: 'cylinder', dimMM: [460, 460, 400], pos: [0.12, 0.55, 0],
      circle: true,
    });
    const boxy = part({ ...round, id: 'boxy', circle: undefined });
    // The fixture's whole point: the same footprint, round and square, land on
    // opposite sides of MIN_SUPPORT_SHARE against this nightstand.
    expect(ridingParents([small, round]), 'the circle is mostly over it').toEqual({ round: 'small' });
    expect(ridingParents([small, boxy]), 'its bounding square is not').toEqual({});
  });

  it('follows a chain: a lamp on a tray on a desk', () => {
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750] });
    const tray = part({ id: 'tray', category: 'other', shape: 'box', dimMM: [400, 400, 60], pos: [0, 0.75, 0] });
    const lamp = part({
      id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.81, 0],
    });
    expect(ridingParents([desk, tray, lamp])).toEqual({ tray: 'desk', lamp: 'tray' });
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

      expect(Object.keys(rides).length, `seed ${seed}: two riders, or this loop is vacuous`).toBe(2);
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
    console.log(`riders: nightstands moved on ${supportsMoved} of 8 seeds`);
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
  // ALREADY TURNED, and that is the whole point of the number.
  //
  // `snapshotDescendants` takes the rider's offset with `worldToLocal(parent.rot, …)`
  // and `cascadeTransform` puts it back with `localToWorld(newRot, …)` — an inverse
  // pair. At parent yaw 0 both are the identity, so replacing the first with the
  // second is a sign flip that changes nothing: measured, that mutation leaves
  // `rigid-parent`, `drag-convoy` and this file green, 114 assertions, every one of
  // whose fixtures snapshots at zero. A user who angles a desk before pressing
  // Suggest gets the monitor on the mirrored side of it.
  const DESK_ROT = 0.6;
  const desk = part({
    id: 'desk', name: 'Desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750],
    pos: [-1.2, 0, -1.6], rot: DESK_ROT,
  });
  // Against the desk's back edge: 250 mm behind its centre, in the desk's own frame.
  const OFFSET: [number, number] = [0, -0.25];
  const seat = localToWorld(DESK_ROT, OFFSET[0], OFFSET[1]);
  const monitor = part({
    id: 'mon', name: 'Monitor', category: 'monitor', shape: 'monitor', dimMM: [600, 200, 450],
    pos: [desk.pos[0] + seat[0], 0.75, desk.pos[2] + seat[1]], rot: DESK_ROT,
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
    // …and the support must START turned, or the world→local leg is the identity and
    // a sign flip in it is invisible.
    expect(Math.abs(desk.rot)).toBeGreaterThan(0.1);
    expect(ridingParents([desk, monitor])).toEqual({ mon: 'desk' });
  });

  it('lands where the desk’s own frame puts it, at whatever angle the desk ended on', () => {
    const parts = [desk, monitor];
    const locked = lockedForSolve(parts, {}, null);
    const movable = movableFor(parts, locked);
    let turned = 0;
    for (let seed = 0; seed < 12; seed++) {
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
    console.log(`off-centre rider: desk ended turned on ${turned} of 12 seeds`);
    expect(turned, 'the desk must actually be ending up turned').toBeGreaterThan(2);
  }, 60000);
});

// ── What the review found, and none of the above could ──────────────────────
//
// Every fixture above hands `lockedForSolve` an empty `pinned` and a null `confined`,
// so not one of them could see that the pass was moving pieces the user had locked.
// Three independent reviewers measured it; it moved a pinned lamp up to 5.3 m.
describe('carryRiders is not a second authority on what may move', () => {
  const DESK_ROT = 0.6;
  const desk = part({
    id: 'desk', name: 'Desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750],
    pos: [-1.2, 0, -1.6], rot: DESK_ROT,
  });
  const seat = localToWorld(DESK_ROT, 0, -0.25);
  const monitor = part({
    id: 'mon', name: 'Monitor', category: 'monitor', shape: 'monitor', dimMM: [600, 200, 450],
    pos: [desk.pos[0] + seat[0], 0.75, desk.pos[2] + seat[1]], rot: DESK_ROT,
  });
  const sofa = part({ id: 'sofa', name: 'Sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 880] });
  const parts = [desk, monitor, sofa];
  const room = footprintForLayout('rect', 6, 4);

  it('leaves a LOCKED rider exactly where the user pinned it', () => {
    const locked = lockedForSolve(parts, { mon: true }, null);
    expect(locked, 'the fixture pins the monitor and nothing else').toEqual([false, true, false]);
    const movable = movableFor(parts, locked);
    let deskMoved = 0;
    for (let seed = 0; seed < 8; seed++) {
      const start = randomizeStart(parts, room, movable, makeRng(seed));
      const result = solveLayout(parts, room, locked, { seed, mode: 'shuffle', start });
      const after = applyPlacements(parts, result);
      expect(after[1].pos[0], `seed ${seed} x`).toBeCloseTo(monitor.pos[0], 9);
      expect(after[1].pos[2], `seed ${seed} z`).toBeCloseTo(monitor.pos[2], 9);
      expect(after[1].rot, `seed ${seed} yaw`).toBeCloseTo(monitor.rot, 9);
      expect(result.moved, `seed ${seed}: a pinned piece is not a moved piece`).not.toContain(1);
      // THE CONTROL. A solve that moved nothing satisfies every line above.
      if (result.moved.includes(0)) deskMoved++;
    }
    expect(deskMoved, 'the desk under it must actually be getting moved').toBeGreaterThan(4);
  }, 60000);

  // The same hole one lock along. A **Try a fix** locks the whole room outside its
  // own finding, and `lib/clearance.ts` can never name a rider in `partIds` (it
  // skips anything above the floor), so EVERY confined fix on a support was carrying
  // a piece the user's press had excluded. Fixed at the confinement, in `RoomTools`,
  // which is why what this asserts is only that the lock itself holds.
  it('honours a confine that names the support but not the rider', () => {
    const locked = lockedForSolve(parts, {}, new Set(['desk']));
    expect(locked, 'everything outside the confine is locked').toEqual([false, true, true]);
    const result = solveLayout(parts, room, locked, { seed: 3, mode: 'arrange' });
    const after = applyPlacements(parts, result);
    expect(after[1].pos[0]).toBeCloseTo(monitor.pos[0], 9);
    expect(after[1].pos[2]).toBeCloseTo(monitor.pos[2], 9);
  }, 60000);
});

// A rider that the SEARCH is scoring as a floor obstacle is not the search's to
// second-guess. `ridingParents` admits anything off the floor (`pos[1] > 0`) and
// `isObstacle` counts anything under 50 mm up, so the two overlap on (0, 0.05) — a
// chair on a 40 mm platform is both. Carried after `openRoutes` and `snapYaws`, the
// last passes that could repair it, that chair was measured at `overlap` 361 on one
// seed and `outside` 647 on another: carried straight through the wall.
describe('a rider the search is pricing as an obstacle is left to the search', () => {
  const mat = part({ id: 'mat', name: 'Platform', category: 'other', shape: 'box', dimMM: [2400, 2400, 40] });
  const chair = part({
    id: 'chair', name: 'Chair', category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850],
    pos: [1.0, 0.04, 1.0],
  });
  const wardrobe = part({
    id: 'ward', name: 'Wardrobe', category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2100],
    pos: [-2.0, 0, -1.5],
  });
  const parts = [mat, chair, wardrobe];
  const room = footprintForLayout('rect', 6, 4);

  it('the fixture really is in the band where the two bars disagree', () => {
    expect(ridingParents(parts), 'geometrically it IS riding the platform').toEqual({ chair: 'mat' });
    expect(isObstacle(chair), 'and the search IS pricing it as floor').toBe(true);
  });

  it('does not carry it, and does not strike it out of the reasons either', () => {
    const locked = lockedForSolve(parts, {}, null);
    const movable = movableFor(parts, locked);
    let seen = 0;
    for (let seed = 0; seed < 6; seed++) {
      const start = randomizeStart(parts, room, movable, makeRng(seed));
      const result = solveLayout(parts, room, locked, { seed, mode: 'shuffle', start });
      if (!result.moved.includes(1)) continue;
      seen++;
      // In `moved` AND in `moves`: the search moved it, so the search can say why.
      // Filtering `moves` on the geometric rider map struck it out anyway — a piece
      // moved with nothing on screen naming it, the same silence as the lock.
      expect(result.moves.map((m) => m.index), `seed ${seed}`).toContain(1);
    }
    expect(seen, 'the chair must actually be getting moved on some seed').toBeGreaterThan(2);
  }, 60000);
});

// The other half of the confine fix. `carryRiders` refuses to move a locked piece,
// so a **Try a fix** naming only the nightstand would strand its lamp — the widening
// has to happen where the confinement is decided.
describe('withRiders widens a confine to what is standing on it', () => {
  const stand = part({ id: 'stand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] });
  const lamp = part({
    id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.55, 0],
  });
  const other = part({ id: 'other', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 880], pos: [3, 0, 3] });

  it('adds the lamp when the nightstand is named', () => {
    expect([...withRiders(new Set(['stand']), [stand, lamp, other])].sort()).toEqual(['lamp', 'stand']);
  });

  it('does not add the nightstand when only the lamp is named', () => {
    // The relation is one-way. Naming the lamp is not a claim on the furniture it
    // happens to be resting on, and widening both ways would let one finding about a
    // lamp move the whole bedside.
    expect([...withRiders(new Set(['lamp']), [stand, lamp, other])]).toEqual(['lamp']);
  });

  it('follows a chain to a fixed point', () => {
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750] });
    const tray = part({ id: 'tray', category: 'other', shape: 'box', dimMM: [400, 400, 60], pos: [0, 0.75, 0] });
    const top = part({
      id: 'top', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.81, 0],
    });
    // The fixture must BE a chain, or a single pass would satisfy this too.
    expect(ridingParents([desk, tray, top])).toEqual({ tray: 'desk', top: 'tray' });
    expect([...withRiders(new Set(['desk']), [desk, tray, top])].sort()).toEqual(['desk', 'top', 'tray']);
  });

  it('leaves a set with no riders in it alone', () => {
    expect([...withRiders(new Set(['other']), [stand, lamp, other])]).toEqual(['other']);
  });
});

// The pass runs BEFORE the answer is measured, and that ordering was pinned by
// nothing: moving `carryRiders` to after `breakdownAfter` left `layout-riders`,
// `layout-solve`, `bed-rung-safety` AND `layout-shuffle` green. Neither re-recorded
// baseline can see it — both re-score `.placements` themselves and never read
// `.after` — so the 0.18 shift is evidence the PLACEMENTS changed, not that the
// number describes them.
//
// The invariant is the honest form and it is not about riders at all: what a solve
// reports as its cost must be the cost of what it returns. `isCleanShuffle` reads
// `breakdownAfter` and `RoomTools` reads `after`, so if those describe a room with
// the lamp still where the search left it, the gate is judging an arrangement the
// user will never see.
describe('the reported cost describes the returned placements', () => {
  const parts = defaultScene('u', 6, 5);
  const footprint = footprintForLayout('u', 6, 5);
  const locked = lockedForSolve(parts, {}, null);
  const movable = movableFor(parts, locked);
  const model = prepare({ parts, movable, footprint } as LayoutContext);

  it('re-scoring the answer reproduces `after`, over eight seeds', () => {
    let riderMoved = 0;
    for (let seed = 0; seed < 8; seed++) {
      const start = randomizeStart(parts, footprint, movable, makeRng(seed));
      const r = solveLayout(parts, footprint, locked, { seed, mode: 'shuffle', start });
      const rescored = costBreakdown(model, r.placements, DEFAULT_WEIGHTS, NAV_CELL);
      expect(rescored.total, `seed ${seed}`).toBeCloseTo(r.after, 9);
      // THE CONTROL. If no rider ever moved, `after` would match whether the carry
      // ran before or after the measurement and this asserts nothing about ordering.
      const rides = ridingParents(parts);
      if (r.moved.some((i) => parts[i].id in rides)) riderMoved++;
    }
    expect(riderMoved, 'a rider must actually be moving on most seeds').toBeGreaterThan(4);
  }, 60000);
});
