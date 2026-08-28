import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PART_LIBRARY, BED_LADDER, SHAPES } from '@/lib/scene-spec';
import { clampDims, dimRangeFor } from '@/lib/dimension-ranges';

/** Every shipped preset must survive its own clamp.
 *
 *  `clampDims` is rule 2's trust boundary: no size reaches the scene without
 *  passing through it. So a catalog entry whose own `dimMM` falls outside its own
 *  band is not a harmless inconsistency — it means **pressing Add in the Library
 *  silently gives you a different piece of furniture than the one you pressed**,
 *  which is the exact thing rule 2's second half forbids. There is no message,
 *  because the clamp is behaving correctly; the data disagrees with itself.
 *
 *  This is a SWEEP over the whole catalog rather than the beds it was written for,
 *  for the reason this repo keeps relearning: choosing examples is how the first
 *  version misses the case. It is also cheap — 43 entries, one clamp each.
 *
 *  ── Why it exists ──
 *
 *  `tests/query-size-refusal.test.ts` states in a comment that "every shipped
 *  preset sits inside its own range", and leans on it: it needs a synthetic
 *  out-of-band entry to test the unnamed-axis path *because* no real one exists.
 *  That was an assumption nothing checked, and it was **false for three of the
 *  four beds**. With the bed bands as they stood, adding from the Library gave:
 *
 *      Single bed  [900,2000,600]  ->  [1700,1200,600]   1.7 m wide, 1.2 m long
 *      Double bed  [1400,2000,600] ->  [1800,2000,600]   becomes a King
 *      Queen bed   [1600,2000,600] ->  [1800,2000,600]   becomes a King
 *
 *  A Double and a Queen collapsing onto the same size, and a single rebuilt into
 *  something wider than it is long. The bands' first two slots were transposed
 *  relative to the catalog: `bed-single` read `[1700, 800, …]`–`[2100, 1200, …]`,
 *  so slot 0 demanded 1700–2100 of a piece whose authored slot 0 is 900.
 *
 *  ── What is and is not evidence for the axis, because this took two sessions ──
 *
 *  The only **independent** evidence is the geometry, and it is decisive.
 *  `BedGeo` (`components/three/DynamicPart.tsx`) is byte-identical on every ref,
 *  so it owes nothing to any branch:
 *
 *      <Box size={[w, h * 1.4, 0.05]} position={[0, h * 0.7, -d / 2]} />
 *
 *  A 5 cm slab spanning the **full w**, standing at **z = −d / 2**. That is a
 *  headboard: it spans a bed's width and stands at its head. The pillows agree —
 *  two of them at `x = ∓w * 0.22`, laid side by side **across x**, at
 *  `z = −d * 0.3` — and so does the duvet, `d * 0.66` of it draped toward
 *  `+d * 0.15`, the foot. So **slot 0 is the width, slot 1 is the length, and the
 *  head is at −Z.**
 *
 *  A second independent confirmation comes from a consumer that cannot see the
 *  range table at all: `layout-rules.ts` gives a bed access zones on
 *  `['left', 'right']` — the ±X faces — described as "the bedside strip you need
 *  to get in and make the bed". With slot 0 as the width, the *short* extent, the
 *  ±X faces are the bed's LONG sides, which is what a bedside is. (That inference
 *  inverts easily and did: ±X being the *face* you approach from is not ±X being
 *  the *long* extent.)
 *
 *  What is **not** evidence: the note above `BED_LADDER` saying width is the axis
 *  that separates the rungs. `BED_LADDER` does not exist on `origin/main` at all —
 *  it arrives with the same change that corrects the beds — so quoting it is
 *  quoting the change to justify itself. It was cited that way once here and it
 *  was circular.
 *
 *  ── The limit of the sweep above, which is the whole reason for the test below ──
 *
 *  The sweep asserts no convention. That is deliberate — a second copy of the
 *  convention is what drifted in the first place — but it means the sweep can only
 *  see the two tables **disagreeing**. When the catalog and the bands are
 *  transposed *together*, they agree, nothing clamps, and it passes. That is the
 *  state of `origin/main`: beds `[1900, 1000, 600]` against bands
 *  `[1700, 800, …]`–`[2100, 1200, …]`, consistent with each other and wrong. So
 *  this file's first test **would pass on main**, and anyone reading it as a guard
 *  against mis-shaped beds would be wrong.
 *
 *  It is the self-referential assertion in its subtlest form: both sides of the
 *  comparison are drawn from the same convention, so the comparison cannot see
 *  that convention being wrong. The fix is an assertion whose other side comes
 *  from somewhere that does not share it — the renderer — which is what
 *  `a bed is longer than it is wide` below does.
 *
 *  Mutations observed failing: restore the three bed rows to their transposed form
 *  and the sweep goes red naming all three with before/after sizes; restore the
 *  catalog's beds to `origin/main`'s values and the proportion test goes red while
 *  the sweep stays green, which is the whole point of having both. */
