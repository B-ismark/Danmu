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
 *  § G.1 measured `defaultScene('t', ROOM.width, ROOM.depth)` and reported `navigation`
 *  232.20 on the T and 474.60 on the U — **weighted figures**, which is
 *  `DEFAULT_WEIGHTS.navigation` times the raw quantity this file prints. The T's
 *  reproduces; the U's is **472.20** today, and three of that table's five rows had
 *  moved. A first pass over it declared that every number reproduced, having checked
 *  the T and generalised — which is the same move as the retracted threshold below, and
 *  the reason the corrections survived is that a figure wrong in its third significant
 *  digit reads as right. What does not hold at all is what room they are about:
 *  `ROOM`'s 5.6 x 4.2 is
 *  **`DEFAULT_ROOM`'s size, and `DEFAULT_ROOM.layoutId` is `'rect'`**
 *  (`lib/scene-store.ts`), so that pairing is a T built at the rectangle's dimensions.
 *  § G.1's own headline was that every solver fixture used 6 x 5 while the app shipped
 *  5.6 x 4.2 — *"a fixture that cannot express the defect"*. The fixture that found
 *  **that** had the same fault one level up. **A fixture is a claim about a reachable
 *  state.**
 *
 *  **That is where the first version of this file stopped, and it was wrong to.** Two
 *  claims it made are retracted here rather than quietly dropped, because both were
 *  reasoned rather than measured and one is contradicted by this file's own output:
 *
 *  · *"The T and U come clean at depth >= 4.6"* — **false.** The grid below strands
 *    `t` at d = 4.6 for the four widest columns, and the `l` at 4.0 x 5.0 strands where
 *    the same L at 4.0 x 3.4 does not. Depth is not the variable, area is not the
 *    variable and part count is not the variable; the surface is not monotonic in any
 *    of them. The prose read the left half of a table it printed itself. Hence the pins
 *    below: the findings that used to sit in a paragraph are assertions now, and the one
 *    that was wrong could not have survived being written as an assertion.
 *  · *"Not a first-run defect, because no path constructs that pairing"* — **too
 *    strong.** `buildSceneFromRoom` re-seeds through `defaultScene` on EVERY open when
 *    a room has no detections and no saved scene, and `moveWallCarrying` never writes
 *    one — so a picker T plus one wall nudge plus a revisit seeds a stranded room with
 *    the user having moved no furniture at all. Watched happening in a browser; the
 *    numbers are in § G.1 of `docs/what-is-still-open.md`. What survives is only the
 *    narrow fact that the five sizes the picker OFFERS are clean as seeded.
 *
 *  **What this file asserts that nothing else does, and what it deliberately does
 *  not.** `tests/scene-seed.test.ts` already asserts, per preset and at the same five
 *  sizes, that the seeded room is walkable (*"seeds a room you can walk all of"*), that
 *  the report is quiet (*"opens with a room the report finds no fault in"*) and that it
 *  is furnished (*"furnishes the room"*, `> 3`, stronger than a `> 0` here). Repeating
 *  that would be two gates over one property — and worse, they would be gating
 *  different rooms, since that file hand-typed its five sizes while this one parses
 *  them. So the duplication is resolved the other way: both read
 *  `tests/helpers/offered-sizes.ts`, and the per-preset assertions stay where the
 *  per-preset fixture is. **Those three are named rather than cited by line**, because
 *  a line number in a docblock rots the moment the file above it grows — all three of
 *  the citations that stood here were two lines out by the time a reviewer followed
 *  them, and two of the three landed in a different test.
 *
 *  What is left here is three things nothing else has: the picker's list is **derived**
 *  and its measurement **printed**; `rect` at `ROOM`'s own 5.6 x 4.2 — the one row of
 *  § G.1's table a user reaches without editing a room — is clean, which no other file
 *  builds; and the grid.
 *
 *  No solver runs in any of these numbers. It is `defaultScene` read by
 *  `navigabilityCost`, which is what makes them a statement about the SEEDER.
 *
 *  **Why the assertions read `navigabilityCost` and the tables print `costBreakdown`.**
 *  `costBreakdown`'s `navCell` is a fourth optional positional defaulting to `null`,
 *  and with it null the navigation term is never written and stays 0 — so every
 *  `navigation === 0` would pass vacuously if a call ever lost its argument. Its
 *  `navigation` is also the WEIGHTED term, so `DEFAULT_WEIGHTS.navigation = 0` is a
 *  second way to a silent green. `navigabilityCost` has neither property. It has three
 *  of its own, all of which return 0 for a room nobody could walk: no door
 *  (`layout-score.ts:1000`), no clearance field (`:1006`), and **no walkable floor near
 *  any door** (`:1015`). Every row therefore asserts its door count, and — because the
 *  third of those is per-room and a door count cannot see it — every `=== 0` pin is
 *  paired with `analyzeRoom`'s own verdict on the same room, which the grid was already
 *  computing and throwing away.
 *
 *  **Mutation ledger — every assertion below has been watched failing but one, and
 *  the exception is named rather than left for a reader to discover.**
 *
 *    · `prepare`'s door list emptied — the T and U negative controls, and every door
 *      count. This is the vacuity route the whole redesign is about.
 *    · the door-reach radius 1.2 -> 50, and separately -> 0.02 — all five "this room
 *      does strand" pins. The second is worth its own line: at 0.02 nothing is
 *      walkable near a door and `navigabilityCost` RETURNS 0 by design, so a room too
 *      full to analyse scores exactly like a perfect one.
 *    · `PLAN_RANKS` 4 -> 1; the seeder's rule (A) stage deleted; `BED_LADDER` cut to
 *      its widest rung — the deeper U's clean cell, each time.
 *    · `LOVESEAT` widened to the three-seater's 2200 — both "small room is clean"
 *      pins, which is the defect that constant's own docblock was written about.
 *    · `SOFA` 950 -> 1600 deep, and -> 3200 x 1900 — the rect sweep, naming its cells.
 *    · the `wardrobe` widened to 2900 — the U part-count pin, 11 against 12.
 *    · `SEED_WALL_GAP` + 0.55 m and + 1.15 m — five pins between them. **Metres**: it
 *      is `WALL_GAP`, which is 0.02 m. This ledger said "550 mm" and anyone replaying
 *      it would have seeded every piece 550 m from its wall, got an empty room, and
 *      recorded "could not reproduce" against an entry that was fine.
 *    · `defaultScene` forced to return `[]` — the part count and the door counts.
 *    · the `tall` guard inverted — DEFAULT_ROOM's report, with twelve findings.
 *    · the picker's `HEIGHT` 2.8 -> 3.1, its `PRESETS` renamed, and the row regex
 *      narrowed to four-letter ids — the parse, the array terminator and the
 *      short-parse guard, which reported `5 preset rows, 2 parsed`.
 *
 *  **The exception: `DEFAULT_ROOM strands floor` has never been seen failing.** Four
 *  mutations that strand a rect at other sizes leave 5.6 x 4.2 clean — a rectangle has
 *  no pocket to cut off, which is also why the rect row of the grid is clean in all 56
 *  cells. It is kept rather than deleted because the assertion over that whole row IS
 *  killable and has been killed twice, and 5.6 x 4.2 is one of its cells; this line
 *  adds only the name of the room.
 *
 *  From the first pass and still true: `CLASH_SHARE` 0.5 -> 0.0 survives, because a
 *  starter room has no overlapping pair at all; and bypassing `settleParts` survives,
 *  which is what retired an `outside === 0` assertion nothing could make fail. That
 *  column is not printed here any more, and nothing else measures it. */

