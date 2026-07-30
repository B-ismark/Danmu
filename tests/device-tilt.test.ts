import { describe, it, expect } from 'vitest';
import { tiltFromOrientation } from '@/lib/device-tilt';

describe('tiltFromOrientation', () => {
  it('reads an upright phone as level', () => {
    expect(tiltFromOrientation(90, 0)).toBe(0);
  });

  it('reads a droop as a downward tilt', () => {
    // beta short of upright means the lens has dropped below the horizon, which
    // is the direction that makes the geometry engine over-read distance.
    expect(tiltFromOrientation(85, 0)).toBeCloseTo(5, 6);
    expect(tiltFromOrientation(95, -3)).toBeCloseTo(-5, 6);
  });

  it('refuses a phone rolled onto its side', () => {
    // In landscape the mapping from beta to lens tilt is a different expression.
    // A wrong tilt is worse than none: the fallback is the level camera the
    // engine assumed anyway.
    expect(tiltFromOrientation(90, 60)).toBeNull();
    expect(tiltFromOrientation(90, -90)).toBeNull();
  });

  it('refuses a phone that is not aimed at a wall', () => {
    expect(tiltFromOrientation(0, 0)).toBeNull(); // flat on a table
    expect(tiltFromOrientation(170, 0)).toBeNull(); // aimed at the ceiling
  });

  it('tolerates a device that reports no roll', () => {
    expect(tiltFromOrientation(88, null)).toBeCloseTo(2, 6);
  });

  it('returns null when there is no reading at all', () => {
    expect(tiltFromOrientation(null, null)).toBeNull();
    expect(tiltFromOrientation(NaN, 0)).toBeNull();
  });
});
