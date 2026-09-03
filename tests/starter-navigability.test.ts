import { describe, expect, it } from 'vitest';

import { analyzeRoom } from '@/lib/clearance';
import { footprintForLayout, type LayoutId } from '@/lib/footprint';
import {
  DEFAULT_WEIGHTS,
  NAV_CELL,
  costBreakdown,
  navigabilityCost,
  prepare,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { ROOM } from '@/lib/parts-catalog';
import { defaultScene } from '@/lib/scene-spec';

import { offeredHeight, offeredSizes } from './helpers/offered-sizes';

/** § G.1 — where a SEEDED room strands floor, and what the room § G.1 measured was.
 *
 *  § G.1 measured `defaultScene('t', ROOM.width, ROOM.depth)` and found `navigation`
 *  232.20 on the T and 472.20 on the U. Both reproduce. What does not hold is what
 *  room they are about: `ROOM`'s 5.6 x 4.2 is **`DEFAULT_ROOM`'s size, and
 *  `DEFAULT_ROOM.layoutId` is `'rect'`** (`lib/scene-store.ts`), so that pairing is a
 *  T built at the rectangle's dimensions. § G.1's own headline was that every solver
 *  fixture used 6 x 5 while the app shipped 5.6 x 4.2 — *"a fixture that cannot
 *  express the defect"*. The fixture that found **that** had the same fault one level
 *  up. **A fixture is a claim about a reachable state.**
 *
 *  **That is where the first version of this file stopped, and it was wrong to.** Two
 *  claims it made are retracted here rather than quietly dropped, because both were
 *  reasoned rather than measured and one is contradicted by this file's own output:
 *
 *  · *"The T and U come clean at depth >= 4.6"* — **false.** The grid below strands
 *    `t` at d = 4.6 for the four widest columns, and `l` at 4.0 x 5.0 costs ~592 while
 *    being clean at 4.0 x 3.4. Depth is not the variable, area is not the variable and
 *    part count is not the variable; the surface is not monotonic in any of them. The
 *    prose read the left half of a table it printed itself. Hence the pins below: the
 *    findings that used to sit in a paragraph are assertions now, and the ones that
 *    were wrong could not have survived being written as assertions in the first place.
 *  · *"Not a first-run defect, because no path constructs that pairing"* — **too
 *    strong.** `buildSceneFromRoom` re-seeds through `defaultScene` on EVERY open when
 *    a room has no detections and no saved scene, and `moveWallCarrying` never writes
 *    one — so a picker T plus one wall nudge plus a revisit seeds a stranded room with
 *    the user having moved no furniture at all. What survives is only the narrow fact
 *    below: the five sizes the picker OFFERS are clean as seeded.
 *
 *  **What this file asserts that nothing else does, and what it deliberately does
 *  not.** `tests/scene-seed.test.ts` already asserts, per preset, that the seeded room
 *  is walkable (`:280`), that the report is quiet (`:183`) and that it is furnished
 *  (`:121`). Repeating that here would be two gates over one property — and worse,
 *  they would be gating different rooms, since that file hand-typed its five sizes
 *  while this one parses them. So the duplication is resolved the other way: both read
 *  `tests/helpers/offered-sizes.ts`, this file keeps the parse and its pins, and the
 *  per-preset assertions stay where the per-preset fixture is.
 *
 *  What is left here is three things nothing else has: that the picker's list is
 *  **derived** and not remembered; that `rect` at `ROOM`'s own 5.6 x 4.2 — the one
 *  row of § G.1's table a user reaches without editing a room — is clean, which no
 *  other file builds; and the grid, which is the measurement.
 *
 *  No solver runs in any of these numbers. It is `defaultScene` read by
 *  `navigabilityCost`, which is what makes them a statement about the SEEDER.
 *
 *  **Why the assertion reads `navigabilityCost` and the table prints `costBreakdown`.**
 *  `costBreakdown`'s `navCell` is a fourth optional positional defaulting to `null`,
 *  and with it null the navigation term is never written and stays 0 — so every
 *  `navigation === 0` would pass vacuously if a call ever lost its argument. Its
 *  `navigation` is also the WEIGHTED term, so `DEFAULT_WEIGHTS.navigation = 0` is a
 *  second way to a silent green. `navigabilityCost` has neither property. It has one
 *  of its own — it returns 0 when the room has no door — which is why every row
 *  asserts its door count.
 *
 *  **Mutation ledger — every assertion below has been watched failing but one, and
 *  the exception is named rather than left for a reader to discover.**
 *
 *    · `prepare`'s door list emptied — the T and U negative controls, and every door
 *      count. This is the vacuity route the whole redesign is about.
 *    · the door-reach radius 1.2 -> 50, and separately -> 0.02 — all five "this room
 *      does strand" pins. The second is worth its own line: at 0.02 nothing is
 *      walkable near a door and `navigabilityCost` RETURNS 0 by design
 *      (`layout-score.ts:1015`), so a room too full to analyse scores exactly like a
 *      perfect one. That is a third vacuity route, and only a negative control sees it.
 *    · `PLAN_RANKS` 4 -> 1; the seeder's rule (A) stage deleted; `BED_LADDER` cut to
 *      its widest rung — the deeper U's clean cell, each time.
 *    · `LOVESEAT` widened to the three-seater's 2200 — both "small room is clean"
 *      pins, which is the defect that constant's own docblock was written about.
 *    · `SOFA` 950 -> 1600 deep, and -> 3200 x 1900 — the rect sweep, naming its cells.
 *    · the `wardrobe` widened to 2900 — the U part-count pin, 11 against 12.
 *    · `SEED_WALL_GAP` + 550 mm and + 1150 mm — five pins between them.
 *    · `defaultScene` forced to return `[]` — the part count and the door counts.
 *    · the `tall` guard inverted — DEFAULT_ROOM's report, with twelve findings.
 *    · the picker's `HEIGHT` 2.8 -> 3.1, its `PRESETS` renamed, and the row regex
 *      narrowed to four-letter ids — the parse, the two slice markers and the
 *      short-parse guard, which reported `5 preset rows, 2 parsed`.
 *
 *  **The exception: `DEFAULT_ROOM strands floor` has never been seen failing.** Four
 *  mutations that strand a rect at other sizes leave 5.6 x 4.2 clean — a rectangle has
 *  no pocket to cut off, which is also why the rect row of the grid is clean in all 56
 *  cells. It is kept rather than deleted because the assertion over that whole row IS
 *  killable and has been killed twice, and 5.6 x 4.2 is one of its cells; this line
 *  adds only the name of the room, which is the part a reader needs.
 *
 *  From the first pass and still true: `CLASH_SHARE` 0.5 -> 0.0 survives, because a
 *  starter room has no overlapping pair at all; and bypassing `settleParts` survives,
 *  which is what retired an `outside === 0` assertion nothing could make fail. */

const PRESET_ORDER: LayoutId[] = ['rect', 'l', 't', 'u', 'open'];
const HEIGHT = offeredHeight();

type Row = {
  layout: LayoutId;
  w: number;
  d: number;
  parts: number;
  doors: number;
  /** Unweighted, on the room report's own grid. THE measured quantity. */
  navigation: number;
  /** Weighted, printed only — and not the seeder's own figure either: its chooser
   *  compares `bd.total + missing`, charging a plan for the pieces it did not place. */
  weightedTotal: number;
  findings: string[];
};

function score(layout: LayoutId, w: number, d: number): Row {
  const poly = footprintForLayout(layout, w, d);
  const parts = defaultScene(layout, w, d, { footprint: poly, height: HEIGHT });
  const at: Placement[] = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
  // `movable` all-true, which is the seeder's own chooser (`scene-spec.ts:1398`).
  // It cannot change these numbers today — `layout-score.ts` reads it only inside
  // `if (origin)` and neither caller passes an origin — so this is alignment against
  // the day a term starts reading it, not a correction.
  const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: poly };
  const model = prepare(ctx);
  const report = analyzeRoom(parts, { footprint: poly, height: HEIGHT });
  return {
    layout,
    w,
    d,
    parts: parts.length,
    doors: model.doors.length,
    navigation: navigabilityCost(model, at, NAV_CELL),
    weightedTotal: costBreakdown(model, at, DEFAULT_WEIGHTS, NAV_CELL).total,
    // `severity: detail` rather than `rule`, so a failure names the piece the way
    // `scene-seed.test.ts` does. A bare rule kind says a room is wrong without
    // saying which corner of it.
    findings: report.issues.map((i) => `${i.severity}: ${i.detail}`),
  };
}

