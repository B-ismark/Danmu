// Machine-speed calibration for the two wall-clock bars in this suite.
//
// The problem this solves, measured 2026-09-03 at `a23b50b` rather than assumed.
// `tests/layout-solve.test.ts`'s twenty-piece solve costs ~394 ms idle and **4061 ms**
// with eighteen spinners on eight cores — a healthy solve failing a 2000 ms bar by
// 2x, with nothing wrong with the code. Both of the obvious repairs are worse than
// they look:
//
// · **Raising the number** turns the bar into decoration. The thing it guards is a
//   regression that reinstated per-proposal rule-table rebuilding, worth 8.4 SECONDS
//   for twenty pieces against ~270 ms after the hoist. A bar loose enough never to
//   fire under load is close enough to 8400 ms to stop separating the two.
// · **A ratio against another solve** — the shape `scales with the room rather than
//   exploding` already uses — cannot see that regression at all, because rebuilding
//   per proposal slows the small solve and the large one by the same factor. The
//   ratio is the right tool for a complexity claim and the wrong one for a constant
//   factor. Both bars are worth having; they are not the same assertion.
//
// So the bound is scaled by what the machine can do *right now*, measured against a
// fixed reference workload in the same process. Under contention the reference is
// slowed by the same scheduler that slows the solve, so the ratio between them holds
// and the bar keeps meaning "this code is fast" instead of "this machine is idle".
//
// Two things keep it from becoming a bound that cannot fail:
//
// · The factor is **clamped to `MAX_FACTOR`**. A calibration that goes wrong — a
//   pathological JIT deopt, a reference loop that got optimised into nothing and
//   reads as an infinitely fast machine, a future edit — cannot inflate a bar without
//   limit. `MAX_FACTOR` is the ONLY thing bounding the damage from a broken
//   calibration, which is why it is small: a review found that growing
//   `referenceWorkload` fourfold, or moving `REFERENCE_IDLE_MS` anywhere inside the
//   band its own test asserts, pins every machine at the clamp with the whole suite
//   still green. Neither of those is detectable from inside a test that can only
//   compare the calibration against itself. So the answer is not a cleverer
//   assertion, it is a ceiling low enough that being wrong is survivable:
//   `TWENTY_PIECE_BAR_MS × MAX_FACTOR` stays a factor below `HOIST_REGRESSION_MS`,
//   and `tests/perf-calibration.test.ts` asserts exactly that, reading both numbers
//   from here rather than retyping them.
//
//   The first version of this paragraph said the clamp "can at worst quadruple it,
//   which is still four times under the number the regression it guards produced".
//   That was arithmetic nobody did: 2000 × 4 is 8000 against 8400, a **five per cent**
//   margin, not four times. It is the sentence a reader would have trusted when
//   deciding whether `MAX_FACTOR` could be raised.
// · The factor is **never below 1**. A machine faster than the one this was written
//   on does not get to tighten a bar it was not calibrated for; it just runs
//   comfortably inside it.

/**
 * The reference workload's cost on the machine these bars were calibrated on
 * (2026-09-03, 8 cores, idle, warm process): best of five runs, in milliseconds.
 *
 * This is the one number here that is a measurement of a *machine* rather than of
 * this code, which is exactly why it is named and dated instead of being inlined.
 *
 * An earlier draft said being wrong here "only shifts every calibrated bound by the
 * same proportion". That is false in one direction and the false direction is the
 * quiet one. Set it too HIGH — 90 is inside the band its own test asserts — and the
 * raw factor drops below 1 on every machine, the floor clamps it to exactly 1,
 * `ceilingMs` becomes the identity, and the whole calibration is switched off with
 * the suite green and the printed factor reading a confident `1.00`. Hence the
 * one-sided pin in `tests/perf-calibration.test.ts`: the measured cost must not come
 * back far BELOW this constant. That direction is safe to assert because a slower
 * machine measures higher, so no CI box can trip it; only a shrunken workload or a
 * badly inflated constant can.
 */
export const REFERENCE_IDLE_MS = 22;

/** The most a slow machine may stretch a calibrated bound, and the only bound on the
 *  damage a broken calibration can do. See the header. */
export const MAX_FACTOR = 3;

/**
 * The two wall-clock bars this file scales, and the one regression whose size is
 * actually known — stated here rather than at their call sites, because the guard
 * that keeps `MAX_FACTOR` honest has to read the bar and the regression together and
 * a hand-typed copy in the guard is a copy that stops describing anything.
 *
 * `HOIST_REGRESSION_MS` is measured: twenty pieces took 8.4 s before the model
 * hoisted static work out of the annealer's loop, ~270 ms after.
 *
 * **`CLEARANCE_FIELD_BAR_MS` has no companion, and that is a gap rather than an
 * omission.** Nothing in this repo records what an O(cells × parts) regression in
 * `buildClearanceField` would cost, so unlike the solve bar there is no evidence
 * about what this one still separates — only that a healthy field is ~40 ms and the
 * bar is 1500. `lib/clearance-field.ts`'s `MAX_CELLS` with 30 parts makes a per-part
 * rescan plausibly ~1.2 s, which would sit UNDER the clamped ceiling. Measuring it
 * means writing the regression and timing it; until someone does, this bar is a
 * canary of unknown sensitivity and should not be quoted as more.
 */
export const TWENTY_PIECE_BAR_MS = 1200;
export const HOIST_REGRESSION_MS = 8400;
export const CLEARANCE_FIELD_BAR_MS = 1500;

