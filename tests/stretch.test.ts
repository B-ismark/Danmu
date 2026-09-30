import { describe, it, expect } from 'vitest';
import {
  dragPlaneNormal,
  facingSide,
  pulledBy,
  stretchDirection,
  stretchedDim,
  stretchedOrigin,
} from '@/lib/stretch';
import { clampDims } from '@/lib/dimension-ranges';
import { localToWorld } from '@/lib/geometry';

// The arithmetic under the scale mode's three handles. The one promise a handle
// makes is that pulling a side moves THAT side and leaves the opposite one where it
// stands, so most of this file measures the far face before and after.

type V3 = [number, number, number];
const none = (d: V3) => d;
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

/** Where a piece's face on `side` of `axis` is, in world metres. */
function face(pos: V3, rot: number, axis: 'width' | 'depth', side: 1 | -1, dim: V3): V3 {
  const d = stretchDirection(rot, axis, side);
  const half = (axis === 'width' ? dim[0] : dim[1]) / 2000;
  return [pos[0] + d[0] * half, pos[1], pos[2] + d[2] * half];
}

describe('stretchDirection', () => {
  it('width is the piece’s own local X, depth its front, height up', () => {
    // Turned 30°, so a swapped sine or cosine cannot pass by symmetry.
    const rot = Math.PI / 6;
    const [wx, wz] = localToWorld(rot, 1, 0);
    close(stretchDirection(rot, 'width', 1), [wx, 0, wz]);
    close(stretchDirection(rot, 'depth', 1), [Math.sin(rot), 0, Math.cos(rot)]);
    close(stretchDirection(rot, 'height', -1), [0, -1, 0]);
    close(stretchDirection(rot, 'width', -1), [-wx, 0, -wz]);
  });
});

describe('pulledBy', () => {
  it('reads only the travel along the handle’s direction', () => {
    expect(pulledBy([1, 1, 1], [1.3, 5, 1], [1, 0, 0])).toBeCloseTo(0.3, 12);
    expect(pulledBy([0, 0, 0], [0.2, 0, 0], [-1, 0, 0])).toBeCloseTo(-0.2, 12);
  });
});

describe('stretchedDim', () => {
  const start: V3 = [2000, 900, 850];

  it('changes the pulled axis and no other', () => {
    expect(stretchedDim(start, 'width', 0.3, null, none)).toEqual([2300, 900, 850]);
    expect(stretchedDim(start, 'depth', -0.1, null, none)).toEqual([2000, 800, 850]);
    expect(stretchedDim(start, 'height', 0.05, null, none)).toEqual([2000, 900, 900]);
  });

  it('leaves an off-grid size on the other axes alone', () => {
    // The gizmo-era path snapped EVERY axis on commit, so widening a detected sofa
    // rounded its measured 853 mm depth to 850.
    expect(stretchedDim([2000, 853, 847], 'width', 0.012, 10, none)).toEqual([2010, 853, 847]);
  });

  it('rounds to the snap step, to whole mm with snap off, and never below one step', () => {
    expect(stretchedDim(start, 'width', 0.123, 50, none)[0]).toBe(2100);
    expect(stretchedDim(start, 'width', 0.1234, null, none)[0]).toBe(2123);
    expect(stretchedDim(start, 'width', -5, 50, none)[0]).toBe(50);
    expect(stretchedDim(start, 'width', -5, null, none)[0]).toBe(1);
  });

  it('stops at the shape’s range: sizes still come from code', () => {
    const sofa = (d: V3) => clampDims('sofa', 'sofa', d);
    const huge = stretchedDim(start, 'width', 50, 10, sofa);
    expect(huge).toEqual(clampDims('sofa', 'sofa', [52000, 900, 850]));
    expect(huge[0]).toBeLessThan(52000);
  });
});

describe('stretchedOrigin keeps the opposite face still', () => {
  const pos: V3 = [1.2, 0, -0.4];
  const startDim: V3 = [2000, 900, 850];

  for (const rot of [0, Math.PI / 6, Math.PI / 2, -2.5]) {
    for (const axis of ['width', 'depth'] as const) {
      for (const side of [1, -1] as const) {
        it(`${axis}, side ${side}, turned ${rot.toFixed(2)}`, () => {
          const dim = stretchedDim(startDim, axis, 0.4, null, none);
          const o = stretchedOrigin(pos, rot, axis, side, startDim, dim, true);
          // The far face is where it was…
          close(face(o, rot, axis, -side as 1 | -1, dim), face(pos, rot, axis, -side as 1 | -1, startDim));
          // …and the pulled one has moved out by the whole 400 mm.
          const moved = face(o, rot, axis, side, dim);
          const was = face(pos, rot, axis, side, startDim);
          expect(Math.hypot(moved[0] - was[0], moved[2] - was[2])).toBeCloseTo(0.4, 9);
        });
      }
    }
  }

  it('height on a floor piece: its origin is its base, so nothing moves', () => {
    const dim: V3 = [2000, 900, 1100];
    expect(stretchedOrigin(pos, 0, 'height', 1, startDim, dim, true)).toEqual(pos);
  });

  it('height on a centred piece moves the centre half the growth, keeping the other edge', () => {
    // A TV on a wall, centre at 1.2 m, 600 mm tall: its bottom edge is 0.9 m.
    const tv: V3 = [0, 1.2, 0];
    const was: V3 = [1200, 60, 600];
    const now: V3 = [1200, 60, 800];
    const up = stretchedOrigin(tv, 0, 'height', 1, was, now, false);
    expect(up[1] - 0.4).toBeCloseTo(0.9, 12); // bottom edge unmoved
    // A ceiling piece pulled from underneath keeps its TOP.
    const down = stretchedOrigin(tv, 0, 'height', -1, was, now, false);
    expect(down[1] + 0.4).toBeCloseTo(1.5, 12);
  });
});

describe('facingSide', () => {
  it('puts the dot on the side the camera is on', () => {
    expect(facingSide(0, 'width', [0, 0, 0], [5, 2, 1])).toBe(1);
    expect(facingSide(0, 'width', [0, 0, 0], [-5, 2, 1])).toBe(-1);
    expect(facingSide(0, 'depth', [0, 0, 0], [1, 2, -5])).toBe(-1);
    // Turned half round, the same camera is behind the piece.
    expect(facingSide(Math.PI, 'depth', [0, 0, 0], [1, 2, 5])).toBe(-1);
  });
});

describe('dragPlaneNormal', () => {
  it('contains the handle’s direction and faces the camera as far as that allows', () => {
    const dir: V3 = [1, 0, 0];
    const n = dragPlaneNormal(dir, [3, 4, 0])!;
    expect(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]).toBeCloseTo(0, 12);
    close(n, [0, 1, 0]);
    // A height handle seen from eye level gets an upright plane facing the camera.
    close(dragPlaneNormal([0, 1, 0], [0, 0.5, -2])!, [0, 0, -1]);
  });

  it('refuses when the camera looks straight down the direction', () => {
    expect(dragPlaneNormal([0, 1, 0], [0, 3, 0])).toBeNull();
  });
});