// The order the picker offers its shapes in. A DECISION, pinned as one — and used for
// nothing else: every loop below runs over the parsed list, so a rename on the page
// turns the pin red and cannot leave the sweeps quietly working through a vocabulary
// the picker has stopped offering.
const PRESET_ORDER: LayoutId[] = ['rect', 'l', 't', 'u', 'open'];

/** The picker's ceiling — the one a room CREATED there is saved with. */
const OFFERED_HEIGHT = offeredHeight();

type Row = {
  layout: LayoutId;
  w: number;
  d: number;
  parts: number;
  doors: number;
  /** Unweighted, on the room report's own grid. THE measured quantity — and it is not
   *  purely an area: `navigabilityCost` adds `STRANDED_PIECE` for each piece whose
   *  access zones are all unreachable, so a cell of 4.93 may be 4.93 m² of floor or
   *  0.93 m² and two wardrobes nobody can open. "Stranded" below means that sum. */
  stranded: number;
  /** Weighted, printed only — and not the seeder's own figure either: its chooser
   *  compares `bd.total + missing`, charging a plan for the pieces it did not place. */
  weightedTotal: number;
  findings: string[];
};

function score(layout: LayoutId, w: number, d: number, height: number): Row {
  const poly = footprintForLayout(layout, w, d);
  const parts = defaultScene(layout, w, d, { footprint: poly, height });
  const at: Placement[] = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
  // `movable` all-true, which is the seeder's own chooser (`scene-spec.ts:1398`).
  // It cannot change these numbers today — `layout-score.ts` reads it only inside
  // `if (origin)` and neither caller passes an origin — so this is alignment against
  // the day a term starts reading it, not a correction.
  const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: poly };
  const model = prepare(ctx);
  const report = analyzeRoom(parts, { footprint: poly, height });
  return {
    layout,
    w,
    d,
    parts: parts.length,
    doors: model.doors.length,
    stranded: navigabilityCost(model, at, NAV_CELL),
    weightedTotal: costBreakdown(model, at, DEFAULT_WEIGHTS, NAV_CELL).total,
    // `severity: detail` rather than `rule`, so a failure names the piece the way
    // `scene-seed.test.ts` does. A bare rule kind says a room is wrong without
    // saying which corner of it.
    findings: report.issues.map((i) => `${i.severity}: ${i.detail}`),
  };
}

