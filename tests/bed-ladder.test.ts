// What bed a starter bedroom actually gets, across the whole size range — and a
// report printed on every green run, not just a gate.
//
// The five `'u'` assertions in `scene-seed.test.ts` are five chosen sizes. They all
// went green the moment `SeedPlan.bedRung` let the plan search start further down
// the ladder, and that green would have been the end of it. Sweeping instead shows
// behaviour those five cannot see: a 6 × 4 U gets NO BED at all, and depth and bed
// width are not monotonic. Neither is asserted as correct below, because neither
// has been decided — they are printed, and the ONE thing that can be stated is.
//
// The precedent is `detect-pipeline.test.ts`, which exists to report a measurement
// on every run rather than to pass. That is also why `pnpm test` carries
// `--disableConsoleIntercept`: vitest 4 discards `console.log` from a passing run,
// and a table printed to nobody is not a measurement.
import { describe, it, expect } from 'vitest';
import { defaultScene, PART_LIBRARY } from '../lib/scene-spec';

/** Every bed size the Library ships, as `w×l` keys. */
const CATALOG_BEDS = new Set(
  PART_LIBRARY.filter((i) => i.category === 'bed').map((i) => `${i.dimMM[0]}x${i.dimMM[1]}`),
);

type Row = { w: number; d: number; label: string; key: string | null };

function sweep(): Row[] {
  const rows: Row[] = [];
  for (let w = 40; w <= 80; w += 5) {
    for (let d = 40; d <= 80; d += 5) {
      const bed = defaultScene('u', w / 10, d / 10).find((p) => p.category === 'bed');
      rows.push({
        w: w / 10,
        d: d / 10,
        label: bed?.name ?? 'NO BED',
        key: bed ? `${bed.dimMM[0]}x${bed.dimMM[1]}` : null,
      });
    }
  }
  return rows;
}

