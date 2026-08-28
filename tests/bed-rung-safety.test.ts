import { describe, expect, it } from 'vitest';
import { defaultScene, BED_LADDER, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';
import { prepare, costBreakdown, DEFAULT_WEIGHTS, NAV_CELL } from '@/lib/layout-score';
import { solveLayout } from '@/lib/layout-solve';
import type { LayoutContext } from '@/lib/layout-score';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Scramble exactly as `layout-solve`'s bedroom test does, so the two are
 *  measuring the same room and a number can be carried between them. */
const scramble = (parts: ReturnType<typeof defaultScene>) =>
  parts.map((q, i) =>
    q.wallMounted
      ? { ...q }
      : {
          ...q,
          pos: [-q.pos[0] * 0.8 + (i % 3) * 0.4, q.pos[1], -q.pos[2] * 0.7] as [number, number, number],
          rot: q.rot + 0.6,
        },
  );

/** The safety terms — the ones that mean "this room does not work", as opposed to
 *  "this room is untidy". `alignment`, `balance`, `middle` and `inertia` are
 *  preferences; these five are the ones `lib/clearance.ts` would report to the
 *  user as findings.
 *
 *  `door` is in here even though dropping it survives mutation TODAY, and the
 *  reason is worth keeping rather than tidying: at U 6x5 the shipped Single blocks
 *  no door (so the per-seed gate below is unaffected) and both wider rungs are
 *  already unsafe on `navigation` alone (so the x10 comparison is unaffected). The
 *  door fact for this room is pinned directly instead, by reading `r.door` rather
 *  than through here. What this term guards is a room this file does not yet
 *  measure — a ladder change that put the SHIPPED bed across a doorway. A survivor
 *  that is explained is not the same as a check that cannot fail, but the
 *  difference has to be written down or the next sweep deletes it. */
const dangerOf = (r: Record<string, number>) =>
  r.overlap + r.outside + r.door + r.navigation + r.walkway;

const solveAll = (
  dim: [number, number, number],
  w: number,
  d: number,
) => {
  const poly = footprintForLayout('u', w, d);
  const base = defaultScene('u', w, d, { footprint: poly, height: 2.8 });
  const parts = base.map((q) => (q.category === 'bed' ? { ...q, dimMM: dim } : q));
  const messy = scramble(parts);
  const model = prepare({
    parts: messy,
    movable: messy.map((q) => !q.wallMounted),
    footprint: poly,
  } as LayoutContext);
  return SEEDS.map((seed) =>
    costBreakdown(
      model,
      solveLayout(messy, poly, messy.map(() => false), { seed }).placements,
      DEFAULT_WEIGHTS,
      NAV_CELL,
    ) as unknown as Record<string, number>,
  );
};

/** Why the bed ladder has to be allowed to come DOWN a rung, measured.
 *
 *  `BED_LADDER` walks widest-first and takes the first rung that places, and the
 *  staged chooser prefers the widest rung whose plan strands nothing. It is easy
 *  to read that as timidity — a 6x5 m room sounds big enough for a double — so
 *  this file is the evidence that it is not. At U 6x5 the room's usable bays are
 *  cut by the U's notch, and anything wider than a single either seals a route or
 *  parks itself across the door.
 *
 *  It prints the table on every green run (the `detect-pipeline` precedent), because
 *  the interesting thing here is the SHAPE of the trade and not the pass: the wider
 *  beds are TIDIER in the median and catastrophic in the tail, which is exactly the
 *  trade `roomProfile.anchor` exists to make and the reason
 *  `layout-solve`'s median bar cannot be read as a quality target on its own. */
describe('the bed ladder comes down a rung when the room cannot take a wider one', () => {
  // The sweep is one measurement read by all three tests below, so it is taken once
  // and memoised. It has to live out here for a second reason: the first test is RED
  // on its danger assertion, and an `expect` parked after a failing one in the same
  // `it` never runs — it cannot even be mutation-checked. The original single test
  // had the door facts and the alignment fact sitting behind that failure, so three
  // assertions were unreachable. One fact per test instead.
  type Row = {
    label: string;
    width: number;
    worst: number;
    median: number;
    danger: number;
    door: number;
    align: number;
  };
  let ROWS: Row[] | null = null;
  const sweep = (): Row[] => {
    if (ROWS) return ROWS;
    const rows = BED_LADDER.map((rung) => {
      const runs = solveAll(rung.dim, 6, 5);
      const totals = runs.map((r) => r.total).sort((a, b) => a - b);
      return {
        label: rung.label,
        width: rung.dim[0],
        worst: Math.max(...totals),
        median: totals[6],
        danger: runs.reduce((a, r) => a + dangerOf(r), 0),
        door: runs.reduce((a, r) => a + r.door, 0),
        align: runs.reduce((a, r) => a + r.alignment, 0),
      };
    });

    console.log('\n  U 6x5, 12 seeds, bed rung swept — safety vs tidiness');
    console.log('  rung          width     worst    median    Σdanger      Σdoor    Σalign');
    for (const r of rows) {
      console.log(
        `  ${r.label.padEnd(12)} ${String(r.width).padStart(5)} ${r.worst.toFixed(2).padStart(9)} ${r.median
          .toFixed(2)
          .padStart(9)} ${r.danger.toFixed(2).padStart(10)} ${r.door.toFixed(2).padStart(10)} ${r.align
          .toFixed(1)
          .padStart(9)}`,
      );
    }
    ROWS = rows;
    return rows;
  };


  // The room as it SHIPS - no forced rung - memoised for the same reason `sweep` is:
  // it costs twelve solves, and it is now read by three tests rather than one. Those
  // three used to be one `it`, and two of its assertions could never execute because
  // the one between them fails by design. A red assertion nobody can observe is the
  // same defect as a green one that cannot fail.
  let SHIPPED: { bed: ScenePart | undefined; runs: Record<string, number>[] } | null = null;
  const shipped = () => {
    if (SHIPPED) return SHIPPED;
    const poly = footprintForLayout('u', 6, 5);
    const base = defaultScene('u', 6, 5, { footprint: poly, height: 2.8 });
    const bed = base.find((q) => q.category === 'bed');
    const messy = scramble(base);
    const model = prepare({
      parts: messy,
      movable: messy.map((q) => !q.wallMounted),
      footprint: poly,
    } as LayoutContext);
    const runs = SEEDS.map(
      (seed) =>
        costBreakdown(
          model,
          solveLayout(messy, poly, messy.map(() => false), { seed }).placements,
          DEFAULT_WEIGHTS,
          NAV_CELL,
        ) as unknown as Record<string, number>,
    );
    SHIPPED = { bed, runs };
    return SHIPPED;
  };

  // -- The ladder's SHAPE, in its own test and deliberately so -----------------
  //
  // These were the premises of every assertion below, and they sat inside the `it`
  // that is red by design - so they could not signal. Two mutations proved the
  // silence: truncating `BED_LADDER` to one rung, and adding a 2600 mm rung, BOTH
  // reported the identical failures as an unmutated run. A guard that cannot be heard
  // is not a guard, however correct it is.
  it('the ladder is Queen / Double / Single, widest first', () => {
    const rows = sweep();
    // A LITERAL, not `BED_LADDER.length`. Deriving the expected count from the array
    // being counted is the self-referential assertion that cannot fail: deleting the
    // Queen rung left `wider.length > 0` green, because Double is still wider than
    // Single. Three rungs is a decision - change it here on purpose.
    expect(BED_LADDER.length, 'the ladder is Queen / Double / Single').toBe(3);
    expect(rows.length, 'and the sweep covers every rung').toBe(3);
    expect(rows.slice(0, -1).length).toBe(2);
    // Widest first, so the sweep's last row really is the narrowest.
    expect(rows[rows.length - 1].width).toBe(Math.min(...rows.map((r) => r.width)));
    expect(rows[0].width).toBe(Math.max(...rows.map((r) => r.width)));
  }, 180_000);

  // RED BY DESIGN - see section F of `docs/what-is-still-open.md`.
  //
  // Not a mis-set threshold. `narrowest.danger` is 80.70 and every unit of it is
  // `navigation`, on ONE seed of the twelve - seed 5. The other eleven are 0.00 on
  // all five danger terms, and the unscrambled starter room is nav 0.00 / total 3.57.
  // At seed 5 `solveLayout` is handed navigation 26.40 and returns 80.70.
  //
  // What that 80.70 actually IS, measured rather than inferred: `navigabilityCost`
  // returns square metres of floor a person coming through the door cannot reach,
  // plus `STRANDED_PIECE = 2` for each piece nobody can get to, and the weight is
  // 120. So 80.70 / 120 = 0.6725 raw, which is below 2 - therefore NO piece is
  // stranded, and the whole of it is ~0.67 m2 of cut-off floor, about an 0.8 m
  // square. It is a stranded pocket, not a sealed room. The first version of this
  // note said "the route seals", which was read off the placement coordinates rather
  // than off the term that produces the number.
  //
  // Still a finding: `lib/clearance.ts` reports unreachable floor by name, and the
  // per-seed test below says in as many words that no seed may produce one. Raising
  // the bar would ship it with nothing left to find it again.
  //
  // This file has NEVER been green - it failed at `2e3367d`, the commit that added
  // it, with total danger 86.10 for the same reason. Read no assertion here as having
  // once held.
  it('refuses, at U 6x5, the rung that ships being unsafe at all', () => {
    const rows = sweep();
    expect(rows.length).toBe(3);
    expect(rows[rows.length - 1].danger).toBeLessThan(10);
  }, 180_000);

  // RED BY DESIGN, and red for the same single seed. 80.70 x 10 = 807 clears both
  // wider rungs' 700.20 and 430.20, so this cannot pass while seed 5 stands. Split
  // out of the test above because behind that failure it could not run at all.
  //
  // The assertion is not "the wider bed scores worse" but "the wider bed produces the
  // kind of failure the user would be shown as a finding".
  it('...and every rung above it unsafe by an order of magnitude', () => {
    const rows = sweep();
    expect(rows.length).toBe(3);
    const narrowest = rows[rows.length - 1];
    for (const r of rows.slice(0, -1)) {
      expect(r.danger, `${r.label} at U 6x5 should be unsafe`).toBeGreaterThan(narrowest.danger * 10);
    }
  }, 180_000);

  // The door, and this is where the round that wrote this file got it wrong. The
  // claim was "the WIDEST rung parks across the doorway", pinned as
  // `rows[0].door > 50`. Total door cost is 0.00 on all three rungs, and was 0.00 at
  // `2e3367d`, the commit that introduced this sweep - so that assertion never passed
  // and no committed state ever made it true. What separates the rungs at this room
  // is `navigation` alone (700.20 / 430.20 / 80.70).
  //
  // `door` stays inside `dangerOf` regardless, for the reason its own comment gives:
  // it guards a ladder change that put the shipped bed across a doorway. But a term
  // that reads 0 everywhere is indistinguishable from a term that is not wired up, so
  // the fact is pinned in BOTH directions - 0 on every rung here, and a bed actually
  // parked on the door scoring far above the gate.
  //
  // The zeros loop is a mutation SURVIVOR and that is written down rather than
  // hidden. Adding a 2600 mm rung - 1000 mm wider than the Queen - still gives total
  // door cost 0.00, so this loop cannot tell a solver that protects the door from one
  // blind to it at this room. The negative control is the assertion carrying the
  // weight: it goes red on `DEFAULT_WEIGHTS.door = 0`. Keep the pair.
  //
  // The `rows.length` line is not ceremony: without it, truncating `BED_LADDER` to a
  // single rung leaves this loop asserting over one row and still green.
  it('the door term is live, and no rung blocks the door at U 6x5', () => {
    const rows = sweep();
    expect(rows.length, 'over every rung, not whatever the sweep happened to return').toBe(3);
    for (const r of rows) {
      expect(r.door, `${r.label} does not block the door at U 6x5`).toBe(0);
    }
    const poly = footprintForLayout('u', 6, 5);
    const base = defaultScene('u', 6, 5, { footprint: poly, height: 2.8 });
    const door = base.findIndex((q) => q.category === 'door');
    const bed = base.findIndex((q) => q.category === 'bed');
    expect(door, 'this room seeds a door at all').toBeGreaterThanOrEqual(0);
    expect(bed, 'and a bed').toBeGreaterThanOrEqual(0);
    const m = prepare({
      parts: base,
      movable: base.map((q) => !q.wallMounted),
      footprint: poly,
    } as LayoutContext);
    const at = base.map((q) => ({ x: q.pos[0], z: q.pos[2], yaw: q.rot }));
    const onDoor = at.map((q, i) =>
      i === bed ? { x: base[door].pos[0], z: base[door].pos[2], yaw: 0 } : q,
    );
    const hit = costBreakdown(m, onDoor, DEFAULT_WEIGHTS, NAV_CELL) as unknown as Record<string, number>;
    // Worth naming what this does and does not prove: a bed centred ON the doorway is
    // also half through the wall, so that layout scores `outside` 333.33 as well. It
    // demonstrates the door term is WIRED, not that a bed standing inside the room
    // across a doorway would clear 50.
    expect(hit.door, 'the door term is live, so the zeros above are a fact about the room').toBeGreaterThan(50);
  }, 180_000);

  // And the direction of the trade. The round that wrote this file had it BACKWARDS:
  // it said the safe choice is the untidy one, that "median total is lower for a wider
  // bed even as its tail explodes", and warned a median bar would select the dangerous
  // rung. Measured, the medians run 47.73 / 16.26 / 13.73 - the narrowest rung is the
  // TIDIEST as well as the safest, and no such trade exists at this room.
  //
  // What survives is narrower: the safe rung pays in `alignment` specifically
  // (32.7 / 62.1 / 68.0), because a single bed leaves slack its neighbours settle into
  // off-axis. That is a preference term, not a finding, which is the whole reason it
  // may lose to `navigation`.
  //
  // `Math.max(...[])` is `-Infinity`, so without the length guard this passes
  // vacuously the moment the ladder has one rung - any finite number beats -Infinity.
  it('the safe rung pays for it in alignment, and that is a preference not a finding', () => {
    const rows = sweep();
    expect(rows.length).toBe(3);
    const wider = rows.slice(0, -1);
    expect(wider.length, 'or Math.max over an empty list passes on -Infinity').toBe(2);
    expect(rows[rows.length - 1].align, 'the safe rung pays for it in alignment').toBeGreaterThan(
      Math.max(...wider.map((r) => r.align)),
    );
  }, 180_000);

  it('the room as it ships comes down to the narrowest rung', () => {
    const { bed } = shipped();
    expect(bed, 'a U 6x5 must seed a bed at all').toBeTruthy();
    expect(bed!.dimMM[0]).toBe(BED_LADDER[BED_LADDER.length - 1].dim[0]);
  }, 180_000);

  // RED BY DESIGN - the same seed 5, from the ladder's side. `layout-solve`'s own bar
  // is 40 and this asserts the same property here, so a ladder change that wrecked
  // the tail cannot be green in one file and red only in the other.
  it('still keeps the worst case bounded once the ladder has chosen', () => {
    const { runs } = shipped();
    expect(SEEDS.length).toBe(12);
    expect(runs.length).toBe(12);
    expect(Math.max(...runs.map((r) => r.total))).toBeLessThan(40);
  }, 180_000);

  // RED BY DESIGN, and this is the one that says what "no disaster" means - a
  // stronger statement than any bound on a total, and it names the seed. It was
  // unreachable behind the bound above until this split: `seed 5 must strand nothing:
  // expected 80.70 to be less than 5`. FOUR assertions in this file are red, not two,
  // and that only became visible once each got its own test.
  it('and no seed produces a finding at all', () => {
    const { runs } = shipped();
    expect(runs.length).toBe(12);
    for (const [i, r] of runs.entries()) {
      expect(dangerOf(r), `seed ${SEEDS[i]} must strand nothing`).toBeLessThan(5);
    }
  }, 180_000);
});
