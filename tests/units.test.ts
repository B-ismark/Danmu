import { describe, it, expect } from 'vitest';
import { boundsToUnit, decimalsOf, fromMM, stepFor, toMM, formatDim, precisionFor } from '@/lib/units';
import { dimRangeFor, roomAxisRange, roomAxisWithin, type RoomAxis } from '@/lib/dimension-ranges';
import { CATEGORIES, SHAPES } from '@/lib/scene-spec';

const UNITS = ['mm', 'cm', 'm', 'in', 'ft'] as const;
const AXES: RoomAxis[] = ['width', 'depth', 'height'];

/** Exactly what `NumberField.bump` does to a value before handing it back: clamp
 *  to the bounds it was given, then render at the step's precision. The rounding
 *  is the half that gets forgotten — a bound is only as good as the number the
 *  field will actually show. */
function landed(raw: number, unit: (typeof UNITS)[number], lo: number, hi: number): number {
  return Number(Math.max(lo, Math.min(hi, raw)).toFixed(decimalsOf(stepFor(unit))));
}

describe('a stepper cannot reach a room the editor would refuse', () => {
  // The bug: `RoomDimsEditor` handed `NumberField` bounds in METRES while the
  // field's value was in the user's unit. A 5 m room reads 500.0 cm against a max
  // of 50, so one press of the up chevron clamped it to 50 cm — 0.5 m — and the
  // commit then refused the room it had just produced. Four of the five units.
  it('holds every axis inside its range, in every unit, at both ends', () => {
    for (const unit of UNITS) {
      for (const axis of AXES) {
        const r = roomAxisRange(axis);
        const { min: lo, max: hi } = boundsToUnit(r.min * 1000, r.max * 1000, unit);
        expect(lo).toBeLessThan(hi);
        // Push the field far past each end and see where the stepper leaves it.
        for (const raw of [-9999, 0, 1e6, lo - 1, hi + 1]) {
          const m = toMM(landed(raw, unit, lo, hi), unit) / 1000;
          expect(
            roomAxisWithin(axis, m),
            `${axis} in ${unit}: raw ${raw} landed on ${m} m, outside its own bounds`,
          ).toBe(true);
        }
      }
    }
  });

  it('rounds toward the interior, which a plain conversion does not', () => {
    // 1.8 m is 5.90551 ft. Rendered at the foot step's one decimal that is "5.9" —
    // 1.79832 m, two millimetres BELOW the floor the stepper exists to hold. The
    // asymmetric case: a max rounded the same way would be a millimetre too high.
    expect(boundsToUnit(1800, 12000, 'ft').min).toBe(6);
    expect(fromMM(1800, 'ft')).toBeCloseTo(5.90551, 5);
    expect(boundsToUnit(1800, 12000, 'ft').max).toBe(39.3);
    expect(toMM(39.3, 'ft') / 1000).toBeLessThan(12);
    // And an exact conversion is not nudged off its own value by the epsilon.
    expect(boundsToUnit(1000, 50000, 'm')).toEqual({ min: 1, max: 50 });
    expect(boundsToUnit(1800, 12000, 'm').min).toBe(1.8);
    expect(boundsToUnit(1000, 50000, 'cm').min).toBe(100);
  });

  it('never hands a stepper a range it cannot move inside', () => {
    // Rounding BOTH ends inward is only safe while it leaves an interval, and the
    // catalog is full of ranges narrower than one step of a coarse unit. A
    // mirror's 15-60 mm depth is 0.049-0.197 ft and rounds to 0.1 at both ends —
    // two chevrons, one number, a control that looks broken. A door's 35-60 mm
    // INVERTS to min 0.2 / max 0.1, and `NumberField.bump` applies max first and
    // min second, so every press lands on `min`: pressing DOWN on a door's depth
    // in feet raised it past its own maximum and stuck.
    //
    // The sweep is the assertion, because picking examples is how the first
    // version of this missed fourteen combinations.
    const bad: string[] = [];
    for (const c of CATEGORIES) {
      for (const s of SHAPES) {
        const r = dimRangeFor(c, s);
        for (const unit of UNITS) {
          for (let i = 0; i < 3; i++) {
            const b = boundsToUnit(r.min[i], r.max[i], unit);
            if (!(b.min < b.max)) bad.push(`${c}/${s} axis ${i} ${unit}: ${b.min}..${b.max}`);
          }
        }
      }
    }
    expect(bad, `unusable stepper bounds — ${bad.slice(0, 8).join(' | ')}`).toEqual([]);
  });

  it('falls back to the exact conversion rather than to no bound at all', () => {
    // When it does collapse, the bounds still have to bracket the real range —
    // `clampDims` is the backstop there, and it clamps rather than refuses, which
    // is why the Inspector can afford this branch and the room editor could not.
    const door = boundsToUnit(35, 60, 'ft');
    expect(door.min).toBeCloseTo(fromMM(35, 'ft'), 9);
    expect(door.max).toBeCloseTo(fromMM(60, 'ft'), 9);
    expect(door.min).toBeLessThan(door.max);
    // And the room's own ranges must NOT reach it — they are metres wide, and
    // there an out-of-range value is refused rather than clamped.
    for (const unit of UNITS) {
      for (const axis of AXES) {
        const r = roomAxisRange(axis);
        const b = boundsToUnit(r.min * 1000, r.max * 1000, unit);
        const p = Math.pow(10, decimalsOf(stepFor(unit)));
        expect(Math.round(b.min * p) / p, `${axis} ${unit} min is not step-aligned`).toBe(b.min);
        expect(toMM(b.min, unit) / 1000).toBeGreaterThanOrEqual(r.min);
        expect(toMM(b.max, unit) / 1000).toBeLessThanOrEqual(r.max);
      }
    }
  });

  it('derives its precision from the step, not from the display precision', () => {
    // They disagree for cm (step 1, display 1dp) and ft (step 0.1, display 2dp),
    // and it is the STEP that decides what a bumped value renders as.
    expect(decimalsOf(stepFor('cm'))).toBe(0);
    expect(precisionFor('cm')).toBe(1);
    expect(decimalsOf(stepFor('ft'))).toBe(1);
    expect(precisionFor('ft')).toBe(2);
    expect(decimalsOf(0.05)).toBe(2);
    expect(decimalsOf(10)).toBe(0);
  });
});

