import { describe, it, expect } from 'vitest';
import { candelaFromLumens, candelaFromLumensInCone, hexFromKelvin } from '@/lib/light-units';

const channels = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

describe('candelaFromLumens', () => {
  it('spreads lumens over the whole sphere', () => {
    // The usual "60 W equivalent" bulb.
    expect(candelaFromLumens(800)).toBeCloseTo(800 / (4 * Math.PI), 9);
    expect(candelaFromLumens(800)).toBeCloseTo(63.66, 2);
  });

  it('keeps two lamps in proportion', () => {
    // The property that makes the unit worth carrying: a 400 lm bedside lamp is
    // half a 800 lm floor lamp, in the scene as on the box.
    expect(candelaFromLumens(400) * 2).toBeCloseTo(candelaFromLumens(800), 9);
  });

  it('treats nonsense as no light', () => {
    expect(candelaFromLumens(0)).toBe(0);
    expect(candelaFromLumens(-5)).toBe(0);
    expect(candelaFromLumens(NaN)).toBe(0);
  });
});

describe('candelaFromLumensInCone', () => {
  it('concentrating the same lumens makes them brighter', () => {
    // A shade does not create light, it aims it.
    expect(candelaFromLumensInCone(800, 60)).toBeGreaterThan(candelaFromLumensInCone(800, 120));
    expect(candelaFromLumensInCone(800, 120)).toBeGreaterThan(candelaFromLumens(800));
  });

  it('is exactly twice the isotropic figure over a hemisphere', () => {
    // The widest a cone goes is 180° full angle — half the sphere, so the same
    // lumens are twice as intense. (There is no "full sphere" cone: that is what
    // candelaFromLumens is for, and what a bare bulb gets.)
    expect(candelaFromLumensInCone(800, 180)).toBeCloseTo(candelaFromLumens(800) * 2, 6);
    expect(candelaFromLumensInCone(800, 999)).toBe(candelaFromLumensInCone(800, 180));
  });

  it('is finite at the degenerate ends', () => {
    expect(Number.isFinite(candelaFromLumensInCone(800, 0))).toBe(true);
    expect(candelaFromLumensInCone(0, 90)).toBe(0);
  });
});

describe('hexFromKelvin', () => {
  it('makes a domestic bulb warm', () => {
    const [r, g, b] = channels(hexFromKelvin(2700));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeGreaterThan(60); // unmistakably warm, not a faint tint
  });

  it('makes daylight near-neutral', () => {
    const [r, g, b] = channels(hexFromKelvin(6500));
    expect(Math.abs(r - b)).toBeLessThan(30);
    expect(Math.abs(r - g)).toBeLessThan(30);
  });

  it('goes blue past daylight', () => {
    const [r, , b] = channels(hexFromKelvin(12000));
    expect(b).toBeGreaterThan(r);
  });

  it('warms monotonically as the temperature drops', () => {
    const warmth = [2200, 2700, 3000, 4000, 5000, 6500].map((k) => {
      const [r, , b] = channels(hexFromKelvin(k));
      return r - b;
    });
    for (let i = 1; i < warmth.length; i++) {
      expect(warmth[i]).toBeLessThan(warmth[i - 1]);
    }
  });

  it('always returns a full-brightness, well-formed colour', () => {
    for (const k of [1000, 1667, 2700, 6500, 25000, 40000]) {
      const hex = hexFromKelvin(k);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      // Normalised, not clipped — one channel is always at the top.
      expect(Math.max(...channels(hex))).toBe(255);
    }
  });
});
