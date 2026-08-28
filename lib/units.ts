// Dimension unit conversions. Internal storage stays in mm; display units convert.

import type { DimUnit } from './store';

const MM_PER: Record<DimUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

export function fromMM(valueMM: number, unit: DimUnit): number {
  return valueMM / MM_PER[unit];
}

export function toMM(value: number, unit: DimUnit): number {
  return value * MM_PER[unit];
}

/** Reasonable step for input sliders / increments per unit. */
export function stepFor(unit: DimUnit): number {
  switch (unit) {
    case 'mm':
      return 10;
    case 'cm':
      return 1;
    case 'm':
      return 0.05;
    case 'in':
      return 0.5;
    case 'ft':
      return 0.1;
  }
}

/** Decimal places for display per unit. */
export function precisionFor(unit: DimUnit): number {
  switch (unit) {
    case 'mm':
      return 0;
    case 'cm':
      return 1;
    case 'm':
      return 2;
    case 'in':
      return 1;
    case 'ft':
      return 2;
  }
}

export function formatDim(valueMM: number, unit: DimUnit): string {
  const v = fromMM(valueMM, unit);
  return v.toFixed(precisionFor(unit));
}

/** Decimals implied by a step, so 0.01 steps don't produce 2.7300000000000004.
 *  Lives here rather than in `NumberField` because `boundToUnit` below has to
 *  round to the SAME precision the field will render at — two copies of this and
 *  a bound rounds to a number the stepper then renders just outside itself. */
export function decimalsOf(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** A bound expressed in mm, converted into `unit` and rounded so the number a
 *  stepper lands on stays INSIDE the range.
 *
 *  Both halves matter and each was wrong on its own. `RoomDimsEditor` handed
 *  `NumberField` a bound in METRES while the field's value was in the user's
 *  unit, so a room 5 m wide showed `500.0` cm against a max of 50 and one press
 *  of the up chevron clamped it to 50 cm — a room destroyed by one arrow, in four
 *  of the five units. And a plain conversion is not enough on its own: 1.8 m is
 *  5.90551 ft, which the field renders as `5.9` — two millimetres BELOW the floor
 *  its own stepper exists to hold. So the rounding goes toward the interior, at
 *  the step's precision, and the epsilon is there because `1.8 * 100` is
 *  180.00000000000003.
 *
 *  The sentence under the fields reads its range off the same call, which is what
 *  makes the number the user is told and the bound the arrows obey the same one.
 *
 *  Deliberately NOT exported: one end of a range cannot tell whether rounding it
 *  inward has left an interval. `boundsToUnit` is the only way in. */
function boundToUnit(valueMM: number, unit: DimUnit, side: 'min' | 'max'): number {
  const p = Math.pow(10, decimalsOf(stepFor(unit)));
  const raw = fromMM(valueMM, unit) * p;
  return (side === 'min' ? Math.ceil(raw - 1e-9) : Math.floor(raw + 1e-9)) / p;
}

/** A range in mm as the pair of bounds a stepper in `unit` should carry.
 *
 *  Rounding each end inward is only safe while it leaves an interval, and for
 *  narrow ranges in a coarse unit it does not. A mirror's depth is 15–60 mm, which
 *  in feet is 0.049–0.197 and rounds to 0.1 at BOTH ends — a stepper whose two
 *  chevrons produce the same number and looks broken. A door's 35–60 mm is worse:
 *  it rounds to a min of 0.2 and a max of 0.1, and `NumberField.bump` applies
 *  `max` first and `min` second, so an inverted pair pins every press to `min` —
 *  pressing DOWN on a door's depth in feet raised it past its own maximum and
 *  stuck there. Fourteen shape/axis/unit combinations did one or the other, all
 *  of them in feet.
 *
 *  Below one step of the display unit the stepper cannot express the range at all,
 *  so the exact conversion is the better answer there: it puts the clamp region in
 *  the right place and leaves `clampDims` — which clamps rather than refuses — to
 *  catch a value the field's own rounding lands just outside. The room editor never
 *  reaches that branch, its ranges being metres wide, and could not afford it if it
 *  did: an out-of-range room is REFUSED rather than clamped, which is the whole
 *  reason the inward rounding exists. */
export function boundsToUnit(minMM: number, maxMM: number, unit: DimUnit): { min: number; max: number } {
  const min = boundToUnit(minMM, unit, 'min');
  const max = boundToUnit(maxMM, unit, 'max');
  if (min < max) return { min, max };
  return { min: fromMM(minMM, unit), max: fromMM(maxMM, unit) };
}

export const UNIT_OPTIONS: { id: DimUnit; label: string }[] = [
  { id: 'm', label: 'Meters (m)' },
  { id: 'cm', label: 'Centimeters (cm)' },
  { id: 'mm', label: 'Millimeters (mm)' },
  { id: 'ft', label: 'Feet (ft)' },
  { id: 'in', label: 'Inches (in)' },
];
