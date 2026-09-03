import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeRoom } from '@/lib/clearance';
import { ROOM_SIDE_EPS, ROOM_SIDE_M } from '@/lib/dimension-ranges';
import { footprintBounds, footprintForLayout, offsetWall, type Footprint, type LayoutId } from '@/lib/footprint';
import { NAV_CELL, navigabilityCost, prepare, type LayoutContext, type Placement } from '@/lib/layout-score';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';

import { offeredHeight, offeredSizes } from './helpers/offered-sizes';

// § G.1, part 2 — **nothing in this repo scores a custom footprint**, and this is the
// sweep that does.
//
// Every wall move makes one. `useScene.moveWall` runs `offsetWall` and writes the
// resulting polygon with `layoutId: 'custom'`; both `buildSceneFromRoom` and
// `loadFromRoom` then PREFER that polygon over the preset shape. So the room the seeder
// actually furnishes, for any user who has dragged a wall, is a polygon no fixture in
// this repo had ever built.
//
// **A `(layoutId, width, depth)` sweep cannot see this, and that is asserted below
// rather than argued.** A T and a U have interior edges: moving one changes the polygon
// and leaves the bounding box identical, so the room reads as the same size and is a
// different shape. `tests/starter-navigability.test.ts` sweeps 280 cells of
// `(preset, width, depth)` and every one of them is `footprintForLayout`'s idealised
// shape — it could run for a century without reaching a single room below. **A third of
// the cells here are unreachable that way**, and the U is the extreme: five of its eight
// walls move without changing its size at all.
//
// **What this file measures, in three parts that answer different questions:**
//
// 1. **Reachability of the sweep itself** — which edges leave the bounding box alone,
//    per preset. If that set were empty the whole file would be redundant, so it is a
//    pin and not a print, and `rect` and `open` being empty is the control that proves
//    the property is about interior edges rather than about the sweep.
// 2. **What the seeder does with them** — the raw `navigabilityCost` and `analyzeRoom`'s
//    own verdict, the same pair `starter-navigability` uses and for the same reason:
//    `navigabilityCost` returns 0 both for a room that strands nothing and for a room it
//    declines to judge, so the report's verdict is the control that tells those apart.
// 3. **What a REVISIT hands back.** This is the one that is not about floor area. A wall
//    move writes `room` and the transform overrides and **never a scene snapshot**
//    (`moveWallCarrying` does not call `setParts` — measured 8 of 8 edges in a browser),
//    so the next open re-seeds from `defaultScene` against the NEW polygon and the saved
//    overrides land on whatever comes back, **by id**. Three ways that goes wrong and
//    each is counted separately, because they are different bugs wearing one symptom: an
//    id the re-seed does not produce (the override lands on nothing), an id it produces
//    that the base seed did not (arrives unplaced, wherever the seeder put it), and an id
//    present in both whose SHAPE OR SIZE changed (the override is applied to a different
//    object under the same name). That is a pure question — two `defaultScene` calls —
//    and it needs no browser and no store.
//
// **Who this actually bites.** A user who has only MOVED furniture has transform
// overrides and no scene key, because `RoomSync` writes one from `state.parts` and a
// drag does not touch `parts`. So the arrangement most likely to be destroyed by a wall
// drag plus a revisit belongs to the user who has done the most arranging and the least
// adding.
//
// **Not asserted here, and it is the honest limit:** whether the fix belongs in the
// seeder or in making a wall move write a snapshot. This file measures the gap; the
// snapshot half is a persistence change with its own review. See § G.1.

/** `WALL_STEP` — how far one arrow key moves a wall — parsed from the only file that
 *  defines it.
 *
 *  It lives in `components/studio/PlanView.tsx`, which a node-environment test cannot
 *  import, and the deltas below are multiples of it. Hand-typing `0.05` here would make
 *  this file's whole delta ladder a second source of truth for the app's step, in a repo
 *  whose `offered-sizes` helper exists because exactly that happened to five room sizes.
 *  Throws rather than defaulting: a regex that stops matching must fail loudly, not
 *  quietly sweep a step nobody uses. */
function wallStep(): number {
  const src = readFileSync(join(process.cwd(), 'components/studio/PlanView.tsx'), 'utf8');
  const m = /^const WALL_STEP = ([\d.]+);/m.exec(src);
  if (!m) throw new Error('components/studio/PlanView.tsx: no `const WALL_STEP = …;`');
  const step = Number(m[1]);
  if (!(step > 0)) throw new Error(`components/studio/PlanView.tsx: WALL_STEP parsed as ${m[1]}`);
  return step;
}

