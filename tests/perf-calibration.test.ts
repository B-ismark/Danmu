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
 *
 * ── TWO MUTATIONS SURVIVE THIS FILE, ON PURPOSE, AND HERE IS THE PROOF THEY MAY ──
 *
 * Growing `referenceWorkload` fourfold, and setting `REFERENCE_IDLE_MS` to 10, both
 * pass all fifteen tests here. Neither is detectable in principle: each makes the
 * machine read as slower than it is, and a test cannot tell that from a machine that
 * genuinely is slower — the whole point of running on CI hardware nobody has measured.
 * An assertion that tried would fire on a slow runner and get loosened until it did
 * not, which is a worse outcome than a survivor that is written down.
 *
 * What is asserted instead is that the DAMAGE is bounded. Both mutations pin the
 * factor at `MAX_FACTOR`, so the worst bar either can produce is
 * `TWENTY_PIECE_BAR_MS × MAX_FACTOR` = 3600 ms, and `keeps a clamped bar a clear
 * factor below the regression it guards` asserts that stays under half the 8400 ms
 * the regression measured. Verified end to end rather than reasoned: with
 * `REFERENCE_IDLE_MS = 10` AND a 30x-slower `solveLayout` applied together, the
 * twenty-piece bar still went red — `expected 5157.97 to be less than 3600`.
 *
 * So the design here is not "the calibration cannot be wrong". It is "a wrong
 * calibration cannot cost more than one clamp", which is a claim a test can hold.
 */
import { describe, it, expect } from 'vitest';
import {
  CLEARANCE_FIELD_BAR_MS,
  HOIST_REGRESSION_MS,
  MAX_FACTOR,
  REFERENCE_IDLE_MS,
  TWENTY_PIECE_BAR_MS,
  bestMs,
  yardstickWorkload,
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
    expect(b).toBe(a);

    // **The exact value, which is the guard every timing assertion in this file was
    // trying to be and structurally could not.** `> 1` passes for any loop that runs
    // at all: halve the rounds and it returns 10810.88, halve the inner array and it
    // returns 15000.86, and a bound of 1 waves both through.
    //
    // Nothing here is timed, so it reads the same on a runner as it does locally. The
    // workload is deterministic float maths over constant inputs — the assertion
    // directly above already depends on that — so its result is a fingerprint of the
    // round count, the array length and the body at once, in BOTH directions. That
    // last part is the half a floor never had: a floor is one-sided, a workload grown
    // fourfold measures HIGHER, and `tests/helpers/perf.ts` named exactly that growth
    // as a failure "not detectable from inside a test that can only compare the
    // calibration against itself". It is detectable. It was being asked in the one
    // space — milliseconds — where the answer belongs to the machine.
    //
    // `toBeCloseTo(…, 3)` and not `toBe`: V8 computes `Math.sin`/`Math.cos` in
    // software, so an engine upgrade could move the last ULPs of a 512,000-term sum.
    // The tolerance is deliberately at the loose end — 5e-4 against a smallest
    // observed edit of 6627 leaves seven orders of magnitude, so precision buys
    // nothing and costs a false red on a node bump.
    expect(
      a,
      'referenceWorkload was edited — the calibration now measures a different program',
    ).toBeCloseTo(21627.954983732892, 3);
  });

  it('costs enough to survive a scheduler quantum', () => {
    // A calibration shorter than a preemption is noise. 22 ms was measured on the
    // calibration box, and this band used to be 10-100 — an ORDER-of-magnitude check,
    // because the workload the constant describes could itself be edited and there is
    // no sense pinning a measurement of a moving program.
    //
    // **The workload cannot move now**: the test above pins its exact return. So
    // `REFERENCE_IDLE_MS` describes a FIXED program, which makes it a decision rather
    // than a re-measurement, and a decision can be pinned tightly. 15-30 admits this
    // machine's real idle spread (19.35-22.58 ms over 25 samples) and refuses both
    // values a review found sailing through the old band: 10, which pins every
    // machine at the floor and switches the calibration off, and 90, which pins every
    // machine at the clamp and inflates both bars.
    //
    // It is not a bound on how fast the machine running this is. That is
    // `machineFactor`'s job, and conflating the two is what put a wall-clock
    // assertion in the test below for as long as there was one.
    expect(REFERENCE_IDLE_MS).toBeGreaterThanOrEqual(15);
    expect(REFERENCE_IDLE_MS).toBeLessThanOrEqual(30);
  });

  it('reports what the two workloads cost here, and asserts nothing about the clock', () => {
    // **Every wall-clock assertion that used to live here is gone, and a measurement
    // retired them rather than a loosening.** There were two — a bare `measured > 5`
    // and a floor at `REFERENCE_IDLE_MS * 0.4` = 8.8 ms. Both existed to catch the
    // reference loop being edited, and both asked that question in milliseconds, which
    // makes the answer a property of the machine rather than of the loop.
    //
    // A GitHub runner answered it wrong on 2026-09-06: `expected 8.554660000000013 to
    // be greater than 8.8`, on a commit with nothing wrong with it. Re-running the
    // same job on the same commit passed, and this file reddened again later at a
    // different assertion. The floor's own comment had claimed "no CI box can trip
    // this" and prescribed re-measuring `REFERENCE_IDLE_MS` on the machine that fired
    // it — advice nobody can follow, because that machine is a runner nobody here
    // controls.
    //
    // What replaced them, one defect at a time:
    //
    // · loop shrunk, or optimised away entirely → the exact-value pin above
    // · loop GROWN fourfold → the exact-value pin above, and nothing before it. A
    //   floor is one-sided and growth measures HIGHER, so that failure was open for
    //   as long as the floor stood in for it.
    // · `REFERENCE_IDLE_MS` moved to 10 or to 90 → the narrowed band above
    //
    // Nothing is left for a clock to answer, so nothing here asks one.
    referenceWorkload();
    const measured = bestMs(referenceWorkload, 3);
    yardstickWorkload();
    const yard = bestMs(yardstickWorkload, 3);

    // Printed on every passing run (`--disableConsoleIntercept`), so drift stays
    // visible without reading a diff.
    //
    // **The ratio was proposed as a SCALE-FREE bound and the first CI reading refutes
    // it.** The argument was that both workloads scale with the CPU, so their ratio
    // would normalise machine speed where an absolute floor could not. Measured:
    // 16.6-24.3 here over 20 pairs, and **9.30 on the runner** — below the whole local
    // range rather than inside it.
    //
    // The reason was already written, in `yardstickWorkload`'s own docblock, before the
    // measurement: this workload is "deliberately UNLIKE `referenceWorkload` — scalar
    // float maths, no allocation — so the pair also says whether a machine is starved
    // of CPU or of allocation bandwidth." A pair that can tell those two apart is by
    // construction a pair whose ratio moves between machines. A diagnostic and a
    // normaliser are opposite requirements and one pair cannot be both.
    //
    // So the ratio stays printed and unasserted, now for a measured reason instead of
    // a precautionary one. Any bound the local range would have justified is above
    // 9.30, and would have gone red on the next CI run.
    console.log(
      `  calibration: workload=${measured.toFixed(2)}ms yardstick=${yard.toFixed(2)}ms ` +
        `ratio=${(measured / yard).toFixed(2)} (runner 9.30, this box 16.6-24.3)`,
    );
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
