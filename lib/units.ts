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
 *  makes the number the user is told and the bound the arrows obey the same one. */
export function boundToUnit(valueMM: number, unit: DimUnit, side: 'min' | 'max'): number {
  const p = Math.pow(10, decimalsOf(stepFor(unit)));
  const raw = fromMM(valueMM, unit) * p;
  return (side === 'min' ? Math.ceil(raw - 1e-9) : Math.floor(raw + 1e-9)) / p;
}

export const UNIT_OPTIONS: { id: DimUnit; label: string }[] = [
  { id: 'm', label: 'Meters (m)' },
  { id: 'cm', label: 'Centimeters (cm)' },
  { id: 'mm', label: 'Millimeters (mm)' },
  { id: 'ft', label: 'Feet (ft)' },
  { id: 'in', label: 'Inches (in)' },
];
