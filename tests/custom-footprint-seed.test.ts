import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeRoom } from '@/lib/clearance';
import { ROOM_SIDE_EPS, ROOM_SIDE_M } from '@/lib/dimension-ranges';
import { footprintBounds, footprintForLayout, offsetWall, type Footprint, type LayoutId } from '@/lib/footprint';
import {
  NAV_CELL,
  STRANDED_PIECE,
  navigabilityCost,
  prepare,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { anchorFor } from '@/lib/physics';
import { furnitureFloor, roomFloor } from '@/lib/room-floor';
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
// **Two limits on that headline, both measured rather than guessed.** It is a property
// of ONE wall move: compose four and the invisible share collapses (t 53% -> 3%, u 50%
// -> 2%), because successive nudges eventually move an outer wall too. And the blind
// EDGE SETS are the robust part — a review held them across 47 room sizes and every one
// agreed — while the invisible CELL COUNT is not: below about 4.5 m an interior edge
// nudged a metre punches through the outer wall and the box changes after all. So the
// sets are pinned and the count is pinned at the sizes the picker offers, which is the
// population this file is about and the reason it reads `tests/helpers/offered-sizes.ts`
// rather than naming rooms of its own.
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
// 3. **What a RE-SEED would hand back**, which is the one that is not about floor area.
//    A wall move writes `room` and the transform overrides; it wrote no scene snapshot,
//    so the next open re-seeded from `defaultScene` against the NEW polygon and the
//    saved overrides landed on whatever came back, **by id**. Five ways that goes wrong,
//    counted separately because they are different bugs wearing one symptom: an id the
//    re-seed does not produce (the override lands on nothing), an id it produces that
//    the base seed did not (arrives unplaced), an id in both whose SHAPE OR SIZE changed
//    (the override moves a different object under the same name), and — the two the
//    first version of this file could not see — an id that survives byte-identical and is
//    nonetheless TURNED or RELOCATED, because `identity` is everything about a piece in
//    its own frame and nothing about where the seeder put it. All of it is a pure
//    question, two `defaultScene` calls, needing no browser and no store.
//
// **Read part 3 as a counterfactual for a SEEDED room, because `RoomSync` now pins the
// snapshot on a footprint change.** That fix is the commit after this file and it is
// what the numbers argued for; they are kept, and kept measured, because they are the
// evidence for it and because the pin is gated — a room with photographs or detections
// is deliberately left unpinned, and for those the re-seed below is still what happens.
//
// **Who it bit.** A user who has only MOVED furniture has transform overrides and no
// scene key, because `RoomSync` writes one from `state.parts` and a drag does not touch
// `parts`. So the arrangement most at risk belonged to whoever had done the most
// arranging and the least adding.

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
  /** **Not an area, despite the name and the column beside it.** `navigabilityCost`
   *  returns the square metres of floor no door can reach PLUS `STRANDED_PIECE` for
   *  every piece whose access zones are all unreachable, so 4.88 may be 4.88 m² or
   *  2.88 m² and one wardrobe nobody can open — it is the latter, decomposed below.
   *  `tests/starter-navigability.test.ts` carries the same warning on the same
   *  quantity; this file dropped it and then pinned a number inside a window exactly
   *  one `STRANDED_PIECE` wide, which a review had to point out. */
  stranded: number;
  findings: string[];
  /** Ids in the base seed the re-seed does not produce. An override lands on nothing. */
  lost: string[];
  /** Ids the re-seed produces that the base seed did not. No override exists for them. */
  gained: string[];
  /** Ids in both, whose shape or size changed. The override moves a different object. */
  changed: string[];
  /** Ids in both with a byte-identical `identity` that the re-seed nonetheless TURNED.
   *  `identity` is everything about a piece in its own frame; where the seeder puts it
   *  is not in it, so without these two columns the churn reads an order of magnitude
   *  smaller than it is. */
  turned: string[];
  /** …and the ones it moved more than 50 mm. */
  relocated: string[];
  /** The worst of the `changed` set, separated out because the metric cannot rank its
   *  own contents: ids whose ANCHOR CLASS flipped — a floor-standing piece coming back
   *  as a ceiling-hung one under the same name, or the reverse. `identity` scores that
   *  identically to a TV moving one size rung, and the consequence is not comparable:
   *  a saved position for a floor lamp gets applied to a pendant 2.58 m up. */
  reanchored: string[];
};

