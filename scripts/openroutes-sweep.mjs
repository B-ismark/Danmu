// The 54 × 28 sweep that `tests/suggest-tidiness.test.ts`'s fine-grid re-check is
// derived from, as a script rather than as a test.
//
// WHY IT IS NOT A VITEST FILE. The sweep runs `openRoutes` several hundred times and
// takes minutes. A test that takes minutes is a test somebody eventually gives a
// smaller grid, and an earlier attempt at exactly this died on a ten-minute harness
// timeout — a timeout is a hang-catcher, not a budget, so the answer is not a bigger
// number, it is to stop pretending a measurement campaign is a gate. The gate lives
// in that test file and asserts ONE scramble's worth; this prints the population that
// scramble was chosen out of.
//
// WHY IT EXISTS AT ALL. The refusal set has moved five times, every move paid for by a
// change to the cost function or the seed layout and never because anything was wrong
// with the retired fixture — the enumeration is in the docblock on LAYOUT_SEED in the
// test file. Each move was re-hunted by hand. That file's own note put it plainly:
// "the payment is scriptable and it is two minutes, not twelve". It also used to carry a
// figure it forbade you to quote, measured on a superseded cost function with no live
// artifact behind it. This script is that artifact, and no count of the hunts is stated
// here on purpose: the sentence that did state one was wrong twice over by the time
// anyone read it.
//
// WHAT A REFUSAL IS. `openRoutes` searches on the coarse navigation proxy and then
// re-checks the winner on the fine grid; if the fine grid says the proxy's answer is
// worse than the input, it hands the INPUT back by identity. Three other paths also
// return by identity — no doors, nothing stranded, an empty movable pool — so only
// scrambles the fine grid says are genuinely cut are counted as trials. That is the
// whole reason the denominator is the cut scrambles and not 54 × 28.
//
//   node scripts/openroutes-sweep.mjs                 # the full 54 × 28, ~7 minutes
//   node scripts/openroutes-sweep.mjs --scrambles 8   # a shorter probe
//   node scripts/openroutes-sweep.mjs --only 35       # one scramble, all 28 seeds, ~20 s
//
// EXIT CODES, because the two bad outcomes are not the same outcome:
//   0  the grid ran and at least one refusal was found
//   1  the grid ran and NOTHING refused — the re-check has no live evidence
//   2  nothing was cut, so nothing was searched and the run measures nothing
//
// Loaded through vite's SSR pipeline because the modules under test are TypeScript and
// import through the repo's `@/` alias. `vite` is a declared devDependency; nothing
// here reaches for a transitive binary.

import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

const SCRAMBLES = arg('scrambles', 54);
const REPAIR_SEEDS = arg('seeds', 28);
const ONLY = arg('only', NaN);


const server = await createServer({
  configFile: false,
  root: ROOT,
  resolve: { alias: { '@': ROOT } },
  server: { middlewareMode: true },
  logLevel: 'warn',
});

try {
  const solve = await server.ssrLoadModule('/lib/layout-solve.ts');
  const score = await server.ssrLoadModule('/lib/layout-score.ts');
  const spec = await server.ssrLoadModule('/lib/scene-spec.ts');
  const fp = await server.ssrLoadModule('/lib/footprint.ts');
  // The SAME generators the test file uses, not a copy of them. A copy here drifts in
  // one direction and in silence: this script's table is quoted INTO that file as
  // authority, so a drifted scramble would describe a different population and nothing
  // would go red. See the header of `tests/helpers/openroutes-grid.ts`.
  const grid = await server.ssrLoadModule('/tests/helpers/openroutes-grid.ts');
  const { lcg, layoutSeed, repairSeed, scatterInto } = grid;

  const { openRoutes } = solve;
  const { costBreakdown, navigabilityCost, DEFAULT_WEIGHTS, NAV_CELL, prepare } = score;

  const poly = fp.footprintForLayout('u', 8.5, 6.4);
  const b = fp.footprintBounds(poly);
  const base = spec.defaultScene('u', 8.5, 6.4, { footprint: poly });
  const model = prepare({ parts: base, movable: base.map((p) => !p.wallMounted), footprint: poly });
  const bounds = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
  const fine = (p) => costBreakdown(model, p, DEFAULT_WEIGHTS, NAV_CELL).total;


  const indices = Number.isNaN(ONLY) ? [...Array(SCRAMBLES).keys()] : [ONLY];
  const t0 = Date.now();

  console.log(`U 8.5 x 6.4 · ${indices.length} scramble(s) x ${REPAIR_SEEDS} repair seeds`);
  console.log('');
  console.log('  scramble    navCost      input cost   trials   refused on');
  console.log('  --------    ---------    ----------   ------   ----------');

  let cut = 0;
  let trials = 0;
  const refusals = [];

  for (const i of indices) {
    const at = scatterInto(base, bounds, layoutSeed(i));
    const nav = navigabilityCost(model, at, NAV_CELL);
    if (nav <= 0) {
      // Not a trial of anything: `openRoutes` returns by identity without searching,
      // so counting it would make the property look better tested than it is.
      console.log(`  ${String(i).padStart(8)}    ${nav.toFixed(3).padStart(9)}    ${'—'.padStart(10)}   ${'—'.padStart(6)}   not cut`);
      continue;
    }
    cut++;
    const refused = [];
    for (let j = 0; j < REPAIR_SEEDS; j++) {
      trials++;
      if (openRoutes(model, at, DEFAULT_WEIGHTS, bounds, lcg(repairSeed(i, j))) === at) {
        refused.push(j);
        refusals.push({ scramble: i, seed: j });
      }
    }
    console.log(
      `  ${String(i).padStart(8)}    ${nav.toFixed(3).padStart(9)}    ${fine(at).toFixed(2).padStart(10)}   ${String(REPAIR_SEEDS).padStart(6)}   ${refused.length ? refused.join(', ') : '—'}`,
    );
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log(`  ${cut} of ${indices.length} scrambles cut · ${trials} trials · ${refusals.length} refusals · ${secs}s`);
  if (refusals.length) {
    // The fixture the test file freezes is one of these, and its VALUE is the ratio,
    // never the seed number. Print both so a re-derivation can name the same point.
    const byScramble = new Map();
    for (const r of refusals) byScramble.set(r.scramble, [...(byScramble.get(r.scramble) ?? []), r.seed]);
    for (const [s, seeds] of byScramble) {
      console.log(`    scramble ${s}: LAYOUT_SEED = ${s} * 2654435761, refusing REPAIR_SEED = ${s} * 31 + {${seeds.join(', ')}}`);
    }
  } else if (trials === 0) {
    // NOT the same answer as "nothing refused", and the advice differs. Nothing was cut,
    // so `openRoutes` returned by identity without searching on every scramble and the
    // grid tested nothing at all. The first version of this script printed the
    // no-refusals message here and exited 0, which is a green run reporting that a guard
    // has no evidence when in fact the sweep never ran.
    console.log('    NOTHING WAS CUT, so nothing was searched and this run measures NOTHING.');
    console.log('    The fixture has stopped being cut. RE-RUN the sweep on a grid that is');
    console.log('    cut; do NOT relax the gate. A fixture that stops being cut is a test');
    console.log('    that stops meaning anything, which is how the first two fixtures died.');
    process.exitCode = 2;
  } else {
    console.log('    NO REFUSALS across ' + trials + ' real trials. The fine-grid re-check has no');
    console.log('    live evidence on this grid — a finding, not a clean run. Widen the grid');
    console.log('    before relaxing the gate.');
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
