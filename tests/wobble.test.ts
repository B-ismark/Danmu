import { describe, it, expect } from 'vitest';
import { Euler, Vector3 } from 'three';
import { MAX_RISE_M, WOBBLE, atRest, leanFor, pivotOffset, stepSpring, tiltCap, type Spring } from '@/lib/wobble';
import { localToWorld } from '@/lib/geometry';

// The give in a carried piece (lib/wobble.ts). Drawn only — nothing here reaches
// a stored transform — so what can go wrong is how it LOOKS, and each of these is
// a look that is wrong in a way no screenshot of one frame shows.

/** Run a spring from `from` to rest at `target`, counting the swings you could
 *  SEE — peaks past 0.3°. The tail below that is real and invisible, and counting
 *  it would make the test about the rest threshold instead of the look. */
function settle(from: Spring, target: number) {
  let s = from;
  let visible = 0;
  let t = 0;
  let peak = 0;
  let prevV = s.v;
  let lastSeen = 0;
  while (!atRest(s, target) && t < 5) {
    s = stepSpring(s, target, 1 / 240);
    t += 1 / 240;
    peak = Math.max(peak, Math.abs(s.x - target));
    if (Math.abs(s.x - target) > (0.3 * Math.PI) / 180) lastSeen = t;
    if (Math.sign(s.v) !== Math.sign(prevV) && prevV !== 0) {
      // A turning point: the end of one swing.
      if (peak > (0.3 * Math.PI) / 180 && t > 1 / 240) visible++;
      peak = 0;
    }
    prevV = s.v;
  }
  return { t, swings: visible, stillBy: lastSeen };
}

describe('the wobble', () => {
  it('rocks a couple of times and is still inside a second', () => {
    // A lifeless (critically damped) spring never crosses; a jelly one keeps going.
    const { t, swings, stillBy } = settle({ x: WOBBLE.maxTilt, v: 0 }, 0);
    expect(swings).toBeGreaterThanOrEqual(2);
    expect(swings).toBeLessThanOrEqual(4);
    // Visibly still (inside 0.3°) well within a second of the release, and at
    // rest — no longer asking for frames — inside two.
    expect(stillBy).toBeLessThan(0.9);
    expect(t).toBeLessThan(2);
  });

  it('leans the top AWAY from the way the piece is going', () => {
    // Unrotated: moving +Z tips the top toward −Z (negative turn about X), moving
    // +X tips it toward −X (positive turn about Z). The wrong sign reads as being
    // towed by the top.
    expect(leanFor(0, 1, 0).aboutX).toBeLessThan(0);
    expect(leanFor(0, 1, 0).aboutZ).toBeCloseTo(0, 12);
    expect(leanFor(1, 0, 0).aboutZ).toBeGreaterThan(0);
    expect(leanFor(1, 0, 0).aboutX).toBeCloseTo(0, 12);
  });

  it('leans the same way relative to the piece, whichever way it is turned', () => {
    // Moving along the piece's own +Z, at any heading, is the same lean. At 0° and
    // 180° a hand-written rotation with the wrong sign still passes; 37° does not.
    for (const rot of [0, 0.64, Math.PI / 2, 2.3, Math.PI]) {
      const [wx, wz] = localToWorld(rot, 0, 1);
      const l = leanFor(wx, wz, rot);
      expect(l.aboutX, `rot ${rot}`).toBeCloseTo(-WOBBLE.gain, 12);
      expect(l.aboutZ, `rot ${rot}`).toBeCloseTo(0, 12);
    }
  });

  it('never tips further than its ceiling, however fast the pointer', () => {
    const l = leanFor(40, -40, 0.3);
    expect(Math.abs(l.aboutX)).toBeLessThanOrEqual(WOBBLE.maxTilt);
    expect(Math.abs(l.aboutZ)).toBeLessThanOrEqual(WOBBLE.maxTilt);
    expect(WOBBLE.maxTilt).toBeCloseTo((7 * Math.PI) / 180, 12);
  });

  it('is the same motion at 30 frames a second as at 144', () => {
    // A slow frame is several small steps, so the spring does not blow up or
    // change character on a weak GPU.
    let a: Spring = { x: 0.1, v: 0 };
    let b: Spring = { x: 0.1, v: 0 };
    for (let i = 0; i < 30; i++) a = stepSpring(a, 0, 1 / 30);
    for (let i = 0; i < 144; i++) b = stepSpring(b, 0, 1 / 144);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.004);
  });
});

describe('a leaning piece stays on the floor', () => {
  /** The four bottom corners after the inner group's lean and offset, through
   *  three's own Euler — not a re-derivation of the matrix `pivotOffset` writes out,
   *  which would agree with it by construction. */
  const corners = (rx: number, rz: number, hw: number, hd: number) => {
    const off = pivotOffset(rx, rz, hw, hd);
    const e = new Euler(rx, 0, rz);
    return [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]].map(([x, z]) =>
      new Vector3(x, 0, z).applyEuler(e).add(new Vector3(...off)),
    );
  };
  const t = WOBBLE.maxTilt;
  const leans: [number, number][] = [[t, 0], [-t, 0], [0, t], [0, -t], [t, t], [-t, t], [t, -t], [-t, -t], [0.03, -0.05]];

  it('no corner goes below the floor, and the low one rests on it', () => {
    // A 2.2 m sofa, a chair, a long narrow bench: the sofa is the case that sank
    // 134 mm when the lean pivoted on the middle of the foot.
    for (const [hw, hd] of [[1.1, 0.45], [0.25, 0.25], [0.9, 0.2]]) {
      for (const [rx, rz] of leans) {
        const ys = corners(rx, rz, hw, hd).map((c) => c.y);
        expect(Math.min(...ys)).toBeGreaterThan(-1e-9);
        expect(Math.min(...ys)).toBeLessThan(1e-9);
      }
    }
  });

  it('is no offset at all when upright, from either side', () => {
    for (const z of [0, 1e-12, -1e-12]) {
      const o = pivotOffset(z, z, 1.1, 0.45);
      for (const v of o) expect(Math.abs(v)).toBeLessThan(1e-9);
    }
  });

  it('big pieces lean less, small ones keep the full sway', () => {
    expect(tiltCap(0.5)).toBe(WOBBLE.maxTilt);
    // A sofa's far edge rises no more than the cap however it is carried.
    const cap = tiltCap(2.2);
    expect(cap).toBeLessThan(WOBBLE.maxTilt);
    expect(2.2 * Math.sin(cap)).toBeCloseTo(MAX_RISE_M, 9);
    expect(tiltCap(0)).toBe(WOBBLE.maxTilt);
  });
});
