import { describe, expect, it } from 'vitest';
import { FAN_HUB_H, FAN_HUB_R, fanBlade, fanColumn, pendantDrop } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { verticalExtent } from '@/lib/physics';

/** Every height in a shape's legal band, at 10 mm — the band is the assertion,
 *  because picking examples is how the first version of `fanBlade` was missed. */
function band(min: number, max: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max; v += 10) out.push(v);
  if (out[out.length - 1] !== max) out.push(max);
  return out;
}

const FAN = dimRangeFor('fan', 'fan');
const PENDANT = dimRangeFor('lamp', 'lamp-pendant');

describe('the ceiling fan is drawn at the height it declares', () => {
  it('spans exactly its declared height, centred on its origin, across the whole band', () => {
    const heights = band(FAN.min[2], FAN.max[2]);
    expect(heights.length, 'the sweep must have something in it').toBeGreaterThan(20);
    for (const hMM of heights) {
      const c = fanColumn(hMM);
      expect(c.top - c.bottom, `${hMM} mm: drawn height`).toBeCloseTo(hMM / 1000, 9);
      // Centred, because a ceiling anchor's `pos[1]` is the mesh CENTRE. This is
      // the half the old drawing got wrong even where the total was close.
      expect(c.top, `${hMM} mm: top`).toBeCloseTo(hMM / 2000, 9);
      expect(c.bottom, `${hMM} mm: bottom`).toBeCloseTo(-hMM / 2000, 9);
    }
  });

  it('agrees with the extent every consumer computes — not with a re-derivation', () => {
    // `verticalExtent` is what `clearance.ts`, `settleHeights` and `groundY` read.
    // Asserting against `hMM / 2000` alone would only pin this function to itself.
    for (const hMM of band(FAN.min[2], FAN.max[2])) {
      const y = 2.6;
      const c = fanColumn(hMM);
      const [lo, hi] = verticalExtent('fan', 'fan', [1000, 1000, hMM], y);
      expect(y + c.bottom, `${hMM} mm`).toBeCloseTo(lo, 9);
      expect(y + c.top, `${hMM} mm`).toBeCloseTo(hi, 9);
    }
  });

  it('tiles the height between housing and downrod, leaving no gap and no overlap', () => {
    for (const hMM of band(FAN.min[2], FAN.max[2])) {
      const c = fanColumn(hMM);
      expect(c.hubH + c.rodH, `${hMM} mm`).toBeCloseTo(hMM / 1000, 9);
      // …and each piece is where its own half-height says it is.
      expect(c.hubY - c.hubH / 2, `${hMM} mm: hub bottom`).toBeCloseTo(c.bottom, 9);
      expect(c.rodY + c.rodH / 2, `${hMM} mm: rod top`).toBeCloseTo(c.top, 9);
      expect(c.hubY + c.hubH / 2, `${hMM} mm: they meet`).toBeCloseTo(c.rodY - c.rodH / 2, 9);
    }
  });

  it('keeps the housing at full thickness once there is room, and caps it when there is not', () => {
    // Both sides of the cap, which is the only branch in the function. A one-ended
    // sweep would leave `Math.min` free to be either argument alone.
    expect(fanColumn(450).hubH, 'a tall fan keeps the full housing').toBeCloseTo(FAN_HUB_H, 9);
    expect(fanColumn(450).rodH, '…and spends the rest on downrod').toBeCloseTo(0.45 - FAN_HUB_H, 9);
    expect(fanColumn(150).hubH, 'a 150 mm fan cannot spare 80 mm for its motor').toBeCloseTo(0.06, 9);
    expect(fanColumn(150).rodH).toBeCloseTo(0.09, 9);
    expect(fanColumn(150).hubH, 'the cap really is below the nominal').toBeLessThan(FAN_HUB_H);
  });

  it('never draws a blade thicker than the housing that carries it', () => {
    // The blade box is 0.012 tall in `FanGeo`; the housing must be able to hold it
    // at the narrowest legal fan, or the blades stick out of the motor.
    expect(fanColumn(FAN.min[2]).hubH).toBeGreaterThan(0.012);
  });

  it('leaves the swept circle to `fanBlade` and does not touch it', () => {
    // The two axes are separate functions on purpose; this pins that the vertical
    // one has not started having opinions about the horizontal one.
    expect(fanBlade(1000).tip).toBeCloseTo(0.5, 9);
    expect(FAN_HUB_R).toBeCloseTo(0.1, 9);
  });
});

