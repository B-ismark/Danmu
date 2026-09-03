// The hot path does not recompute constants.
//
// This file exists because of a regression that was invisible in every way a test
// normally looks. `lib/layout-score.ts` scores each part against its nearest wall,
// and `nearestEdge` needs to know which way is inward. It takes that as an optional
// argument and computes it itself when the caller omits it — the same value, every
// time, for a footprint that does not change during a solve.
//
// (It was a POINT when this file was written — the average of the polygon's corners,
// which `nearestEdge` flipped its perpendicular toward. It is the polygon's WINDING
// now, because no point answers the question correctly on a non-convex room. Nothing
// about this file's subject changed with it: a constant is still being recomputed per
// part per proposal, and the argument is still the fix.)
//
// A change here dropped that argument. Nothing about any result moved, because the
// value is identical either way; every seeded fixture in this suite stayed green,
// including ones that assert by reference identity. What moved was the cost: a
// polygon sweep per part per proposal instead of one per solve. Measured on the
// seeded 20-piece room, isolated, alternating between the two trees over three reps
// each, `solveLayout` went **453 ms → 961 ms median, 2.1×**.
//
// The suite did not catch it. `stays inside two seconds for a room of twenty pieces`
// has a 2000 ms ceiling — stated for an idle machine and scaled by `ceilingMs` — and
// 961 ms sits comfortably under it. That ceiling is the right shape for the
// regression it was written for, the 8.4 s one, and it cannot see a doubling. Nor
// should it be tightened to try: a wall-clock assertion tight enough to catch 2×
// fails on a loaded machine every other run, which is how a suite learns to be
// ignored, and the calibration buys robustness against the machine rather than
// resolution against the code.
//
// (The parenthesis here used to say three of `layout-solve`'s assertions go 50/50
// under contention. Measured 2026-09-03: they do go red, and only ONE of the three
// is an assertion. The other two are the default 5000 ms `testTimeout` killing
// bodies that assert nothing about a clock — see `vitest.config.ts`, which now sets
// that number on purpose.)
//
// So this asserts the CONTRACT rather than the clock — every `nearestEdge` call on
// the hot path is handed its winding. Exact, no timing, deterministic, and red on
// the edit that caused this, which a duration assertion tuned to survive other
// people's CPUs structurally cannot be.

import { describe, it, expect, vi } from 'vitest';
import type { LayoutContext, Placement } from '@/lib/layout-score';
import type { ScenePart } from '@/lib/scene-spec';

// `vi.hoisted`, not a plain `const`: `vi.mock` is hoisted above every statement in
// the file, so a factory closing over an ordinary top-level binding reads it in the
// temporal dead zone.
const rec = vi.hoisted(() => ({ total: 0, bare: new Map<string, number>() }));

// Wrap `nearestEdge` to record which callers omitted the winding, then delegate to
// the real one — the values driving the solve below must be the real values, or this
// is not the solve that ships.
//
// The caller is read off the stack rather than counted in aggregate, because "295 of
// 28928 calls omitted it" is not a finding anyone can act on: it does not say whether
// that is one hot line or three cold ones. Capturing a stack is expensive, so it is
// paid only on the calls that are already wrong.
vi.mock('@/lib/geometry', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/geometry')>();
  return {
    ...real,
    nearestEdge: (...args: Parameters<typeof real.nearestEdge>) => {
      rec.total++;
      if (args.length < 4) {
        const frame = (new Error().stack ?? '').split(String.fromCharCode(10))[2] ?? '?';
        // Filename + line, pulled out by pattern rather than by splitting on a path
        // separator — vitest reports posix paths and Windows reports backslashes, and
        // a separator this misses would silently key every call by its whole absolute
        // path, which differs per machine and per worktree.
        const at = /[\w.-]+\.ts:\d+/.exec(frame)?.[0] ?? frame.trim();
        rec.bare.set(at, (rec.bare.get(at) ?? 0) + 1);
      }
      return real.nearestEdge(...args);
    },
  };
});

/** The one caller that legitimately still omits it, named rather than filtered away.
 *
 *  `snapToWall` in `lib/physics.ts` takes a position and a footprint and nothing else;
 *  it has no model to read a cached winding from, and it is reached here through the
 *  solver's wall proposals — about **296 calls of 29,000**, or 1 %. It is not part of
 *  this regression: `main` omits it there too, identically.
 *
 *  It is named as a string and asserted against, so the exception is declared. A test
 *  that quietly tolerated "some bare calls" would go green over the next one. */
const KNOWN_BARE = 'physics.ts';

const bareIn = (...owned: string[]) =>
  [...rec.bare.entries()].filter(([at]) => owned.some((o) => at.startsWith(o)));

const reset = () => {
  rec.total = 0;
  rec.bare.clear();
};

const { solveLayout } = await import('@/lib/layout-solve');
const { costBreakdown, prepare, DEFAULT_WEIGHTS } = await import('@/lib/layout-score');
const { defaultScene } = await import('@/lib/scene-spec');
const { footprintForLayout } = await import('@/lib/footprint');
const { nearestEdge, polygonWinding } = await import('@/lib/geometry');

function ctxFor(id: 'rect' | 'u', w: number, d: number): LayoutContext {
  const footprint = footprintForLayout(id, w, d);
  const parts = defaultScene(id, w, d, { footprint });
  return { parts, movable: parts.map((p) => !p.wallMounted), footprint };
}

