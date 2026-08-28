import { describe, expect, it } from 'vitest';
import { defaultScene, BED_LADDER } from '@/lib/scene-spec';
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
  it('refuses, at U 6x5, every rung above the one that ships', () => {
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

    // The ladder is authored widest-first, so the LAST entry is the narrowest and
    // is the one that ships here. Derived from the table, not named.
    const narrowest = rows[rows.length - 1];
    const wider = rows.slice(0, -1);
    // A LITERAL, not `BED_LADDER.length`. Deriving the expected count from the
    // array being counted is the self-referential assertion that cannot fail:
    // deleting the Queen rung left `wider.length > 0` green, because Double is
    // still wider than Single. Three rungs is a decision — change it here on
    // purpose.
    expect(BED_LADDER.length, 'the ladder is Queen / Double / Single').toBe(3);
    expect(wider.length).toBe(2);
    // Widest first, so the sweep's last row really is the narrowest.
    expect(narrowest.width).toBe(Math.min(...rows.map((r) => r.width)));
    expect(rows[0].width).toBe(Math.max(...rows.map((r) => r.width)));

    // The narrowest rung is safe…
    expect(narrowest.danger).toBeLessThan(10);
    // …and every wider rung is not, by an order of magnitude. This is the
    // assertion: not "the wider bed scores worse" but "the wider bed produces the
    // kind of failure the user would be shown as a finding".
    for (const r of wider) {
      expect(r.danger, `${r.label} at U 6x5 should be unsafe`).toBeGreaterThan(narrowest.danger * 10);
    }

    // The door specifically, because `Σdanger` alone does not pin it: the Double's
    // 453.6 is navigation, so a `dangerOf` that quietly stopped counting `door`
    // still passed every assertion above. The WIDEST rung is the one that parks
    // across the doorway, and that is the concrete thing a reader needs to believe
    // — a bed you cannot walk past is the failure `lib/clearance.ts` reports by
    // name, not a score.
    expect(rows[0].door, 'the widest rung blocks the door at U 6x5').toBeGreaterThan(50);
    expect(narrowest.door, 'the shipped rung does not').toBe(0);

    // And the direction of the trade, which is the part that makes
    // `layout-solve`'s median bar unreadable in isolation: the SAFE choice is the
    // UNTIDY one. Median total is lower for a wider bed even as its tail explodes,
    // so a median bar tightened against this room would select for the dangerous
    // rung.
    expect(narrowest.align, 'the safe rung pays for it in alignment').toBeGreaterThan(
      Math.max(...wider.map((r) => r.align)),
    );
  }, 180_000);

  it('still keeps the worst case bounded once the ladder has chosen', () => {
    // The guarantee `roomProfile.anchor` is actually for, on the room as it SHIPS
    // (no forced rung). `layout-solve`'s own bar is 40; this asserts the same
    // property from the ladder's side so a ladder change that wrecked the tail
    // cannot be green here and red only over there.
    const poly = footprintForLayout('u', 6, 5);
    const base = defaultScene('u', 6, 5, { footprint: poly, height: 2.8 });
    const bed = base.find((q) => q.category === 'bed');
    expect(bed, 'a U 6x5 must seed a bed at all').toBeTruthy();
    // The narrowest rung, which the sweep above proves is the only safe one.
    expect(bed!.dimMM[0]).toBe(BED_LADDER[BED_LADDER.length - 1].dim[0]);

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
    expect(SEEDS.length).toBe(12);
    expect(Math.max(...runs.map((r) => r.total))).toBeLessThan(40);
    // No seed may produce a finding — this is what "no disaster" means, and it is
    // a stronger statement than any bound on the total.
    for (const [i, r] of runs.entries()) {
      expect(dangerOf(r), `seed ${SEEDS[i]} must strand nothing`).toBeLessThan(5);
    }
  }, 180_000);
});
