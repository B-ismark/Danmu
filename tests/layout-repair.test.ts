import { describe, expect, it, vi } from 'vitest';
import { analyzeRoom } from '@/lib/clearance';
import { applyPlacements, lockedForShuffle, shuffleRoom } from '@/lib/layout-shuffle';
import * as solve from '@/lib/layout-solve';
import { ROOMS } from './helpers/ideas-rooms';

// `repairHard` and the start `shuffleRoom` alternates (§ 57, 2026-10-15), held where the
// user meets them rather than through the trajectory counts the other files re-pin.

vi.mock('@/lib/layout-solve', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/layout-solve')>();
  return { ...real, constructiveStart: vi.fn(real.constructiveStart) };
});

describe('repair before refusal', () => {
  it('never clears a fault by standing a piece in front of a wall fixture', { timeout: 600_000 }, () => {
    // A radiator, a window or a mounted TV is not in the cost function (`clash-mounted`
    // is a Room check finding the search cannot price), so a repair that only counted
    // the hard terms cleared a door swing by pushing a wardrobe into a radiator. It
    // counts the clash as hard (`CLASH_COST`). Fix from a scrambled room on the three
    // cut-up presets, 12 seeds each: 0 such rooms; with the clash not counted, 11
    // (l 6x5 5, t 6x5 4, u 6x5 2 — measured 2026-10-15).
    const rows: string[] = [];
    let n = 0;
    for (const r of ROOMS().filter((x) => ['l 6x5', 't 6x5', 'u 6x5'].includes(x.name))) {
      const locked = solve.lockedForSolve(r.parts, {}, null);
      const movable = solve.movableFor(r.parts, locked);
      let k = 0;
      for (let s = 0; s < 12; s++) {
        const st = solve.randomizeStart(r.parts, r.footprint, movable, solve.makeRng(9000 + s));
        const scrambled = r.parts.map((p, i) => ({ ...p, pos: [st[i].x, p.pos[1], st[i].z] as [number, number, number], rot: st[i].yaw }));
        const out = applyPlacements(scrambled, solve.solveLayout(scrambled, r.footprint, locked, { seed: s + 1, mode: 'arrange' }));
        if (analyzeRoom(out, { footprint: r.footprint, height: 2.4 }).issues.some((f) => f.rule === 'clash-mounted')) k++;
      }
      rows.push(`${r.name} ${k}`);
      n += k;
    }
    expect(n, rows.join(' · ')).toBe(0);
  });
});

describe('the starts a press is built from', () => {
  it('half the seeds of a press start from a furnished room, not a scatter', () => {
    // Alternating keeps the scatter's odd ideas and adds the built room's tidy ones
    // (`constructiveStart`'s docblock and § 57 have the measurement).
    const r = ROOMS().find((x) => x.name === 'rect 5x4')!;
    const built = vi.mocked(solve.constructiveStart);
    built.mockClear();
    const out = shuffleRoom(r.parts, { footprint: r.footprint, height: 2.4 }, lockedForShuffle(r.parts, {}), { attempt: 1 });
    expect(out?.tried, 'the press ran solves').toBeGreaterThan(1);
    // Seed 0 is built, seed 1 thrown, and so on: the first of every pair.
    expect(built.mock.calls.length).toBe(Math.ceil(out!.tried / 2));
  });
});