const RECT = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
] as [number, number][];

let serial = 0;
const piece = (p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
  ({ id: `${p.category}-${++serial}`, name: p.category, rot: 0, locked: false, ...p }) as ScenePart;

/** A room the annealer has to actually search — the same shape of fixture as
 *  `tests/layout-solve.test.ts`'s `furnished`.
 *
 *  The first version of the solve assertion below used a seeded preset arrangement,
 *  and the whole `solveLayout` reached `nearestEdge` **six times**: the starting
 *  layout is already the good one, the search finds nothing worth taking, and it
 *  returns almost at once. Two of the four mutations survived against that, which is
 *  the only reason this fixture exists. A call-counting assertion over a code path
 *  that is never taken counts to zero and passes — so the floor below is large and
 *  deliberate. This scene measures 49,089 calls. */
function furnished(count: number): ScenePart[] {
  const out = [
    piece({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [-2, 1.05, -1.975], wallMounted: true }),
    piece({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.2] }),
    piece({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.3, -1.95], wallMounted: true }),
    piece({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [0.2, 0, 0.2] }),
    piece({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800], pos: [-2.6, 0, 0] }),
    piece({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [2.5, 0, 1] }),
    piece({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [-1.5, 0, -1.6] }),
    piece({ category: 'chair', shape: 'chair-office', dimMM: [600, 600, 1000], pos: [-1.5, 0, -0.8] }),
  ];
  while (out.length < count) {
    const i = out.length;
    out.push(
      i % 2
        ? piece({ category: 'plant', shape: 'plant', dimMM: [400, 400, 1600], pos: [(i % 5) - 2, 0, 1.7], circle: true })
        : piece({ category: 'ottoman', shape: 'ottoman', dimMM: [550, 400, 420], pos: [(i % 5) - 2, 0, -0.6] }),
    );
  }
  return out;
}

describe('the solver hands nearestEdge its winding', () => {
  it('on every call a scoring pass makes', () => {
    // One evaluation of an already-prepared model — what the annealer pays per
    // proposal, and where the recompute lived.
    const ctx = ctxFor('u', 7.5, 5.6);
    const model = prepare(ctx);
    const placements: Placement[] = ctx.parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
    reset();
    costBreakdown(model, placements, DEFAULT_WEIGHTS, null);
    // The `wall` term asks once per movable part, so this is not vacuous. Were the
    // count zero, the assertion below would pass having looked at nothing — which is
    // the failure mode this whole file is about.
    expect(rec.total, 'the scoring pass must actually reach nearestEdge').toBeGreaterThan(3);
    expect(bareIn('layout-score.ts'), `of ${rec.total} calls`).toEqual([]);
  });

  it('and on every call a whole solve makes', () => {
    // The finish passes (`snapYaws`) and the wall proposals (`pickWall`) live in
    // `lib/layout-solve.ts` and reach `nearestEdge` by their own routes; a fix applied
    // only to the scoring loop leaves those two recomputing.
    const parts = furnished(12);
    reset();
    solveLayout(parts, RECT, parts.map(() => false), { seed: 1 });
    // Deliberately a large floor and not `> 0` — see `furnished`.
    expect(rec.total, 'the solve must have actually searched').toBeGreaterThan(1000);
    expect(bareIn('layout-score.ts', 'layout-solve.ts'), `of ${rec.total} calls`).toEqual([]);
    // And the declared exception is still the ONLY one. Written as set equality on the
    // caller names, so a new bare call site anywhere — a file this repo does not have
    // yet included — arrives as a red rather than as a number nobody reads.
    expect([...rec.bare.keys()].map((at) => at.split(':')[0])).toEqual([KNOWN_BARE]);
  });

  it('and the cached winding is the answer nearestEdge would have computed', () => {
    // The half that keeps the optimisation honest: caching the WRONG value would be
    // bit-for-bit invisible to the two assertions above, which only count whether the
    // argument was passed.
    //
    // Asserted as the property rather than as the value — every edge of the room must
    // come back identical whether the cache is passed or omitted — because that is
    // what "passing it is free" means, and a sign pinned against `polygonWinding`
    // alone would still be green if `prepare` cached a sign for the wrong polygon.
    const ctx = ctxFor('u', 7.5, 5.6);
    const model = prepare(ctx);
    const poly = ctx.footprint as Parameters<typeof nearestEdge>[0];
    expect(model.winding).toBe(polygonWinding(poly));
    let checked = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      expect(nearestEdge(poly, mx, mz, model.winding)).toEqual(nearestEdge(poly, mx, mz));
      checked++;
    }
    expect(checked, 'the U must actually have edges to sweep').toBe(8);
    // …and the negative control, without which the sweep above would pass for a
    // `nearestEdge` that ignores the argument entirely. The opposite sign has to
    // change the answer, or nothing up there was a test of anything.
    const flipped = nearestEdge(poly, 0, 0, model.winding === 1 ? -1 : 1)!;
    const honest = nearestEdge(poly, 0, 0)!;
    expect(flipped.nx).toBeCloseTo(-honest.nx, 12);
    expect(flipped.nz).toBeCloseTo(-honest.nz, 12);
  });
});
