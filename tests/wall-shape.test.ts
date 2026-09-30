// A wall drag may not fold the room over itself.
//
// `moveWall` bounded only the room's BOUNDING BOX, and a box cannot see a room
// cross its own walls: pushing a T's bar wall up through the north wall, or a
// side wall across the stem, kept both sides in range and drew a floor with a
// wing lying across the rest of the room. `wallTravel` is the shape half.
//
// The oracle below is written from the RULE, not from `wallTravel`'s own helpers:
// crossings by orientation test, lengths by hypot, gaps by densely sampled points
// on both walls. A check that reuses the function under test's gap measure would
// agree with any bug in it.

import { describe, expect, it } from 'vitest';
import { footprintForLayout, offsetWall, wallTravel, type Footprint } from '@/lib/footprint';
import { WALL_MIN_M } from '@/lib/dimension-ranges';

type P = [number, number];

function crosses(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Least distance between two walls: 400 points along each, measured to the other
 *  wall by projection. Sampling only ever OVER-estimates a gap, by at most half a
 *  sample spacing, which is what `SAMPLE_SLACK` allows for. */
function sampledGap(a: P, b: P, c: P, d: P): number {
  const toWall = (p: P, s: P, e: P) => {
    const ex = e[0] - s[0];
    const ez = e[1] - s[1];
    const t = Math.max(0, Math.min(1, ((p[0] - s[0]) * ex + (p[1] - s[1]) * ez) / (ex * ex + ez * ez || 1)));
    return Math.hypot(p[0] - s[0] - t * ex, p[1] - s[1] - t * ez);
  };
  const N = 400;
  let best = Infinity;
  for (let i = 0; i <= N; i++) {
    const p: P = [a[0] + ((b[0] - a[0]) * i) / N, a[1] + ((b[1] - a[1]) * i) / N];
    const q: P = [c[0] + ((d[0] - c[0]) * i) / N, c[1] + ((d[1] - c[1]) * i) / N];
    best = Math.min(best, toWall(p, c, d), toWall(q, a, b));
  }
  return best;
}

const SAMPLE_SLACK = 0.02;
const EPS = 1e-6;

/** What is wrong with this outline as a room, or null. */
function brokenBy(poly: Footprint): string | null {
  const n = poly.length;
  const edge = (k: number): [P, P] => [poly[k], poly[(k + 1) % n]];
  for (let k = 0; k < n; k++) {
    const [a, b] = edge(k);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < WALL_MIN_M - EPS) return `wall ${k} is shorter than the minimum`;
  }
  // Signed area flips when the room is turned inside out without a crossing —
  // a wall pushed clean through the one opposite it.
  for (let e = 0; e < n; e++) {
    for (let f = e + 1; f < n; f++) {
      if (f === e + 1 || (e === 0 && f === n - 1)) continue;
      const [a, b] = edge(e);
      const [c, d] = edge(f);
      if (crosses(a, b, c, d)) return `walls ${e} and ${f} cross`;
      if (sampledGap(a, b, c, d) < WALL_MIN_M - SAMPLE_SLACK) return `walls ${e} and ${f} are closer than the minimum`;
    }
  }
  return null;
}

function area(poly: Footprint): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

const LAYOUTS = ['rect', 'l', 't', 'u'] as const;
const DELTAS = [-9, -2.5, -0.7, 0.7, 2.5, 9];

