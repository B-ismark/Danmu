import { describe, it, expect } from 'vitest';
import { fromMM, toMM, formatDim, precisionFor } from '@/lib/units';

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
