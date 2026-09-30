import { describe, expect, it } from 'vitest';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintBounds, footprintForLayout, type Footprint } from '@/lib/footprint';
import {
  lockedForSolve,
  makeRng,
  movableFor,
  openRoutes,
  randomizeStart,
  rigidSets,
  snapYaws,
  solveLayout,
  withCompany,
  type SolveResult,
} from '@/lib/layout-solve';
import { applyPlacements, lockedForShuffle, shuffleRoom } from '@/lib/layout-shuffle';
import { localToWorld, worldToLocal } from '@/lib/geometry';
import { DEFAULT_WEIGHTS, angleDelta, navigabilityCost, prepare, type Placement } from '@/lib/layout-score';

// A merged set is one rigid body to the solver, as it already was to a click, a drag
// and a wall move. Before this, Suggest and Ideas moved each member as a piece of its
// own, and every Ideas press on the `open` preset's merged dining set handed it back
// taken apart — see § H.6.5 of `docs/what-is-still-open.md` for the table.
//
// Every solve test below first proves its fixture CAN break the set: the same room
// with the merge taken off must come back broken, or a rigid answer would only be the
// search choosing not to move anything.

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape'>): ScenePart => ({
  name: over.id,
  pos: [0, 0, 0],
  rot: 0,
  dimMM: [500, 500, 500],
  locked: false,
  ...over,
});

const W = 6;
const D = 4;
const FOOTPRINT = footprintForLayout('open', W, D);

/** The `open` preset's dining table and its four chairs, merged — the table is the
 *  `table` nearest the chairs (the first `table` in the list is the coffee table). */
function diningRoom(turn = 0): { parts: ScenePart[]; ids: string[] } {
  const base = defaultScene('open', W, D);
  const chairs = base.filter((p) => p.shape === 'chair-dining');
  const cx = chairs.reduce((s, c) => s + c.pos[0], 0) / chairs.length;
  const cz = chairs.reduce((s, c) => s + c.pos[2], 0) / chairs.length;
  const table = base
    .filter((p) => p.category === 'table')
    .reduce((a, b) => (Math.hypot(a.pos[0] - cx, a.pos[2] - cz) <= Math.hypot(b.pos[0] - cx, b.pos[2] - cz) ? a : b));
  const ids = [table.id, ...chairs.map((c) => c.id)];
  const parts = base.map((p) => {
    if (!ids.includes(p.id)) return p;
    const [ox, oz] = localToWorld(turn, p.pos[0] - table.pos[0], p.pos[2] - table.pos[2]);
    return { ...p, groupId: 'dining', pos: [table.pos[0] + ox, p.pos[1], table.pos[2] + oz], rot: p.rot + turn } as ScenePart;
  });
  return { parts, ids };
}

const unmerged = (parts: ScenePart[]) => parts.map(({ groupId: _groupId, ...p }) => p as ScenePart);

type Pose = { x: number; z: number; yaw: number };
const poseOf = (p: ScenePart): Pose => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot });

/** How far the set is from rigid: the largest change, over members, of a member's
 *  offset in the lead's own frame (metres) and of its heading relative to the lead
 *  (radians). Both zero is the set arriving as it left. */
function nonRigidity(before: Pose[], after: Pose[]): { offset: number; turn: number } {
  let offset = 0;
  let turn = 0;
  for (let k = 1; k < before.length; k++) {
    const [bx, bz] = worldToLocal(before[0].yaw, before[k].x - before[0].x, before[k].z - before[0].z);
    const [ax, az] = worldToLocal(after[0].yaw, after[k].x - after[0].x, after[k].z - after[0].z);
    offset = Math.max(offset, Math.hypot(ax - bx, az - bz));
    const rel = (s: Pose[]) => angleDelta(s[k].yaw, s[0].yaw);
    turn = Math.max(turn, Math.abs(angleDelta(rel(after), rel(before))));
  }
  return { offset, turn };
}

const moved = (before: Pose[], after: Pose[]) =>
  before.some((b, k) => Math.hypot(after[k].x - b.x, after[k].z - b.z) > 0.005 || Math.abs(angleDelta(after[k].yaw, b.yaw)) > 0.005);

