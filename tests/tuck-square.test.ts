// A seat tucked under a surface: square, facing in, and clear of its legs.
//
// `tuckedAt` is the one predicate the drag, the room report, the solver, the settle
// pass and the fit search all forgive a chair under a table by, so what it accepts is
// what every one of them draws. Until 2026-10-01 it accepted a dining chair turned 30°
// under the table and one slid along the edge into the corner leg — both drawn
// through the wood, both reported fine. `tests/layout-conformance.test.ts` holds the
// report and the solver to each other on those two; this holds the predicate itself,
// at its boundaries.

import { describe, it, expect } from 'vitest';
import { tuckedAt, tuckProfile, TUCK_SQUARE_RAD } from '../lib/layout-rules';
import { footFromPart, type Foot } from '../lib/geometry';
import { surfacePostsLocal, DINING_LEG } from '../lib/foot-cells';
import type { Category, Shape } from '../lib/scene-spec';

type P = { category: Category; shape: Shape; dimMM: [number, number, number] };
const TABLE: P = { category: 'table', shape: 'desk-standard', dimMM: [1500, 850, 750] };
const DESK: P = { category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750] };
const CHAIR: P = { category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850] };
const OFFICE: P = { category: 'chair', shape: 'chair-office', dimMM: [600, 600, 1150] };
const STOOL: P = { category: 'chair', shape: 'stool', dimMM: [350, 350, 450] };

const foot = (p: P, x: number, z: number, rot: number): Foot =>
  footFromPart([x, 0, z], rot, p.dimMM, p.shape === 'stool' || undefined, p.shape);

/** Is `seat` at (x, z, rot) tucked under `surface` standing at the origin, square? */
function tucked(seat: P, x: number, z: number, rot: number, surface: P = TABLE): boolean {
  const s = tuckProfile(seat);
  const t = tuckProfile(surface);
  const fs = foot(seat, x, z, rot);
  const ft = foot(surface, 0, 0, 0);
  const ab = tuckedAt(s, fs, t, ft);
  // Symmetric, like `profilesTuck`: which one is asked first must not matter.
  expect(tuckedAt(t, ft, s, fs)).toBe(ab);
  return ab;
}

// The chair on the table's front (+Z) edge, facing it (rot π), a third of its depth in.
const FRONT_Z = TABLE.dimMM[1] / 2000 + 0.25 - 0.5 / 3;
const DEG = Math.PI / 180;

describe('a dining chair tucks only square to the edge and facing in', () => {
  it('is tucked pushed in square, at every edge of the table', () => {
    expect(tucked(CHAIR, 0, FRONT_Z, Math.PI)).toBe(true);
    expect(tucked(CHAIR, 0, -FRONT_Z, 0)).toBe(true);
    const endX = TABLE.dimMM[0] / 2000 + 0.25 - 0.5 / 3;
    expect(tucked(CHAIR, endX, 0, -Math.PI / 2)).toBe(true);
    expect(tucked(CHAIR, -endX, 0, Math.PI / 2)).toBe(true);
  });

  it('holds the angle to TUCK_SQUARE_RAD, either way round', () => {
    const tol = TUCK_SQUARE_RAD / DEG;
    expect(tol).toBe(10);
    for (const sign of [-1, 1]) {
      expect(tucked(CHAIR, 0, FRONT_Z, Math.PI + sign * (tol - 1) * DEG)).toBe(true);
      expect(tucked(CHAIR, 0, FRONT_Z, Math.PI + sign * (tol + 1) * DEG)).toBe(false);
      // a 15° turn step off square is never tucked
      expect(tucked(CHAIR, 0, FRONT_Z, Math.PI + sign * 15 * DEG)).toBe(false);
      expect(tucked(CHAIR, 0, FRONT_Z, Math.PI + sign * 30 * DEG)).toBe(false);
    }
  });

  it('is not tucked side-on, whichever side faces the table', () => {
    expect(tucked(CHAIR, 0, FRONT_Z, Math.PI / 2)).toBe(false);
    expect(tucked(CHAIR, 0, FRONT_Z, -Math.PI / 2)).toBe(false);
  });

  it('leaves an office chair free to swivel, and a stool without a back free to turn', () => {
    const z = DESK.dimMM[1] / 2000 + 0.3 - 0.6 / 3;
    expect(tucked(OFFICE, 0, z, Math.PI + 30 * DEG, DESK)).toBe(true);
    expect(tucked(STOOL, 0, FRONT_Z - 0.05, 40 * DEG)).toBe(true);
  });
});