describe('the bed a starter bedroom gets', () => {
  const rows = sweep();

  it('reports the rung chosen at every U size', () => {
    const placed = rows.filter((r) => r.key);
    const byLabel = new Map<string, number>();
    for (const r of rows) byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + 1);
    console.log(
      [
        `U bed ladder over ${rows.length} sizes (4.0-8.0 m, 0.5 m step):`,
        ...[...byLabel.entries()].map(([l, n]) => `  ${l.padEnd(12)} ${n}`),
        `  bedless sizes: ${rows.filter((r) => !r.key).map((r) => `${r.w}x${r.d}`).join(', ') || 'none'}`,
      ].join('\n'),
    );
    expect(placed.length).toBeGreaterThan(0);
  });

  it('never seeds a bed the Library does not sell', () => {
    // The real invariant, and the reason the ladder is a table rather than three
    // literals in `bedroom()`: a seeded room and the Library must agree about what a
    // Queen is. A rung edited in one place and not the other shows up here.
    expect(CATALOG_BEDS.size).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      if (!r.key) continue;
      expect(CATALOG_BEDS, `${r.w}x${r.d} seeded ${r.label} at ${r.key}, which no Library bed matches`)
        .toContain(r.key);
    }
  });

  it('seeds a bed 2000 mm long whatever the room, because every EU mattress is', () => {
    // Width is the only axis the ladder varies. This is what makes "a bay too shallow
    // for a bed gets no bed" the honest outcome rather than a bug to paper over: there
    // is no shorter real bed to fall back to. The transposed catalog had a 1000-long
    // "single", which is why shallow bays used to be furnished — with a bed that did
    // not exist.
    for (const r of rows) {
      if (!r.key) continue;
      expect(Number(r.key.split('x')[1]), `${r.w}x${r.d}`).toBe(2000);
    }
  });

  it('uses every rung of the ladder somewhere, or the rung is dead weight', () => {
    // This is the assertion that earns the middle rung. Removing the Double from
    // BED_LADDER leaves `scene-seed.test.ts` entirely green — mutation-checked — so
    // nothing else in the suite could tell you whether a rung is load-bearing or
    // decoration. Counts are deliberately NOT pinned: bay geometry is not monotonic
    // in the footprint and a legitimate change moves them. "At least once" is the
    // claim that survives that and still fails on a deleted rung.
    const used = new Set(rows.filter((r) => r.key).map((r) => r.label));
    for (const rung of ['Single bed', 'Double bed', 'Queen bed']) {
      expect(used, `no U size picks the ${rung} — that rung is unreachable`).toContain(rung);
    }
  });
  it('places a bed at every legal U size — none may be left bedless', () => {
    // This used to PIN five bedless sizes as a known gap: 6x4 through 8x4, every
    // shallow-and-wide one. They were not a fit failure — a single places fine at 6x4
    // and lost the plan 484.06 to 496.95, because `missing` charges an absent bed the
    // same 240 units as an absent nightstand. Staging the rung choice ahead of the
    // wall search fixed it as rule (B) in `defaultScene`: the widest rung that places
    // a bed at all, with `clearance.ts` left to report the route. Tight and honest
    // beats empty and quiet.
    const bedless = rows.filter((r) => !r.key).map((r) => `${r.w}x${r.d}`);
    expect(bedless, 'a bedroom preset that seeds no bed').toEqual([]);
  });

  it('reports, and ratchets, the sizes where a bigger room gets a narrower bed', () => {
    // Staging the rung choice (rules A and B in `defaultScene`) was expected to make
    // this monotonic BY CONSTRUCTION — the argument being that a deeper bay cannot
    // make a narrow rung qualify where a wide one did not. **That argument is wrong,
    // and this assertion is what showed it.** Thirteen steps still go the wrong way,
    // e.g. 4x4 seeds a Queen and 4x4.5 a Single.
    //
    // The mechanism, once measured: rule (A) asks whether a rung's best plan strands
    // nothing, and whether it strands anything depends on ALL the other furniture, not
    // just the bed. A deeper bay fits more of it — wardrobe, both nightstands, the
    // plant — and that extra furniture strands floor beside a Queen where it would not
    // beside a Single. So the predicate is not monotone in depth because its subject
    // is not the bed alone. Making it monotone means placing the bed first and having
    // the rest of the room yield to it, which is a bedroom-anchor concept this seeder
    // does not have.
    //
    // Ratcheted rather than pinned to 13: an equality pin fails on an improvement,
    // which trains people to raise it. `<=` forbids the regression and welcomes the
    // fix. The count is post-change only — I did not measure it before, so this is not
    // a claim that staging improved it.
    // Both axes, because a room grows two ways and a sign error in one is invisible in
    // the other.
    const width = new Map(rows.map((r) => [`${r.w}x${r.d}`, Number(r.key!.split('x')[0])]));
    const at = (w: number, d: number) => width.get(`${w}x${d}`);
    const steps: string[] = [];
    for (let w = 40; w <= 80; w += 5) {
      for (let d = 40; d < 80; d += 5) {
        const a = at(w / 10, d / 10)!;
        const b = at(w / 10, (d + 5) / 10)!;
        if (b < a) steps.push(`${w / 10}x${d / 10} (${a}) -> ${w / 10}x${(d + 5) / 10} (${b})`);
      }
    }
    for (let d = 40; d <= 80; d += 5) {
      for (let w = 40; w < 80; w += 5) {
        const a = at(w / 10, d / 10)!;
        const b = at((w + 5) / 10, d / 10)!;
        if (b < a) steps.push(`${w / 10}x${d / 10} (${a}) -> ${(w + 5) / 10}x${d / 10} (${b})`);
      }
    }
    console.log(
      steps.length
        ? `bigger room, narrower bed (${steps.length}):\n  ${steps.join(`\n  `)}`
        : 'bed width is monotonic in both axes',
    );
    expect(steps.length, 'more non-monotonic steps than the 13 measured — a regression').toBeLessThanOrEqual(13);
  });
})
