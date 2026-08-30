import { describe, expect, it } from 'vitest';
import { settleHeights, settleParts } from '../lib/layout-settle';
import { footprintForLayout, type Footprint } from '../lib/footprint';
import { footArea, footFromPart, footInsidePoly, footIntersectionArea, outsideShare } from '../lib/geometry';
import type { ScenePart } from '../lib/scene-spec';
import { MOUNT_PAD } from '../lib/physics';

const RECT: Footprint = footprintForLayout('rect', 6, 4);

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

const foot = (p: ScenePart) => footFromPart(p.pos, p.rot, p.dimMM, p.circle);
const outside = (p: ScenePart, poly: Footprint = RECT) => outsideShare(foot(p), poly, 9);
const shared = (a: ScenePart, b: ScenePart) =>
  footIntersectionArea(foot(a), foot(b)) / Math.min(footArea(foot(a)), footArea(foot(b)));

const sofa = (pos: [number, number, number], rot = 0) =>
  part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos, rot });

describe('settleParts · inside the room', () => {
  it('sees an overhang the sampled share forgives', () => {
    // `outsideShare`'s outermost samples sit 10% in from the edges, so a 2.2 m sofa
    // 100 mm over the wall reads as 0.000 outside on a 5×5 grid. Settling used that
    // as its acceptance test and stopped early; the seed used it as its placement
    // gate and seated a coffee table 20 mm inside the plaster.
    const s = sofa([2.55, 0, 0], Math.PI / 2);
    expect(outsideShare(foot(s), RECT, 5)).toBe(0);
    expect(footInsidePoly(foot(s), RECT)).toBe(false);
    const [settled] = settleParts([s], RECT);
    expect(footInsidePoly(foot(settled), RECT)).toBe(true);
  });

  it('pulls a piece whose footprint hangs over a wall back in', () => {
    // Centre 150 mm inside the east wall: the CENTRE clamp every previous pass used
    // called this in-room, and half the sofa was in the garden.
    const s = sofa([2.85, 0, 0], Math.PI / 2);
    expect(outside(s)).toBeGreaterThan(0);
    const [settled] = settleParts([s], RECT);
    expect(outside(settled)).toBe(0);
    // …and it moved no further than it had to: still against that wall.
    expect(settled.pos[0]).toBeGreaterThan(2.4);
  });

  it('recovers a piece placed entirely outside the room', () => {
    const [settled] = settleParts([sofa([12, 0, 9])], RECT);
    expect(outside(settled)).toBe(0);
  });

  it('pulls a piece out of the void of an L', () => {
    // The exact failure the starter scene shipped: an armchair in the quadrant the
    // L cuts away.
    const poly = footprintForLayout('l', 6, 4.7);
    const chair = part({ category: 'chair', shape: 'chair-armchair', dimMM: [800, 800, 900], pos: [2.1, 0, 1.45] });
    expect(outside(chair, poly)).toBeGreaterThan(0);
    const [settled] = settleParts([chair], poly);
    expect(outside(settled, poly)).toBe(0);
  });

  it('leaves a piece that is already in alone', () => {
    const s = sofa([0, 0, 1.4], Math.PI);
    const [settled] = settleParts([s], RECT);
    expect(settled.pos).toEqual(s.pos);
  });

  it('never moves a wall-mounted piece off its wall', () => {
    const tv = part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.4, -1.97], wallMounted: true });
    const [settled] = settleParts([tv], RECT);
    expect(settled.pos).toEqual(tv.pos);
  });

  it('does not resize anything', () => {
    const s = sofa([12, 0, 9]);
    const [settled] = settleParts([s], RECT);
    expect(settled.dimMM).toEqual([2200, 950, 880]);
  });

  it('leaves the caller’s parts untouched', () => {
    const s = sofa([12, 0, 9]);
    settleParts([s], RECT);
    expect(s.pos).toEqual([12, 0, 9]);
  });
});

