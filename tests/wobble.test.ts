import { describe, it, expect } from 'vitest';
import { WOBBLE, atRest, leanFor, stepSpring, type Spring } from '@/lib/wobble';
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
