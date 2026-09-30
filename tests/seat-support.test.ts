import { describe, expect, it } from 'vitest';
import { findSupportDetailed, highestSurfaceUnder, isTabletopProne, MIN_SUPPORT_SHARE, restingOn } from '@/lib/physics';
import { resolvePlacement } from '@/lib/drag-resolve';
import { leadInherited, planConvoy, resolveConvoy, settleLead, travellingWorld } from '@/lib/drag-convoy';
import { settleHeights } from '@/lib/layout-settle';
import { ridingParents } from '@/lib/rigid-parent';
import { CATEGORIES, PART_LIBRARY, placeNewPart, selectionForPick, type ScenePart } from '@/lib/scene-spec';
import { footArea, footFromPart, footIntersectionArea, type Poly } from '@/lib/geometry';
import { isObstacle, isSeating, isSeatRole, roleOf, tucksUnder, TUCKED_CLASH_SHARE } from '@/lib/layout-rules';
import { analyzeRoom, floorBlockers } from '@/lib/clearance';
import { clampDims } from '@/lib/dimension-ranges';

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
/** A nesting ottoman: 350 mm, so it fits under `TABLE`'s 635 mm of knee room. It does
 *  NOT fit under `COFFEE`, whose lower shelf is a quarter of the way up — the fit test
 *  (§ H.6.4) reads what the drawing leaves room for, and that is 105 mm. */
const ottoman = (x: number, z: number, y = 0) =>
  part({ id: 'ottoman', category: 'ottoman', shape: 'ottoman', dimMM: [550, 400, 350], pos: [x, y, z] });

/** Share of `p`'s footprint over `under`'s — the number both bars are written in. */
function share(p: ScenePart, under: ScenePart): number {
  const f = footFromPart(p.pos, p.rot, p.dimMM, p.circle);
  return footIntersectionArea(f, footFromPart(under.pos, under.rot, under.dimMM, under.circle)) / footArea(f);
}

/** A chair whose front edge is 300 mm under the table's +z side: 60% of it is under. */
const TUCKED_Z = 0.45 + 0.25 - 0.3;
/** 450 mm under: 90%, past `TUCKED_CLASH_SHARE`. A pair the room report calls a clash,
 *  so the drag refuses it too — and, for the set tests, the overlap a travelling set
 *  has to INHERIT, because the tuck rule no longer forgives it on its own. */
const DEEP_Z = 0.45 + 0.25 - 0.45;

/** 6 × 4 m, centred on the origin. */
const ROOM: Poly = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const H = 2.5;

/** A set drag the way BOTH tabs run it. The piece under the hand is resolved against
 *  the company shifted by the attempted delta (`travellingWorld`) and carries the
 *  overlaps it picked up with (`leadInherited`); then the lead and its set are brought
 *  to one delta (`settleLead`). `valid` is what a surface accepts: all three agree.
 *
 *  The first version of this file resolved the lead against the UNSHIFTED world, with
 *  no inherited set — a path neither tab takes — and reported a set that both tabs
 *  refused as moving. `inherit: false` is that omission, kept to prove it mattered. */
