/**
 * Machine-speed calibration for the two wall-clock bars in this suite.
 *
 * The problem this solves, measured 2026-09-03 at `a23b50b` rather than assumed.
 * `tests/layout-solve.test.ts`'s twenty-piece solve costs ~394 ms idle and **4061 ms**
 * with eighteen spinners on eight cores — a healthy solve failing a 2000 ms bar by
 * 2x, with nothing wrong with the code. Both of the obvious repairs are worse than
 * they look:
 *
 * · **Raising the number** turns the bar into decoration. The thing it guards is a
 *   regression that reinstated per-proposal rule-table rebuilding, worth 8.4 SECONDS
 *   for twenty pieces against ~270 ms after the hoist. A bar loose enough never to
 *   fire under load is close enough to 8400 ms to stop separating the two.
 * · **A ratio against another solve** — the shape `scales with the room rather than
 *   exploding` already uses — cannot see that regression at all, because rebuilding
 *   per proposal slows the small solve and the large one by the same factor. The
 *   ratio is the right tool for a complexity claim and the wrong one for a constant
 *   factor. Both bars are worth having; they are not the same assertion.
 *
 * So the bound is scaled by what the machine can do *right now*, measured against a
 * fixed reference workload in the same process. Under contention the reference is
 * slowed by the same scheduler that slows the solve, so the ratio between them holds
 * and the bar keeps meaning "this code is fast" instead of "this machine is idle".
 *
 * Two things keep it from becoming a bound that cannot fail:
 *
 * · The factor is **clamped to `MAX_FACTOR`**. A calibration that goes wrong — a
 *   pathological JIT deopt, a reference loop that got optimised into nothing and
 *   reads as an infinitely fast machine, a future edit — cannot inflate a bar without
 *   limit. It can at worst quadruple it, which is still four times under the number
 *   the regression it guards produced.
 * · The factor is **never below 1**. A machine faster than the one this was written
 *   on does not get to tighten a bar it was not calibrated for; it just runs
 *   comfortably inside it.
 */

/**
 * The reference workload's cost on the machine these bars were calibrated on
 * (2026-09-03, 8 cores, idle, warm process): best of five runs, in milliseconds.
 *
 * This is the one number here that is a measurement of a *machine* rather than of
 * this code, which is exactly why it is named and dated instead of being inlined.
 * It being wrong does not break a bar, it only shifts every calibrated bound by the
 * same proportion — and `tests/perf-calibration.test.ts` fails if it has drifted far
 * enough to stop meaning anything.
 */
export const REFERENCE_IDLE_MS = 22;

/** The most a slow machine may stretch a calibrated bound. See the docblock. */
export const MAX_FACTOR = 4;

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
 * Cached deliberately at the *first* call, which is early in a file's run rather than
 * at its slowest moment. That is the conservative direction: a machine that gets
 * busier later keeps the factor it earned when it was quieter, so a bar can still go
 * red. The opposite — recalibrating at the worst moment — is how a bar stops failing.
 */
export function machineFactor(): number {
  if (cached !== null) return cached;
  referenceWorkload(); // warm the JIT, so the first sample is not the compile
  const ms = bestMs(referenceWorkload, 5);
  cached = clampFactor(ms / REFERENCE_IDLE_MS);
  return cached;
}

/** A wall-clock ceiling in milliseconds, scaled to this machine. `idleMs` is the bar
 *  as it would be stated on the calibration machine — write that number, not a
 *  number padded for a bad day, and let the factor do the padding. */
export function ceilingMs(idleMs: number): number {
  return idleMs * machineFactor();
}

/** Test-only escape hatch: forget the cached factor so a test can observe the
 *  calibration itself rather than a value another test warmed. */
export function resetMachineFactor(): void {
  cached = null;
}