const STEP = wallStep();
const HEIGHT = offeredHeight();

/** The nudges to sweep, in arrow presses. One press is what the browser repro used; the
 *  rest are the drags a person makes with a pointer. Both signs, because a wall pushed
 *  out and a wall pulled in are different rooms and `offsetWall`'s sign is the handedness
 *  this repo has already got wrong once — see `wallOutwardNormal` in `CLAUDE.md`. */
const PRESSES = [-20, -10, -5, -2, -1, 1, 2, 5, 10, 20];

type Cell = {
  layout: LayoutId;
  edge: number;
  delta: number;
  width: number;
  depth: number;
  /** True when the bounding box is unchanged — the cells a size sweep cannot reach. */
  invisible: boolean;
  parts: number;
  stranded: number;
  findings: string[];
  /** Ids in the base seed the re-seed does not produce. An override lands on nothing. */
  lost: string[];
  /** Ids the re-seed produces that the base seed did not. No override exists for them. */
  gained: string[];
  /** Ids in both, whose shape or size changed. The override moves a different object. */
  changed: string[];
};

/** Same shape as `starter-navigability`'s `score`, against an arbitrary polygon rather
 *  than a preset's. `movable` all-true matches the seeder's own chooser. */
function strandedIn(poly: Footprint, parts: ScenePart[]): number {
  const at: Placement[] = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
  const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: poly };
  return navigabilityCost(prepare(ctx), at, NAV_CELL);
}

/** What a wall move leaves behind, if the store would accept it. `moveWall` refuses a
 *  polygon whose bounding box leaves `ROOM_SIDE_M`, and refuses ALL of it rather than
 *  clamping, so a rejected nudge is not a room and is not swept. The bounds are read
 *  from `lib/dimension-ranges.ts` — the same two constants the store reads — rather than
 *  typed here, so a widened range widens this sweep instead of silently excluding rooms
 *  the app now accepts. */
function moved(base: Footprint, edge: number, delta: number): Footprint | null {
  const poly = offsetWall(base, edge, delta);
  const b = footprintBounds(poly);
  if (
    b.width < ROOM_SIDE_M.min - ROOM_SIDE_EPS ||
    b.depth < ROOM_SIDE_M.min - ROOM_SIDE_EPS ||
    b.width > ROOM_SIDE_M.max + ROOM_SIDE_EPS ||
    b.depth > ROOM_SIDE_M.max + ROOM_SIDE_EPS
  ) {
    return null;
  }
  return poly;
}

/** What a saved override needs to still be true about a piece for the override to mean
 *  what it meant. Not the id — the id is the KEY the override is filed under — but
 *  everything the position was chosen against. A `bed-1` that is a single bed on the way
 *  back is not the `bed-1` whose place the user picked. */
const identity = (p: ScenePart) => `${p.category}/${p.shape}/${p.dimMM.join('x')}`;

function sweepPreset(layout: LayoutId, w: number, d: number): Cell[] {
  const base = footprintForLayout(layout, w, d);
  const box = footprintBounds(base);
  // The room as the user left it: seeded against the preset polygon, which is what a
  // fresh room out of the picker holds.
  const before = new Map(defaultScene(layout, w, d, { footprint: base, height: HEIGHT }).map((p) => [p.id, p]));

  const out: Cell[] = [];
  for (let edge = 0; edge < base.length; edge++) {
    for (const presses of PRESSES) {
      const delta = presses * STEP;
      const poly = moved(base, edge, delta);
      if (poly === null) continue;
      const b = footprintBounds(poly);
      // `layoutId` is deliberately the preset's, not `'custom'`: `RoomSync` persists
      // width / depth / footprint and NOT `layoutId`, so meta keeps `'t'` while the store
      // says `'custom'` — and `buildSceneFromRoom` reads meta. This is the pairing the
      // app actually re-opens with, and getting it wrong here would sweep a room nobody
      // has, which is the fault § G.1's FIRST sweep was retired for.
      const parts = defaultScene(layout, b.width, b.depth, { footprint: poly, height: HEIGHT });
      const after = new Map(parts.map((p) => [p.id, p]));
      out.push({
        layout,
        edge,
        delta,
        width: b.width,
        depth: b.depth,
        invisible: Math.abs(b.width - box.width) < 1e-9 && Math.abs(b.depth - box.depth) < 1e-9,
        parts: parts.length,
        stranded: strandedIn(poly, parts),
        findings: analyzeRoom(parts, { footprint: poly, height: HEIGHT }).issues.map((i) => i.rule),
        lost: [...before.keys()].filter((id) => !after.has(id)),
        gained: [...after.keys()].filter((id) => !before.has(id)),
        changed: [...after.keys()].filter(
          (id) => before.has(id) && identity(after.get(id)!) !== identity(before.get(id)!),
        ),
      });
    }
  }
  return out;
}

