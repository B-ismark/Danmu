/**
 * The calibration behind this suite's two wall-clock bars, tested as code rather
 * than trusted as scaffolding.
 *
 * `tests/helpers/perf.ts` scales `layout-solve`'s twenty-piece ceiling and
 * `clearance-field`'s frame-budget ceiling by how slow this machine currently is. A
 * calibration that goes wrong does not fail — it *raises both bars*, silently, which
 * is this repo's recurring failure shape wearing a performance test's clothes. So
 * every piece of it is pinned here: that the reference workload is real work and not
 * something an engine can fold to a constant, that `bestMs` genuinely takes the
 * minimum and runs the body the promised number of times, and that the clamp holds at
 * BOTH ends — the floor, so a fast machine cannot tighten a bar it was not calibrated
 * for, and the ceiling, so a pathological reading cannot inflate one without limit.
 *
 * The measured factor is printed on a passing run (`--disableConsoleIntercept`), so a
 * `REFERENCE_IDLE_MS` that has drifted out of date is visible without reading a diff.
 * It is deliberately NOT asserted against 1.0: CI runs on a box nobody here has
 * measured, and an assertion that this machine is as fast as the calibration machine
 * is an assertion about the wrong subject.
 */
import { describe, it, expect } from 'vitest';
import {
  CLEARANCE_FIELD_BAR_MS,
  HOIST_REGRESSION_MS,
  MAX_FACTOR,
  REFERENCE_IDLE_MS,
  TWENTY_PIECE_BAR_MS,
  bestMs,
  ceilingMs,
  clampFactor,
  machineFactor,
  measureReferenceMs,
  referenceWorkload,
  resetMachineFactor,
  scaleMs,
} from './helpers/perf';

describe('the reference workload', () => {
  it('does real work, and the same work every time', () => {
    const a = referenceWorkload();
    const b = referenceWorkload();
    // Finite and non-trivial: a workload an engine folded away returns 0 or NaN and
    // then measures nothing, which is a calibration that reads every machine as
    // infinitely fast — the direction that loosens both bars.
    expect(Number.isFinite(a)).toBe(true);
    expect(Math.abs(a)).toBeGreaterThan(1);
    expect(b).toBe(a);
  });

  it('costs enough to survive a scheduler quantum', () => {
    // A calibration shorter than a preemption is noise. 22 ms was measured; the
    // assertion is a wide band around it, because the point is the ORDER of
    // magnitude — a future edit that shrinks this to 1 ms brings back the defect
    // that the first version of this helper had.
    expect(REFERENCE_IDLE_MS).toBeGreaterThanOrEqual(10);
    expect(REFERENCE_IDLE_MS).toBeLessThanOrEqual(100);
  });

  it('and the workload itself still costs that, not just the constant naming it', () => {
    // The assertion above pins a NUMBER, which a mutation that shrinks the loop
    // leaves untouched: the constant would then describe a workload that no longer
    // exists, every machine would read as fast, and both bars would quietly sit at
    // their idle figures forever. So the body is timed too.
    //
    // A floor, never a band around REFERENCE_IDLE_MS: this runs on CI hardware
    // nobody here has measured, and the only direction that breaks the calibration
    // is the workload becoming too SHORT to outlast a scheduler quantum. 5 ms leaves
    // room for a machine four times faster than the one this was written on.
    referenceWorkload();
    const measured = bestMs(referenceWorkload, 3);
    expect(measured).toBeGreaterThan(5);

    // And the pair, which is the half that was missing. The constant and the workload
    // were each pinned alone — a band for one, a floor for the other — and nothing
    // tied them together, so `REFERENCE_IDLE_MS = 90` (inside its own band) or a
    // workload grown fourfold both sailed through: the first pins every machine at
    // the FLOOR and switches the calibration off, the second pins every machine at
    // the CLAMP and inflates both bars. Two opposite failures, one missing assertion.
    //
    // One-sided on purpose, and it is the safe side: a slower machine measures
    // HIGHER, so no CI box can trip this. Only a shrunken workload or an inflated
    // constant can. If it does fire on a genuinely much faster machine, the fix is to
    // re-measure `REFERENCE_IDLE_MS` there, which is the right thing to be told.
    expect(
      measured,
      `the workload costs far less than REFERENCE_IDLE_MS (${REFERENCE_IDLE_MS} ms) claims — ` +
        `either the loop shrank, the constant was inflated, or this machine is >2.5x the ` +
        `calibration box and the constant needs re-measuring here`,
    ).toBeGreaterThan(REFERENCE_IDLE_MS * 0.4);
  });
});