function dragSet(
  world: ScenePart[],
  grab: string,
  selection: readonly string[],
  dx: number,
  dz: number,
  opts: { rot?: number; inherit?: boolean } = {},
) {
  const lead = world.find((p) => p.id === grab)!;
  const convoy = planConvoy({ draggedId: grab, parts: world, selection, parentIds: {}, footprint: ROOM, roomHeight: H });
  const rot = opts.rot ?? lead.rot;
  const resolveAt = (x: number, z: number) =>
    resolvePlacement({
      part: lead,
      rawX: x,
      rawZ: z,
      rot,
      dim: lead.dimMM,
      parts: convoy.travelling.size > 1 ? travellingWorld(convoy, world, x - lead.pos[0], z - lead.pos[2], convoy.own) : world,
      footprint: ROOM,
      roomHeight: H,
      snapMode: 'off',
      currentY: lead.pos[1],
      wallEdge: convoy.leadEdge,
      inherited: opts.inherit === false ? undefined : leadInherited(convoy, rot, lead.dimMM),
    });
  const asked = resolveAt(lead.pos[0] + dx, lead.pos[2] + dz);
  const s = settleLead(
    resolveAt,
    (l) =>
      resolveConvoy({
        convoy, draggedId: grab, pos: l.pos, rot: l.rot, startPos: lead.pos, parts: world,
        footprint: ROOM, roomHeight: H, gesture: 'move', memberHasPosOverride: () => false,
      }),
    asked,
  );
  return { convoy, lead: s.lead, co: s.co, valid: asked.valid && s.lead.valid && s.co.valid && s.settled };
}

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
    expect(findSupportDetailed([TABLE], c, 0, TUCKED_Z, c.dimMM, 0, undefined)).toBeNull();
    expect(findSupportDetailed([TABLE], lamp(0, TUCKED_Z), 0, TUCKED_Z, [500, 500, 500], 0, undefined)).toEqual({ id: 'table', y: TOP });
  });

  it('…and so does one pushed all the way in', () => {
    const c = chair('c', 0, 0);
    expect(share(c, TABLE)).toBe(1);
    expect(findSupportDetailed([TABLE], c, 0, 0, c.dimMM, 0, undefined)).toBeNull();
  });

  it('an ottoman lands on the floor under a table, and a lamp lands on it', () => {
    const o = ottoman(0, 0);
    const l = lamp(0, 0);
    expect(findSupportDetailed([TABLE], o, 0, 0, o.dimMM, 0, undefined)).toBeNull();
    expect(findSupportDetailed([TABLE], l, 0, 0, l.dimMM, 0, undefined)?.id).toBe('table');
  });

  it('a seat that does not fit under its partner is no partner of it (§ H.6.4)', () => {
    // The rule was written about seats that go UNDER a top. An ottoman at a coffee
    // table shares the roles and not the room — the shelf is at 105 mm — so it is an
    // ordinary pair: dropped over the table, the ottoman stands on it like a box would,
    // rather than on the floor inside the drawing where every later drag is refused.
    const o = ottoman(0, 0);
    expect([tucksUnder(o, TABLE), tucksUnder(o, COFFEE)]).toEqual([true, false]);
    expect(findSupportDetailed([COFFEE], o, 0, 0, o.dimMM, 0, undefined)).toEqual({ id: 'coffee', y: 0.42 });
    // The same gate on a dining chair, at the one corner of the ranges where it closes:
    // the lowest table (600 mm, its apron's underside at 485) and the tallest chairs,
    // whose seat — the part that goes under — is scaled up past it. The chair with it is
    // the catalogue's, which fits.
    const low = { ...TABLE, id: 'low', dimMM: [1600, 900, 600] as [number, number, number] };
    const c = chair('c', 0, 0);
    expect(tucksUnder(c, low)).toBe(true);
    const tall = { ...c, dimMM: [500, 500, 1080] as [number, number, number] };
    expect(tucksUnder(tall, low)).toBe(false);
    expect(findSupportDetailed([low], tall, 0, 0, tall.dimMM, 0, undefined)).toEqual({ id: 'low', y: 0.6 });
  });

  it('only the partner is looked past: a chair over a sofa still stands on the sofa', () => {
    // The chair on the sofa's backrest is § H.6.2's whole fixture. `sharesFloor` pairs a
    // chair with tables and desks and nothing else, so this must keep landing.
    const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] });
    const c = chair('c', 0, 0);
    expect(findSupportDetailed([sofa], c, 0, 0, c.dimMM, 0, undefined)).toEqual({ id: 'sofa', y: 0.88 });
  });

  it('looks PAST the partner to a surface genuinely under the piece', () => {
    // A low platform under the whole set. The table is not a support for the chair, so
    // the probe must find the platform rather than stopping at "nothing".
    const deck = part({ id: 'deck', category: 'other', shape: 'box', dimMM: [2400, 1500, 50], pos: [0, 0, 0] });
    const c = chair('c', 0, TUCKED_Z, 0.05);
    expect(findSupportDetailed([TABLE, deck], c, 0, TUCKED_Z, c.dimMM, 0, undefined)).toEqual({ id: 'deck', y: 0.05 });
  });

  it('a floor deck is not a coffee table: an ottoman stands on it', () => {
    // `other/box` is one of the shapes `roleOf` reads by size, and its range goes down
    // to 50 mm, so a 50 mm deck — the thinnest box `clampDims` allows — was a COFFEE
    // TABLE, which an ottoman shares a floor with. The ottoman then sank through the
    // deck to y = 0. The chair fixture above cannot see this: a chair pairs with dining
    // tables and desks, not coffee tables. Inside a table's plan on purpose, so it is
    // the height that answers and not the platform bound below.
    const deck = part({ id: 'deck', category: 'other', shape: 'box', dimMM: [2400, 1500, 50], pos: [0, 0, 0] });
    expect(clampDims(deck.category, deck.shape, deck.dimMM)).toEqual(deck.dimMM);
    expect(roleOf(deck)).toBe('other');
    const o = ottoman(0, 0, 0.05);
    expect(findSupportDetailed([deck], o, 0, 0, o.dimMM, 0, undefined)).toEqual({ id: 'deck', y: 0.05 });
    // The pair: the lowest real coffee table the catalogue sizes (250 mm) still is one.
    // A box has no shelf and no apron in its drawing, so nothing fits under it, and the
    // ottoman stands on it too — for the fit test's reason rather than the role's.
    const low = part({ id: 'low', category: 'other', shape: 'box', dimMM: [1100, 600, 250], pos: [0, 0, 0] });
    expect(roleOf(low)).toBe('coffee-table');
    expect(tucksUnder(o, low)).toBe(false);
    expect(findSupportDetailed([low], o, 0, 0, o.dimMM, 0, undefined)).toEqual({ id: 'low', y: 0.25 });
  });

  it('a platform bigger than any table is not one: an ottoman and a chair stand on it', () => {
    // The other end of the deck's question. A 3 m platform read as a COFFEE TABLE at
    // 300 mm and a DINING TABLE at 700, so the seat rule would not let an ottoman or a
    // chair stand on it and `settleHeights` dropped the chair inside the box.
    const plat = part({ id: 'plat', category: 'other', shape: 'box', dimMM: [3000, 3000, 300], pos: [0, 0, 0] });
    const stage = { ...plat, dimMM: [3000, 2000, 700] as [number, number, number] };
    expect([roleOf(plat), roleOf(stage)]).toEqual(['other', 'other']);
    const o = ottoman(0, 0, 0.3);
    expect(findSupportDetailed([plat], o, 0, 0, o.dimMM, 0, undefined)).toEqual({ id: 'plat', y: 0.3 });
    const c = chair('c', 0, 0, 0.7);
    expect(findSupportDetailed([stage], c, 0, 0, c.dimMM, 0, undefined)).toEqual({ id: 'plat', y: 0.7 });
    expect(settleHeights([stage, c], H)).toEqual([]);
    // The pair: the largest table the catalogue sizes, 2600 × 1500, is still a table,
    // drawn either way round, and 10 mm past it on either side is not.
    const big = { ...plat, dimMM: [2600, 1500, 700] as [number, number, number] };
    expect(roleOf(big)).toBe('dining-table');
    expect(roleOf({ ...big, dimMM: [1500, 2600, 700] })).toBe('dining-table');
    expect(roleOf({ ...big, dimMM: [2610, 1500, 700] })).toBe('other');
    expect(roleOf({ ...big, dimMM: [2600, 1510, 700] })).toBe('other');
    expect(roleOf({ ...big, dimMM: [1500, 2610, 700] })).toBe('other');
    expect(roleOf({ ...big, dimMM: [1510, 2600, 700] })).toBe('other');
  });

  it('neither bound can make a table or a desk "other"', () => {
    // Both are read off the ranges `clampDims` holds tables and desks to, so a real
    // table at the edge of its own range must still be a table.
    const edges: Array<[number, number, number]> = [
      [9000, 9000, 9000],
      [9000, 9000, 1],
      [9000, 1, 1],
      [1, 9000, 9000],
    ];
    const roles = new Set<string>();
    for (const category of ['table', 'desk'] as const) {
      for (const shape of ['coffee-table', 'desk-standard', 'box'] as const) {
        for (const e of edges) {
          const r = roleOf({ category, shape, dimMM: clampDims(category, shape, e) });
          expect(r, `${category}/${shape} at ${clampDims(category, shape, e).join(' × ')}`).not.toBe('other');
          roles.add(r);
        }
      }
    }
    expect([...roles].sort()).toEqual(['coffee-table', 'desk', 'dining-table']);
  });

  it('a size-read box that blocks the floor always has a role that makes room for it', () => {
    // `roleOf`'s height floor comes from `lib/dimension-ranges.ts`; `isObstacle`'s and
    // `floorBlockers`' 250 mm are literals. They describe one boundary: raise the first
    // above the other two and a box between them stands in the room as 'other' — no
    // access zone, nothing it belongs beside. Swept at every 10 mm and either side of it.
    const heights = [...Array.from({ length: 56 }, (_, i) => 50 + i * 10), 249, 251];
    let blocking = 0;
    for (const h of heights) {
      const box = part({ id: 'box', category: 'other', shape: 'box', dimMM: [1100, 600, h], pos: [0, 0, 0] });
      if (!isObstacle(box) && floorBlockers([box]).length === 0) continue;
      blocking++;
      expect(roleOf(box), `${h} mm`).not.toBe('other');
    }
    expect(blocking).toBe(36);
  });

  it('reads the kind it is HANDED, not the kind stored under that id', () => {
    // The Inspector's model swap asks for the new kind while the list still holds the
    // old one under the same id. Handed the chair's kind with a lamp's id, it must
    // answer for a chair.
    const asked = { id: 'lamp', category: 'chair', shape: 'chair-dining' } as const;
    expect(findSupportDetailed([TABLE, lamp(0, 0, TOP)], asked, 0, 0, [500, 500, 850], 0, undefined)).toBeNull();
  });

  it('works both ways round: a small dining table dropped over a chair does not stand on its seat', () => {
    // `sharesFloor` is symmetric, and so is the rule. The table is the one moving here,
    // so its role is read from its OWN size — a 700 × 500 table at 750 mm is a dining
    // table only because of its dimensions; read as a zero-size piece it would be a
    // side table, which shares no floor with a chair, and would stand on the seat.
    const small = part({ id: 'small', category: 'table', shape: 'desk-standard', dimMM: [700, 500, 750], pos: [0, 0, 0] });
    const c = chair('c', 0, 0);
    // The chair IS a surface the table would stand on: it covers 71% of the table's foot.
    expect(highestSurfaceUnder([c], small.id, 0, 0, small.dimMM, 0, undefined, small.shape)).toEqual({ id: 'c', y: 0.85 });
    expect(findSupportDetailed([c], small, 0, 0, small.dimMM, 0, undefined)).toBeNull();
  });
});

