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
import { defaultScene, collidesAt, SHAPES, PART_LIBRARY, type ScenePart, type Shape } from '@/lib/scene-spec';
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
    const obstacle = { id: 'obs', name: 'wardrobe', shape: 'wardrobe' as Shape, category: 'storage',
                       dimMM: [2400, 600, 2100] as [number, number, number],
                       pos: [0, 0, 0] as [number, number, number], rot: 0, color: '#b07a52' } as unknown as ScenePart;
    let checked = 0;
    let agreed = 0;
    let collided = 0;
    for (let x = -1.6; x <= 1.6; x += 0.1) {
      for (let z = -1.6; z <= 1.6; z += 0.1) {
        const m = { id: 'mover', name: 'mover', shape: 'box' as Shape, category: 'other',
                    dimMM: [600, 600, 900] as [number, number, number],
                    pos: [x, 0, z] as [number, number, number], rot: 0, color: '#888' } as unknown as ScenePart;
        const mine = pairHits(m, obstacle, 'box');
        checked++;
        if (mine === collidesAt([m, obstacle], 'mover', m.pos, m.rot, m.dimMM)) agreed++;
        if (mine) collided++;
      }
    }
    // All three matter. A run that checked nothing agrees on nothing and would pass a bare
    // equality; a fixture that never collides agrees everywhere for the wrong reason.
    expect(checked, 'positions compared').toBeGreaterThan(500);
    expect(collided, 'the fixture must reach the colliding case').toBeGreaterThan(0);
    expect(agreed, 'box arm disagreed with collidesAt').toBe(checked);
  });

  it('the picking arm IS `hitsAt`, and the paint order IS `planPaintOrder`', () => {
    const parts = defaultScene('rect', ROOM_W, ROOM_D).filter((p) => !isSoftFurnishing(p));
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
    const probe = {
      id: 'ctl', name: 'ctl', shape: 'box' as Shape, category: 'other',
      dimMM: [1200, 400, 600] as [number, number, number],
      pos: [1.5, 0, -0.75] as [number, number, number], rot: Math.PI / 6, color: '#888',
    } as unknown as ScenePart;
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
    const mover = (x: number, z: number) =>
      ({ id: 'mover', name: 'mover', shape: 'box' as Shape, category: 'other',
         dimMM: [600, 600, 900] as [number, number, number],
         pos: [x, 0, z] as [number, number, number], rot: 0, color: '#888' }) as unknown as ScenePart;

    type SweepRow = { shape: Shape; n: number; boxOnly: number; geomOnly: number; both: number };
    const out: SweepRow[] = [];

    for (const shape of SHAPES) {
      const lib = PART_LIBRARY.find((l) => l.shape === shape);
      if (!lib) continue; // recorded below as a row that could not be built, not dropped in silence
      const obstacle = { id: 'obs', name: shape, shape, category: lib.category, dimMM: lib.dimMM,
                         pos: [0, 0, 0] as [number, number, number], rot: 0, color: '#b07a52' } as unknown as ScenePart;
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
      const part = { id: 'o', name: shape, shape, category: lib.category, dimMM: lib.dimMM,
                     pos: [0, 0, 0] as [number, number, number], rot: 0, color: '#b07a52' } as unknown as ScenePart;
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