const tally = (kinds: string[]) => (kinds.length === 0 ? '—' : `${kinds.length} finding(s)`);

const raw = (n: number) => (n === 0 ? '.' : n.toFixed(2));

describe('§ G.1 · where a seeded room strands floor', () => {
  const offered = offeredSizes();
  const ids = offered.map((o) => o.id);

  it('derives the picker\'s five presets rather than remembering them', () => {
    // Five is a DECISION and is pinned as one. The helper already fails loudly on a
    // regex that understands fewer rows than the block contains, so this is not that
    // check repeated: it is the separate claim that the picker offers five shapes, in
    // this order, and that a sixth is a change somebody should have to come here for.
    expect(offered).toHaveLength(5);
    expect(ids).toEqual(PRESET_ORDER);
    expect(OFFERED_HEIGHT).toBe(2.8);
  });

  it('prints what every size onboarding offers actually seeds', () => {
    // The ASSERTIONS for these five rows are `scene-seed.test.ts`'s, per preset, off
    // the same derived list — see the docblock. What was missing is the MEASUREMENT:
    // the first version of this file printed this table, the de-duplication took the
    // table out with the assertions, and the property the whole branch is named for
    // was then printed nowhere. Three of the five sizes are in no grid cell below
    // either, so nothing was reporting them at all.
    const rows = offered.map((o) => score(o.id, o.width, o.depth, OFFERED_HEIGHT));

    console.log(`\n§ G.1 · the sizes onboarding OFFERS, at the ceiling it gives them (${OFFERED_HEIGHT} m)\n`);
    console.log('preset     w x d    parts   stranded   weighted tot   analyzeRoom');
    for (const r of rows) {
      console.log(
        `${r.layout.padEnd(6)}  ${r.w.toFixed(1)} x ${r.d.toFixed(1)}  ${String(r.parts).padStart(5)}  ` +
          `${raw(r.stranded).padStart(9)}  ${r.weightedTotal.toFixed(2).padStart(13)}   ${tally(r.findings)}`,
      );
    }

    // A table nobody can trust is worse than no table: `navigabilityCost` answers 0
    // for a room with no door, so without this the "stranded" column could read clean
    // across the board for a reason that has nothing to do with the floor.
    for (const r of rows) expect(r.doors, `${r.layout} ${r.w}x${r.d} seeded no door`).toBeGreaterThan(0);
  });

  it('the room § G.1 measured is a layout at another layout\'s dimensions', () => {
    // `ROOM.height`, not the picker's. This row is DEFAULT_ROOM, which takes all three
    // dimensions from `ROOM` (`lib/scene-store.ts`) — building its floor from `ROOM`
    // and its ceiling from the picker would be this file's own thesis violated in the
    // one row it exists to gate.
    const rows = PRESET_ORDER.map((layout) => score(layout, ROOM.width, ROOM.depth, ROOM.height));

    console.log(
      `\n§ G.1 · defaultScene(<layout>, ROOM.width, ROOM.depth) = ${ROOM.width} x ${ROOM.depth} x ${ROOM.height}` +
        " — DEFAULT_ROOM's own size, and its layoutId is 'rect'\n",
    );
    console.log('preset  parts   stranded   weighted tot   analyzeRoom');
    for (const r of rows) {
      console.log(
        `${r.layout.padEnd(6)}  ${String(r.parts).padStart(5)}  ` +
          `${raw(r.stranded).padStart(9)}  ${r.weightedTotal.toFixed(2).padStart(13)}   ${tally(r.findings)}`,
      );
    }
    console.log(
      `  "stranded" is raw; § G.1's table states it weighted, i.e. x ${DEFAULT_WEIGHTS.navigation}.\n`,
    );

    const by = (id: LayoutId) => rows.find((r) => r.layout === id)!;

    // `expect.soft` throughout: one hard failure would hide the negative control two
    // lines under it, and the negative control is the only thing here that can tell a
    // clean room from a measurement that has stopped measuring.
    //
    // The one row that IS reachable: DEFAULT_ROOM, used by the store's initial state
    // and by `loadFromRoom(null)`. No other file builds a rect at this size —
    // `scene-seed.test.ts` builds the picker's 6.0 x 4.0 — so if this ever strands,
    // a user with no saved room sees a finding before touching anything.
    //
    // 5.6 x 4.2 is also a cell of the grid below, and the rect sweep there is what
    // actually gates it: that assertion covers all 56 cells and mutation has taken it
    // red twice, while nothing tried has reached this cell on its own. See the ledger.
    expect.soft(by('rect').stranded, 'DEFAULT_ROOM strands floor').toBe(0);
    expect.soft(by('rect').findings, 'DEFAULT_ROOM reports a finding').toEqual([]);
    expect.soft(by('rect').parts, 'DEFAULT_ROOM seeded an empty room').toBeGreaterThan(3);

    // …and the negative control, which is the same two figures § G.1 reported. A file
    // whose every assertion is `=== 0` cannot tell a clean room from a measurement
    // that has stopped measuring: with `navCell` lost, a weight zeroed or a room with
    // no door, everything above passes and nothing here does.
    expect.soft(by('t').stranded, 'the T at ROOM size no longer strands').toBeGreaterThan(0);
    expect.soft(by('u').stranded, 'the U at ROOM size no longer strands').toBeGreaterThan(0);
    for (const r of rows) expect(r.doors, `${r.layout} seeded no door`).toBeGreaterThan(0);
  });

  it('strands by no rule of thumb — not depth, not area, not part count', () => {
    const WIDTHS = [4.0, 4.5, 5.0, 5.6, 6.0, 6.5, 7.0, 7.5];
    const DEPTHS = [3.0, 3.4, 3.8, 4.2, 4.6, 5.0, 5.6];
    const grid = new Map<string, Row>();
    const cell = (layout: LayoutId, w: number, d: number) => grid.get(`${layout} ${w}x${d}`)!;

    for (const layout of ids) {
      console.log(`\n§ G.1 · ${layout} · stranded floor by room size (parts in brackets)\n`);
      console.log(`  d\\w  ${WIDTHS.map((w) => w.toFixed(1).padStart(13)).join('')}`);
      for (const d of DEPTHS) {
        const out: string[] = [];
        for (const w of WIDTHS) {
          const r = score(layout, w, d, OFFERED_HEIGHT);
          grid.set(`${layout} ${w}x${d}`, r);
          // Two decimals, not none. This quantity is UNWEIGHTED — the weighted table
          // showed it multiplied by `DEFAULT_WEIGHTS.navigation` — so `toFixed(0)`
          // printed a bare `0` for every room stranding less than half a unit, and a
          // reader would have counted those among the clean ones. A grid whose two
          // states render identically is the whole reason this file was wrong the
          // first time.
          out.push(`${raw(r.stranded)}(${r.parts})`.padStart(13));
        }
        console.log(`${d.toFixed(1).padStart(5)}  ${out.join('')}`);
      }
    }
    console.log(
      '\n  A dot is a room that strands nothing. Every other cell is unreachable floor in m²\n' +
        '  PLUS 2 per piece nobody can get to, so a cell is not purely an area — before\n' +
        `  DEFAULT_WEIGHTS.navigation multiplies it by ${DEFAULT_WEIGHTS.navigation}.\n`,
    );

    // **280, as a literal.** The assertion this replaces compared `cells` — a counter
    // incremented in the loop — against `PRESETS.length * WIDTHS.length * DEPTHS.length`,
    // its own loop bounds, and could not fail. Without SOME size pin, though, both
    // sweeps below are "iterate over whatever you found": empty `WIDTHS` leaves the
    // door loop and the rect filter passing over nothing.
    expect(grid.size, 'the grid is not 5 presets x 8 widths x 7 depths').toBe(280);

    // Every cell has a door, or `navigabilityCost` is answering 0 for a reason that
    // has nothing to do with the floor and the whole grid is decoration.
    for (const r of grid.values()) expect(r.doors, `${r.layout} ${r.w}x${r.d} seeded no door`).toBeGreaterThan(0);

    // `expect.soft` from here down, and it is not a style choice. A hard `expect` ends
    // its test at the first failure, so these would be reported one per run — and a
    // mutation pass that can only see its first kill cannot tell an assertion that is
    // load-bearing from one that was masked by the assertion above it. That is how a
    // decorative assertion survives a ledger: never by passing, but by never being
    // reached. The door loop stays hard, because a room with no door makes every line
    // below it meaningless rather than false.
    //
    // Each `=== 0` pin is a PAIR: the raw quantity and `analyzeRoom`'s own verdict on
    // the same room. `navigabilityCost` returns 0 both for a room that strands nothing
    // and for one whose door is walled in (`layout-score.ts:1015`), and that second
    // case is per-room — a door count cannot see it and the negative controls, being
    // other rooms, only catch it when it is global. The report can: its `reach`,
    // `walk` and `door` rules all fire on a sealed-in door. The grid was already
    // computing these findings for all 280 cells and throwing them away.
    const clean = (r: Row, why: string) => {
      expect.soft(r.stranded, why).toBe(0);
      expect.soft(r.findings, `${why} — and the report says so`).toEqual([]);
    };

    // **The rectangle never strands, at any of the 56 sizes.** The one clean statement
    // in the whole grid, and the reason the prose's depth threshold looked plausible:
    // it is true of the preset anybody checks first.
    const rectStranded = [...grid.values()].filter((r) => r.layout === 'rect' && r.stranded > 0);
    expect.soft(rectStranded.map((r) => `${r.w}x${r.d}`), 'the rect stranded floor').toEqual([]);

    // **Not monotonic in area.** A BIGGER L strands where a smaller one does not, so
    // "too small for its furniture" — § G.1's stated hypothesis, and the reason its
    // suggested fix was "place fewer pieces" — is the wrong reading of the surface.
    clean(cell('l', 4.0, 3.4), 'the small L stranded');
    expect.soft(cell('l', 4.0, 5.0).stranded, 'the larger L stopped stranding').toBeGreaterThan(0);

    // **Not part count either.** Two U's with the SAME furniture in them, one
    // stranding and one not — so nothing is being over-furnished.
    expect.soft(cell('u', 5.6, 4.2).parts, 'the two U rows stopped seeding the same room').toBe(
      cell('u', 5.6, 4.6).parts,
    );
    expect.soft(cell('u', 5.6, 4.2).stranded, 'the shallow U stopped stranding').toBeGreaterThan(0);
    clean(cell('u', 5.6, 4.6), 'the deeper U started stranding');

    // **And not depth, which is what the first version of this file claimed.** One
    // depth, two widths, opposite answers — and the stranded one is the WIDER room.
    // This is the assertion the retracted sentence would have had to survive.
    clean(cell('t', 4.0, 4.6), 'the narrow T at 4.6 stranded');
    expect.soft(cell('t', 7.5, 4.6).stranded, 'the wide T at 4.6 stopped stranding').toBeGreaterThan(0);

    // 280 cells, each a full build plus a clearance field, so this is ~5 s of real
    // work — and ~20 s on a machine running the rest of the suite beside it, which is
    // what this override is still for. It is no longer for the reason first written
    // here. That reason was "vitest's DEFAULT 5 s `testTimeout`, a bound nobody chose,
    // since `vitest.config.ts` sets none at all", and it argued *against* raising the
    // global on the grounds that the other 117 files should not inherit a longer
    // leash. § A.4 then measured what that default was actually doing and the argument
    // lost: three `layout-solve` tests were dying on it with nothing wrong, two of them
    // asserting nothing about a clock. The global is 30 s now and is a hang-catcher
    // rather than a budget. This test keeps its own number because 40 s is a *grid's*
    // allowance and not everyone's.
  }, 40000);
});
