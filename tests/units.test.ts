import { describe, it, expect } from 'vitest';
import { boundToUnit, decimalsOf, fromMM, stepFor, toMM, formatDim, precisionFor } from '@/lib/units';
import { roomAxisRange, roomAxisWithin, type RoomAxis } from '@/lib/dimension-ranges';

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
        const lo = boundToUnit(roomAxisRange(axis).min * 1000, unit, 'min');
        const hi = boundToUnit(roomAxisRange(axis).max * 1000, unit, 'max');
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
    expect(boundToUnit(1800, 'ft', 'min')).toBe(6);
    expect(fromMM(1800, 'ft')).toBeCloseTo(5.90551, 5);
    expect(boundToUnit(12000, 'ft', 'max')).toBe(39.3);
    expect(toMM(39.3, 'ft') / 1000).toBeLessThan(12);
    // And an exact conversion is not nudged off its own value by the epsilon.
    expect(boundToUnit(1000, 'm', 'min')).toBe(1);
    expect(boundToUnit(50000, 'm', 'max')).toBe(50);
    expect(boundToUnit(1800, 'm', 'min')).toBe(1.8);
    expect(boundToUnit(1000, 'cm', 'min')).toBe(100);
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
