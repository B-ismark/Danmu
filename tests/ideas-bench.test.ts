import { describe, it } from 'vitest';
import { isCleanShuffle, lockedForShuffle, shuffleRoom, type ShuffleOffer } from '@/lib/layout-shuffle';
import { lockedForSolve, makeRng, movableFor, randomizeStart, solveLayout } from '@/lib/layout-solve';
import { ROOMS } from './helpers/ideas-rooms';

// The Ideas bench: a MEASUREMENT, not a gate (like `pnpm sweep:routes`). Skipped
// unless IDEAS_BENCH=1, because it takes minutes. `pnpm bench:ideas` runs it and
// prints one table, so a change to the search is judged on the same numbers every
// time: per room, three presses with history, how many solves ran, how many were
// clean, how many ideas came back, their mean cost and the wall clock; then Fix
// (`arrange` from a scrambled room) clean count over 24 seeds per room.

const PRESSES = 3;
const FIX_SEEDS = 24;

describe.skipIf(!process.env.IDEAS_BENCH)('Ideas bench', () => {
  it('prints the table', { timeout: 3_600_000 }, () => {
    const rows: string[] = ['room              | tried | clean | ideas | mean cost | ms/press | fix clean'];
    const sum = { tried: 0, clean: 0, ideas: 0, cost: 0, ms: 0, fix: 0 };
    for (const r of ROOMS()) {
      const room = { footprint: r.footprint, height: 2.4 };
      const locked = lockedForShuffle(r.parts, {});
      const history: ShuffleOffer[] = [];
      const ids = r.parts.map((p) => p.id);
      let tried = 0, clean = 0, ideas = 0, cost = 0, ms = 0;
      for (let attempt = 1; attempt <= PRESSES; attempt++) {
        const t0 = performance.now();
        const o = shuffleRoom(r.parts, room, locked, { attempt, history });
        ms += performance.now() - t0;
        tried += o?.tried ?? 0;
        clean += o?.clean ?? 0;
        for (const idea of o?.ideas ?? []) {
          ideas++;
          cost += idea.after;
          history.push({ ids, placements: idea.placements });
        }
      }
      // Fix: the room scrambled, then `arrange` asked to make it good.
      let fix = 0;
      const lk = lockedForSolve(r.parts, {}, null);
      const mv = movableFor(r.parts, lk);
      for (let s = 0; s < FIX_SEEDS; s++) {
        const start = randomizeStart(r.parts, r.footprint, mv, makeRng(9000 + s));
        const scrambled = r.parts.map((p, i) => ({ ...p, pos: [start[i].x, p.pos[1], start[i].z] as [number, number, number], rot: start[i].yaw }));
        const res = solveLayout(scrambled, r.footprint, lk, { seed: s + 1, mode: 'arrange' });
        if (isCleanShuffle(res)) fix++;
      }
      sum.tried += tried; sum.clean += clean; sum.ideas += ideas; sum.cost += cost; sum.ms += ms; sum.fix += fix;
      rows.push(
        `${r.name.padEnd(17)} | ${String(tried).padStart(5)} | ${String(clean).padStart(5)} | ${String(ideas).padStart(5)} | ${(ideas ? cost / ideas : 0).toFixed(1).padStart(9)} | ${(ms / PRESSES).toFixed(0).padStart(8)} | ${String(fix).padStart(5)}/${FIX_SEEDS}`,
      );
    }
    rows.push(
      `${'TOTAL'.padEnd(17)} | ${String(sum.tried).padStart(5)} | ${String(sum.clean).padStart(5)} | ${String(sum.ideas).padStart(5)} | ${(sum.ideas ? sum.cost / sum.ideas : 0).toFixed(1).padStart(9)} | ${(sum.ms / PRESSES).toFixed(0).padStart(8)} | ${String(sum.fix).padStart(5)}`,
    );
    console.log('\n' + rows.join('\n'));
  });
});