/**
 * A deterministic workload with the same broad shape as the solver's inner loop —
 * float arithmetic plus short-lived arrays, so a machine starved of CPU *and* one
 * starved of allocation bandwidth both show up. It must not be reducible to a
 * constant: `out` is returned, and the caller reads it, so nothing here is dead.
 */
export function referenceWorkload(): number {
  let acc = 0;
  // 1000 rounds lands at ~22 ms, chosen so the sample spans several scheduler
  // quanta: an earlier 60-round version cost 1.5 ms, where a single 15 ms preemption
  // is a 10x reading and the calibration is noise pretending to be a measurement.
  for (let round = 0; round < 1000; round++) {
    const xs = new Float64Array(512);
    for (let i = 0; i < xs.length; i++) {
      xs[i] = Math.sin(i * 0.017 + round) * Math.cos(i * 0.011) + Math.sqrt(i + 1);
    }
    for (let i = 1; i < xs.length; i++) acc += Math.abs(xs[i] - xs[i - 1]);
  }
  return acc;
}

/** Best (lowest) wall-clock of `runs` calls, in ms. The best sample measures what the
 *  machine CAN do, which is the question a ceiling is asking; a mean measures what
 *  else was running. `runs` defaults to 3, matching `tests/clearance-field.test.ts`,
 *  which is the one bar in this suite that has never gone red under load. */
export function bestMs(fn: () => unknown, runs = 3): number {
  let best = Infinity;
  // A run count below one would return `Infinity`, which `clampFactor` maps to the
  // FLOOR — so an unmeasurable machine would silently get the tightest possible bar
  // rather than the loosest. Nothing can reach it today (the one caller passes a
  // literal), and it is closed here because the day it becomes configurable is not
  // the day anyone will re-derive which end of the clamp `Infinity` lands on.
  runs = Math.max(1, Math.floor(runs) || 1);
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const out = fn();
    const ms = performance.now() - t0;
    // Read the result so a future engine cannot elide the call it is timing.
    if ((out as unknown) === Symbol.for('never')) throw new Error('unreachable');
    if (ms < best) best = ms;
  }
  return best;
}

/**
 * The clamp, separated from the measurement so both of its ends can be pinned. A
 * clamp tested only through `machineFactor()` is tested only at whatever this machine
 * happens to be doing — which is 1.0 on the box these bars were written on, so the
 * ceiling end would never be exercised and a `MAX_FACTOR` that had stopped applying
 * would look exactly like one that worked.
 */
export function clampFactor(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.min(MAX_FACTOR, Math.max(1, raw));
}

let cached: number | null = null;

/**
 * How much slower this machine is, right now, than the one the bars were calibrated
 * on — clamped to `[1, MAX_FACTOR]`. Measured once per worker process and reused,
 * because the answer is a property of the machine and re-measuring it per assertion
 * would charge every bar for the calibration.
 *
 * Cached at the first call and reused, because the answer is a property of the machine
 * and a bar that recalibrates at its own worst moment is a bar that stops failing.
 *
 * WHEN that first call happens is the caller's job and it matters — see `ceilingMs`.
 * An earlier note here claimed the first call lands "early in a file's run rather than
 * at its slowest moment", which was not true at either call site: both had it
 * evaluated inside the assertion, i.e. immediately after the timed work.
 */
export function machineFactor(): number {
  if (cached !== null) return cached;
  cached = clampFactor(measureReferenceMs() / REFERENCE_IDLE_MS);
  return cached;
}

/** One warmed reading of the reference workload, in ms. Exported so a test can pin
 *  `machineFactor` to the measurement it claims to take: without it the factor can be
 *  hard-wired to `MAX_FACTOR` and every assertion about it still passes, because the
 *  only bounds a test can put on a machine measurement are `[1, MAX_FACTOR]` and a
 *  constant satisfies both. Found by review, not by the eighteen mutations run here. */
export function measureReferenceMs(): number {
  referenceWorkload(); // warm the JIT, so the first sample is not the compile
  return bestMs(referenceWorkload, 5);
}

/** The scaling itself, separated from the measurement for the same reason
 *  `clampFactor` is. A test comparing `ceilingMs(x)` against `x * machineFactor()`
 *  restates the implementation, and on any machine at the floor both sides are just
 *  `x` — so deleting the factor entirely SURVIVES, which it did, three runs in four.
 *  Feed this a known factor instead. */
export function scaleMs(idleMs: number, factor: number): number {
  return idleMs * factor;
}

/**
 * A wall-clock ceiling in milliseconds, scaled to this machine. `idleMs` is the bar as
 * it would be stated on the calibration machine — write that number, not a number
 * padded for a bad day, and let the factor do the padding.
 *
 * **Take the bar BEFORE the work it bounds, not inside the assertion.** The factor is
 * measured on first use, so evaluating it after three twenty-piece solves measures the
 * reference against the heap those solves left behind. An allocation regression would
 * enlarge the heap, slow the calibration, and buy itself a higher ceiling — a bar
 * partly funding its own defeat. Both call sites take the bar first.
 */
export function ceilingMs(idleMs: number): number {
  return scaleMs(idleMs, machineFactor());
}

/** Test-only escape hatch: forget the cached factor so a test can observe the
 *  calibration itself rather than a value another test warmed. */
export function resetMachineFactor(): void {
  cached = null;
}
