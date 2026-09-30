import { describe, expect, it } from 'vitest';
import { findSupportDetailed, highestSurfaceUnder, MIN_SUPPORT_SHARE, restingOn } from '@/lib/physics';
import { resolvePlacement } from '@/lib/drag-resolve';
import { planConvoy, resolveConvoy } from '@/lib/drag-convoy';
import { settleHeights } from '@/lib/layout-settle';
import { ridingParents } from '@/lib/rigid-parent';
import { placeNewPart, selectionForPick, type ScenePart } from '@/lib/scene-spec';
import { footArea, footFromPart, footIntersectionArea, type Poly } from '@/lib/geometry';
import { TUCKED_CLASH_SHARE } from '@/lib/layout-rules';

// § H.6.3 — a seat never stands on the surface it tucks under.
//
// The two bars disagreed. A chair may be tucked up to `TUCKED_CLASH_SHARE` (0.85) of
// its own footprint under a table and still be a fine arrangement to Suggest and to Room
// check, while anything covering `MIN_SUPPORT_SHARE` (0.5) of it holds it up. So a chair
// tucked 60% under its table was left on the floor by Suggest and stood ON the tabletop
// by the very next drag: over the `t` and `open` dining sets, 14 of 14 chairs tucked past
// half were lifted by a 10 mm nudge, and 14 by dragging the set 50 mm.
//
// Every clause here is a PAIR — a table lamp at the same spot, which must still land —
// because a support probe that refused everything would pass every "stays on the floor"
// assertion on its own.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.

const part = (o: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
  ({ name: o.id, rot: 0, locked: false, ...o }) as ScenePart;

/** A 1600 × 900 dining table at the origin — `desk-standard` in the `table` category,
 *  which `roleOf` reads as a dining table by its size. Top at 0.75. */
const TABLE = part({ id: 'table', category: 'table', shape: 'desk-standard', dimMM: [1600, 900, 750], pos: [0, 0, 0] });
const TOP = 0.75;
/** A 1100 × 600 coffee table. Top at 0.42, above `settleHeights`' 0.3 bar. */
const COFFEE = part({ id: 'coffee', category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [0, 0, 0] });

const chair = (id: string, x: number, z: number, y = 0, rot = 0) =>
  part({ id, category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [x, y, z], rot });
const lamp = (x: number, z: number, y = 0) =>
  part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [x, y, z] });
const ottoman = (x: number, z: number, y = 0) =>
  part({ id: 'ottoman', category: 'ottoman', shape: 'ottoman', dimMM: [550, 400, 420], pos: [x, y, z] });

/** Share of `p`'s footprint over `under`'s — the number both bars are written in. */
function share(p: ScenePart, under: ScenePart): number {
  const f = footFromPart(p.pos, p.rot, p.dimMM, p.circle);
  return footIntersectionArea(f, footFromPart(under.pos, under.rot, under.dimMM, under.circle)) / footArea(f);
}

/** A chair whose front edge is 300 mm under the table's +z side: 60% of it is under. */
const TUCKED_Z = 0.45 + 0.25 - 0.3;

/** 6 × 4 m, centred on the origin. */
const ROOM: Poly = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const H = 2.5;

describe('the fixture sits in the band the two bars disagreed about', () => {
  it('60% under: over the support bar, under the tuck bar', () => {
    const s = share(chair('c', 0, TUCKED_Z), TABLE);
    expect(s).toBeCloseTo(0.6, 9);
    // The premise of the whole file. Below 0.5 nothing ever lifted it; above 0.85 the
    // report calls it a clash. Only between the two was it fine AND lifted.
    expect(s).toBeGreaterThanOrEqual(MIN_SUPPORT_SHARE);
    expect(s).toBeLessThan(TUCKED_CLASH_SHARE);
  });
});

