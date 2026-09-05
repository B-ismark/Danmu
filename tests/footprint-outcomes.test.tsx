// Row 12 / 4a, second half — does the one-box footprint change a REPORTED OUTCOME?
//
// `tests/footprint-fidelity.test.tsx` establishes what each shape actually occupies.
// This file asks the question the research document's build scope actually gates 4a on:
// in the rooms this app ships, does swapping the box for the drawn geometry change an
// answer a user sees?
//
// Two consumers are measured here, and the third is named rather than implied:
//   · COLLISION — `collidesAt` (lib/scene-spec.ts:3161) refusing a drag.
//   · PICKING   — `hitsAt` (lib/plan-hit.ts:62) deciding what a click selects.
//   · `analyzeRoom`'s clearance findings are NOT measured. Its zones come from
//     `lib/layout-rules.ts` keyed on `dimMM`, so a compound footprint does not
//     substitute into them one-for-one; measuring it means designing the zone
//     semantics first, which is the XL this row is trying to decide about.
//
// ONE thing changes between the two arms: the XZ footprint. The vertical test is
// `verticalExtent` on both sides, the pad is `collidesAt`'s own -0.01 on both sides,
// and the paint order is `planPaintOrder`'s on both sides. Using the walk's per-primitive
// heights as well would be a better model of reality and a worse experiment — it would
// move two things, and it can only ever REDUCE the compound arm's hits.
//
// The denominator is every pair and every sampled point, fixed. A pair that nothing
// reports is an outcome.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({
  useStudio: (sel: (s: unknown) => unknown) => sel({ dims: {}, openState: {}, hidden: {}, quality: 'high' }),
}));
vi.mock('@/components/three/materials', () => ({
  SURFACE: new Proxy({}, { get: () => ({}) }),
  PHYSICAL_SURFACES: ['fabric'],
}));

import { PartGeometry } from '@/components/three/DynamicPart';
import { defaultScene, collidesAt, isRoundPart, isWallMountedPart, normalizeStoredParts, SHAPES, PART_LIBRARY, type Category, type ScenePart, type Shape } from '@/lib/scene-spec';
import { footFromPart, footOverlap, pointInFoot } from '@/lib/geometry';
import { verticalExtent } from '@/lib/physics';
import { isSoftFurnishing } from '@/lib/layout-rules';
import { footprintForLayout } from '@/lib/footprint';
import { hitsAt, planPaintOrder } from '@/lib/plan-hit';
import { pointInPoly } from '@/lib/geometry';
import { walk, worldHulls, hullsOverlap, pointInHull, convexHull } from './helpers/geometry-walk';

/** `collidesAt`'s own pad, quoted rather than re-chosen: "the tiny negative pad lets
 *  flush side-by-side placement read as touching, not colliding." */
const PAD = -0.01;

/** Picking raster, metres. Quoted with every rate this file prints. */
const PICK_STEP = 0.025;

const LAYOUTS = ['rect', 'l', 't', 'u', 'open'] as const;
const ROOM_W = 6;
const ROOM_D = 4;

const hullCache = new Map<string, ReturnType<typeof worldHulls>>();
/** Primitives with no floor area, per shape, and the shapes that are NOTHING BUT those.
 *  A shape in `allDegenerate` cannot collide in the geometry arm at all, so every one of
 *  its box-only rows is the instrument speaking, not the app. Counted rather than left to
 *  read as a finding. */
const degenerate = new Map<string, number>();
const allDegenerate = new Set<string>();
function hullsOf(p: ScenePart) {
  const key = `${p.shape}|${p.dimMM.join(',')}|${p.pos.join(',')}|${p.rot}`;
  const got = hullCache.get(key);
  if (got) return got;
  const rep = walk(PartGeometry({ part: p, locked: false }));
  if (Object.keys(rep.unhandled).length || Object.keys(rep.threw).length) {
    throw new Error(`${p.shape}: walk incomplete ${JSON.stringify({ ...rep.unhandled, ...rep.threw })}`);
  }
  degenerate.set(p.shape, rep.degenerate);
  const out = worldHulls(rep.prims, p.pos as [number, number, number], p.rot);
  if (out.length === 0) allDegenerate.add(p.shape);
  hullCache.set(key, out);
  return out;
}

/** The id a plain click gets under the BOX footprints — `hitsAt`'s answer in the form the
 *  sweep needs. Pinned to `hitsAt` by a control below rather than trusted. */