describe('settleParts · out of each other', () => {
  it('separates two pieces in the same place', () => {
    // Two detections of one sofa, or a bed and a wardrobe the AI both put on the
    // north wall. The detect → scene path resolved nothing between parts.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0, 0, -1.1] });
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0.3, 0, -1.3] });
    expect(shared(bed, wardrobe)).toBeGreaterThan(0.5);
    const [a, b] = settleParts([bed, wardrobe], RECT);
    expect(shared(a, b)).toBeLessThan(0.02);
    expect(outside(a)).toBe(0);
    expect(outside(b)).toBe(0);
  });

  it('moves the smaller piece and leaves the anchor where it was', () => {
    const s = sofa([0, 0, 1.4], Math.PI);
    const stand = part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 1.4] });
    const [settledSofa, settledStand] = settleParts([s, stand], RECT);
    expect(settledSofa.pos).toEqual(s.pos);
    expect(settledStand.pos).not.toEqual(stand.pos);
  });

  it('lets a chair stay tucked under the table it belongs to', () => {
    const table = part({ category: 'table', shape: 'desk-standard', dimMM: [1500, 850, 750], pos: [0, 0, 0] });
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [480, 520, 850], pos: [0, 0, 0.55], rot: Math.PI });
    const [, settled] = settleParts([table, chair], RECT);
    expect(settled.pos).toEqual(chair.pos);
  });

  it('leaves a rug under the furniture it anchors', () => {
    const s = sofa([0, 0, 1.4], Math.PI);
    const rug = part({ category: 'rug', shape: 'rug', dimMM: [2400, 1600, 5], pos: [0, 0, 0.8] });
    const [, settled] = settleParts([s, rug], RECT);
    expect(settled.pos).toEqual(rug.pos);
  });

  it('respects a frozen piece', () => {
    const a = sofa([0, 0, 0]);
    const b = part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 0] });
    const [, settled] = settleParts([a, b], RECT, { frozen: new Set([b.id]) });
    expect(settled.pos).toEqual(b.pos);
  });

  it('leaves a piece put when the room has nowhere to put it', () => {
    // A 6 m room with a 2.2 m sofa across every metre of it: there is no free spot,
    // and inventing one is worse than reporting the clash.
    const poly = footprintForLayout('rect', 2.4, 1.2);
    const a = sofa([0, 0, 0]);
    const b = sofa([0.1, 0, 0]);
    const settled = settleParts([a, b], poly);
    expect(settled).toHaveLength(2);
    expect(settled.every((p) => Number.isFinite(p.pos[0]) && Number.isFinite(p.pos[2]))).toBe(true);
  });
});

