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
// WHY IT EXISTS AT ALL. The fixture has been hunted for by hand FOUR times now — each
// time because a change to the cost function or the seed layout moved the space, never
// because anything was wrong with the retired fixture. The test file's own note puts
// it plainly: "the payment is scriptable and it is two minutes, not twelve". It also
// currently carries a figure it forbids you to quote — "three in 532 … measured on the
// old cost function … must not be quoted as current" — which is a number with no live
// artifact behind it. This script is that artifact.
//
// WHAT A REFUSAL IS. `openRoutes` searches on the coarse navigation proxy and then
// re-checks the winner on the fine grid; if the fine grid says the proxy's answer is
// worse than the input, it hands the INPUT back by identity. Three other paths also
// return by identity — no doors, nothing stranded, an empty movable pool — so only
// scrambles the fine grid says are genuinely cut are counted as trials. That is the
// whole reason the denominator is the cut scrambles and not 54 × 28.
//
//   node scripts/openroutes-sweep.mjs                 # the full 54 × 28
//   node scripts/openroutes-sweep.mjs --scrambles 8   # a shorter probe
//   node scripts/openroutes-sweep.mjs --only 35       # one scramble, all 28 seeds
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

// The test file's own generator and its own encodings, reproduced here rather than
// imported: they are properties of that file, and a script that quietly used a
// different scramble would print a table about a different population.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const layoutSeed = (i) => i * 2654435761;
const repairSeed = (i, j) => i * 31 + j;

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

  const { openRoutes } = solve;
  const { costBreakdown, navigabilityCost, DEFAULT_WEIGHTS, NAV_CELL, prepare } = score;

  const poly = fp.footprintForLayout('u', 8.5, 6.4);
  const b = fp.footprintBounds(poly);
  const base = spec.defaultScene('u', 8.5, 6.4, { footprint: poly });
  const model = prepare({ parts: base, movable: base.map((p) => !p.wallMounted), footprint: poly });
  const bounds = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
  const fine = (p) => costBreakdown(model, p, DEFAULT_WEIGHTS, NAV_CELL).total;

  function scattered(seed) {
    const r = lcg(seed);
    return base.map((p) =>
      p.wallMounted
        ? { x: p.pos[0], z: p.pos[2], yaw: p.rot }
        : {
            x: b.minX + r() * (b.maxX - b.minX),
            z: b.minZ + r() * (b.maxZ - b.minZ),
            yaw: r() * Math.PI * 2,
          },
    );
  }

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
    const at = scattered(layoutSeed(i));
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
  } else {
    console.log('    NO REFUSALS. The fine-grid re-check has no live evidence on this grid —');
    console.log('    which is a finding, not a clean run. Widen the grid before relaxing the gate.');
  }
} finally {
  await server.close();
}