describe('unit conversion', () => {
  it('round-trips mm through every unit', () => {
    for (const u of ['mm', 'cm', 'm', 'in', 'ft'] as const) {
      expect(toMM(fromMM(1234, u), u)).toBeCloseTo(1234);
    }
  });

  it('converts known values', () => {
    expect(fromMM(1000, 'm')).toBeCloseTo(1);
    expect(fromMM(304.8, 'ft')).toBeCloseTo(1);
    expect(toMM(1, 'in')).toBeCloseTo(25.4);
  });

  it('formats to the unit precision', () => {
    expect(formatDim(1000, 'm')).toBe('1.00');
    expect(formatDim(1000, 'mm')).toBe('1000');
    expect(precisionFor('m')).toBe(2);
    expect(precisionFor('mm')).toBe(0);
  });
});

describe('formatDim is the only safe way to put a converted length in a sentence', () => {
  it('never renders more decimals than its unit has precision for', () => {
    // A range sentence in the Inspector's mount-height row interpolated the raw
    // output of `boundsToUnit` and printed
    //     "0-0.03280839895013123 ft under this ceiling."
    // for a 1790 mm piece under an 1800 mm ceiling. That is not a bug in
    // `boundsToUnit`: its collapse guard deliberately falls back to unrounded
    // values, because preserving a real interval matters more to the ARITHMETIC
    // than rendering does. It is a bug in reading a bound as if it were display
    // text. `formatDim` is what makes a caller safe, and this is the property it
    // owes them — a ceiling on the decimals for every input, including the ones
    // that convert to a repeating fraction.
    const units = ['mm', 'cm', 'm', 'ft', 'in'] as const;
    const samples = [0, 1, 10, 10.5, 15.24, 40, 333, 1790, 12345];
    let checked = 0;
    for (const unit of units) {
      for (const mm of samples) {
        const decimals = (formatDim(mm, unit).split('.')[1] ?? '').length;
        expect(decimals).toBeLessThanOrEqual(precisionFor(unit));
        checked++;
      }
    }
    // Assert the sweep actually swept, against a LITERAL. The first version of
    // this read `units.length * samples.length` — both sides derived from the
    // arrays being counted, so shrinking either one kept it true: a check that
    // could not fail, inside the test written to stop checks that cannot fail.
    // Caught by mutating the sample list and watching it stay green.
    expect(checked).toBe(45);
  });

  it('is not what a raw conversion gives you, in the case that caught us', () => {
    // The exact input from the defect, kept as the reason the rule above exists.
    // Not an assertion about `boundsToUnit` — about the gap between converting
    // and displaying, which is what a caller has to remember to close.
    expect(String(fromMM(10, 'ft'))).toContain('0.032808');
    expect(formatDim(10, 'ft')).toBe('0.03');
  });
});