describe('the pendant lamp is drawn at the size it declares', () => {
  it('spans exactly its declared drop, centred on its origin, across the whole band', () => {
    const heights = band(PENDANT.min[2], PENDANT.max[2]);
    expect(heights.length).toBeGreaterThan(20);
    for (const hMM of heights) {
      const g = pendantDrop(350, hMM);
      expect(g.top - g.bottom, `${hMM} mm: drawn drop`).toBeCloseTo(hMM / 1000, 9);
      expect(g.top, `${hMM} mm: top`).toBeCloseTo(hMM / 2000, 9);
      expect(g.bottom, `${hMM} mm: bottom`).toBeCloseTo(-hMM / 2000, 9);
    }
  });

  it('agrees with the extent `clearance.ts` reports a clash from', () => {
    for (const hMM of band(PENDANT.min[2], PENDANT.max[2])) {
      const y = 2.5;
      const g = pendantDrop(350, hMM);
      const [lo, hi] = verticalExtent('lamp', 'lamp-pendant', [350, 350, hMM], y);
      expect(y + g.bottom, `${hMM} mm`).toBeCloseTo(lo, 9);
      expect(y + g.top, `${hMM} mm`).toBeCloseTo(hi, 9);
    }
  });

  it('tiles the drop between cord and shade', () => {
    for (const hMM of band(PENDANT.min[2], PENDANT.max[2])) {
      const g = pendantDrop(350, hMM);
      expect(g.cordH + g.domeH, `${hMM} mm`).toBeCloseTo(hMM / 1000, 9);
      expect(g.domeY - g.domeH / 2, `${hMM} mm: shade bottom`).toBeCloseTo(g.bottom, 9);
      expect(g.cordY + g.cordH / 2, `${hMM} mm: cord top`).toBeCloseTo(g.top, 9);
      expect(g.domeY + g.domeH / 2, `${hMM} mm: they meet`).toBeCloseTo(g.cordY - g.cordH / 2, 9);
    }
  });

  it('takes its WIDTH from the declared width, which the old drawing ignored entirely', () => {
    // The whole horizontal axis was the literal 0.15 — a 300 mm shade on a piece
    // declaring 350, and the same 300 mm shade on one declaring 800.
    for (const wMM of [PENDANT.min[0], 350, 600, PENDANT.max[0]]) {
      expect(pendantDrop(wMM, 400).domeR, `${wMM} mm wide`).toBeCloseTo(wMM / 2000, 9);
    }
  });

  it('keeps the bulb inside the shade at both ends of the band', () => {
    for (const hMM of band(PENDANT.min[2], PENDANT.max[2])) {
      for (const wMM of [PENDANT.min[0], PENDANT.max[0]]) {
        const g = pendantDrop(wMM, hMM);
        expect(g.bulbY - g.bulbR, `${wMM}x${hMM}: bulb bottom`).toBeGreaterThan(g.bottom);
        expect(g.bulbY + g.bulbR, `${wMM}x${hMM}: bulb top`).toBeLessThan(g.domeY + g.domeH / 2);
        expect(g.bulbR, `${wMM}x${hMM}: bulb fits the shade mouth`).toBeLessThan(g.domeR);
      }
    }
  });

  it('caps the shade against its own width, so a long drop is a cord and not a spike', () => {
    // Both arguments of the `Math.min` reached, which one end of the band cannot do.
    const wide = pendantDrop(800, 900);
    expect(wide.domeH, 'the biggest legal pendant: 0.4h = 0.36 under 1.2r = 0.48, so h binds')
      .toBeCloseTo(0.36, 9);
    const narrow = pendantDrop(150, 900);
    expect(narrow.domeH, 'width binds on a narrow, long pendant').toBeCloseTo(0.09, 9);
    expect(narrow.cordH, '…and the rest is cord').toBeCloseTo(0.81, 9);
    const squat = pendantDrop(800, 150);
    expect(squat.domeH, 'height binds on a wide, short one').toBeCloseTo(0.06, 9);
  });
});