function frontIdByBox(x: number, z: number, order: readonly ScenePart[]): string | null {
  let id: string | null = null;
  for (const part of order) {
    if (pointInFoot(x, z, footFromPart(part.pos, part.rot, part.dimMM, part.circle))) id = part.id;
  }
  return id;
}

/** Every part this file mints, minted the way production mints one.
 *
 *  `collidesAt` reads the PERSISTED `o.circle` rather than deriving roundness from the
 *  shape (`lib/scene-spec.ts:3183`). So a fixture that builds its own object is not a
 *  second reader of that rule — it is a DIFFERENT rule that happens to agree on the 34
 *  of 42 shapes which are not round, which is exactly why it read as correct.
 *
 *  The sweep below minted its obstacle without the flag and swept all eight round shapes
 *  as rectangles. `fan` reported 56 box-only positions and 0 geometry-only; with the flag
 *  it is 0 and 12 — the direction reverses — and the flagless number had already been
 *  published as the leading "the box is too generous" case.
 *
 *  `isRoundPart(shape) || undefined` is `normalizeStoredParts`' own spelling, character
 *  for character, so this is the production derivation rather than a copy of it. The
 *  `|| undefined` half is load-bearing: absent and `false` must be one answer, because
 *  every reader tests the flag for truthiness.
 *
 *  ONE mint site, for the reason `scene-store.ts`'s `addPart` gives for owning it in
 *  production: three callers each copying the rule is how the ceiling fan came to be
 *  square-footed when added from the Library and round when found in a photograph. */
function mint(
  shape: Shape,
  category: Category,
  dimMM: [number, number, number],
  pos: [number, number, number],
  id: string,
  rot = 0,
): ScenePart {
  return {
    id, name: shape, shape, category, dimMM, pos, rot, color: '#b07a52',
    circle: isRoundPart(shape) || undefined,
    wallMounted: isWallMountedPart(category, shape) || undefined,
  } as unknown as ScenePart;
}

/** The pair test `collidesAt` runs, with its footprint arm swapped out. */
function pairHits(a: ScenePart, b: ScenePart, mode: 'box' | 'geometry'): boolean {
  const [aB, aT] = verticalExtent(a.category, a.shape, a.dimMM, a.pos[1]);
  const [bB, bT] = verticalExtent(b.category, b.shape, b.dimMM, b.pos[1]);
  if (aT <= bB + 0.005 || aB >= bT - 0.005) return false;
  if (mode === 'box') {
    return footOverlap(
      footFromPart(a.pos, a.rot, a.dimMM, a.circle),
      footFromPart(b.pos, b.rot, b.dimMM, b.circle),
      PAD,
    );
  }
  const ha = hullsOf(a);
  const hb = hullsOf(b);
  return ha.some((x) => hb.some((y) => hullsOverlap(x.hull, y.hull, PAD)));
}