/** The set's poses in `applied`, lead first (the table is the lead: the largest
 *  obstacle footprint in the set). */
const setPoses = (applied: ScenePart[], ids: string[]) => ids.map((id) => poseOf(applied.find((p) => p.id === id)!));

describe('movableFor: a merged set moves whole or not at all', () => {
  const a = part({ id: 'a', category: 'table', shape: 'desk-standard', groupId: 'g' });
  const b = part({ id: 'b', category: 'chair', shape: 'chair-dining', groupId: 'g', pos: [1, 0, 0] });
  const c = part({ id: 'c', category: 'chair', shape: 'chair-dining', groupId: 'h', pos: [2, 0, 0] });
  const d = part({ id: 'd', category: 'chair', shape: 'chair-dining', groupId: 'h', pos: [3, 0, 0] });
  const loose = part({ id: 'e', category: 'sofa', shape: 'sofa', pos: [4, 0, 0] });

  it('a lock on one member holds its set, and only its set', () => {
    expect(movableFor([a, b, c, d, loose], [false, true, false, false, false])).toEqual([false, false, true, true, true]);
  });

  it('a wall-mounted member holds its set too', () => {
    const shelf = part({ id: 's', category: 'painting', shape: 'painting', groupId: 'h', wallMounted: true });
    expect(movableFor([c, d, shelf, loose], [false, false, false, false])).toEqual([false, false, false, true]);
  });

  it('a room with no merged set reads exactly as it did', () => {
    const plain = [a, b, c, d, loose].map(({ groupId: _g, ...p }) => p as ScenePart);
    expect(movableFor(plain, [false, true, false, false, false])).toEqual([true, false, true, true, true]);
  });
});

describe('rigidSets: which member leads', () => {
  it('the largest obstacle leads, so a bigger rug in the set never does', () => {
    const rug = part({ id: 'rug', category: 'rug', shape: 'rug', dimMM: [3000, 2000, 5], groupId: 'g' });
    const table = part({ id: 'table', category: 'table', shape: 'desk-standard', dimMM: [1600, 900, 750], groupId: 'g' });
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [480, 520, 850], groupId: 'g' });
    const r = rigidSets([chair, rug, table], [true, true, true]);
    expect(r.sets).toEqual([[2, 0, 1]]);
    expect([...r.setOf]).toEqual([0, 0, 0]);
  });

  it('a tie goes to the lower index', () => {
    const x = part({ id: 'x', category: 'chair', shape: 'chair-dining', groupId: 'g' });
    const y = part({ id: 'y', category: 'chair', shape: 'chair-dining', groupId: 'g' });
    expect(rigidSets([x, y], [true, true]).sets).toEqual([[0, 1]]);
  });

  it('a set of one is a piece, and a piece the solve may not move is in no set', () => {
    const x = part({ id: 'x', category: 'chair', shape: 'chair-dining', groupId: 'g' });
    const y = part({ id: 'y', category: 'chair', shape: 'chair-dining', groupId: 'h' });
    const z = part({ id: 'z', category: 'chair', shape: 'chair-dining', groupId: 'h' });
    const r = rigidSets([x, y, z], [true, false, true]);
    expect(r.sets).toEqual([]);
    expect([...r.setOf]).toEqual([-1, -1, -1]);
  });
});