describe('every shipped preset survives its own clamp', () => {
  it('leaves all of PART_LIBRARY unchanged', () => {
    const bad: string[] = [];
    for (const item of PART_LIBRARY) {
      const got = clampDims(item.category, item.shape, [...item.dimMM] as [number, number, number]);
      if (got.every((v, i) => v === item.dimMM[i])) continue;
      const r = dimRangeFor(item.category, item.shape);
      bad.push(
        `  ${item.label.padEnd(16)} ${item.category}/${item.shape}  ` +
          `[${item.dimMM.join(',')}] -> [${got.join(',')}]  ` +
          `bands ${r.min[0]}-${r.max[0]} / ${r.min[1]}-${r.max[1]} / ${r.min[2]}-${r.max[2]}`,
      );
    }
    // Printed on every green run, the way `detect-pipeline.test.ts` reports its
    // measurement — a count that only appears when it is already too late is a
    // count nobody is watching.
    console.log(`\n  catalog entries: ${PART_LIBRARY.length}   rebuilt by their own clamp: ${bad.length}`);
    if (bad.length) console.log(bad.join('\n') + '\n');
    // Assert the COUNT, or this sweep passes over an empty catalog.
    expect(PART_LIBRARY.length).toBeGreaterThan(20);
    expect(bad, `presets the Library rebuilds on add:\n${bad.join('\n')}`).toEqual([]);
  });

  /** A bed is longer than it is wide, and `BedGeo` is who says so.
   *
   *  This is the assertion the sweep above cannot make, and the only one here whose
   *  two sides come from independent places: the catalog's numbers, against the
   *  renderer's own use of those slots. `BedGeo` puts a full-`w` headboard at
   *  `z = −d / 2` and lays the pillows side by side across `x`, so `w` is the width
   *  and `d` is the length — and no mattress standard has a bed wider than it is
   *  long.
   *
   *  On `origin/main` every bed fails this: `Single [1900, 1000, 600]` renders a
   *  1.9 m headboard on a bed 1.0 m long, with a 95 cm pillow and nowhere to lie
   *  down. **Every bed in the app is rotated 90°**, and it passes every other gate
   *  because the bands are transposed to match. It is the only defect found in this
   *  whole exchange that a user can see without opening devtools, and neither
   *  session found it by looking at beds — both of us were arguing about a range
   *  table. */
  it('ships no bed wider than it is long — the axis the renderer actually uses', () => {
    const beds = PART_LIBRARY.filter((i) => i.category === 'bed');
    expect(beds.length).toBeGreaterThan(3);
    for (const b of beds) {
      expect(
        b.dimMM[1],
        `${b.label} is ${b.dimMM[0]} mm wide and ${b.dimMM[1]} mm long — BedGeo would give it a ` +
          `${b.dimMM[0]} mm headboard at the head of a ${b.dimMM[1]} mm bed`,
      ).toBeGreaterThan(b.dimMM[0]);
    }
  });

  /** The seeded room and the Library have to agree about what a Queen is, so the
   *  ladder goes through the same clamp, and by the same argument: a rung the clamp
   *  rebuilds seeds a bedroom with a bed nobody asked for, and the solver then
   *  scores a room that is not the room it was handed. */
  it('leaves every BED_LADDER rung unchanged too', () => {
    expect(BED_LADDER.length).toBe(3);
    for (const rung of BED_LADDER) {
      const got = clampDims('bed', rung.shape, [...rung.dim] as [number, number, number]);
      expect(got, `${rung.label} is rebuilt by its own clamp`).toEqual(rung.dim);
    }
    // Width is the separating axis, so the rungs must be strictly ordered on slot
    // 0 and constant on slot 1. This is the one place the convention IS asserted,
    // because the ladder's own doc comment states it and a ladder that is not
    // ordered is not a ladder.
    for (let i = 1; i < BED_LADDER.length; i++) {
      expect(BED_LADDER[i].dim[0]).toBeLessThan(BED_LADDER[i - 1].dim[0]);
      expect(BED_LADDER[i].dim[1]).toBe(BED_LADDER[0].dim[1]);
    }
  });

  /** The BANDS on the same axis as the catalog, which the sweep at the top of this
   *  file cannot see.
   *
   *  That sweep asks whether the catalog agrees with the bands, and both were
   *  transposed together, so it was green on `origin/main` — the self-referential
   *  check this file's own docblock is about. The catalog half is grounded on the
   *  renderer above. This is the other half, and it is the assertion that makes the
   *  fix un-revertable: three fixtures elsewhere in this suite hand-write a correct
   *  bed and pass in BOTH worlds, so without this there is nothing anywhere that
   *  tells the two worlds apart.
   *
   *  BOTH ENDS, and that is the `boundsToUnit` argument rather than thoroughness for
   *  its own sake: a range is an interval and neither end alone can tell you whether
   *  the interval means what it says. A transposition flips both, but a half-applied
   *  fix flips one — and a band whose min is `[800, 1700]` against a max of
   *  `[2100, 1200]` is inverted on both axes at once, which `clampDims` would
   *  resolve by applying whichever bound it applies second.
   *
   *  Swept over `SHAPES` rather than naming `bed-single` and `bed-double`, because
   *  the transposition was in three rows — those two and the `bed` category
   *  fallback — and naming examples is how the first version of this arithmetic
   *  missed 890 mm. */
  it('states every bed band on the same axis as the catalog, at both ends', () => {
    // `'bed'` is a CATEGORY and not a shape, so the third transposed row is not
    // reachable by filtering `SHAPES` — it is `BY_CATEGORY.bed`, which
    // `dimRangeFor` returns for any GENERIC shape. `'box'` is one, and it is also
    // what a detection that never got refined actually carries, so the fallback row
    // is a live path rather than a table entry nothing reads. Writing this as
    // `SHAPES.filter(s => s === 'bed' || ...)` is how I first wrote it, and it
    // asserted over two rows of three while looking like it swept all of them.
    const bedShapes = SHAPES.filter((sh) => sh.startsWith('bed-'));
    expect(bedShapes.length, 'no bed shapes in SHAPES any more').toBeGreaterThanOrEqual(2);
    for (const shape of [...bedShapes, 'box' as const]) {
      const r = dimRangeFor('bed', shape);
      for (const [end, v] of [['min', r.min], ['max', r.max]] as const) {
        expect(
          v[1],
          `the ${shape} band's ${end} is ${v[0]} mm wide by ${v[1]} mm long — a bed cannot be ` +
            `wider than it is long at either end of its own range`,
        ).toBeGreaterThan(v[0]);
      }
    }
  });

  /** The grep half of CLAUDE.md rule 5, as an assertion.
   *
   *  Six fixtures across three files carried `[2000, 1600, 600]` — a double bed 2.0 m
   *  wide and 1.6 m long — and a seventh carried `[1900, 1000, 600]`. **Every one of
   *  them passed both before and after the axes were swapped**, because none was
   *  load-bearing for its own assertion. That is exactly why no runner could ever
   *  find them: a stale fixture that still passes is invisible to the only tool
   *  anybody runs.
   *
   *  It is a scan over source and not an import, deliberately, because the subject
   *  is what OTHER test files hand-write — there is nothing to import. The reason it
   *  sweeps rather than lists is measured: two independent greps were run for these
   *  literals during one exchange and the more careful one found ONE of the seven.
   *  A list of known sites would have been that grep, frozen. */
  it('lets no test in this suite hand-write a bed wider than it is long', () => {
    const dir = join(process.cwd(), 'tests');
    const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts'));
    expect(files.length, 'the suite directory came back nearly empty').toBeGreaterThan(20);

    const bad: string[] = [];
    let seen = 0;
    for (const f of files) {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Comments are skipped so that the prose in this very file — which quotes
        // `[1900, 1000, 600]` as the defect — is not read as a fixture. A negative
        // assertion that reads its own explanation fails on the explanation.
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*')) return;
        // A DETECTION's `dimMM` is excluded, and that is rule 2 rather than an
        // exception to this test: a detection carries the AI's raw hint, which is
        // allowed to be nonsense — being nonsense is what `clampDims` and
        // `judgeLabel` exist to answer. `label-repair.test.ts` hands `judgeLabel` a
        // bed of `[1900, 1234, 600]` precisely so that `1234` can be shown to have
        // been recomputed; it is a sentinel, not a bed. This sweep found it on its
        // first run, which is the sweep working — and reading it as a stale fixture
        // would have deleted a real assertion to make a new one look right.
        if (code.includes('det({')) return;
        if (!/category: 'bed'|shape: 'bed/.test(code)) return;
        const m = /dimMM: \[(\d+), *(\d+), *\d+\]/.exec(code);
        if (!m) return;
        seen += 1;
        if (Number(m[2]) <= Number(m[1])) bad.push(`  ${f}:${i + 1}  ${code}`);
      });
    }
    // The count, so this cannot pass by matching nothing — the regex is three
    // alternations away from silently finding no bed fixtures at all.
    expect(seen, 'no bed fixtures matched — has `dimMM: [` been reformatted?').toBeGreaterThan(8);
    expect(bad, `bed fixtures still on the pre-fix axis:\n${bad.join('\n')}`).toEqual([]);
  });
});
