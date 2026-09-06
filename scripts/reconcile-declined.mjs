// Two review lenses measured the same rooms and disagreed, so this reproduces the
// published case before anything is varied.
//
//   lens A: u/l/t x 8 seeds x 2 modes at 6x4 -> 9 impossible declines, ZERO naming one term
//   lens C: defaultScene('u',6,4), seeds 1-8, default opts -> 4 impossible, terms=["outside"]
//
// They ran concurrently in ONE worktree while a third process was mutating
// `lib/layout-solve.ts` in short windows, so at most one of them measured the real
// module. `impossibleTermsWorse`'s comparison was one of the mutated lines, and `>` -> `>=`
// would name BOTH terms on every refusal of a legal room (0 >= 0 is true), which is
// exactly lens A's result. That is a hypothesis until this runs against a file whose
// hash matches the commit.
//
// Prints one row per solve, nothing aggregated, so the reading is not mediated by a
// summary. Run only with the tree verified pristine.

import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({
  configFile: false,
  root: ROOT,
  resolve: { alias: { '@': ROOT } },
  server: { middlewareMode: true },
  logLevel: 'warn',
});

try {
  const { solveLayout, impossibleClause } = await server.ssrLoadModule('/lib/layout-solve.ts');
  const spec = await server.ssrLoadModule('/lib/scene-spec.ts');
  const fp = await server.ssrLoadModule('/lib/footprint.ts');

  for (const id of ['u', 'l', 't']) {
    const poly = fp.footprintForLayout(id, 6, 4);
    const parts = spec.defaultScene(id, 6, 4, { footprint: poly });
    const locked = parts.map(() => false);
    console.log('\n-- ' + id + ' 6x4, ' + parts.length + ' parts --');
    for (const mode of ['arrange', 'shuffle']) {
      for (let seed = 1; seed <= 8; seed++) {
        const r = solveLayout(parts, poly, locked, { seed, mode });
        const dec = r.declined == null ? 'applied' : r.declined;
        const terms = r.declinedTerms || [];
        const say = dec === 'impossible'
          ? '  terms=[' + terms.join(',') + ']  -> "' + impossibleClause(terms) + '"'
          : '';
        console.log('  ' + mode.padEnd(8) + ' seed ' + seed + '  ' + dec.padEnd(11) +
          ' moved ' + String(r.moved.length).padStart(2) + say);
      }
    }
  }
} finally {
  await server.close();
}