describe('bestMs', () => {
  it('takes the lowest sample, not the first and not the mean', () => {
    const waits = [40, 5, 40];
    let calls = 0;
    const ms = bestMs(() => {
      const w = waits[calls++];
      const t0 = performance.now();
      while (performance.now() - t0 < w) {
        /* spin: a synchronous body, which is what both real bars time */
      }
    });
    // Three calls, so a `runs` that silently became 1 is red rather than merely
    // less accurate.
    expect(calls).toBe(3);
    // The first version of this bar was 30, and its own comment did the arithmetic
    // wrong: "the mean of 40/5/40 is ~28 … only the minimum is under 30". 28.34 IS
    // under 30, so a `bestMs` returning the mean passed the test named for not
    // returning the mean — measured at 28.34 against the real spin bodies. Best-of-N
    // is the mechanism BOTH wall-clock bars now rest on, so the assertion guarding it
    // being decoration was the most expensive kind of green here. 15 separates them.
    expect(ms).toBeGreaterThanOrEqual(4);
    expect(ms).toBeLessThan(15);
  });

  it('honours an explicit run count', () => {
    let calls = 0;
    bestMs(() => void calls++, 5);
    expect(calls).toBe(5);
  });
});

describe('the clamp', () => {
  it('never lets a fast machine tighten a bar', () => {
    expect(clampFactor(0.25)).toBe(1);
    expect(clampFactor(1)).toBe(1);
  });

  it('never lets a slow reading inflate one without limit', () => {
    expect(clampFactor(MAX_FACTOR + 1)).toBe(MAX_FACTOR);
    expect(clampFactor(1e6)).toBe(MAX_FACTOR);
  });

  it('passes a genuine middle reading through untouched', () => {
    // The half that makes the two ends above mean something: a clamp that returned a
    // constant would satisfy both of them.
    //
    // Derived from MAX_FACTOR rather than typed. The first version used a literal 3.5
    // as "the middle" and went red the moment MAX_FACTOR came down to 3 — a test
    // asserting a pass-through against a value that had become an edge, which is the
    // same hand-typed-copy defect this change is otherwise about.
    const mid = 1 + (MAX_FACTOR - 1) / 2;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(MAX_FACTOR);
    expect(clampFactor(mid)).toBe(mid);
  });

  it('refuses a reading that is not a number', () => {
    // `ms / REFERENCE_IDLE_MS` is NaN if the constant is ever edited to 0, and
    // `Math.min(MAX, Math.max(1, NaN))` is NaN — which compares false against every
    // bound, so `expect(ms).toBeLessThan(NaN)` fails rather than passes. That is the
    // safe direction, but it fails for an unreadable reason, so it is caught here.
    expect(clampFactor(NaN)).toBe(1);
    expect(clampFactor(Infinity)).toBe(1);
  });

  it('keeps a clamped bar a clear factor below the regression it guards', () => {
    // The reason first written here was wrong, and it is worth keeping because the
    // right reason is a different hazard. It said a MAX_FACTOR of 4.2 would let the
    // inflated bar "swallow the regression on a machine slow enough to hit the
    // ceiling". It would not: on a machine `s` times slower the regression costs
    // 8400·s while the bar is only 2000·min(s, MAX_FACTOR), so the slow machine is
    // the SAFE case and no value of MAX_FACTOR breaks it.
    //
    // The real hazard is a BROKEN CALIBRATION on a normal machine, and review proved
    // it reachable: growing `referenceWorkload` fourfold, or moving REFERENCE_IDLE_MS
    // anywhere inside the band asserted above, pins the factor at the clamp with the
    // whole suite green. There the regression still costs its own 8400 ms while the
    // bar has been multiplied for no reason — so this is the one assertion standing
    // between a mis-calibration and a dead gate, and it must read the bar and the
    // regression rather than restating them.
    expect(MAX_FACTOR).toBeGreaterThan(1);
    expect(TWENTY_PIECE_BAR_MS * MAX_FACTOR).toBeLessThan(HOIST_REGRESSION_MS / 2);
  });

  it('leaves the un-clamped bar comfortably clear of it too', () => {
    // The floor end of the same claim: on the calibration machine the bar is the
    // stated number, and it has to separate there as well or the scaling is covering
    // for a bar that was never right.
    expect(TWENTY_PIECE_BAR_MS * 4).toBeLessThan(HOIST_REGRESSION_MS);
    // And a bar that had collapsed toward the healthy ~300 ms solve would flake on
    // every run, so it is pinned from below too.
    expect(TWENTY_PIECE_BAR_MS).toBeGreaterThan(600);
  });
});