const tally = (kinds: string[]) => (kinds.length === 0 ? '—' : `${kinds.length} finding(s)`);

describe('§ G.1 · where a seeded room strands floor', () => {
  const offered = offeredSizes();

  it('derives the picker\'s five presets rather than remembering them', () => {
    // Five is a DECISION and is pinned as one. The helper already fails loudly on a
    // regex that understands fewer rows than the block contains, so this is not that
    // check repeated: it is the separate claim that the picker offers five shapes, in
    // this order, and that a sixth is a change somebody should have to come here for.
    expect(offered).toHaveLength(5);
    expect(offered.map((o) => o.id)).toEqual(PRESET_ORDER);
    expect(HEIGHT).toBe(2.8);
  });

  it('the room § G.1 measured is a layout at another layout\'s dimensions', () => {
    const rows = PRESET_ORDER.map((layout) => score(layout, ROOM.width, ROOM.depth));

    console.log(
      `\n§ G.1 · defaultScene(<layout>, ROOM.width, ROOM.depth) = ${ROOM.width} x ${ROOM.depth}` +
        " — the size of DEFAULT_ROOM, whose layoutId is 'rect'\n",
    );
    console.log('preset  parts   navigation   weighted tot   analyzeRoom');
    for (const r of rows) {
      console.log(
        `${r.layout.padEnd(6)}  ${String(r.parts).padStart(5)}  ` +
          `${r.navigation.toFixed(2).padStart(11)}  ${r.weightedTotal.toFixed(2).padStart(13)}   ${tally(r.findings)}`,
      );
    }

    const by = (id: LayoutId) => rows.find((r) => r.layout === id)!;

    // The one row that IS reachable: DEFAULT_ROOM, used by the store's initial state
    // and by `loadFromRoom(null)`. No other file builds a rect at this size —
    // `scene-seed.test.ts` builds the picker's 6.0 x 4.0 — so if this ever strands,
    // a user with no saved room sees a finding before touching anything.
    //
    // `5.6 x 4.2` is also a cell of the grid below, and the rect sweep there is what
    // actually gates it: that assertion covers all 56 cells and mutation has taken it
    // red twice, while nothing tried has reached this cell on its own. See the ledger.
    // `expect.soft` for the same reason as the grid below: one hard failure would hide
    // the negative control two lines under it, and the negative control is the only
    // thing here that can tell a clean room from a measurement that has stopped
    // measuring.
    expect.soft(by('rect').navigation, 'DEFAULT_ROOM strands floor').toBe(0);
    expect.soft(by('rect').findings, 'DEFAULT_ROOM reports a finding').toEqual([]);
    expect.soft(by('rect').parts, 'DEFAULT_ROOM seeded an empty room').toBeGreaterThan(3);

    // …and the negative control, which is the same two figures § G.1 reported. A file
    // whose every assertion is `=== 0` cannot tell a clean room from a measurement
    // that has stopped measuring: with `navCell` lost, a weight zeroed or a room with
    // no door, everything above passes and nothing here does.
    expect.soft(by('t').navigation, 'the T at ROOM size no longer strands').toBeGreaterThan(0);
    expect.soft(by('u').navigation, 'the U at ROOM size no longer strands').toBeGreaterThan(0);
    for (const r of rows) expect(r.doors, `${r.layout} seeded no door`).toBeGreaterThan(0);
  });

  it('strands by no rule of thumb — not depth, not area, not part count', () => {
    const WIDTHS = [4.0, 4.5, 5.0, 5.6, 6.0, 6.5, 7.0, 7.5];
    const DEPTHS = [3.0, 3.4, 3.8, 4.2, 4.6, 5.0, 5.6];
    const grid = new Map<string, Row>();
    const cell = (layout: LayoutId, w: number, d: number) => grid.get(`${layout} ${w}x${d}`)!;

    for (const layout of PRESET_ORDER) {
      console.log(`\n§ G.1 · ${layout} · stranded floor by room size (parts in brackets)\n`);
      console.log(`  d\\w  ${WIDTHS.map((w) => w.toFixed(1).padStart(13)).join('')}`);
      for (const d of DEPTHS) {
        const out: string[] = [];
        for (const w of WIDTHS) {
          const r = score(layout, w, d);
          grid.set(`${layout} ${w}x${d}`, r);
          // Two decimals, not none. This quantity is UNWEIGHTED now — the weighted
          // table showed it multiplied by `DEFAULT_WEIGHTS.navigation` — so
          // `toFixed(0)` printed a bare `0` for every room stranding less than half a
          // unit, and a reader would have counted those among the clean ones. A grid
          // whose two states render identically is the whole reason this file was
          // wrong the first time.
          out.push(`${r.navigation === 0 ? '.' : r.navigation.toFixed(2)}(${r.parts})`.padStart(13));
        }
        console.log(`${d.toFixed(1).padStart(5)}  ${out.join('')}`);
      }
    }
    console.log(
      '\n  A dot is a room that strands nothing. Every other cell is stranded floor in the\n' +
        "  room report's own units, before DEFAULT_WEIGHTS.navigation multiplies it by " +
        `${DEFAULT_WEIGHTS.navigation}.\n`,
    );

    // Every cell has a door, or `navigabilityCost` is answering 0 for a reason that
    // has nothing to do with the floor and the whole grid is decoration.
    for (const r of grid.values()) expect(r.doors, `${r.layout} ${r.w}x${r.d} seeded no door`).toBeGreaterThan(0);

    // **`expect.soft` from here down, and it is not a style choice.** A hard `expect`
    // ends its test at the first failure, so these eight would be reported one per
    // run — and a mutation pass that can only see its first kill cannot tell an
    // assertion that is load-bearing from one that was merely masked by the assertion
    // above it. That is how a decorative assertion survives a mutation ledger: never
    // by passing, but by never being reached. The door loop above stays hard, because
    // a room with no door makes every line below it meaningless rather than false.

    // **The rectangle never strands, at any of the 56 sizes.** The one clean statement
    // in the whole grid, and the reason the prose's depth threshold looked plausible:
    // it is true of the preset anybody checks first.
    const rectStranded = [...grid.values()].filter((r) => r.layout === 'rect' && r.navigation > 0);
    expect.soft(rectStranded.map((r) => `${r.w}x${r.d}`), 'the rect stranded floor').toEqual([]);

    // **Not monotonic in area.** A BIGGER L strands where a smaller one does not, so
    // "too small for its furniture" — § G.1's stated hypothesis, and the reason its
    // suggested fix was "place fewer pieces" — is the wrong reading of the surface.
    expect.soft(cell('l', 4.0, 3.4).navigation, 'the small L stranded').toBe(0);
    expect.soft(cell('l', 4.0, 5.0).navigation, 'the larger L stopped stranding').toBeGreaterThan(0);

    // **Not part count either.** Two U's with the SAME furniture in them, one
    // stranding and one not — so nothing is being over-furnished.
    expect.soft(cell('u', 5.6, 4.2).parts, 'the two U rows stopped seeding the same room').toBe(
      cell('u', 5.6, 4.6).parts,
    );
    expect.soft(cell('u', 5.6, 4.2).navigation, 'the shallow U stopped stranding').toBeGreaterThan(0);
    expect.soft(cell('u', 5.6, 4.6).navigation, 'the deeper U started stranding').toBe(0);

    // **And not depth, which is what the first version of this file claimed.** One
    // depth, two widths, opposite answers — and the stranded one is the WIDER room.
    // This is the assertion the retracted sentence would have had to survive.
    expect.soft(cell('t', 4.0, 4.6).navigation, 'the narrow T at 4.6 stranded').toBe(0);
    expect.soft(cell('t', 7.5, 4.6).navigation, 'the wide T at 4.6 stopped stranding').toBeGreaterThan(0);

    // 280 cells, each a full build plus a clearance field, so this is ~5 s of real
    // work and it does not fit vitest's DEFAULT 5 s `testTimeout` — a bound nobody
    // chose, since `vitest.config.ts` sets none at all. This test hit it on its first
    // green run, which is § A.4 of `what-is-still-open.md` happening to the file that
    // measured § A.4. Budgeted here rather than raised globally: a grid is allowed to
    // be slow, and the other 117 files should not inherit a longer leash for it.
  }, 40000);
});
