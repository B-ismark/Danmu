import { describe, it, expect } from 'vitest';
import { boundsToUnit, decimalsOf, fromMM, stepFor, steppedValue, toMM, formatDim, precisionFor } from '@/lib/units';
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
    let checked = 0;
    for (const c of CATEGORIES) {
      for (const s of SHAPES) {
        const r = dimRangeFor(c, s);
        for (const unit of UNITS) {
          for (let i = 0; i < 3; i++) {
            const b = boundsToUnit(r.min[i], r.max[i], unit);
            checked++;
            if (!(b.min < b.max)) bad.push(`${c}/${s} axis ${i} ${unit}: ${b.min}..${b.max}`);
          }
        }
      }
    }
    // The sweep's own tripwire. `toEqual([])` is satisfied by an empty subject, so
    // if `CATEGORIES` or `SHAPES` ever resolved to nothing — a refactor, a bad
    // import — this would report all clear over zero combinations. Its sibling in
    // `zone-findings.test.ts` has carried one of these since the day it was written.
    expect(checked).toBeGreaterThan(1000);
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

describe('a chevron never moves a value against its own arrow', () => {
  // `steppedValue` IS what the field runs — not a copy of it. This file used to
  // model `NumberField.bump` in a local helper and nothing under tests/ imported
  // the component, so the one control here with a destructive, documented history
  // had no test at all: swapping its clamp order, or its rounding, left every
  // assertion green.
  //
  // The defect it now pins: `boundsToUnit` rounds a bound to the STEP grid, while
  // a field renders its value at `precisionFor` — finer for ft (2 vs 1) and cm
  // (1 vs 0). A legal value stored exactly on a bound therefore displays just
  // outside it, and an unguarded clamp throws it across, so the press moves the
  // value the opposite way to the arrow.

  const H = roomAxisRange('height');
  const ftBounds = boundsToUnit(H.min * 1000, H.max * 1000, 'ft');
  const shownAtFloor = fromMM(H.min * 1000, 'ft').toFixed(precisionFor('ft'));

  it('the setup is real: the minimum ceiling displays BELOW its own bound in feet', () => {
    // Without this the two tests under it would be asserting nothing.
    expect(Number(shownAtFloor)).toBeLessThan(ftBounds.min);
  });

  it('pressing DOWN at the floor does not raise the ceiling', () => {
    // Against the number on screen, not against `H.min`: 1.8 m is 5.90551 ft and
    // the field's two decimals render that `5.91`, which is already a hair ABOVE
    // the floor. What must never happen is the press making it larger still — the
    // bug committed `6.0` ft, 1828.8 mm, from a chevron marked "decrease".
    const after = steppedValue(shownAtFloor, -1, ftBounds.min, ftBounds.max, stepFor('ft'));
    expect(Number(after)).toBeLessThanOrEqual(Number(shownAtFloor));
  });

  it('…while UP from the same spot still moves', () => {
    const after = steppedValue(shownAtFloor, 1, ftBounds.min, ftBounds.max, stepFor('ft'));
    expect(Number(after)).toBeGreaterThan(Number(shownAtFloor));
  });

  it('a room saved below the current floor is not raised by a DOWN press', () => {
    // The 1.65 m room CLAUDE.md names — legal when it was written, under the floor
    // now. Both chevrons used to emit 1.80: a press meaning "shorter" raised the
    // ceiling 15 cm and regraded every piece hung from it.
    const b = boundsToUnit(H.min * 1000, H.max * 1000, 'm');
    expect(steppedValue('1.65', -1, b.min, b.max, stepFor('m'))).toBe('1.65');
    expect(Number(steppedValue('1.65', 1, b.min, b.max, stepFor('m')))).toBeGreaterThan(1.65);
  });

  it('an ordinary press in the middle of a range still steps', () => {
    // The guard must not have turned the stepper off.
    expect(steppedValue('3', -1, 1, 10, 0.5)).toBe('2.5');
    expect(steppedValue('3', 1, 1, 10, 0.5)).toBe('3.5');
  });

  it('holds at both ends of every ROOM axis too, in every unit', () => {
    // The room's own ranges are not in the catalog sweep below, and they are the
    // ones that cost the most when an arrow reverses: a ceiling press regrades
    // every piece hung from it. Two distinct causes reach here — the precision gap
    // (ft, cm) and `boundsToUnit`'s exact-conversion fallback for a range narrower
    // than one step (m, in) — which is why the guard is judged on the ROUNDED
    // result rather than on the clamp alone. A fix aimed at only the first leaves
    // the second standing.
    const bad: string[] = [];
    let checked = 0;
    for (const axis of AXES) {
      const r = roomAxisRange(axis);
      for (const unit of UNITS) {
        const step = stepFor(unit);
        const b = boundsToUnit(r.min * 1000, r.max * 1000, unit);
        const atMin = fromMM(r.min * 1000, unit).toFixed(precisionFor(unit));
        const atMax = fromMM(r.max * 1000, unit).toFixed(precisionFor(unit));
        checked += 2;
        if (Number(steppedValue(atMin, -1, b.min, b.max, step)) > Number(atMin)) {
          bad.push(`room ${axis} ${unit}: DOWN at min ${atMin} grew`);
        }
        if (Number(steppedValue(atMax, 1, b.min, b.max, step)) < Number(atMax)) {
          bad.push(`room ${axis} ${unit}: UP at max ${atMax} shrank`);
        }
      }
    }
    expect(checked).toBe(AXES.length * UNITS.length * 2);
    expect(bad, `room arrows moving the wrong way — ${bad.join(' | ')}`).toEqual([]);
  });

  it('holds at both ends of every catalog range, in every unit', () => {
    // The sweep is the assertion, for the reason the one above it gives: picking
    // examples is how the first version of the bound fix missed fourteen.
    const bad: string[] = [];
    let checked = 0;
    for (const c of CATEGORIES) {
      for (const s of SHAPES) {
        const r = dimRangeFor(c, s);
        for (const unit of UNITS) {
          const step = stepFor(unit);
          for (let i = 0; i < 3; i++) {
            const b = boundsToUnit(r.min[i], r.max[i], unit);
            const atMin = fromMM(r.min[i], unit).toFixed(precisionFor(unit));
            const atMax = fromMM(r.max[i], unit).toFixed(precisionFor(unit));
            checked += 2;
            if (Number(steppedValue(atMin, -1, b.min, b.max, step)) > Number(atMin)) {
              bad.push(`${c}/${s} axis ${i} ${unit}: DOWN at min ${atMin} grew`);
            }
            if (Number(steppedValue(atMax, 1, b.min, b.max, step)) < Number(atMax)) {
              bad.push(`${c}/${s} axis ${i} ${unit}: UP at max ${atMax} shrank`);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(bad, `arrows moving the wrong way — ${bad.slice(0, 8).join(' | ')}`).toEqual([]);
  });
});

describe('a chevron never lands outside the range either', () => {
  // A second property, and NOT implied by the direction guard: the clamps run
  // before `toFixed`, so the rounding can carry a clamped value straight back out.
  // A mirror's 15-60 mm depth in feet shows `0.05`; DOWN clamped to the exact
  // minimum 0.049 and rendered "0.0" — 0 mm, a depth the mirror does not have.
  // `Inspector.commitDebounced` then refuses it for being <= 0, so nothing commits,
  // nothing re-renders, and the field sits on 0.0 with no message on the path. UP
  // rendered 0.2 ft = 60.96 mm, over the 60 mm maximum: the whole range crossed by
  // one chevron. 366 combinations did this, all in feet, 122 landing on zero —
  // measured by danmu-cb over 55,500 presses and untouched by the direction fix.

  it('the mirror-depth-in-feet case, named because it is the one that reached zero', () => {
    const r = dimRangeFor('mirror', 'mirror');
    const b = boundsToUnit(r.min[1], r.max[1], 'ft');
    const shown = fromMM(r.min[1], 'ft').toFixed(precisionFor('ft'));
    const down = steppedValue(shown, -1, b.min, b.max, stepFor('ft'));
    expect(Number(down)).toBeGreaterThan(0);
    expect(toMM(Number(down), 'ft')).toBeGreaterThanOrEqual(r.min[1] - 1e-6);
  });

  it('holds across the whole catalog and every room axis, both ends, every unit', () => {
    const bad: string[] = [];
    let checked = 0;
    const check = (label: string, atMin: string, atMax: string, min: number, max: number, step: number) => {
      for (const [from, dir] of [[atMin, -1], [atMax, 1]] as const) {
        const landed = Number(steppedValue(from, dir, min, max, step));
        checked++;
        // A press must not MOVE a value out of range. It may legitimately leave one
        // there: the bounds are rounded to the step grid while the field renders at
        // `precisionFor`, which is finer for ft and cm, so a perfectly legal stored
        // value can already sit a hair outside its own rounded bound. Refusing to
        // move it is the whole point of the guard, and an assertion that simply
        // demanded "landed in range" flagged 8585 of those no-ops as defects — it
        // was asserting the wrong property, not finding a bug.
        const moved = landed !== Number(from);
        if (moved && (landed < min - 1e-9 || landed > max + 1e-9)) {
          bad.push(`${label} ${dir < 0 ? 'DOWN' : 'UP'} from ${from} moved to ${landed}, outside ${min}..${max}`);
        }
      }
    };
    for (const c of CATEGORIES) {
      for (const s of SHAPES) {
        const r = dimRangeFor(c, s);
        for (const unit of UNITS) {
          for (let i = 0; i < 3; i++) {
            const b = boundsToUnit(r.min[i], r.max[i], unit);
            check(
              `${c}/${s} axis ${i} ${unit}`,
              fromMM(r.min[i], unit).toFixed(precisionFor(unit)),
              fromMM(r.max[i], unit).toFixed(precisionFor(unit)),
              b.min, b.max, stepFor(unit),
            );
          }
        }
      }
    }
    for (const axis of AXES) {
      const r = roomAxisRange(axis);
      for (const unit of UNITS) {
        const b = boundsToUnit(r.min * 1000, r.max * 1000, unit);
        check(
          `room ${axis} ${unit}`,
          fromMM(r.min * 1000, unit).toFixed(precisionFor(unit)),
          fromMM(r.max * 1000, unit).toFixed(precisionFor(unit)),
          b.min, b.max, stepFor(unit),
        );
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(bad, `presses landing out of range — ${bad.slice(0, 6).join(' | ')}`).toEqual([]);
  });
});