describe('findSupportDetailed — where a piece would LAND', () => {
  it('a dining chair 60% under its table lands on the floor; a lamp there lands on the table', () => {
    const c = chair('c', 0, TUCKED_Z);
    expect(findSupportDetailed([TABLE], c, 0, TUCKED_Z, c.dimMM)).toBeNull();
    expect(findSupportDetailed([TABLE], lamp(0, TUCKED_Z), 0, TUCKED_Z, [500, 500, 500])).toEqual({ id: 'table', y: TOP });
  });

  it('…and so does one pushed all the way in', () => {
    const c = chair('c', 0, 0);
    expect(share(c, TABLE)).toBe(1);
    expect(findSupportDetailed([TABLE], c, 0, 0, c.dimMM)).toBeNull();
  });

  it('an ottoman lands on the floor under a coffee table, and a lamp lands on it', () => {
    const o = ottoman(0, 0);
    const l = lamp(0, 0);
    expect(findSupportDetailed([COFFEE], o, 0, 0, o.dimMM)).toBeNull();
    expect(findSupportDetailed([COFFEE], l, 0, 0, l.dimMM)?.id).toBe('coffee');
  });

  it('only the partner is looked past: a chair over a sofa still stands on the sofa', () => {
    // The chair on the sofa's backrest is § H.6.2's whole fixture. `sharesFloor` pairs a
    // chair with tables and desks and nothing else, so this must keep landing.
    const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] });
    const c = chair('c', 0, 0);
    expect(findSupportDetailed([sofa], c, 0, 0, c.dimMM)).toEqual({ id: 'sofa', y: 0.88 });
  });

  it('looks PAST the partner to a surface genuinely under the piece', () => {
    // A low platform under the whole set. The table is not a support for the chair, so
    // the probe must find the platform rather than stopping at "nothing".
    const deck = part({ id: 'deck', category: 'other', shape: 'box', dimMM: [3000, 3000, 40], pos: [0, 0, 0] });
    const c = chair('c', 0, TUCKED_Z, 0.04);
    expect(findSupportDetailed([TABLE, deck], c, 0, TUCKED_Z, c.dimMM)).toEqual({ id: 'deck', y: 0.04 });
  });

  it('reads the kind it is HANDED, not the kind stored under that id', () => {
    // The Inspector's model swap asks for the new kind while the list still holds the
    // old one under the same id. Handed the chair's kind with a lamp's id, it must
    // answer for a chair.
    const asked = { id: 'lamp', category: 'chair', shape: 'chair-dining' } as const;
    expect(findSupportDetailed([TABLE, lamp(0, 0, TOP)], asked, 0, 0, [500, 500, 850])).toBeNull();
  });

  it('works both ways round: a small dining table dropped over a chair does not stand on its seat', () => {
    // `sharesFloor` is symmetric, and so is the rule. The table is the one moving here,
    // so its role is read from its OWN size — a 700 × 500 table at 750 mm is a dining
    // table only because of its dimensions; read as a zero-size piece it would be a
    // side table, which shares no floor with a chair, and would stand on the seat.
    const small = part({ id: 'small', category: 'table', shape: 'desk-standard', dimMM: [700, 500, 750], pos: [0, 0, 0] });
    const c = chair('c', 0, 0);
    // The chair IS a surface the table would stand on: it covers 71% of the table's foot.
    expect(highestSurfaceUnder([c], small.id, 0, 0, small.dimMM)).toEqual({ id: 'c', y: 0.85 });
    expect(findSupportDetailed([c], small, 0, 0, small.dimMM)).toBeNull();
  });
});

describe('what a piece is ON, as it stands, is still said truthfully', () => {
  // A chair an earlier version of the app stood on its table is physically on the
  // table. Reporting it "Floating — nothing is holding it up" would be § 37's banner lie
  // in the other direction, and leaving it out of the rider relation strands it in mid-air
  // the moment the table moves.
  const up = chair('c', 0, TUCKED_Z, TOP);

  it('restingOn names the table', () => {
    const r = restingOn([TABLE, up], up.id, up.pos, up.rot, up.dimMM, up.category, up.shape);
    expect(r?.on).toBe('part');
    expect(r?.id).toBe('table');
  });

  it('ridingParents carries it with the table', () => {
    expect(ridingParents([TABLE, up])).toEqual({ c: 'table' });
  });

  it('because the state question has no seat rule, and the drop question does', () => {
    expect(highestSurfaceUnder([TABLE], up.id, up.pos[0], up.pos[2], up.dimMM)?.id).toBe('table');
    expect(findSupportDetailed([TABLE], up, up.pos[0], up.pos[2], up.dimMM)).toBeNull();
  });
});