const churned = (c: Cell) => c.lost.length + c.gained.length + c.changed.length;
const raw = (n: number) => (n === 0 ? '.' : n.toFixed(2));

describe('§ G.1 · what the seeder does with a wall-moved footprint', () => {
  const offered = offeredSizes();
  const sweep = new Map<LayoutId, Cell[]>(offered.map((o) => [o.id, sweepPreset(o.id, o.width, o.depth)]));
  const all = [...sweep.values()].flat();
  /** The edges whose movement a `(layoutId, width, depth)` sweep is blind to. */
  const blindEdges = (id: LayoutId) => [...new Set(sweep.get(id)!.filter((c) => c.invisible).map((c) => c.edge))].sort((a, b) => a - b);

  it('prints what a wall move seeds, and what a revisit would hand back', () => {
    console.log(
      `\n§ G.1 · every wall of every offered preset, nudged ${PRESSES.join('/')} arrow presses ` +
        `(WALL_STEP ${STEP} m, ceiling ${HEIGHT} m)\n`,
    );
    console.log('preset  cells  invisible  strands  reports  ids churn   blind edges');
    for (const [id, cells] of sweep) {
      console.log(
        `${id.padEnd(6)}  ${String(cells.length).padStart(5)}  ${String(cells.filter((c) => c.invisible).length).padStart(9)}  ` +
          `${String(cells.filter((c) => c.stranded > 0).length).padStart(7)}  ` +
          `${String(cells.filter((c) => c.findings.length > 0).length).padStart(7)}  ` +
          `${String(cells.filter((c) => churned(c) > 0).length).padStart(9)}   ${JSON.stringify(blindEdges(id))}`,
      );
    }

    // The rows that are the finding: the room's stated size did not change, and the
    // report did. Printed in full rather than counted, because a count cannot show that
    // ONE arrow press reaches them.
    console.log('\nSame size on the way in, a finding on the way out:\n');
    console.log('preset  edge   delta   w x d          parts  stranded   lost  new  changed  report');
    for (const c of all) {
      if (!c.invisible || c.findings.length === 0) continue;
      console.log(
        `${c.layout.padEnd(6)}  ${String(c.edge).padStart(4)}  ${c.delta.toFixed(2).padStart(6)}  ` +
          `${c.width.toFixed(2)} x ${c.depth.toFixed(2)}  ${String(c.parts).padStart(5)}  ${raw(c.stranded).padStart(8)}  ` +
          `${String(c.lost.length).padStart(4)}  ${String(c.gained.length).padStart(3)}  ` +
          `${String(c.changed.length).padStart(7)}  ${c.findings.join(',')}`,
      );
    }

    const worst = [...all].sort((a, b) => b.lost.length - a.lost.length)[0];
    console.log(
      `\nMost furniture a single wall move loses on the way back: ${worst.lost.length} pieces — ` +
        `${worst.layout} edge ${worst.edge} at ${worst.delta.toFixed(2)} m, ${worst.parts} pieces re-seeded.\n`,
    );
    expect(all.length).toBeGreaterThan(0);
  });

  it('sweeps rooms a (layout, width, depth) sweep cannot reach, and says which', () => {
    // The point of the whole file, as a pin. These sets are geometry —
    // `footprintForLayout`'s vertex order — and they are the reason
    // `starter-navigability`'s 280 cells cannot stand in for these 300.
    expect(blindEdges('rect')).toEqual([]);
    expect(blindEdges('open')).toEqual([]);
    expect(blindEdges('l')).toEqual([2, 3]);
    expect(blindEdges('t')).toEqual([2, 3, 5, 6]);
    // Five of the U's eight walls move without changing its size. The notch IS the room.
    expect(blindEdges('u')).toEqual([0, 1, 2, 3, 4]);

    // And the control that makes those sets mean something: a rectangle has no interior
    // edge, so every one of its cells IS reachable by a size sweep. If this ever went
    // non-empty the sweep would be measuring its own arithmetic rather than the shape.
    expect(sweep.get('rect')!.every((c) => !c.invisible)).toBe(true);
    expect(sweep.get('open')!.every((c) => !c.invisible)).toBe(true);
    expect(all.filter((c) => c.invisible)).toHaveLength(100);
  });

  it('strands floor in a room whose stated size never changed', () => {
    const hidden = all.filter((c) => c.invisible && c.findings.length > 0);
    expect(hidden.length).toBeGreaterThanOrEqual(40);

    // ONE arrow press. The T's own offered size, its second wall, 50 mm — the room is
    // 5.50 x 4.70 before and after, and Room check has something to say afterwards.
    // This is the smallest gesture in the app that reaches the gap.
    const onePress = all.find((c) => c.layout === 't' && c.edge === 2 && c.delta === STEP)!;
    expect(onePress.invisible).toBe(true);
    expect(onePress.findings).toContain('reach');
    expect(churned(onePress)).toBeGreaterThan(0);

    // The worst invisible cell, pinned at BOTH ends: a floor on its own would let the
    // number grow without limit and still pass, and a ceiling on its own would let the
    // defect be fixed without anyone noticing this assertion had stopped meaning
    // anything. 4.88 today.
    const worst = [...all].filter((c) => c.invisible).sort((a, b) => b.stranded - a.stranded)[0];
    expect(worst.stranded).toBeGreaterThan(4);
    expect(worst.stranded).toBeLessThan(6);
    expect(`${worst.layout}/${worst.edge}`).toBe('u/2');
  });

  it('does not hand the same room back: the re-seed loses, gains and rewrites pieces', () => {
    // Every override the wall move just wrote is filed by id against the list on the
    // left of these three numbers, and applied to the list on the right.
    expect(all.filter((c) => c.lost.length > 0).length).toBeGreaterThanOrEqual(20);
    expect(all.filter((c) => c.gained.length > 0).length).toBeGreaterThanOrEqual(20);
    // The sharpest of the three: the id survives, so nothing anywhere reports a problem,
    // and the piece under it is a different size.
    expect(all.filter((c) => c.changed.length > 0).length).toBeGreaterThanOrEqual(20);

    const mostLost = Math.max(...all.map((c) => c.lost.length));
    expect(mostLost).toBeGreaterThanOrEqual(9);
    expect(mostLost).toBeLessThanOrEqual(12);
  });

  it('leaves a rectangle WALKABLE, which is what makes the stranding a finding', () => {
    // The negative control, and it earns its place: every assertion above is of the form
    // "some cells do X", which a sweep broken so that EVERY cell does X would satisfy
    // just as well. `rect` and `open` are the two presets with no interior edge, and
    // across all 80 of their cells nothing is stranded and nothing is reported. So the
    // stranding above is a property of the SHAPE and not of this file's arithmetic.
    for (const id of ['rect', 'open'] as const) {
      const cells = sweep.get(id)!;
      expect(cells.length).toBe(PRESSES.length * 4);
      expect(cells.filter((c) => c.stranded > 0)).toHaveLength(0);
      expect(cells.filter((c) => c.findings.length > 0)).toHaveLength(0);
    }
  });

  it('churns the part list on a RECTANGLE too, which says where the fix is', () => {
    // Written as a control and it failed, which is the useful outcome: the assertion was
    // that a preset with no interior edge hands back the room it was given, and `rect`
    // pushed out by 1.00 m drops a piece. So the id churn is NOT a non-rectangular
    // problem and cannot be fixed by teaching the seeder about notches — a re-seed is a
    // fresh arrangement for a room of a new size, which is correct behaviour for a SEED
    // and destructive when it lands on top of a user's saved overrides.
    //
    // That is the argument for the snapshot half of § G.1 rather than the seeder half,
    // and it is measured rather than reasoned: the two shapes that strand nothing and
    // report nothing still lose furniture.
    const churn = (id: LayoutId) => sweep.get(id)!.filter((c) => churned(c) > 0).length;
    expect(churn('rect')).toBe(2);
    expect(churn('open')).toBe(2);
    // …and the interior-edge shapes churn an order of magnitude more often, so the two
    // effects are separable and both are real. Pinned at both ends: a floor alone would
    // survive the churn growing without limit, a ceiling alone would survive it being
    // fixed to nothing.
    for (const id of ['l', 't', 'u'] as const) {
      expect(churn(id)).toBeGreaterThan(25);
      expect(churn(id)).toBeLessThanOrEqual(sweep.get(id)!.length);
    }
  });
});