// ─── settleHeights · what Suggest was missing ─────────────────────────────────
//
// The user's report, in one sentence: put a nightstand on an armchair, press Suggest,
// and the armchair moves out from under it while the nightstand keeps the armchair's
// height and hangs in the air. `Placement` is `{x, z, yaw}` — the solver has no
// vertical axis and no concept of one piece riding another — so nothing in the search
// could have noticed, and from directly above in the plan it looks correct.
describe('settleHeights · a rider whose support has moved', () => {
  const armchair = (pos: [number, number, number]) =>
    part({ category: 'chair', shape: 'chair-armchair', dimMM: [700, 700, 900], pos });
  // A nightstand is NOT tabletop-prone, which is what makes it the right fixture: it
  // exercises the "floor-standing piece left in mid-air" branch rather than the
  // "snap a lamp onto a surface" one, and those are two different clauses.
  const nightstand = (pos: [number, number, number]) =>
    part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos });

  it('drops the rider to the floor when nothing is under it any more', () => {
    // The armchair has moved to (2, 0, 1); the nightstand still sits at the armchair's
    // old TOP (0.9) over (0, 0, 0), where there is now nothing at all.
    const chair = armchair([2, 0, 1]);
    const stand = nightstand([0, 0.9, 0]);
    const fixes = settleHeights([chair, stand], 2.8);
    expect(fixes, 'exactly one piece needed moving').toHaveLength(1);
    expect(fixes[0].id).toBe(stand.id);
    expect(fixes[0].y).toBe(0);
  });

  it('leaves it alone when the support is still under it', () => {
    // The negative control, and without it the test above passes for a function that
    // drops everything to the floor unconditionally.
    const chair = armchair([0, 0, 0]);
    const stand = nightstand([0, 0.9, 0]);
    expect(settleHeights([chair, stand], 2.8)).toEqual([]);
  });

  it('reports only the pieces whose Y changed, not every piece', () => {
    // A write is not free: on the Suggest path each of these becomes an override in
    // `useStudio.positions`, which per `lib/transforms.ts` pins that value against a
    // re-detect and persists. A function returning all four would stamp the room.
    const parts = [
      armchair([2, 0, 1]),
      nightstand([0, 0.9, 0]),
      part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [-1, 0, -1] }),
      part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [1, 0, -1] }),
    ];
    const fixes = settleHeights(parts, 2.8);
    expect(fixes.map((f) => f.id)).toEqual([parts[1].id]);
  });

  it('resolves lowest-first, so a lamp on a desk does not land on itself', () => {
    // `findSupportDetailed` has NO below-test — it takes the highest `top` whose
    // footprint covers enough of the mover, above or below. So the order pieces are
    // resolved in is load-bearing rather than an optimisation: a lamp asked before the
    // desk it stands on can come back resting on a desk that is still in the air.
    //
    // Desk in mid-air at 0.5 with a lamp on top of it at 1.25. Both must come down,
    // and the lamp must end on the desk's FINAL top (0.75), not on its old one.
    const desk = part({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0.5, 0] });
    const lamp = part({ category: 'lamp', shape: 'lamp-table', dimMM: [300, 300, 400], pos: [0, 1.25, 0] });
    const fixes = settleHeights([lamp, desk], 2.8);
    const by = new Map(fixes.map((f) => [f.id, f]));
    expect(by.get(desk.id)?.y, 'the desk goes to the floor').toBe(0);
    expect(by.get(lamp.id)?.y, 'and the lamp onto the desk it now stands on').toBeCloseTo(0.75, 9);
  });

  it('measures a mounted piece by its CENTRE, so the ceiling clamp is not off by h/2', () => {
    // `pos[1]` is a bottom for a floor anchor and the mesh CENTRE for every other one.
    // This clamp used to read `p.wallMounted || p.shape === 'fan' || p.shape ===
    // 'lamp-pendant'` — a list that had already needed two shapes appended — and a
    // DOOR is neither of those shapes, so a door with its flag unset was measured as
    // `pos[1] + h`: 1.05 + 2.1 = 3.15 in a 2.8 m room, over a cap it is nowhere near.
    //
    // The door here is deliberately given NO `wallMounted` flag, which is exactly what
    // an imported scene file can produce (`lib/scene-file.ts` trusts the field rather
    // than deriving it). Its real extent is [0, 2.1] and it fits.
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 1.05, -2] });
    expect(settleHeights([door], 2.8), 'a 2.1 m door fits under a 2.8 m ceiling').toEqual([]);
  });

  it('leaves a door too tall for the room on its own threshold', () => {
    // Without this the assertion above passes for a clamp that was deleted. Same door, a
    // 2.0 m ceiling: cap is 1.98 and the door's top is 2.1, so `cap - h / 2` wants a
    // CENTRE of 0.93 — which is a BOTTOM of −0.12 m, and `wallApertures` would cut the
    // light hole into the ground.
    //
    // **Two earlier versions of this test both pinned a door lifted off its threshold.**
    // The first asserted 0.93 and pinned the hole in the ground. The second asserted
    // `1.05 + MOUNT_PAD` and pinned the door 20 mm up — against the docblock of the very
    // constant it read, which says `placeNewPart` deliberately does not use it because
    // "a door's canonical height IS h/2, and padding stood every door 2 cm off its own
    // threshold". `wall-floor` is a centred anchor that is still floor-REFERENCED.
    //
    // So the low guard is `h / 2`, the clamp resolves to the height the door already has,
    // and it emits NOTHING. The door keeps its threshold, its top pokes 120 mm through
    // the ceiling, and `lib/clearance.ts` reports `tall`. Refusing to move it is the
    // answer, not a missing clamp — which is why the sibling below has to exist.
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 1.05, -2] });
    expect(settleHeights([door], 2.0), 'a door too tall for the room is not moved').toEqual([]);
    expect(door.pos[1] - 2100 / 2000, 'and its bottom is still on the floor').toBeCloseTo(0, 9);
  });

  it('and does bring a mounted piece down when its top would go through the slab', () => {
    // The sibling that makes the two `toEqual([])` above mean something. A door can never
    // exercise the high bound — it is floor-referenced, so `h / 2` always wins — and with
    // only door fixtures the whole centred branch could be deleted with this file green.
    // A television hung too high is the case that fires.
    const tv = part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 2.5, -2] });
    const fixes = settleHeights([tv], 2.6);
    expect(fixes).toHaveLength(1);
    // Derived from the constant, not typed: this is the bound `drag-resolve.ts:187` and
    // `heightForNewCeiling` already use, so the high side really is one number in three
    // files. `MOUNT_PAD`'s own value is pinned in `tests/scene-build.test.ts`.
    expect(fixes[0].y).toBeCloseTo(2.6 - MOUNT_PAD - 820 / 2000, 9);
    // And the top is under the slab, which is what the clamp is for.
    expect(fixes[0].y + 820 / 2000).toBeLessThanOrEqual(2.6 - MOUNT_PAD + 1e-9);
  });

  it('does not touch the array it is handed', () => {
    // The docblock says "Pure: `parts` is not touched", and nothing asserted it —
    // dropping the `.map(p => ({ ...p, pos: [...p.pos] }))` from the working copy is a
    // silent mutant that every other assertion in this file still passes, because they
    // all read the returned fixes and never the input. One caller hands in the array it
    // is rendering from.
    // One piece, floating, with nothing under it — so the pass certainly has work to
    // do. A chair-plus-nightstand pair does not move at all: the chair's top IS the
    // nightstand's support, which is the pass working and no use as a fixture here.
    // TWO pieces at DIFFERENT heights, so the working copy's `.sort()` is not a no-op.
    // With one element the snapshot could not see `[...parts].sort()` become
    // `parts.sort()` - an in-place reorder of the array a caller is rendering from,
    // which is exactly the aliasing the docblock warns about.
    const stand = part({ id: 'stand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0.85, 0] });
    const plant = part({ id: 'plant', category: 'plant', shape: 'plant', dimMM: [400, 400, 700], pos: [1.5, 0.4, 1.5] });
    const parts = [stand, plant];
    const snapshot = JSON.stringify(parts);
    const fixes = settleHeights(parts, 2.8);
    expect(fixes.length, 'the fixture must actually move something').toBeGreaterThan(0);
    expect(JSON.stringify(parts), 'settleHeights mutated its input').toBe(snapshot);
  });

  // A DOCUMENTED LIMIT, pinned at the wrong answer, the way `CEILING_TOPS` in
  // `tests/scene-seed.test.ts` pins the pendant that pokes through its slab. It goes red
  // the day someone fixes this — 1.35 becomes 0.75 — so it still retires itself.
  //
  // **It was an `it.fails` and that was the wrong tool.** `it.fails` passes when the body
  // throws for ANY reason, so it was parked on "something in here throws" rather than on
  // the number in its own name. Measured, both green: making `settleHeights` throw a
  // TypeError on entry, and making the monitor emit no fix at all so that `?.y` is
  // `undefined` and `toBeCloseTo` throws on that instead. In the second case the
  // documented limit had silently changed — the monitor was left at its authored 0.3
  // rather than at 1.35 — and the test whose whole job was to hold that number noticed
  // nothing. Self-retiring worked in the fix direction and was inert in the break one.
  //
  // Ascending Y is necessary and not sufficient. A support that starts ABOVE its rider is
  // resolved second, so the rider has already taken its floating top: the desk drops to
  // the floor and the monitor is left at 1.35 with nothing under it — the exact bug this
  // pass exists to fix, one level up. Unreachable through `buildSceneFromRoom`, where
  // everything enters at y = 0, and reachable the moment Suggest is wired up. Not fixed
  // here because a fixed-point loop can DIVERGE: with no below-test, two pieces over one
  // footprint each take the other's top and both rise every pass. A correct fix has to
  // say which pieces may act as supports, which is a rule about furniture and belongs in
  // `lib/layout-rules.ts` beside the others.
  it('leaves a rider on the height its support had BEFORE it fell — documented limit', () => {
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0.6, 0] });
    const monitor = part({ id: 'monitor', category: 'monitor', shape: 'monitor', dimMM: [600, 200, 400], pos: [0, 0.3, 0] });
    const fixes = settleHeights([desk, monitor], 2.8);

    // Both halves, because the limit is the PAIR: the desk falls and the rider does not
    // follow it. Either alone is satisfied by the pass doing nothing.
    const m = fixes.find((f) => f.id === 'monitor');
    const d = fixes.find((f) => f.id === 'desk');
    expect(m, 'the monitor must get a fix at all').toBeDefined();
    expect(d, 'the desk must get a fix at all').toBeDefined();
    expect(d!.y, 'the desk drops to the floor').toBeCloseTo(0, 9);
    // 0.75 — the desk's SETTLED top — is the right answer. 1.35 is what it does.
    expect(m!.y, 'documented limit: 1.35 is wrong, 0.75 is right').toBeCloseTo(1.35, 9);
  });
});