describe('withCompany widens a confine to the whole merged set', () => {
  const stand = part({ id: 'stand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], groupId: 'bed' });
  const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 500], pos: [1.2, 0, 0], groupId: 'bed' });
  const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.55, 0], groupId: 'lit' });
  const bulb = part({ id: 'bulb', category: 'lamp', shape: 'lamp-floor', dimMM: [300, 300, 1600], pos: [3, 0, 3], groupId: 'lit' });
  const other = part({ id: 'other', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 880], pos: [-3, 0, 3] });
  const room = [stand, bed, lamp, bulb, other];

  it('naming a member names its set, then its riders, then THEIR sets', () => {
    // bed → stand (same set) → lamp (on the stand) → bulb (merged with the lamp).
    expect([...withCompany(new Set(['bed']), room)].sort()).toEqual(['bed', 'bulb', 'lamp', 'stand']);
  });

  it('leaves a piece in no set, with nothing on it, alone', () => {
    expect([...withCompany(new Set(['other']), room)]).toEqual(['other']);
  });

  it('is withRiders exactly in a room with no merged set', () => {
    const plain = room.map(({ groupId: _g, ...p }) => p as ScenePart);
    expect([...withCompany(new Set(['stand']), plain)].sort()).toEqual(['lamp', 'stand']);
    expect([...withCompany(new Set(['bed']), plain)]).toEqual(['bed']);
  });

  it('lets a confined solve move the set it names a chair of', () => {
    const { parts, ids } = diningRoom();
    const confined = withCompany(new Set([ids[1]]), parts);
    expect([...confined].sort()).toEqual([...ids].sort());
    const movable = movableFor(parts, lockedForSolve(parts, {}, confined));
    expect(parts.filter((_, i) => movable[i]).map((p) => p.id).sort()).toEqual([...ids].sort());
  });
});

describe('randomizeStart scatters a merged set as one body', () => {
  it('the lead and every other piece draw exactly as unmerged; the members ride the lead', () => {
    const { parts, ids } = diningRoom();
    const plain = unmerged(parts);
    const lockedM = lockedForShuffle(parts, {});
    const lockedP = lockedForShuffle(plain, {});
    for (const seed of [1, 2, 3]) {
      const merged = randomizeStart(parts, FOOTPRINT, movableFor(parts, lockedM), makeRng(seed));
      const free = randomizeStart(plain, FOOTPRINT, movableFor(plain, lockedP), makeRng(seed));
      const idx = ids.map((id) => parts.findIndex((p) => p.id === id));
      // Every draw is still taken, so nothing outside the set moves to a new spot.
      parts.forEach((_, i) => {
        if (!idx.slice(1).includes(i)) expect(merged[i]).toEqual(free[i]);
      });
      const before = idx.map((i) => poseOf(parts[i]));
      const after = idx.map((i) => merged[i]);
      const n = nonRigidity(before, after);
      expect(n.offset).toBeLessThan(1e-9);
      expect(n.turn).toBeLessThan(1e-9);
      // …and unmerged, the same scatter takes it apart, so the check above can fail.
      expect(nonRigidity(before, idx.map((i) => free[i])).offset).toBeGreaterThan(0.1);
    }
  });
});

describe('the solver hands a merged set back as it took it', () => {
  it('Suggest on a set turned 30°: moved, and rigid', { timeout: 120_000 }, () => {
    const turn = Math.PI / 6;
    const { parts, ids } = diningRoom(turn);
    const placed = new Set(ids);
    const before = setPoses(parts, ids);
    let movedMerged = 0;
    let brokeUnmerged = 0;
    for (const seed of [1, 2, 3]) {
      const solve = (ps: ScenePart[]): SolveResult =>
        solveLayout(ps, FOOTPRINT, lockedForSolve(ps, {}, null), { seed, mode: 'arrange', placed });
      const merged = setPoses(applyPlacements(parts, solve(parts)), ids);
      if (moved(before, merged)) movedMerged++;
      const n = nonRigidity(before, merged);
      expect(n.offset, `seed ${seed}`).toBeLessThan(1e-6);
      expect(n.turn, `seed ${seed}`).toBeLessThan(1e-9);
      const free = setPoses(applyPlacements(parts, solve(unmerged(parts))), ids);
      if (nonRigidity(before, free).offset > 0.02) brokeUnmerged++;
    }
    expect(movedMerged, 'the set has to be moved for rigid to mean anything').toBe(3);
    expect(brokeUnmerged, 'unmerged, the same solves take it apart').toBe(3);
  });

  it('every idea Ideas offers keeps the set whole', { timeout: 120_000 }, () => {
    const { parts, ids } = diningRoom();
    const room = { footprint: FOOTPRINT, height: 2.4 };
    const before = setPoses(parts, ids);
    const merged = shuffleRoom(parts, room, lockedForShuffle(parts, {}), { attempt: 1 });
    expect(merged?.ideas.length ?? 0).toBeGreaterThan(0);
    for (const idea of merged!.ideas) {
      const after = setPoses(applyPlacements(parts, idea), ids);
      expect(moved(before, after)).toBe(true);
      const n = nonRigidity(before, after);
      expect(n.offset).toBeLessThan(1e-6);
      expect(n.turn).toBeLessThan(1e-9);
    }
    const plain = unmerged(parts);
    const free = shuffleRoom(plain, room, lockedForShuffle(plain, {}), { attempt: 1 });
    expect(free!.ideas.some((idea) => nonRigidity(before, setPoses(applyPlacements(plain, idea), ids)).offset > 0.02)).toBe(true);
  });
});