describe('one box per piece, against the geometry the app draws', () => {
  it('the box arm IS the production predicate, not a faithful copy of it', () => {
    // Both arms of every rate below are written out here rather than called out of `lib/`,
    // because the geometry arm has to differ in exactly ONE place and the two must
    // otherwise be the same function. A copy that is faithful today is still a copy, and
    // the failure it invites is silent in the worst way: change `collidesAt`'s 0.005
    // vertical epsilon, its -0.01 pad or its soft-furnishing filter and BOTH arms here
    // still agree with each other, all six tests stay green, and every number this file
    // publishes becomes a measurement of a predicate the app no longer runs.
    //
    // TWO obstacles, and the round one is not decoration. With a wardrobe alone this
    // control never reached `footFromPart`'s circle branch on either side, so the whole
    // round-footprint half of the predicate it claims to pin was unexercised — and the
    // `plant` here is a shape the sweep below reports on.
    const obstacles = [
      mint('wardrobe', 'wardrobe', [2400, 600, 2100], [0, 0, 0], 'obs'),
      mint('plant', 'plant', [400, 400, 1600], [0, 0, 0], 'obs'),
    ];
    // `'storage'` stood where `'wardrobe'` does now. It is not a member of `Category` at
    // all, and `as unknown as ScenePart` — which every fixture in this file used to carry
    // — suppressed the error for as long as the object was built inline. `anchorFor`
    // answers `'floor'` for both, so no number moves; the point is that a cast wide
    // enough to build a fixture is wide enough to build an impossible one, and one mint
    // site with a real `Category` parameter is what makes tsc the thing that says so.
    let checked = 0;
    let agreed = 0;
    let collided = 0;
    let straddled = 0;
    let round = 0;
    for (const obstacle of obstacles) {
      // The mover is lifted through a range of heights as well as swept across the floor.
      // Sweeping at y = 0 only, this control could not see `collidesAt`'s VERTICAL gate at
      // all: widening its 0.005 epsilon to 0.5 changed nothing and the mutation survived,
      // because nothing in the fixture ever sat near the boundary. The wardrobe is 2100 mm
      // tall, so a 900 mm mover at y = 2.09 overlaps it by 10 mm and at y = 2.11 clears it
      // by 10 mm — either side of the epsilon, which is what makes the gate observable.
      const [, obsTop] = verticalExtent(obstacle.category, obstacle.shape, obstacle.dimMM, obstacle.pos[1]);
      for (let x = -1.6; x <= 1.6; x += 0.2) {
        for (let z = -1.6; z <= 1.6; z += 0.2) {
          for (const y of [0, obsTop - 0.01, obsTop - 0.004, obsTop + 0.004, obsTop + 0.01]) {
            const m = mint('box', 'other', [600, 600, 900], [x, y, z], 'mover');
            const mine = pairHits(m, obstacle, 'box');
            checked++;
            if (mine === collidesAt([m, obstacle], 'mover', m.pos, m.rot, m.dimMM)) agreed++;
            if (mine) collided++;
            if (Math.abs(y - obsTop) <= 0.01) straddled++;
            if (obstacle.circle && mine) round++;
          }
        }
      }
    }
    // All four matter. A run that checked nothing agrees on nothing and would pass a bare
    // equality; a fixture that never collides agrees everywhere for the wrong reason; and
    // a fixture that never collides with the ROUND obstacle leaves the circle branch of
    // both `footFromPart` calls untaken while reporting full agreement.
    expect(checked, 'positions compared').toBeGreaterThan(500);
    expect(collided, 'the fixture must reach the colliding case').toBeGreaterThan(0);
    expect(straddled, 'the fixture must reach the vertical gate').toBeGreaterThan(0);
    expect(round, 'the fixture must reach the ROUND footprint branch').toBeGreaterThan(0);
    expect(agreed, 'box arm disagreed with collidesAt').toBe(checked);
  });

  it('every part this file mints carries the flags production would give it', () => {
    // The control the one above STRUCTURALLY cannot be. It hands `collidesAt` and
    // `pairHits` the same object, so an object minted with the wrong flag is wrong on
    // both sides and they agree perfectly — which is what happened: the sweep swept
    // eight round shapes as rectangles and this file reported full agreement throughout.
    // A control that restates its subject cannot see its subject's inputs.
    //
    // `normalizeStoredParts` returns the SAME OBJECT when it has nothing to correct, so
    // identity is the assertion and there is no field list here to drift. That is not a
    // convenience: on its first run this caught a SECOND missing flag nobody was looking
    // for — `wallMounted`, absent from every part this file mints. It moves no number
    // here (`DynamicPart` never reads it, and `verticalExtent` derives the anchor from
    // category and shape rather than from the flag), and it is fixed anyway, because the
    // whole point of one mint site is that it does not get to be selectively faithful.
    const minted = SHAPES.flatMap((shape) => {
      const lib = PART_LIBRARY.find((l) => l.shape === shape);
      return lib ? [mint(shape, lib.category, lib.dimMM, [0, 0, 0], 'probe')] : [];
    });
    expect(minted.length, 'the sweep must have shapes to mint').toBeGreaterThan(40);
    expect(minted.filter((p) => p.circle).length, 'and round ones among them').toBeGreaterThan(0);
    for (const p of minted) {
      expect(normalizeStoredParts([p])[0], `${p.shape} is not minted as production mints it`).toBe(p);
    }
  });

  it('the picking arm IS `hitsAt`, and the paint order IS `planPaintOrder`', () => {
    // Two deliberately OVERLAPPING pieces on top of the preset. Over `defaultScene`
    // alone no two boxes share a sampled point, so "first wins" and "last wins" give
    // the same answer everywhere and reversing the paint order survived as a mutation —
    // a control that cannot observe the thing it is pinning. A small piece sitting
    // inside a large one is exactly the case `planPaintOrder` exists to decide.
    const mk = (id: string, dim: [number, number, number], pos: [number, number, number]) =>
      mint('box', 'other', dim, pos, id);
    const parts = [
      ...defaultScene('rect', ROOM_W, ROOM_D).filter((p) => !isSoftFurnishing(p)),
      mk('big', [1600, 1200, 400], [-1.2, 0, 0.8]),
      mk('small', [400, 300, 500], [-1.2, 0, 0.8]),
    ];
    const order = planPaintOrder(parts);
    let checked = 0;
    let hits = 0;
    for (let x = -3; x <= 3; x += 0.1) {
      for (let z = -2; z <= 2; z += 0.1) {
        checked++;
        const theirs = hitsAt(x, z, parts)[0] ?? null;
        expect(frontIdByBox(x, z, order), `box pick disagreed with hitsAt at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(theirs);
        if (theirs) hits++;
      }
    }
    expect(checked, 'points compared').toBeGreaterThan(1000);
    expect(hits, 'the raster must actually land on furniture').toBeGreaterThan(0);
    // The overlap must actually be sampled, or the order is still unobservable.
    expect(hitsAt(-1.2, 0.8, parts).length, 'the raster must reach a point two pieces share').toBeGreaterThan(1);
  });

  const rooms = LAYOUTS.map((layout) => ({
    layout,
    poly: footprintForLayout(layout, ROOM_W, ROOM_D),
    parts: defaultScene(layout, ROOM_W, ROOM_D).filter((p) => !isSoftFurnishing(p)),
  }));

  it('the world placement agrees with the production footprint on a plain box', () => {
    // Control for the rotation convention, which is the one place this file could be
    // silently wrong in a way every later number would inherit. A `box` is its own
    // footprint, so its rotated hull bounds must equal `footFromPart`'s corners — and
    // the fixture is deliberately NON-SQUARE and rotated off an axis, because at 0°,
    // 180° or on a square a sign error in the rotation is invisible.
    const probe = mint('box', 'other', [1200, 400, 600], [1.5, 0, -0.75], 'ctl', Math.PI / 6);
    const mine = convexHull(hullsOf(probe).flatMap((h) => h.hull));
    const f = footFromPart(probe.pos, probe.rot, probe.dimMM, false);
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const theirs: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(
      ([sx, sz]) => [f.cx + sx * f.hw * c + sz * f.hd * s, f.cz - sx * f.hw * s + sz * f.hd * c],
    );
    for (const [x, z] of theirs) {
      expect(pointInHull(x, z, mine.map(([a, b]) => [a, b] as [number, number])), `corner ${x.toFixed(3)},${z.toFixed(3)}`).toBe(true);
    }
    const bx = Math.max(...mine.map((p) => p[0])) - Math.min(...mine.map((p) => p[0]));
    const tx = Math.max(...theirs.map((p) => p[0])) - Math.min(...theirs.map((p) => p[0]));
    expect(bx, 'rotated width').toBeCloseTo(tx, 3);
  });

  it('counts the collision outcomes that differ', () => {
    let pairs = 0;
    let boxOnly = 0;
    let geomOnly = 0;
    let both = 0;
    const byShape = new Map<string, { boxOnly: number; geomOnly: number }>();

    for (const room of rooms) {
      for (let i = 0; i < room.parts.length; i++) {
        for (let j = i + 1; j < room.parts.length; j++) {
          const a = room.parts[i];
          const b = room.parts[j];
          pairs++;
          const box = pairHits(a, b, 'box');
          const geo = pairHits(a, b, 'geometry');
          if (box && geo) both++;
          else if (box && !geo) boxOnly++;
          else if (!box && geo) geomOnly++;
          if (box !== geo) {
            const key = [a.shape, b.shape].sort().join(' / ');
            const e = byShape.get(key) ?? { boxOnly: 0, geomOnly: 0 };
            if (box) e.boxOnly++; else e.geomOnly++;
            byShape.set(key, e);
          }
        }
      }
    }

    console.log(
      `\nCOLLISION — ${LAYOUTS.length} shipped layouts at ${ROOM_W} x ${ROOM_D} m, pad ${PAD}` +
        `\n  pairs                          ${pairs}` +
        `\n  agree, both collide            ${both}` +
        `\n  agree, neither collides        ${pairs - both - boxOnly - geomOnly}` +
        `\n  box collides, geometry does NOT ${boxOnly}   (box too generous — a refusal nobody can see)` +
        `\n  geometry collides, box does NOT ${geomOnly}   (box too small — a drag allowed THROUGH a piece)`,
    );
    for (const [k, v] of [...byShape].sort((a, b) => b[1].boxOnly + b[1].geomOnly - a[1].boxOnly - a[1].geomOnly)) {
      console.log(`    ${k.padEnd(34)} box-only ${v.boxOnly}  geometry-only ${v.geomOnly}`);
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it('counts the picking outcomes that differ', () => {
    let sampled = 0;
    let differ = 0;
    let boxOnlyPick = 0;
    let geomOnlyPick = 0;
    let otherPiece = 0;
    const blame = new Map<string, number>();

    for (const room of rooms) {
      // `planPaintOrder`'s order, computed ONCE off the box areas, and used by both
      // arms. Re-deriving it from hull areas would move a second thing.
      const order = planPaintOrder(room.parts);

      const xs = room.poly.map((p) => p[0]);
      const zs = room.poly.map((p) => p[1]);
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += PICK_STEP) {
        for (let z = Math.min(...zs); z <= Math.max(...zs); z += PICK_STEP) {
          if (!pointInPoly(x, z, room.poly)) continue;
          sampled++;
          const boxId = frontIdByBox(x, z, order);
          let geoId: string | null = null;
          for (const part of order) {
            if (hullsOf(part).some((h) => pointInHull(x, z, h.hull))) geoId = part.id;
          }
          if (boxId === geoId) continue;
          differ++;
          if (boxId && !geoId) { boxOnlyPick++; blame.set(boxId.replace(/-\d+$/, ''), (blame.get(boxId.replace(/-\d+$/, '')) ?? 0) + 1); }
          else if (!boxId && geoId) { geomOnlyPick++; blame.set(geoId.replace(/-\d+$/, ''), (blame.get(geoId.replace(/-\d+$/, '')) ?? 0) + 1); }
          else otherPiece++;
        }
      }
    }

    console.log(
      `\nPICKING — same ${LAYOUTS.length} layouts, ${PICK_STEP * 1000} mm raster over the room polygon` +
        `\n  points inside the room          ${sampled}` +
        `\n  same answer                     ${sampled - differ}` +
        `\n  DIFFERENT answer                ${differ}  (${((differ / sampled) * 100).toFixed(1)}%)` +
        `\n    click selects a piece, nothing is drawn there   ${boxOnlyPick}` +
        `\n    something is drawn there, click selects nothing  ${geomOnlyPick}` +
        `\n    selects a DIFFERENT piece than the one drawn     ${otherPiece}`,
    );
    for (const [k, v] of [...blame].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`    ${k.padEnd(28)} ${v}`);
    }
    expect(sampled).toBeGreaterThan(0);
    // 166,664 points x every part's hulls, ~3.8 s idle here. vitest.config.ts's own
    // measured table puts an 18-way oversubscribed runner at ~9.6x, which lands this on
    // top of the 30 s default — and being killed there surfaces as a hang, not a slow
    // test. Stated beside the body, which is this repo's convention.
  }, 120_000);

  it('sweeps one mover past every shape and counts the refusals that differ', () => {
    // The population the resting-pair count above cannot express. `collidesAt` is asked
    // its question thousands of times DURING a drag, so the informative denominator is
    // positions, not pieces at rest — 302 resting pairs in five preset rooms is a
    // population where almost nothing touches anything, and a rate over it is a rate
    // about the presets rather than about the footprint.
    //
    // The mover is a plain `box`, whose footprint IS its geometry, so every difference
    // is attributable to the OBSTACLE. One obstacle at a time, at its library size, and
    // every shape gets a row whether or not anything differs.
    const STEP = 0.05;
    const REACH = 1.6;
    const mover = (x: number, z: number) => mint('box', 'other', [600, 600, 900], [x, 0, z], 'mover');

    type SweepRow = { shape: Shape; n: number; boxOnly: number; geomOnly: number; both: number };
    const out: SweepRow[] = [];

    for (const shape of SHAPES) {
      const lib = PART_LIBRARY.find((l) => l.shape === shape);
      if (!lib) continue; // recorded below as a row that could not be built, not dropped in silence
      const obstacle = mint(shape, lib.category, lib.dimMM, [0, 0, 0], 'obs');
      const row: SweepRow = { shape, n: 0, boxOnly: 0, geomOnly: 0, both: 0 };
      for (let x = -REACH; x <= REACH; x += STEP) {
        for (let z = -REACH; z <= REACH; z += STEP) {
          const m = mover(x, z);
          row.n++;
          const box = pairHits(m, obstacle, 'box');
          const geo = pairHits(m, obstacle, 'geometry');
          if (box && geo) row.both++;
          else if (box) row.boxOnly++;
          else if (geo) row.geomOnly++;
        }
      }
      out.push(row);
    }

    const built = out.length;
    const missing = SHAPES.filter((s) => !PART_LIBRARY.some((l) => l.shape === s));
    const totalN = out.reduce((a, r) => a + r.n, 0);
    const totalBox = out.reduce((a, r) => a + r.boxOnly, 0);
    const totalGeo = out.reduce((a, r) => a + r.geomOnly, 0);

    console.log(
      `
DRAG SWEEP — a 600 x 600 x 900 box moved past one obstacle, ${STEP * 1000} mm grid, +/-${REACH} m` +
        `
  shapes swept                  ${built} of ${SHAPES.length}` +
        `
  not in PART_LIBRARY, no row   ${missing.length}  [${missing.join(', ')}]` +
        `
  positions                     ${totalN}` +
        `
  box refuses, geometry does not ${totalBox}  (${((totalBox / totalN) * 100).toFixed(2)}%)` +
        `
  geometry refuses, box does not ${totalGeo}  (${((totalGeo / totalN) * 100).toFixed(2)}%)
`,
    );
    console.log('shape                    n   both  box-only  geom-only   box-only%  geom-only%');
    for (const r of [...out].sort((a, b) => b.boxOnly + b.geomOnly - a.boxOnly - a.geomOnly)) {
      if (r.boxOnly === 0 && r.geomOnly === 0) continue;
      console.log(
        `${r.shape.padEnd(18)} ${String(r.n).padStart(5)} ${String(r.both).padStart(6)} ` +
          `${String(r.boxOnly).padStart(9)} ${String(r.geomOnly).padStart(10)}   ` +
          `${((r.boxOnly / r.n) * 100).toFixed(2).padStart(8)}  ${((r.geomOnly / r.n) * 100).toFixed(2).padStart(9)}`,
      );
    }
    // ── The finding, as an assertion rather than a paragraph ──────────────────
    // Every position where the GEOMETRY refuses and the box does not is a position
    // where the piece draws itself outside its own `dimMM`. That is CLAUDE.md rule 2's
    // corollary — "a shape's geometry must be authored at `part.dimMM`" — and it is a
    // defect in one renderer, repaired by moving a literal. It is NOT an argument for
    // compound footprints, which is what row 4a would build.
    //
    // The converse direction, box-refuses-and-geometry-does-not, IS 4a's case: the box
    // is a true outer bound and simply too generous for a round or a leggy piece.
    // Splitting them is the whole result, so it is pinned here.
    const overOf = (shape: Shape) => {
      const lib = PART_LIBRARY.find((l) => l.shape === shape)!;
      const part = mint(shape, lib.category, lib.dimMM, [0, 0, 0], 'o');
      const hs = hullsOf(part);
      const hw = lib.dimMM[0] / 2000, hd = lib.dimMM[1] / 2000;
      let over = 0;
      for (const h of hs) for (const [x, z] of h.hull) {
        over = Math.max(over, Math.abs(x) - hw, Math.abs(z) - hd);
      }
      return over * 1000;
    };
    for (const r of out) {
      if (r.geomOnly > 0) {
        expect(overOf(r.shape), `${r.shape} refuses ${r.geomOnly} positions the box allows, so it must draw outside dimMM`).toBeGreaterThan(1);
      }
    }

    const bad = out.filter((r) => allDegenerate.has(r.shape));
    if (bad.length) {
      console.log(
        `
  NOT A FINDING — ${bad.length} shape(s) draw nothing with floor area, so the geometry arm` +
          `
  cannot report a hit for them at any position. Their box-only counts are the instrument:` +
          `
  [${bad.map((r) => `${r.shape} ${r.boxOnly}`).join(', ')}]`,
      );
    }
    const quiet = out.filter((r) => r.boxOnly === 0 && r.geomOnly === 0);
    console.log(`
  shapes where NO position differs: ${quiet.length} of ${built}  [${quiet.map((r) => r.shape).join(', ')}]`);
    expect(built + missing.length).toBe(SHAPES.length);
    // ~1.9 s idle; same argument as the picking body above.
  }, 120_000);
});