describe('an L-desk is square to the edge of the arm the chair is at, not of its box', () => {
  // 1600 × 1400: the long arm runs along the back to z 0.028, the return fills
  // x 0.128…0.8 in front of it, and the notch the chair stands in is what is left.
  // Measured against the BOX, the notch is the box's middle: a chair pushed square
  // into the arm read as beyond the return's end, facing the wrong edge.
  const ELL: P = { category: 'desk', shape: 'desk-l', dimMM: [1600, 1400, 750] };
  const armZ = 0.028 + 0.25 - 0.5 / 3;
  const returnX = 0.128 - 0.25 + 0.5 / 3;

  it('tucks a chair pushed square into the long arm from the notch', () => {
    expect(tucked(CHAIR, -0.4, armZ, Math.PI, ELL)).toBe(true);
    expect(tucked(CHAIR, -0.4, armZ, Math.PI / 2, ELL)).toBe(false);
  });

  it('and one pushed square into the return’s inside face', () => {
    expect(tucked(CHAIR, returnX, 0.4, Math.PI / 2, ELL)).toBe(true);
    expect(tucked(CHAIR, returnX, 0.4, Math.PI, ELL)).toBe(false);
  });
});

describe('a seat never stands where the surface’s legs are', () => {
  const legInner = TABLE.dimMM[0] / 2000 - DINING_LEG.inset - DINING_LEG.size;

  it('is tucked between the legs and not through them', () => {
    // The chair's side 10 mm short of the leg's inner face, then 10 mm past it.
    expect(tucked(CHAIR, legInner - 0.25 - 0.01, FRONT_Z, Math.PI)).toBe(true);
    expect(tucked(CHAIR, legInner - 0.25 + 0.03, FRONT_Z, Math.PI)).toBe(false);
  });

  it('forgives a chair only touching a leg’s face, the pad `collidesAt` passes', () => {
    expect(tucked(CHAIR, legInner - 0.25 + 0.004, FRONT_Z, Math.PI)).toBe(true);
  });

  it('a chair barely under the edge is clear of a leg set 40 mm in', () => {
    // A chair 30 mm under the top stops short of the leg's outer face.
    const shallow = TABLE.dimMM[1] / 2000 + 0.25 - 0.03;
    expect(tucked(CHAIR, legInner, shallow, Math.PI)).toBe(true);
  });

  it('holds a stool low enough to go wholly under to the legs too', () => {
    const lz = TABLE.dimMM[1] / 2000 - DINING_LEG.inset - DINING_LEG.size / 2;
    const lx = TABLE.dimMM[0] / 2000 - DINING_LEG.inset - DINING_LEG.size / 2;
    expect(tucked(STOOL, lx, lz, 0)).toBe(false);
    expect(tucked(STOOL, 0, lz, 0)).toBe(true);
  });

  it('keeps an office chair out of the desk’s side panel and its right-hand legs', () => {
    const z = DESK.dimMM[1] / 2000 + 0.3 - 0.6 / 3;
    const w = DESK.dimMM[0] / 2000;
    expect(tucked(OFFICE, 0, z, Math.PI, DESK)).toBe(true);
    expect(tucked(OFFICE, -w + 0.3 - 0.02, z, Math.PI, DESK)).toBe(false);
    expect(tucked(OFFICE, w - 0.3 + 0.02, z, Math.PI, DESK)).toBe(false);
    expect(tucked(OFFICE, -w + 0.3 + 0.03, z, Math.PI, DESK)).toBe(true);
  });
});

describe('surfacePostsLocal — the legs the renderer builds', () => {
  it('a dining table stands on four legs inside its top, a desk on a panel and two legs', () => {
    const [w, d] = [1.5, 0.85];
    const legs = surfacePostsLocal('desk-standard', true, w, d);
    expect(legs).toHaveLength(4);
    for (const r of legs) {
      expect(Math.min(w / 2 - Math.abs(r.x0), w / 2 - Math.abs(r.x1))).toBeCloseTo(DINING_LEG.inset, 9);
      expect(Math.min(d / 2 - Math.abs(r.z0), d / 2 - Math.abs(r.z1))).toBeCloseTo(DINING_LEG.inset, 9);
      expect(r.x1 - r.x0).toBeCloseTo(DINING_LEG.size, 9);
    }
    expect(surfacePostsLocal('desk-standard', false, 1.4, 0.7)).toHaveLength(3);
    expect(surfacePostsLocal('desk-l', false, 1.6, 1.2)).toHaveLength(3);
    expect(surfacePostsLocal('coffee-table', false, 1.1, 0.6)).toEqual([]);
    // every post inside the top
    for (const [shape, dining] of [['desk-standard', true], ['desk-standard', false], ['desk-l', false]] as const) {
      for (const r of surfacePostsLocal(shape, dining, 1.4, 0.8)) {
        expect(r.x0).toBeGreaterThanOrEqual(-0.7 - 1e-9);
        expect(r.x1).toBeLessThanOrEqual(0.7 + 1e-9);
        expect(r.z0).toBeGreaterThanOrEqual(-0.4 - 1e-9);
        expect(r.z1).toBeLessThanOrEqual(0.4 + 1e-9);
      }
    }
  });
});