describe('every caller that moves a piece to what it finds', () => {
  it('drag: nudging a tucked chair does not stand it on the table', () => {
    const c = chair('c', 0, TUCKED_Z);
    const world = [TABLE, c];
    const r = resolvePlacement({
      part: c, rawX: 0.01, rawZ: TUCKED_Z, rot: 0, dim: c.dimMM, parts: world, footprint: ROOM, roomHeight: H, snapMode: 'off',
    });
    expect(r.pos[1]).toBe(0);
    expect(r.supportId).toBeUndefined();
    // Refused rather than lifted. `collidesAt` has no `sharesFloor` exemption, so a
    // chair tucked under its table is refused at ANY depth — § 17's open decision, and
    // already true of the seeded 23% tucks. Before this change a chair past half was
    // lifted instead, and the lift is what made the move valid. If § 17 is ever decided
    // the other way, this is the line that changes.
    expect(r.valid).toBe(false);
    // The pair: a lamp nudged at the same spot lands on the table.
    const l = lamp(0, TUCKED_Z, TOP);
    const lr = resolvePlacement({
      part: l, rawX: 0.01, rawZ: TUCKED_Z, rot: 0, dim: l.dimMM, parts: [TABLE, l], footprint: ROOM, roomHeight: H, snapMode: 'off',
    });
    expect(lr.pos[1]).toBeCloseTo(TOP, 9);
    expect(lr.supportId).toBe('table');
  });

  // Both ways a set travels: shift-selected, and MERGED — the user's own report was a
  // merged dining set. A merged set travels because a click on it selects the whole
  // group (`selectionForPick`), so that is how the merged case picks its selection:
  // the click, not a list this test writes out.
  it.each([
    ['selected', (ps: ScenePart[]) => ps, (ps: ScenePart[]) => ps.map((p) => p.id)],
    [
      'merged',
      (ps: ScenePart[]) => ps.map((p) => ({ ...p, groupId: 'set' })),
      (ps: ScenePart[]) => selectionForPick(ps, ps[0].id, []),
    ],
  ] as const)('drag: moving the whole set (%s) leaves every chair on the floor', (_, merge, pick) => {
    const chairs = [chair('c1', -0.4, TUCKED_Z), chair('c2', 0.4, TUCKED_Z), chair('c3', 0, -TUCKED_Z, 0, Math.PI)];
    const world = merge([TABLE, ...chairs]);
    const table = world[0];
    const convoy = planConvoy({ draggedId: table.id, parts: world, selection: pick(world), parentIds: {}, footprint: ROOM, roomHeight: H });
    const lead = resolvePlacement({
      part: table, rawX: 0.05, rawZ: 0, rot: 0, dim: table.dimMM, parts: world, footprint: ROOM, roomHeight: H, snapMode: 'off',
    });
    const r = resolveConvoy({
      convoy, draggedId: table.id, pos: lead.pos, rot: lead.rot, startPos: table.pos, parts: world,
      footprint: ROOM, roomHeight: H, gesture: 'move', memberHasPosOverride: () => false,
    });
    const moved = r.moves.filter((m) => m.id !== table.id);
    // Vacuity: all three chairs travelled, so "none lifted" is about three moves.
    expect(moved.map((m) => m.id).sort()).toEqual(['c1', 'c2', 'c3']);
    for (const m of moved) {
      expect(m.pos[1], m.id).toBe(0);
      expect(m.pos[0], m.id).toBeCloseTo(chairs.find((c) => c.id === m.id)!.pos[0] + 0.05, 9);
    }
  });

  it('adding: an ottoman dropped over a coffee table goes on the floor; a lamp goes on the table', () => {
    const room = { width: 6, depth: 4, height: H, footprint: ROOM };
    const o = placeNewPart('ottoman', 'ottoman', [550, 400, 420], room, [COFFEE], [0, 0]);
    expect(o.pos[1]).toBe(0);
    expect(o.supportId).toBeNull();
    const l = placeNewPart('lamp', 'lamp-table', [250, 250, 500], room, [COFFEE], [0, 0]);
    expect(l.pos[1]).toBeCloseTo(0.42, 9);
    expect(l.supportId).toBe('coffee');
  });

  it('settling: an ottoman under a coffee table is not lifted onto it, and a lamp is', () => {
    // `settleHeights` lifts "goes on a table" pieces onto any support over 0.3 m, and
    // an ottoman is one of those — so a detected ottoman under a coffee table was put
    // ON the coffee table.
    expect(settleHeights([COFFEE, ottoman(0, 0)], H)).toEqual([]);
    expect(settleHeights([COFFEE, lamp(0, 0)], H)).toEqual([{ id: 'lamp', y: 0.42 }]);
  });

  it('settling: a chair left standing on its table comes down; a lamp there stays', () => {
    expect(settleHeights([TABLE, chair('c', 0, TUCKED_Z, TOP)], H)).toEqual([{ id: 'c', y: 0 }]);
    expect(settleHeights([TABLE, lamp(0, TUCKED_Z, TOP)], H)).toEqual([]);
  });
});
