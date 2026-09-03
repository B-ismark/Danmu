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
  MAX_FACTOR,
  REFERENCE_IDLE_MS,
  bestMs,
  ceilingMs,
  clampFactor,
  machineFactor,
  referenceWorkload,
  resetMachineFactor,
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
    expect(bestMs(referenceWorkload, 3)).toBeGreaterThan(5);
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
    // The mean of 40/5/40 is ~28 and the first is ~40; only the minimum is under 30.
    expect(ms).toBeGreaterThanOrEqual(4);
    expect(ms).toBeLessThan(30);
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
    expect(clampFactor(2)).toBe(2);
    expect(clampFactor(3.5)).toBe(3.5);
  });

  it('refuses a reading that is not a number', () => {
    // `ms / REFERENCE_IDLE_MS` is NaN if the constant is ever edited to 0, and
    // `Math.min(MAX, Math.max(1, NaN))` is NaN — which compares false against every
    // bound, so `expect(ms).toBeLessThan(NaN)` fails rather than passes. That is the
    // safe direction, but it fails for an unreadable reason, so it is caught here.
    expect(clampFactor(NaN)).toBe(1);
    expect(clampFactor(Infinity)).toBe(1);
  });

  it('keeps MAX_FACTOR far below the regression the bars guard', () => {
    // The twenty-piece bar is 2000 ms against a regression that measured 8400 ms.
    // If MAX_FACTOR ever reached 4.2 the inflated bar would swallow the regression
    // on a machine slow enough to hit the ceiling. Both ends of this are the point:
    // above 1 it is doing something, below 4.2 it is still a gate.
    expect(MAX_FACTOR).toBeGreaterThan(1);
    expect(MAX_FACTOR).toBeLessThan(8400 / 2000);
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

  it('scales a ceiling by exactly that factor', () => {
    const f = machineFactor();
    expect(ceilingMs(1000)).toBeCloseTo(1000 * f, 6);
    // A ceiling is never below the number it was stated as, which is the property
    // that lets the two bars keep writing their idle figure and nothing else.
    expect(ceilingMs(2000)).toBeGreaterThanOrEqual(2000);
  });

  it('reports what it measured, so drift in REFERENCE_IDLE_MS is visible', () => {
    resetMachineFactor();
    const f = machineFactor();
    const observed = REFERENCE_IDLE_MS * f;
    console.log(
      `\n  perf calibration — reference ${REFERENCE_IDLE_MS} ms on the calibration box, ` +
        `~${observed.toFixed(1)} ms here → factor ${f.toFixed(2)}` +
        (f >= MAX_FACTOR ? '  (AT THE CLAMP — bars are no longer scaling)' : '') +
        `\n  ceilings this run: layout-solve ${ceilingMs(2000).toFixed(0)} ms, ` +
        `clearance-field ${ceilingMs(1500).toFixed(0)} ms\n`,
    );
    expect(f).toBeGreaterThan(0);
  });
});