/** Far enough that nobody would call it the same spot. Not a tolerance — the two seeds
 *  are separate deterministic runs, so a piece the seeder did not decide to move comes
 *  back at exactly the same coordinates. */
const MOVED_MM = 0.05;

/** Same shape as `starter-navigability`'s `score`, against an arbitrary polygon rather
 *  than a preset's. `movable` all-true matches the seeder's own chooser. */
function strandedIn(poly: Footprint, parts: ScenePart[]): number {
  const at: Placement[] = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
  const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: poly };
  return navigabilityCost(prepare(ctx), at, NAV_CELL);
}

/** What a wall move leaves behind, if the store would accept it.
 *
 *  **This mirrors `useScene.moveWall`, which is NOT the gate a user's wall move passes
 *  through**, and the difference is worth stating rather than glossing. Every surface
 *  goes through `moveWallCarrying` (`lib/wall-actions.ts`), which also tests the
 *  prospective box against the room's furniture floor and, on refusal, applies
 *  `permittedDelta` — it CLAMPS to the bound rather than refusing outright, so the app
 *  reaches rooms this function returns `null` for.
 *
 *  Why the mirror rather than the real thing: `wall-actions.ts` imports both stores, and
 *  the store imports `zustand/persist`, which wants a DOM. The bounds are at least read
 *  from `lib/dimension-ranges.ts` — the same two constants `moveWall` reads — so a
 *  widened range widens this sweep too. The PREDICATE is where refusals get added, and a
 *  review proved that half is unbounded: it planted a new refusal reason in `moveWall`
 *  and every test here stayed green.
 *
 *  What makes that latent rather than live is measured and pinned in
 *  `agrees with the gate a real wall move passes` below: at these deltas the two answer
 *  identically on all 300 cells, because the seeded presets' furniture floors are metres
 *  further out than a twenty-press ladder reaches. Widen `PRESSES` and that stops being
 *  true — which is what the pin is for. */
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
      // `layoutId` is the preset's, not `'custom'`, matching what the app re-opens with:
      // `RoomSync` persists width / depth / footprint and NOT `layoutId`, so meta keeps
      // `'t'` while the store says `'custom'`, and `buildSceneFromRoom` reads meta. Worth
      // knowing and not worth defending at length, because `defaultScene` reads `layout`,
      // `w` and `d` ONLY to synthesise a footprint when none is given — with one supplied
      // here, all three are inert. The pairing matters the day that stops being true.
      const parts = defaultScene(layout, b.width, b.depth, { footprint: poly, height: HEIGHT });
      const after = new Map(parts.map((p) => [p.id, p]));
      const survivors = [...after.keys()].filter((id) => before.has(id));
      const same = survivors.filter((id) => identity(after.get(id)!) === identity(before.get(id)!));
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
        changed: survivors.filter((id) => identity(after.get(id)!) !== identity(before.get(id)!)),
        turned: same.filter((id) => after.get(id)!.rot !== before.get(id)!.rot),
        relocated: same.filter((id) => {
          const a = after.get(id)!.pos;
          const c = before.get(id)!.pos;
          return Math.hypot(a[0] - c[0], a[2] - c[2]) > MOVED_MM;
        }),
        reanchored: survivors.filter(
          (id) =>
            anchorFor(after.get(id)!.category, after.get(id)!.shape) !==
            anchorFor(before.get(id)!.category, before.get(id)!.shape),
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
    console.log('preset  cells  invisible  strands  reports  ids churn  turned  moved>50mm   blind edges');
    for (const [id, cells] of sweep) {
      const sum = (f: (c: Cell) => number) => cells.reduce((n, c) => n + f(c), 0);
      console.log(
        `${id.padEnd(6)}  ${String(cells.length).padStart(5)}  ${String(cells.filter((c) => c.invisible).length).padStart(9)}  ` +
          `${String(cells.filter((c) => c.stranded > 0).length).padStart(7)}  ` +
          `${String(cells.filter((c) => c.findings.length > 0).length).padStart(7)}  ` +
          `${String(cells.filter((c) => churned(c) > 0).length).padStart(9)}  ` +
          `${String(sum((c) => c.turned.length)).padStart(6)}  ${String(sum((c) => c.relocated.length)).padStart(10)}   ` +
          JSON.stringify(blindEdges(id)),
      );
    }
    // The last two columns count pieces, not cells, and they are the ones `identity`
    // cannot see: same category, same shape, same millimetres, somewhere else in the
    // room or facing another way. Printed beside the churn because the churn is what a
    // reader would otherwise take for the whole damage.

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

    // `blindEdges(id)` is empty exactly when no cell of `id` is invisible, so restating
    // it here would be one assertion written twice — a review called the earlier version
    // out for presenting the restatement as the control. The real control is the COUNT,
    // which is derived and cannot be satisfied by an `invisible` stuck either way: an
    // always-false one fails l/t/u's sets, an always-true one fails rect's and open's,
    // and only the true partition reaches 100. It is 20 + 40 + 40 and NOT 20 + 40 + 50,
    // because one of the U's five blind edges also has visible cells.
    expect(all.filter((c) => c.invisible)).toHaveLength(100);
  });

  it('is measured on a signed quantity, so it says which way a wall went', () => {
    // `PRESSES` is closed under negation, which makes the whole sweep invariant under a
    // sign flip in `offsetWall` — a review proved it by flipping both vertices and
    // getting a byte-identical table and 6/6 green. The file's own comment claimed the
    // ladder covered handedness; it covered the ladder. So here is the one asymmetric
    // reading, on a named edge of a named preset, in both directions.
    //
    // `rect` edge 0 is the north wall: its outward normal is (0, -1), so a POSITIVE
    // delta grows the depth and leaves the width alone. Every clause matters — a flipped
    // sign swaps the two comparisons, and a normal rotated 90 degrees moves the width
    // instead.
    const base = footprintForLayout('rect', 6, 4);
    const box = footprintBounds(base);
    const out = footprintBounds(moved(base, 0, +10 * STEP)!);
    const inward = footprintBounds(moved(base, 0, -10 * STEP)!);
    expect(out.depth).toBeCloseTo(box.depth + 0.5, 9);
    expect(inward.depth).toBeCloseTo(box.depth - 0.5, 9);
    expect(out.width).toBeCloseTo(box.width, 9);
    expect(inward.width).toBeCloseTo(box.width, 9);
  });

  it('reports a finding in a room whose stated size never changed', () => {
    // Both ends. A floor alone survives a change that makes EVERY invisible cell report
    // something — which is not a fix, it is the measurement losing its meaning — and the
    // negative controls below are `rect` and `open`, which have no invisible cells at
    // all and so bound nothing here. 44 of 100 today.
    const hidden = all.filter((c) => c.invisible && c.findings.length > 0);
    expect(hidden.length).toBeGreaterThanOrEqual(40);
    expect(hidden.length).toBeLessThanOrEqual(60);

    // ONE arrow press. The T's own offered size, its second wall, 50 mm — the room is
    // 5.50 x 4.70 before and after, and Room check has something to say afterwards.
    // This is the smallest gesture in the app that reaches the gap.
    const onePress = all.find((c) => c.layout === 't' && c.edge === 2 && c.delta === STEP)!;
    expect(onePress.invisible).toBe(true);
    expect(onePress.findings).toContain('reach');
    expect(churned(onePress)).toBeGreaterThan(0);

    // The worst invisible cell. **The window is deliberately wider than one
    // `STRANDED_PIECE`**, which the first version's was not: `stranded` is square metres
    // of unreachable floor PLUS 2 per unreachable piece, and `u/2 @ -1.00` is 2.88 m²
    // plus one piece. A `> 4, < 6` pin therefore went red when a SECOND piece was
    // stranded — reporting "the stranded floor grew past 6" about a floor that had not
    // moved — and stayed green when the 2.88 m² was cleared and two pieces stranded
    // instead. Pinned in units of the penalty so the arithmetic is legible, and the
    // cell's identity is pinned separately because that is the part that carries meaning.
    const worst = [...all].filter((c) => c.invisible).sort((a, b) => b.stranded - a.stranded)[0];
    expect(`${worst.layout}/${worst.edge}`).toBe('u/2');
    expect(worst.stranded).toBeGreaterThan(2 * STRANDED_PIECE);
    expect(worst.stranded).toBeLessThan(2 + 3 * STRANDED_PIECE);
    expect(worst.findings).toContain('cut-off');
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

    // And the three columns above are the CONSERVATIVE reading. `identity` is
    // `category/shape/dimMM` — everything about a piece in its own frame, and nothing
    // about where the seeder decided to put it. Of the ids that survive byte-identical,
    // the re-seed turns hundreds and walks hundreds more across the room; one `l` row
    // flips a sofa by pi and moves a TV 4.75 m while reporting `changed: 0`. Pinned,
    // because the printed table is this file's deliverable and it understated the
    // damage by roughly fourteen times until a review measured it.
    const turned = all.reduce((n, c) => n + c.turned.length, 0);
    const relocated = all.reduce((n, c) => n + c.relocated.length, 0);
    expect(turned).toBeGreaterThan(500);
    expect(relocated).toBeGreaterThan(1000);
    expect(all.filter((c) => c.turned.length + c.relocated.length > 0).length).toBeGreaterThan(200);

    // No id in the offered sizes changes its ANCHOR CLASS, and that is asserted rather
    // than assumed — because the next test finds one a little way outside them, and a
    // silent zero here would read as the phenomenon not existing.
    expect(all.flatMap((c) => c.reanchored)).toEqual([]);
  });

  it('turns a floor lamp into a ceiling pendant, under the same id, one arrow press away', () => {
    // The sharpest single instance of the churn, and `changed` counts it as one
    // alongside a TV moving a size rung. `lamp-1` is `lamp-floor` at y = 0 before and
    // `lamp-pendant` at y = 2.58 after, so a saved position the user chose for a floor
    // lamp is applied to something hanging from the ceiling.
    //
    // **Not an offered size, and that is stated rather than smuggled.** The picker's
    // five are swept above and none of them reaches this; 3.5 x 6.0 is a room the Room
    // rail's own number fields will accept, which is why it is worth a gate. A review
    // lens found it on a wider grid than this file sweeps, which is exactly the value of
    // measuring the catalogue rather than the fixture.
    const base = footprintForLayout('t', 3.5, 6);
    const box = footprintBounds(base);
    const before = new Map(
      defaultScene('t', 3.5, 6, { footprint: base, height: HEIGHT }).map((p) => [p.id, p]),
    );
    // Edge 2 is in the T's blind set, so the room is 3.50 x 6.00 before and after: no
    // size sweep, and no glance at the Room panel, would show anything at all.
    const poly = moved(base, 2, STEP)!;
    const b = footprintBounds(poly);
    expect(b.width).toBeCloseTo(box.width, 9);
    expect(b.depth).toBeCloseTo(box.depth, 9);

    const after = defaultScene('t', b.width, b.depth, { footprint: poly, height: HEIGHT });
    const lamp = after.find((p) => p.id === 'lamp-1')!;
    const was = before.get('lamp-1')!;
    expect(anchorFor(was.category, was.shape)).toBe('floor');
    expect(anchorFor(lamp.category, lamp.shape)).toBe('ceiling');
    // Both ends of the fall, so a change that merely renames the shapes cannot pass.
    expect(was.pos[1]).toBeCloseTo(0, 6);
    expect(lamp.pos[1]).toBeGreaterThan(2);
  });

  it('leaves a rectangle WALKABLE after ONE wall move, which is what makes the stranding a finding', () => {
    // The negative control, and it earns its place: every assertion above is of the form
    // "some cells do X", which a sweep broken so that EVERY cell does X would satisfy
    // just as well. `rect` and `open` are the two presets with no interior edge, and
    // across all 80 of their cells nothing is stranded and nothing is reported. So the
    // stranding above is a property of the SHAPE and not of this file's arithmetic.
    //
    // **It is a claim about ONE wall move, and the title says so because the earlier one
    // did not.** A review composed moves: TWO nudges on this same offered 6 x 4 rect
    // strand it (max 2.70), and four strand and report in 4% of trajectories. The
    // rectangle is not immune, it is one gesture further away — which strengthens the
    // finding rather than weakening it, and would read as a contradiction to anyone who
    // took the old title at face value.
    for (const id of ['rect', 'open'] as const) {
      const cells = sweep.get(id)!;
      // Derived from the polygon rather than from the loop's own bounds. Written as
      // `PRESSES.length * 4` this compared a loop counter with the loop it came from —
      // the shape of assertion this repo keeps finding, and it hid the one fact worth
      // stating: `moved()` never rejects a cell at these deltas, so every edge x press
      // is present.
      expect(cells).toHaveLength(footprintForLayout(id, 6, 4).length * PRESSES.length);
      expect(cells.filter((c) => c.stranded > 0)).toHaveLength(0);
      expect(cells.filter((c) => c.findings.length > 0)).toHaveLength(0);
    }
  });

  it('agrees with the gate a real wall move passes, at the deltas it sweeps', () => {
    // `moved()` mirrors `moveWall`; the gate every wall surface actually passes is
    // `moveWallCarrying`, which ALSO refuses a box smaller than the room's own furniture
    // needs and, on refusal, clamps to the bound rather than declining. A review planted
    // a new refusal reason in `moveWall` and every test in this file stayed green, so
    // the mirror's drift is real and unbounded by anything in the mirror itself.
    //
    // This is the guard, and it is the furniture end of the gate rather than a proxy for
    // it: `lib/room-floor.ts` is the ONE source of that bound — `wall-actions.ts` and
    // `RoomDimsEditor` both read it and nothing else does — and it imports only pure
    // modules, so it can be run here where `wall-actions.ts` cannot (that file imports
    // both stores, and the store wants a DOM).
    //
    // Every swept cell must clear the floor its own base scene imposes. Today the
    // tightest margin is 3.00 m of room against a 2.40 m rug, so nothing is clamped —
    // and if a smaller preset is added to the picker, or `PRESSES` is widened, this goes
    // red and sends the reader to this comment rather than silently seeding rooms the
    // app would have refused.
    let tightest = Infinity;
    for (const o of offered) {
      const parts = defaultScene(o.id, o.width, o.depth, {
        footprint: footprintForLayout(o.id, o.width, o.depth),
        height: HEIGHT,
      });
      for (const c of sweep.get(o.id)!) {
        for (const axis of ['width', 'depth'] as const) {
          const floor = roomFloor(furnitureFloor(parts, axis), axis === 'width' ? o.width : o.depth);
          const margin = (axis === 'width' ? c.width : c.depth) - floor;
          expect(
            margin,
            `${o.id} edge ${c.edge} at ${c.delta.toFixed(2)} m: ${axis} ${(axis === 'width' ? c.width : c.depth).toFixed(2)} ` +
              `is under the ${floor.toFixed(2)} m this room's furniture needs — moveWallCarrying would have clamped it`,
          ).toBeGreaterThanOrEqual(0);
          tightest = Math.min(tightest, margin);
        }
      }
    }
    // Both ends. A floor alone would survive the ladder shrinking to nothing, at which
    // point the margin is enormous and the sweep measures a handful of cells.
    expect(tightest).toBeGreaterThan(0.3);
    expect(tightest).toBeLessThan(1.5);

    // …and nothing was rejected by `moved()` either, so its `ROOM_SIDE_M` branch is not
    // quietly shaping the population: every edge x press is present.
    for (const [id, cells] of sweep) {
      expect(cells).toHaveLength(footprintForLayout(id, 6, 4).length * PRESSES.length);
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
    // effects are separable and both are real.
    //
    // **The ceiling here used to be `<= sweep.get(id)!.length`, which is a tautology** —
    // `churn` IS a filter over that array, and a subset cannot outnumber its source. The
    // comment beside it claimed both ends were pinned. A review forced every `l`/`t`/`u`
    // cell to churn, taking the counts to 60/80/80, and all six tests stayed green while
    // this file's headline ("an order of magnitude more often") had quietly become
    // "always". The real ceiling is a fraction of the population: past this, the
    // difference between a rectangle and a notch has stopped being the finding.
    for (const id of ['l', 't', 'u'] as const) {
      const cells = sweep.get(id)!.length;
      expect(churn(id)).toBeGreaterThan(25);
      expect(churn(id)).toBeLessThan(cells * 0.9);
    }
  });
});