describe('a dragged wall keeps the room a room', () => {
  it('every wall of every preset, pushed either way by up to 9 m, ends on a valid outline', () => {
    let cases = 0;
    let stopped = 0;
    for (const layout of LAYOUTS) {
      const poly = footprintForLayout(layout, 6, 5);
      expect(brokenBy(poly)).toBeNull();
      const sign = Math.sign(area(poly));
      for (let i = 0; i < poly.length; i++) {
        for (const delta of DELTAS) {
          cases++;
          const { travel, fault } = wallTravel(poly, i, delta);
          expect(Math.sign(travel) === Math.sign(delta) || travel === 0).toBe(true);
          expect(Math.abs(travel)).toBeLessThanOrEqual(Math.abs(delta) + EPS);
          const after = offsetWall(poly, i, travel);
          expect(brokenBy(after), `${layout} wall ${i} by ${delta}`).toBeNull();
          expect(Math.sign(area(after)), `${layout} wall ${i} by ${delta} turned inside out`).toBe(sign);
          if (fault !== null) {
            stopped++;
            // …and it stops AT the limit, not early: one more millimetre breaks it.
            const further = wallTravel(poly, i, travel + Math.sign(delta) * 0.001);
            expect(further.fault, `${layout} wall ${i} by ${delta} stopped early`).not.toBeNull();
          } else {
            expect(travel).toBe(delta);
          }
        }
      }
    }
    // Literals, not floors: 4 + 6 + 8 + 8 walls × 6 deltas, and how many of them
    // the rule stops. A change that stops more, or fewer, is a decision to look at.
    expect(cases).toBe(156);
    expect(stopped).toBe(62);
  });

  it("stops a T's bar wall pushed up through the north wall, with the bar's end wall at the minimum", () => {
    const t = footprintForLayout('t', 6, 5);
    // Wall 2 runs under the bar's east half; wall 1 is the bar's east end.
    const { travel, fault } = wallTravel(t, 2, -5);
    expect(fault).toBe('short');
    const after = offsetWall(t, 2, travel);
    expect(Math.hypot(after[2][0] - after[1][0], after[2][1] - after[1][1])).toBeCloseTo(WALL_MIN_M, 6);
  });

  it('catches a step that jumps clean through the opposite wall and lands clear of it', () => {
    // A rectangle's north wall pushed 10 m south in ONE step ends 5 m beyond the
    // south wall: every wall long, every gap wide, no crossing — only the winding
    // says the room is inside out. A check of the end position alone passes it.
    const r = footprintForLayout('rect', 6, 5);
    const end = offsetWall(r, 0, -10);
    expect(brokenBy(end)).toBeNull();
    expect(Math.sign(area(end))).not.toBe(Math.sign(area(r)));
    const { travel, fault } = wallTravel(r, 0, -10);
    expect(fault).not.toBeNull();
    expect(travel).toBeCloseTo(-(5 - WALL_MIN_M), 6);
  });

  it('stops a wall before it reaches a wall it does not share a corner with', () => {
    // A U's notch floor (wall 2) pushed south toward the south wall (wall 6): its
    // neighbours only lengthen, so it is the GAP that binds, at the minimum.
    const u = footprintForLayout('u', 6, 5);
    const { travel, fault } = wallTravel(u, 2, -4);
    expect(fault).toBe('close');
    const after = offsetWall(u, 2, travel);
    expect(after[6][1] - after[2][1]).toBeCloseTo(WALL_MIN_M, 6);
  });

  it('lets a room that already breaks the rule be dragged back out of it, and no further in', () => {
    // An L whose east leg is 0.1 m wide — saved before this rule, or opened from a
    // file. Wall 2 is the inner wall along that leg.
    const l: Footprint = [
      [-3, -2.5],
      [3, -2.5],
      [3, -2.4],
      [0, -2.4],
      [0, 2.5],
      [-3, 2.5],
    ];
    expect(brokenBy(l)).not.toBeNull();
    expect(wallTravel(l, 2, -0.05)).toEqual({ travel: 0, fault: 'short' });
    expect(wallTravel(l, 2, 1)).toEqual({ travel: 1, fault: null });
  });

  it('lets a room ALREADY folded over itself be dragged back out, the whole way', () => {
    // The room this rule was written for: a T whose bar wall was pushed 3 m north,
    // through the north wall, before the rule existed. Its stem wall now crosses
    // the north wall. Pulling the bar wall back south must be allowed all the way
    // home — crossing walls are a gap of NOTHING, so un-crossing them only ever
    // widens it. Measure the gap as the distance between the walls' ends instead
    // and it reads 0.75 m here, "shrinks" as the wall comes back, and the room
    // cannot be mended.
    const t = footprintForLayout('t', 6, 5);
    const folded = offsetWall(t, 2, -3);
    expect(brokenBy(folded)).toMatch(/cross/);
    expect(wallTravel(folded, 2, 3)).toEqual({ travel: 3, fault: null });
    expect(brokenBy(offsetWall(folded, 2, 3))).toBeNull();
  });

  it('leaves every ordinary move alone', () => {
    const r = footprintForLayout('rect', 6, 5);
    for (let i = 0; i < 4; i++) {
      for (const d of [-1.5, -0.05, 0.05, 3]) expect(wallTravel(r, i, d)).toEqual({ travel: d, fault: null });
    }
  });
});