describe('machineFactor', () => {
  it('measures once and reuses the answer', () => {
    resetMachineFactor();
    const first = machineFactor();
    expect(machineFactor()).toBe(first);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(MAX_FACTOR);
  });

  it('is the measurement it claims to take, not a constant', () => {
    // Without this the factor can be hard-wired to MAX_FACTOR and every other
    // assertion here still passes — measured: 13 of 13 green with every bar pinned at
    // the clamp forever, which is precisely the silent inflation this file exists to
    // stop. The bounds a test can put on a machine reading are `[1, MAX_FACTOR]`, and
    // a constant satisfies both, so the composition has to be checked instead.
    resetMachineFactor();
    const f = machineFactor();
    const independent = clampFactor(measureReferenceMs() / REFERENCE_IDLE_MS);
    // A generous relative band: two best-of-five readings of the same workload differ
    // by a couple of per cent idle, and by more on a machine whose load is moving. It
    // does not need to be tight to separate a real measurement from `MAX_FACTOR`.
    expect(f).toBeGreaterThan(independent * 0.6);
    expect(f).toBeLessThan(independent * 1.7);
  });

  it('scales a ceiling by the factor, fed a factor it did not measure', () => {
    // `scaleMs` is separated from `machineFactor` for exactly this: an assertion that
    // compares `ceilingMs(x)` against `x * machineFactor()` restates the
    // implementation, and on any machine at the floor both sides are `x`, so dropping
    // the multiply survives. It did — three runs in four.
    expect(scaleMs(1000, 3)).toBe(3000);
    expect(scaleMs(1000, 1)).toBe(1000);
    expect(scaleMs(1500, 2.5)).toBe(3750);
    // And the composition: a ceiling is never below the number it was stated as,
    // which is what lets both bars keep writing their idle figure and nothing else.
    expect(ceilingMs(2000)).toBeGreaterThanOrEqual(2000);
    expect(ceilingMs(2000)).toBeLessThanOrEqual(2000 * MAX_FACTOR);
    // `ceilingMs` is `scaleMs(idle, machineFactor())` and both halves are pinned above
    // on their own; this is the two-line glue between them. **It can only be OBSERVED
    // on a machine reading above the floor** — where the factor is exactly 1, an
    // identity `ceilingMs` is indistinguishable from a correct one, and that is not
    // fixable from inside a test that cannot make the machine slow. Stated rather than
    // papered over: CI read 1.00, so on CI this particular line proves nothing.
    expect(ceilingMs(1000)).toBe(scaleMs(1000, machineFactor()));
  });

  it('reports what it measured, so drift in REFERENCE_IDLE_MS is visible', () => {
    resetMachineFactor();
    const f = machineFactor();
    const observed = REFERENCE_IDLE_MS * f;
    console.log(
      `\n  perf calibration — reference ${REFERENCE_IDLE_MS} ms on the calibration box, ` +
        `~${observed.toFixed(1)} ms here → factor ${f.toFixed(2)}` +
        (f >= MAX_FACTOR ? '  (AT THE CLAMP — bars are no longer scaling)' : '') +
        `\n  ceilings this run: layout-solve ${ceilingMs(TWENTY_PIECE_BAR_MS).toFixed(0)} ms, ` +
        `clearance-field ${ceilingMs(CLEARANCE_FIELD_BAR_MS).toFixed(0)} ms\n`,
    );
    expect(f).toBeGreaterThan(0);
  });
});
