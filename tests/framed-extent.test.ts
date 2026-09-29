import { describe, expect, it } from 'vitest';
import { extent, framedExtent } from './helpers/project';

// The sweep fixtures' box for a piece the frame cuts (§ 49.16). Clamping each point
// to the frame and boxing the clamped points is what they did before, and it keeps
// extent wherever the outline crosses an edge at a slant.

const close = (got: number[] | null, want: number[]) => {
  expect(got).not.toBeNull();
  got!.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
};

describe('framedExtent', () => {
  it('is the plain extent of an outline wholly inside the frame, in any order and with inside points', () => {
    const pts: Array<[number, number]> = [[0.6, 0.7], [0.2, 0.3], [0.4, 0.5], [0.6, 0.3], [0.2, 0.7]];
    expect(framedExtent(pts)).toEqual(extent(pts));
  });

  it('keeps none of the height a slanted outline has off the left edge', () => {
    // The far corner is off the left and low; the outline meets the edge between
    // v 0.583 and 0.65. Clamped, that corner lands on the edge at 0.95.
    const pts: Array<[number, number]> = [[-1, 0.95], [0.5, 0.4], [0.5, 0.5]];
    close(framedExtent(pts), [0, 0.4, 0.5, 0.25]);
    const clamped = pts.map(([u, v]) => [Math.max(0, u), v] as [number, number]);
    close(extent(clamped), [0, 0.4, 0.5, 0.55]);
  });

  it('cuts at every edge of the frame', () => {
    // A diamond larger than the frame, centred on it: every side crosses a corner cut.
    const pts: Array<[number, number]> = [[0.5, -0.5], [1.5, 0.5], [0.5, 1.5], [-0.5, 0.5]];
    close(framedExtent(pts), [0, 0, 1, 1]);
    // Off the right and the bottom only, on a slant: what is left is a corner triangle.
    close(framedExtent([[0.8, 0.8], [1.4, 0.8], [0.8, 1.4]]), [0.8, 0.8, 0.2, 0.2]);
    close(framedExtent([[0.8, 0.2], [1.2, 0.2], [0.8, -0.2]]), [0.8, 0, 0.2, 0.2]);
    close(framedExtent([[0.2, 0.2], [-0.2, 0.2], [0.2, 0.6]]), [0, 0.2, 0.2, 0.4]);
  });

  it('is null for an outline the frame does not show, or one with no area', () => {
    expect(framedExtent([[-0.5, 0.2], [-0.1, 0.2], [-0.3, 0.6]])).toBeNull();
    expect(framedExtent([[0.2, 0.2], [0.8, 0.8]])).toBeNull();
  });
});