// The two passes that move pieces AFTER the search, called directly: each has a
// path a whole solve reaches only now and then, and each is where a set would come
// back in two places if it moved one member and put back another.
describe('the tidy passes carry a set whole', () => {
  const at = (ps: ScenePart[]): Placement[] => ps.map((q) => ({ x: q.pos[0], z: q.pos[2], yaw: q.rot }));
  const pick = (ps: Placement[], idx: number[]) => idx.map((k) => ps[k]);

  /** A desk turned 5° with a chair merged beside it, and — when `boxed` — two locked
   *  wardrobes 2 mm either side of the chair, turned with it. Squaring the set turns
   *  the chair too, and turned it no longer fits between them however far the set is
   *  shoved, so every attempt `snapYaws` makes fails and it has to put the set back. */
  const deskRoom = (boxed: boolean, merged = true) => {
    const rot = (5 * Math.PI) / 180;
    const [cx, cz] = localToWorld(rot, 1.2, 0);
    const block = (id: string, side: number) => {
      const [ox, oz] = localToWorld(rot, 0, side * (0.24 + 0.002 + 0.3));
      return part({ id, category: 'wardrobe', shape: 'wardrobe', dimMM: [600, 600, 2000], pos: [cx + ox, 0, cz + oz], rot, locked: true });
    };
    const g = merged ? { groupId: 'g' } : {};
    const parts = [
      part({ id: 'desk', category: 'table', shape: 'desk-standard', dimMM: [1500, 850, 750], rot, ...g }),
      part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [480, 520, 850], pos: [cx, 0, cz], rot: rot + Math.PI / 2, ...g }),
      ...(boxed ? [block('b1', 1), block('b2', -1)] : []),
    ];
    const model = prepare({ parts, movable: movableFor(parts, parts.map((p) => p.locked)), footprint: FOOTPRINT });
    return { model, start: at(parts) };
  };

  it('snapYaws squares a set about its lead, and puts ALL of it back when it cannot', () => {
    const open = deskRoom(false);
    const squared = snapYaws(open.model, open.start, DEFAULT_WEIGHTS, false, null);
    expect(squared[0].yaw, 'with room to turn, the set is squared').toBeCloseTo(0, 9);
    expect(nonRigidity(pick(open.start, [0, 1]), pick(squared, [0, 1])).offset).toBeLessThan(1e-9);

    const boxed = deskRoom(true);
    const kept = snapYaws(boxed.model, boxed.start, DEFAULT_WEIGHTS, false, null);
    expect(kept.slice(0, 2), 'boxed in, every member is where it was').toEqual(boxed.start.slice(0, 2));

    // Unmerged, the desk squares on its own and the chair stays turned: the fixture
    // does reach a state where the two part company.
    const loose = deskRoom(true, false);
    const apart = snapYaws(loose.model, loose.start, DEFAULT_WEIGHTS, false, null);
    expect(nonRigidity(pick(loose.start, [0, 1]), pick(apart, [0, 1])).offset).toBeGreaterThan(0.05);
  });

  it('openRoutes opens a route by moving the set as one', () => {
    // A 4 x 6 room with its door in the south wall, sealed across the middle by two
    // 2 m wardrobes merged side by side. Unmerged, the repair opens the route by
    // taking the pair apart; merged, it has to move them together.
    const POLY: Footprint = [
      [-2, -3],
      [2, -3],
      [2, 3],
      [-2, 3],
    ];
    const room = (merged: boolean) => {
      const g = merged ? { groupId: 'g' } : {};
      const parts = [
        part({ id: 'door', category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 1.05, -3], wallMounted: true }),
        part({ id: 'w1', category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2000], pos: [-1, 0, 0], ...g }),
        part({ id: 'w2', category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2000], pos: [1, 0, 0], ...g }),
      ];
      return { model: prepare({ parts, movable: movableFor(parts, [false, false, false]), footprint: POLY }), start: at(parts) };
    };
    for (const seed of [1, 2, 3]) {
      const merged = room(true);
      expect(navigabilityCost(merged.model, merged.start, 0.05), 'the set cuts the room off from the door').toBeGreaterThan(0);
      const out = openRoutes(merged.model, merged.start, DEFAULT_WEIGHTS, footprintBounds(POLY), makeRng(seed));
      expect(navigabilityCost(merged.model, out, 0.05), `seed ${seed}: the route is open`).toBe(0);
      const n = nonRigidity(pick(merged.start, [1, 2]), pick(out, [1, 2]));
      expect(n.offset, `seed ${seed}`).toBeLessThan(1e-9);
      expect(n.turn, `seed ${seed}`).toBeLessThan(1e-9);

      const loose = room(false);
      const apart = openRoutes(loose.model, loose.start, DEFAULT_WEIGHTS, footprintBounds(POLY), makeRng(seed));
      expect(nonRigidity(pick(loose.start, [1, 2]), pick(apart, [1, 2])).offset, `seed ${seed}: unmerged, it splits them`).toBeGreaterThan(1);
    }
  });
});