describe('what a piece is ON, as it stands, is still said truthfully', () => {
  // A chair an earlier version of the app stood on its table is physically on the
  // table. Reporting it "Floating — nothing is holding it up" would be § 37's banner lie
  // in the other direction, and leaving it out of the rider relation strands it in mid-air
  // the moment the table moves.
  const up = chair('c', 0, TUCKED_Z, TOP);

  it('restingOn names the table', () => {
    const r = restingOn([TABLE, up], up.id, up.pos, up.rot, up.dimMM, up.category, up.shape, up.circle);
    expect(r?.on).toBe('part');
    expect(r?.id).toBe('table');
  });

  it('ridingParents carries it with the table', () => {
    expect(ridingParents([TABLE, up])).toEqual({ c: 'table' });
  });

  it('because the state question has no seat rule, and the drop question does', () => {
    expect(highestSurfaceUnder([TABLE], up.id, up.pos[0], up.pos[2], up.dimMM, up.rot, up.circle, up.shape)?.id).toBe('table');
    expect(findSupportDetailed([TABLE], up, up.pos[0], up.pos[2], up.dimMM, up.rot, up.circle)).toBeNull();
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
    // Moved, on the floor. § 17 decided (2026-09-30): a seat less than
    // `TUCKED_CLASH_SHARE` under the surface it tucks under is composition, as the
    // room report has always said, so the drag lets it go. Before, it was refused at
    // any depth; before THAT, a chair past half was lifted onto the tabletop, and the
    // lift is what made the move valid. Neither is the answer now.
    expect(share(c, TABLE)).toBeCloseTo(0.6, 9);
    expect(r.valid).toBe(true);
    // The bar is the report's, and past it the drag refuses — still on the floor.
    const deep = resolvePlacement({
      part: c, rawX: 0, rawZ: DEEP_Z, rot: 0, dim: c.dimMM, parts: world, footprint: ROOM, roomHeight: H, snapMode: 'off',
    });
    expect(deep.valid).toBe(false);
    expect(deep.refusal).toBe('blocked');
    expect(deep.pos[1]).toBe(0);
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
  //
  // And from both ends — grabbing the table, and grabbing a chair — because the two are
  // different code: the piece under the hand is resolved by the SURFACE, against the
  // company shifted to where it is going, and every other piece by `resolveConvoy`.
  it.each([
    ['selected', 'table'],
    ['selected', 'c1'],
    ['merged', 'table'],
    ['merged', 'c1'],
  ] as const)('drag: moving the whole set (%s, grabbed by %s) leaves every chair on the floor', (how, grab) => {
    const chairs = [chair('c1', -0.4, TUCKED_Z), chair('c2', 0.4, TUCKED_Z), chair('c3', 0, -TUCKED_Z, 0, Math.PI)];
    const plain = [TABLE, ...chairs];
    const world = how === 'merged' ? plain.map((p) => ({ ...p, groupId: 'set' })) : plain;
    const selection = how === 'merged' ? selectionForPick(world, grab, []) : world.map((p) => p.id);
    const r = dragSet(world, grab, selection, 0.05, 0);
    expect(r.valid).toBe(true);
    // Vacuity: everything travelled, so "none lifted" is about every piece.
    const moved = [r.lead.pos, ...r.co.moves.map((m) => m.pos)];
    expect([grab, ...r.co.moves.map((m) => m.id)].sort()).toEqual(['c1', 'c2', 'c3', 'table']);
    for (const [i, at] of moved.entries()) {
      const id = i === 0 ? grab : r.co.moves[i - 1].id;
      expect(at[1], id).toBe(0);
      expect(at[0], id).toBeCloseTo(world.find((p) => p.id === id)!.pos[0] + 0.05, 9);
    }
  });

  it('drag: the set was refused outright before its overlaps were inherited', () => {
    // The first version of this file said the set moved — measured on a lead resolved
    // against the UNSHIFTED world, a path neither tab takes. Resolved the way both
    // tabs resolve it, the table collided with its own chairs where they were about to
    // be, and was refused from the first millimetre. Withholding the inherited set is
    // that world again, and this is the line that proves the fixture can see it.
    // A chair past the tuck bar, since one inside it is no longer an overlap at all.
    const world = [TABLE, chair('c1', -0.4, DEEP_Z)];
    expect(dragSet(world, 'table', ['table', 'c1'], 0.05, 0).valid).toBe(true);
    expect(dragSet(world, 'table', ['table', 'c1'], 0.05, 0, { inherit: false }).valid).toBe(false);
  });

  it('drag: a turned table answers for its chairs again', () => {
    // `leadInherited` holds only while the lead is exactly as it was picked up. A wheel
    // turn partway through a drag moves its corners, so the forgiveness goes and the
    // chairs are obstacles once more — refused rather than ploughed through.
    const world = [TABLE, chair('c1', -0.4, DEEP_Z)];
    const convoy = planConvoy({ draggedId: 'table', parts: world, selection: ['table', 'c1'], parentIds: {}, footprint: ROOM, roomHeight: H });
    expect(leadInherited(convoy, 0, TABLE.dimMM)).toEqual(new Set(['c1']));
    expect(leadInherited(convoy, Math.PI / 12, TABLE.dimMM)).toBeUndefined();
    // A full turn either way is the table where it started, so its chairs stay forgiven.
    expect(leadInherited(convoy, 2 * Math.PI, TABLE.dimMM)).toEqual(new Set(['c1']));
    expect(leadInherited(convoy, -2 * Math.PI, TABLE.dimMM)).toEqual(new Set(['c1']));
    expect(leadInherited(convoy, 2 * Math.PI + Math.PI / 12, TABLE.dimMM)).toBeUndefined();
    // A half turn is still a turn. For a box it lands on the same footprint, so this is
    // the conservative answer `leadInherited`'s docblock owns up to, not a correct one.
    expect(leadInherited(convoy, Math.PI, TABLE.dimMM)).toBeUndefined();
    expect(leadInherited(convoy, 0, [1700, 900, 750])).toBeUndefined();
    expect(dragSet(world, 'table', ['table', 'c1'], 0.05, 0, { rot: Math.PI / 12 }).valid).toBe(false);
  });

  it('drag: a tucked chair still has a vote — the set stops at a bookcase the chair would hit', () => {
    // Grabbing the table's far end is the case that went through. The table itself
    // overlaps nothing it is not travelling with, so it is not refused; the chair was
    // `startValid: false` for overlapping the table and so could not refuse either —
    // and was towed into the bookcase, valid and silent.
    const c1 = chair('c1', -0.4, TUCKED_Z);
    const shelf = part({ id: 'shelf', category: 'shelf', shape: 'bookshelf', dimMM: [800, 350, 1800], pos: [-0.4, 0, TUCKED_Z + 0.25 + 0.175 + 0.15] });
    const blocked = dragSet([TABLE, c1, shelf], 'table', ['table', 'c1'], 0, 0.35);
    expect(blocked.valid).toBe(false);
    expect(blocked.co.blockedIds).toEqual(['c1']);
    // The pair: the same drag with the bookcase moved out of the chair's path goes.
    const clear = dragSet([TABLE, c1, { ...shelf, pos: [2, 0, shelf.pos[2]] }], 'table', ['table', 'c1'], 0, 0.35);
    expect(clear.valid).toBe(true);
  });

  it('drag: wall riders are left out of it on both sides — a bookcase over a painting refuses, as before', () => {
    // A bookcase stood against a wall with a painting behind it overlaps the painting.
    // The set is refused by either piece, exactly as it was before sets kept their
    // overlaps, because the painting cannot follow the set exactly: its wall corrects
    // it, and a wall rider is exempt from the rigidity test for that reason.
    const art = part({ id: 'art', category: 'painting', shape: 'painting', dimMM: [800, 30, 600], pos: [0, 1.4, -1.965] });
    const shelf = part({ id: 'shelf', category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800], pos: [0, 0, -1.99 + 0.175] });
    const world = [shelf, art];
    const byShelf = dragSet(world, 'shelf', ['shelf', 'art'], 0, -0.009);
    expect(byShelf.convoy.leadStart.inherited.size).toBe(0);
    expect(byShelf.convoy.members.map((m) => m.inherited.size)).toEqual([0]);
    // Toward the wall is where forgiving would plough: the painting is held on the
    // wall, and it cannot refuse — it starts inside the bookcase, so it has no vote.
    expect(byShelf.valid).toBe(false);
    // Grabbed by the painting, forgiving would be sound, since the bookcase follows the
    // painting's own accepted move. It stays refused all the same: keeping riders out
    // on both sides keeps the rule one sentence long and this change to floor pieces.
    const byArt = dragSet(world, 'art', ['shelf', 'art'], 0.1, 0);
    expect(byArt.convoy.leadStart.inherited.size).toBe(0);
    expect(byArt.valid).toBe(false);
  });

  it('drag: a chair on its own slides under its table up to the bar, and stops there', () => {
    // § 17, decided. The inherited set is empty when nothing travels with the chair, so
    // this is the tuck rule alone, reached the app's way: from clear of the table, in.
    const out = chair('c1', -0.4, 0.45 + 0.25 + 0.05);
    expect(share(out, TABLE)).toBe(0);
    const inside = dragSet([TABLE, out], 'c1', ['c1'], 0, TUCKED_Z - out.pos[2]);
    expect(inside.convoy.leadStart.inherited.size).toBe(0);
    expect(inside.valid).toBe(true);
    expect(inside.lead.pos[1]).toBe(0);
    expect(inside.lead.pos[2]).toBeCloseTo(TUCKED_Z, 9);
    // 90% is the report's clash, and the drag says so — the table is what refuses it.
    const past = dragSet([TABLE, out], 'c1', ['c1'], 0, DEEP_Z - out.pos[2]);
    expect(past.valid).toBe(false);
    expect(past.lead.refusal).toBe('blocked');
  });

  it('drag: …only a seat that fits under that surface', () => {
    // The rule is `tucksUnder`, the report's, not the roles alone: a seat that tucks
    // under a dining table is two pieces in one place when it is pushed into a coffee
    // table instead. (No dining chair is the counter-example: its seat is at most
    // 1100 × 490 / 1090 = 494 mm within `clampDims`, under this table's 635 of knee room.)
    const o = ottoman(0, 0.3 + 0.2 - 0.12);
    expect(tucksUnder(o, COFFEE)).toBe(false);
    expect(tucksUnder(o, TABLE)).toBe(true);
    const r = resolvePlacement({
      part: o, rawX: 0.01, rawZ: o.pos[2], rot: 0, dim: o.dimMM, parts: [COFFEE, o], footprint: ROOM, roomHeight: H, snapMode: 'off',
    });
    // Not tucked, so it is not let through at floor level: it stands on the coffee
    // table's top, as § H.6.4 has it — or is refused. Either way it is not IN the table.
    expect(r.pos[1] === 0 && r.valid).toBe(false);
  });

  it('drag: a seat stretched mid-gesture is asked about the size it is becoming', () => {
    // An office chair's armrests are its tuck height (640 / 1150 of it). At 1000 mm they
    // clear a 750 desk's 675 of knee room; stretched to 1300 they do not. Below the
    // support share, so gravity leaves it on the floor and the collision is the answer.
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1200, 600, 750], pos: [0, 0, 0] });
    const c = part({ id: 'c', category: 'chair', shape: 'chair-office', dimMM: [600, 600, 1000], pos: [0, 0, 0.36] });
    expect(share(c, desk)).toBeLessThan(MIN_SUPPORT_SHARE);
    const at = (h: number) =>
      resolvePlacement({ part: c, rawX: 0.01, rawZ: 0.36, rot: 0, dim: [600, 600, h], parts: [desk, c], footprint: ROOM, roomHeight: H, snapMode: 'off' });
    expect(tucksUnder(c, desk)).toBe(true);
    expect(at(1000)).toMatchObject({ valid: true, pos: [0.01, 0, 0.36] });
    expect(tucksUnder({ ...c, dimMM: [600, 600, 1300] }, desk)).toBe(false);
    expect(at(1300)).toMatchObject({ valid: false, refusal: 'blocked' });
  });

  it('drag: a tray on the tabletop does not lift the chair tucked under it', () => {
    // Looking past the table found whatever else was over the chair. A 900 × 600 tray
    // on the table covers the tucked chair by well over half, so the chair stood on
    // the tray, 810 mm up, with the table it is tucked under excluded as a support.
    const tray = part({ id: 'tray', category: 'other', shape: 'box', dimMM: [900, 600, 60], pos: [-0.4, TOP, TUCKED_Z] });
    const c = chair('c', -0.4, TUCKED_Z);
    expect(share(c, tray)).toBeGreaterThanOrEqual(MIN_SUPPORT_SHARE);
    expect(findSupportDetailed([TABLE, tray], c, c.pos[0], c.pos[2], c.dimMM, 0, undefined)).toBeNull();
    // The pair: a lamp at the same spot stands on the tray, the highest thing there.
    expect(findSupportDetailed([TABLE, tray], lamp(-0.4, TUCKED_Z), -0.4, TUCKED_Z, [500, 500, 500], 0, undefined)).toEqual({ id: 'tray', y: TOP + 0.06 });
    // "As high as" has no allowance: a placemat 5 mm thick is skipped the same.
    const mat = part({ id: 'mat', category: 'other', shape: 'box', dimMM: [900, 600, 5], pos: [-0.4, TOP, TUCKED_Z] });
    expect(findSupportDetailed([TABLE, mat], c, c.pos[0], c.pos[2], c.dimMM, 0, undefined)).toBeNull();
    expect(findSupportDetailed([TABLE, mat], lamp(-0.4, TUCKED_Z), -0.4, TUCKED_Z, [250, 250, 500], 0, undefined)).toEqual({ id: 'mat', y: TOP + 0.005 });
    // And only a partner the chair is actually UNDER caps anything. Beside the table, on
    // a shoe rack taller than the tabletop, it stands on the rack.
    const rack = part({ id: 'rack', category: 'shelf', shape: 'shoe-rack', dimMM: [800, 300, 900], pos: [1.5, 0, 0] });
    expect(findSupportDetailed([TABLE, rack], c, 1.5, 0, c.dimMM, 0, undefined)).toEqual({ id: 'rack', y: 0.9 });
  });

  it('drag: under two surfaces, the LOWER one is the cap', () => {
    // A chair tucked under a 650 mm desk with its back under the edge of a dining table
    // beside it. The tray on the desk is below the dining table's top and above the
    // desk's, so it is on the desk the chair is under, and it does not hold the chair.
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1200, 600, 650], pos: [0, 0, 0] });
    const dining = { ...TABLE, pos: [0, 0, 0.9] as [number, number, number] };
    const tray = part({ id: 'tray', category: 'other', shape: 'box', dimMM: [600, 400, 60], pos: [0, 0.65, 0.15] });
    const c = chair('c', 0, 0.25);
    expect(share(c, desk)).toBeGreaterThanOrEqual(MIN_SUPPORT_SHARE);
    expect(share(c, dining)).toBeGreaterThan(0);
    expect(share(c, tray)).toBeGreaterThanOrEqual(MIN_SUPPORT_SHARE);
    expect(findSupportDetailed([desk, dining, tray], c, 0, 0.25, c.dimMM, 0, undefined)).toBeNull();
    // The pair: a lamp there stands on the tray.
    expect(findSupportDetailed([desk, dining, tray], lamp(0, 0.25), 0, 0.25, [250, 250, 500], 0, undefined)).toEqual({ id: 'tray', y: 0.71 });
  });

  it('drag: …and a table dropped over a tucked chair does not rest on what is on top of it', () => {
    // Symmetric, like `sharesFloor`: nothing as high as the partner's own top — its
    // BOUNDING top, which for a chair is the backrest, 850 mm up. The app has no seat
    // height, so that is the only height the cap can speak for.
    const c = chair('c', 0, 0);
    const board = part({ id: 'board', category: 'other', shape: 'box', dimMM: [1400, 800, 100], pos: [0, 0.85, 0] });
    expect(findSupportDetailed([c, board], TABLE, 0, 0, TABLE.dimMM, 0, undefined)).toBeNull();
    // A cushion ON the seat is below the cap. What keeps it from holding the table is
    // support share: 450 × 450 under a 1600 × 900 top is 14%. A board that wide on the
    // seat would hold it — the cap does not reach down there.
    const cushion = part({ id: 'cushion', category: 'other', shape: 'box', dimMM: [450, 450, 100], pos: [0, 0.45, 0] });
    expect(share(TABLE, cushion)).toBeLessThan(MIN_SUPPORT_SHARE);
    expect(findSupportDetailed([c, cushion], TABLE, 0, 0, TABLE.dimMM, 0, undefined)).toBeNull();
  });

  it("drag: an L-desk caps a chair only where the desk is, not where its box is", () => {
    // `collidesAt` reads an L-desk's two arms since #190, and the seat rule's "under"
    // is the same question. Read off the box, a chair in the open corner was under the
    // desk: a shoe rack there, taller than the desktop, was capped away and the chair
    // dropped through it to the floor.
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-l', dimMM: [1600, 1400, 750], pos: [0, 0, 0] });
    const rack = part({ id: 'rack', category: 'shelf', shape: 'shoe-rack', dimMM: [700, 300, 900], pos: [-0.35, 0, 0.5] });
    const corner = chair('c', -0.35, 0.5);
    const box = footFromPart(desk.pos, 0, desk.dimMM);
    const arms = footFromPart(desk.pos, 0, desk.dimMM, false, 'desk-l');
    const seat = footFromPart(corner.pos, 0, corner.dimMM);
    expect(footIntersectionArea(seat, box)).toBeGreaterThan(0);
    expect(footIntersectionArea(seat, arms)).toBe(0);
    expect(share(corner, rack)).toBeGreaterThanOrEqual(MIN_SUPPORT_SHARE);
    expect(findSupportDetailed([desk, rack], corner, -0.35, 0.5, corner.dimMM, 0, undefined)).toEqual({ id: 'rack', y: 0.9 });
    // The pair: under an arm, the cap still holds. A tray on the arm does not lift the
    // chair tucked beneath it, and a lamp there stands on the tray.
    const tray = part({ id: 'tray', category: 'other', shape: 'box', dimMM: [600, 500, 60], pos: [-0.4, TOP, -0.2] });
    const under = chair('c', -0.4, -0.2);
    expect(footIntersectionArea(footFromPart(under.pos, 0, under.dimMM), arms)).toBeGreaterThan(0);
    expect(findSupportDetailed([desk, tray], under, -0.4, -0.2, under.dimMM, 0, undefined)).toBeNull();
    expect(findSupportDetailed([desk, tray], lamp(-0.4, -0.2), -0.4, -0.2, [250, 250, 500], 0, undefined)).toEqual({ id: 'tray', y: TOP + 0.06 });
    // Both ways round: the desk dropped over the chair in its corner is not capped by
    // it, so it stands on the board resting on the chair's back; over a chair under an
    // arm, it is.
    const board = part({ id: 'board', category: 'other', shape: 'box', dimMM: [1600, 1400, 20], pos: [0, 0.85, 0] });
    expect(findSupportDetailed([corner, board], desk, 0, 0, desk.dimMM, 0, undefined)).toEqual({ id: 'board', y: 0.87 });
    expect(findSupportDetailed([under, board], desk, 0, 0, desk.dimMM, 0, undefined)).toBeNull();
  });

  it('adding: an ottoman dropped over a table goes on the floor; a lamp goes on the table', () => {
    const room = { width: 6, depth: 4, height: H, footprint: ROOM };
    const o = placeNewPart('ottoman', 'ottoman', [550, 400, 350], room, [TABLE], [0, 0]);
    expect(o.pos[1]).toBe(0);
    expect(o.supportId).toBeNull();
    const l = placeNewPart('lamp', 'lamp-table', [250, 250, 500], room, [TABLE], [0, 0]);
    expect(l.pos[1]).toBeCloseTo(TOP, 9);
    expect(l.supportId).toBe('table');
    // Over a coffee table it does not fit under, it goes on top like the lamp (§ H.6.4).
    const on = placeNewPart('ottoman', 'ottoman', [550, 400, 350], room, [COFFEE], [0, 0]);
    expect(on.pos[1]).toBeCloseTo(0.42, 9);
    expect(on.supportId).toBe('coffee');
  });

  it('settling: an ottoman under a table is not lifted onto it, and a lamp is', () => {
    // `settleHeights` lifts "goes on a table" pieces onto any support over 0.3 m, and
    // an ottoman is one of those — so a detected ottoman under a table was put ON it.
    expect(settleHeights([TABLE, ottoman(0, 0)], H)).toEqual([]);
    expect(settleHeights([TABLE, lamp(0, 0)], H)).toEqual([{ id: 'lamp', y: TOP }]);
    // One it does not fit under is not lifted onto it either. Adding one there puts it
    // on top (the adding test above), because the user put it there; this pass is the
    // scan's, where a seat was read as standing on the floor, and it stood a scanned
    // ottoman on its coffee table where no report saw it. On the floor, Room check
    // names the clash.
    expect(settleHeights([COFFEE, ottoman(0, 0)], H)).toEqual([]);
    expect(analyzeRoom([COFFEE, ottoman(0, 0)], { footprint: ROOM, height: H }).issues.filter((i) => i.rule === 'clash')).toHaveLength(1);
    expect(settleHeights([COFFEE, lamp(0, 0)], H)).toEqual([{ id: 'lamp', y: 0.42 }]);
    // Not lifted is not knocked down: one already on the top stays there, and one
    // hanging above it comes down onto it.
    expect(settleHeights([COFFEE, ottoman(0, 0, 0.42)], H)).toEqual([]);
    expect(settleHeights([COFFEE, ottoman(0, 0, 0.6)], H)).toEqual([{ id: 'ottoman', y: 0.42 }]);
    // "On" is read with the resting tolerance: 20 mm into the top is on it, not under it.
    expect(settleHeights([COFFEE, ottoman(0, 0, 0.4)], H)).toEqual([{ id: 'ottoman', y: 0.42 }]);
    // Not lifted from anywhere below the top, either. A seat left in the air goes to the
    // branch for those, which stood it on whatever was under it — so 60 mm up it went
    // onto the table and 40 mm up it stayed down. A chair too, which is not
    // tabletop-prone and reaches only that branch.
    expect(settleHeights([COFFEE, ottoman(0, 0, 0.06)], H)).toEqual([{ id: 'ottoman', y: 0 }]);
    expect(settleHeights([COFFEE, ottoman(0, 0, 0.2)], H)).toEqual([{ id: 'ottoman', y: 0 }]);
    expect(settleHeights([COFFEE, chair('c', 0, 0, 0.2)], H)).toEqual([{ id: 'c', y: 0 }]);
    // Onto anything: a platform too big to be a table, and a bed. What a scan put on the
    // floor over one of those stays there, and Room check says so.
    const platform = part({ id: 'plat', category: 'other', shape: 'box', dimMM: [3000, 2000, 400], pos: [0, 0, 0] });
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', dimMM: [1600, 2100, 550], pos: [0, 0, 0] });
    expect(roleOf(platform)).toBe('other');
    for (const under of [platform, bed]) {
      expect(findSupportDetailed([under], ottoman(0, 0), 0, 0, ottoman(0, 0).dimMM, 0, undefined)?.id, under.id).toBe(under.id);
      expect(settleHeights([under, ottoman(0, 0)], H), under.id).toEqual([]);
      const clashes = analyzeRoom([under, ottoman(0, 0)], { footprint: ROOM, height: H }).issues.filter((i) => i.rule === 'clash');
      expect(clashes, under.id).toHaveLength(1);
    }
    // A seat, not an ottoman: a row the detector files under `other` with a chair shape
    // is tabletop-prone by its category (`sceneShapeFor` keeps the shape it picked), and
    // is a dining chair by its shape. A coffee table is no partner of a dining chair, so
    // nothing else keeps it off that top.
    const filed = part({ id: 'filed', category: 'other', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0] });
    expect(roleOf(filed)).toBe('dining-chair');
    expect(settleHeights([COFFEE, filed], H)).toEqual([]);
    // A SEAT, not anything that shares floor. A storage box the size of a coffee table
    // reads as one (`roleOf`), and a box on a dining table is still put on it.
    const chest = part({ id: 'chest', category: 'other', shape: 'box', dimMM: [800, 450, 320], pos: [0, 0, 0] });
    expect(roleOf(chest)).toBe('coffee-table');
    expect(settleHeights([TABLE, chest], H)).toEqual([{ id: 'chest', y: TOP }]);
  });

  it('settling: no seat goes up onto a top — not only the ones that tuck under one', () => {
    // The gate asked `isSeatRole`, which names the seats that go UNDER a surface. The
    // others were lifted: a stool, an armchair or a sofa the detector filed as `other`
    // (or a stool as `plant`) is tabletop-prone by that category, and 100 mm off a
    // coffee table's centre each one went up onto it — `[{ y: 0.42 }]`, every one.
    const filed = [
      part({ id: 'stool', category: 'other', shape: 'stool', dimMM: [350, 350, 450], pos: [0.1, 0, 0] }),
      part({ id: 'plant-stool', category: 'plant', shape: 'stool', dimMM: [350, 350, 450], pos: [0.1, 0, 0] }),
      part({ id: 'armchair', category: 'other', shape: 'chair-armchair', dimMM: [700, 700, 900], pos: [0.1, 0, 0] }),
      part({ id: 'sofa', category: 'other', shape: 'sofa', dimMM: [1000, 600, 800], pos: [0.1, 0, 0] }),
    ];
    for (const s of filed) {
      // In the band: tabletop-prone, and the drop question does stand it on the top.
      expect(isTabletopProne(s.category), s.id).toBe(true);
      expect(findSupportDetailed([COFFEE], s, s.pos[0], s.pos[2], s.dimMM, s.rot, s.circle)?.id, s.id).toBe('coffee');
      expect(settleHeights([COFFEE, s], H), s.id).toEqual([]);
    }
    // The pair: a box of the stool's size at the same spot still goes up.
    const box = part({ id: 'box', category: 'other', shape: 'box', dimMM: [350, 350, 450], pos: [0.1, 0, 0] });
    expect(settleHeights([COFFEE, box], H)).toEqual([{ id: 'box', y: 0.42 }]);
  });

  it('settling: a seat on a platform is refused the table beside it, not the platform', () => {
    // Refusing the lift threw the probe's answer away whole, so an ottoman on a 350 mm
    // platform, over a coffee table standing on the same platform, fell THROUGH it to
    // the floor: `[{ id: 'ottoman', y: 0 }]`. It is asked again at its own level.
    const plat = part({ id: 'plat', category: 'other', shape: 'box', dimMM: [3000, 2000, 350], pos: [0, 0, 0] });
    const ct = { ...COFFEE, pos: [0, 0.35, 0] as [number, number, number] };
    const on = ottoman(0.1, 0, 0.35);
    // In the band: the drop question answers the table, 0.42 above the platform.
    expect(findSupportDetailed([plat, ct], on, 0.1, 0, on.dimMM, 0, undefined)?.id).toBe('coffee');
    expect(settleHeights([plat, ct, on], H)).toEqual([]);
    // "At its level" is read with the resting tolerance: 20 mm into the platform is on it.
    expect(settleHeights([plat, ct, ottoman(0.1, 0, 0.33)], H)).toEqual([{ id: 'ottoman', y: 0.35 }]);
    // The pair: a lamp there still goes up onto the table.
    expect(settleHeights([plat, ct, lamp(0.1, 0, 0.35)], H)).toEqual([{ id: 'lamp', y: 0.77 }]);
  });

  it('a seat is what the Library files under Seating, whatever the detector calls it', () => {
    // `isSeating` is a hand-kept role set, so it is held to the catalogue: every Seating
    // item is one, nothing else in the Library is, and a seat's shape stays a seat under
    // any category — a cloud row names its category separately, and `sceneShapeFor`
    // keeps the shape it picked. Every seat that tucks is a seat too.
    for (const item of PART_LIBRARY) {
      expect(isSeating(roleOf(item)), item.label).toBe(item.group === 'Seating');
      if (isSeatRole(roleOf(item))) expect(isSeating(roleOf(item)), item.label).toBe(true);
      if (item.group !== 'Seating') continue;
      for (const category of CATEGORIES) {
        expect(isSeating(roleOf({ ...item, category })), `${item.label} as ${category}`).toBe(true);
      }
    }
  });

  it('settling: a tray on an ottoman stays on it', () => {
    // A 750 × 450 × 60 tray is `other/box` too, and was read as a coffee table — so the
    // ottoman under it was its floor-sharer, not its support, and `settleHeights` put
    // the tray on the floor straight through the ottoman: `[{ id: 'tray', y: 0 }]` on
    // this PR's first commit, `[]` before it and after this one.
    //
    // A LARGE ottoman, which kept a second defect out of this test while it was open:
    // under a 550 × 400 × 420 one the tray covers the whole seat, and `settleHeights`
    // lifted the ottoman onto the tray standing on it — ottoman to 0.48, tray to 0.90 —
    // for every tray role. That one is fixed and held in `tests/layout-settle.test.ts`
    // ("is not held up by what stands on it"); the fixture stays large so this test
    // keeps asking only the role question.
    const tray = part({ id: 'tray', category: 'other', shape: 'box', dimMM: [750, 450, 60], pos: [0, 0.42, 0] });
    const big = part({ id: 'ottoman', category: 'ottoman', shape: 'ottoman', dimMM: [1200, 1000, 420], pos: [0, 0, 0] });
    expect(roleOf(tray)).toBe('other');
    expect(settleHeights([big, tray], H)).toEqual([]);
  });

  it('settling: a chair left standing on its table comes down; a lamp there stays', () => {
    expect(settleHeights([TABLE, chair('c', 0, TUCKED_Z, TOP)], H)).toEqual([{ id: 'c', y: 0 }]);
    expect(settleHeights([TABLE, lamp(0, TUCKED_Z, TOP)], H)).toEqual([]);
  });
});
