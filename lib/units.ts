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

export const UNIT_OPTIONS: { id: DimUnit; label: string }[] = [
  { id: 'm', label: 'Meters (m)' },
  { id: 'cm', label: 'Centimeters (cm)' },
  { id: 'mm', label: 'Millimeters (mm)' },
  { id: 'ft', label: 'Feet (ft)' },
  { id: 'in', label: 'Inches (in)' },
];