// Where a set meets the room's other structure: a rug that has to go home, a relation
// group, a swap, a rider. Each is a path one set member could take on its own, so each
// is a room where that happens — found by breaking the rule it tests and sweeping the
// presets until a solve came back bent, then kept to the cheapest press that shows it.
describe('a set stays whole where it meets the rest of the room', () => {
  const room = (layout: 'rect', w: number, d: number) => ({ footprint: footprintForLayout(layout, w, d), height: 2.4 });
  /** `base` with `ids` merged as they stand, about the first. */
  const merge = (base: ScenePart[], ids: string[]): ScenePart[] => {
    const piv = base.find((p) => p.id === ids[0])!;
    return base.map((p) => {
      if (!ids.includes(p.id)) return p;
      const [ox, oz] = localToWorld(0, p.pos[0] - piv.pos[0], p.pos[2] - piv.pos[2]);
      return { ...p, groupId: 'g', pos: [piv.pos[0] + ox, p.pos[1], piv.pos[2] + oz], rot: p.rot } as ScenePart;
    });
  };
  /** Every idea keeps the set whole, one moves it (unless `moves` is false), and
   *  unmerged the same press takes it apart. */
  const ideasKeepWhole = (parts: ScenePart[], ids: string[], r: ReturnType<typeof room>, moves = true) => {
    const before = setPoses(parts, ids);
    const out = shuffleRoom(parts, r, lockedForShuffle(parts, {}), { attempt: 1 });
    expect(out?.ideas.length ?? 0).toBeGreaterThan(0);
    for (const [k, idea] of out!.ideas.entries()) {
      const n = nonRigidity(before, setPoses(applyPlacements(parts, idea), ids));
      expect(n.offset, `idea ${k}`).toBeLessThan(1e-6);
      expect(n.turn, `idea ${k}`).toBeLessThan(1e-9);
    }
    expect(out!.ideas.some((idea) => moved(before, setPoses(applyPlacements(parts, idea), ids)))).toBe(moves);
    const plain = unmerged(parts);
    const free = shuffleRoom(plain, r, lockedForShuffle(plain, {}), { attempt: 1 });
    expect(free!.ideas.some((idea) => nonRigidity(before, setPoses(applyPlacements(plain, idea), ids)).offset > 0.02)).toBe(true);
  };

  it('a rug that has to go home takes its set home with it', { timeout: 120_000 }, () => {
    // A 5 x 4 m rug under the coffee table, in a 4.8 x 3.8 m room: it overhangs
    // wherever it goes, so every idea sends it back to its spot, and the table with it
    // — the set never moves here, and the test is that the table goes home too.
    const base = defaultScene('rect', 4.8, 3.8).map((p) =>
      p.id === 'rug-1' ? { ...p, dimMM: [5000, 4000, 5] as [number, number, number], pos: [0, 0, 0] as [number, number, number] } : p,
    );
    ideasKeepWhole(merge(base, ['table-1', 'rug-1']), ['table-1', 'rug-1'], room('rect', 4.8, 3.8), false);
  });

  it('a group move takes a merged set whole, a member the group does not relate to included', { timeout: 120_000 }, () => {
    // A group move carries what the relation table ties together, and the plant is
    // tied to nothing: merged to the sofa, it travels only because the set is made a
    // group of its own, joined to the sofa's.
    const ids = ['sofa-1', 'plant-1'];
    ideasKeepWhole(merge(defaultScene('rect', 6, 4), ids), ids, room('rect', 6, 4));
  });

  it('a set never trades places with a piece, either way round', { timeout: 120_000 }, () => {
    // A floor lamp is within the swap's size band of plenty of the room, so a swap
    // that took the lamp alone, or put another piece where it stood, is on offer.
    const ids = ['sofa-1', 'lamp-1'];
    ideasKeepWhole(merge(defaultScene('rect', 6, 4), ids), ids, room('rect', 6, 4));
  });

  it('a set carrying a rider comes back whole when the set barely moved', { timeout: 120_000 }, () => {
    // The rider pass resets a support that did not move past MOVE_EPSILON to where it
    // was. Asked of the table alone, that put the table back and left its chairs a
    // hair along: Suggest on the set turned 30°, with a lamp on the table, seed 2.
    const { parts: set, ids } = diningRoom(Math.PI / 6);
    const t = set.find((p) => p.id === ids[0])!;
    const parts = [...set, part({ id: 'tl', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [t.pos[0] + 0.4, 0.75, t.pos[2]] })];
    const before = setPoses(parts, ids);
    const solve = (ps: ScenePart[]) =>
      applyPlacements(ps, solveLayout(ps, FOOTPRINT, lockedForSolve(ps, {}, null), { seed: 2, mode: 'arrange', placed: new Set(ids) }));
    const n = nonRigidity(before, setPoses(solve(parts), ids));
    expect(n.offset).toBeLessThan(1e-6);
    expect(n.turn).toBeLessThan(1e-9);
    expect(nonRigidity(before, setPoses(solve(unmerged(parts)), ids)).offset, 'unmerged, the same solve takes it apart').toBeGreaterThan(0.02);
  });
});

// The helper's own arithmetic, since every assertion above leans on it: a rigid move
// of the whole set reads zero, and moving one member reads its distance.
describe('nonRigidity measures what it says', () => {
  const before: Pose[] = [
    { x: 0, z: 0, yaw: 0 },
    { x: 1, z: 0, yaw: 0.5 },
  ];
  it('reads zero for a rigid turn and slide', () => {
    const t = 0.7;
    const [ox, oz] = localToWorld(t, 1, 0);
    const n = nonRigidity(before, [
      { x: 2, z: 3, yaw: t },
      { x: 2 + ox, z: 3 + oz, yaw: 0.5 + t },
    ] satisfies Placement[]);
    expect(n.offset).toBeLessThan(1e-12);
    expect(n.turn).toBeLessThan(1e-12);
  });
  it('reads a member moved on its own', () => {
    const n = nonRigidity(before, [before[0], { x: 1.3, z: 0, yaw: 0.9 }]);
    expect(n.offset).toBeCloseTo(0.3, 12);
    expect(n.turn).toBeCloseTo(0.4, 12);
  });
});
