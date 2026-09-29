import { describe, it, expect } from 'vitest';
import { skyPoint, sunArcShape } from '@/lib/sun-arc';
import { hourOnDayArc, hourOnNightArc, moonAt, sunAt } from '@/lib/lighting-moods';

// The sun's handle must never be the thing under a hand that reached for a piece
// of furniture. Measured in a browser: with the arc stood on the floor, 06:40 in a
// 5 × 4 m room put the handle beside the sofa. On the eaves, no point of the path
// — by day or by night, at any bearing — is lower than the top of the walls, so
// from a camera looking down at the room it can only be over plaster or sky.

const ROOM = { cx: 0, cz: 0, width: 5, depth: 4 };
const H = 2.6;

function walk(half: 'day' | 'night', bearing: number, bounds = ROOM) {
  const { center, radius } = sunArcShape(bounds, H);
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= 96; i++) {
    const t = i / 96;
    const a = half === 'day' ? sunAt(hourOnDayArc(t)) : moonAt(hourOnNightArc(t));
    pts.push(skyPoint(a, bearing, radius, center));
  }
  return pts;
}

describe('the sun arc', () => {
  it('rides above the walls everywhere, by day and by night, at any bearing', () => {
    for (const half of ['day', 'night'] as const) {
      for (const bearing of [0, 37, 90, 180, 271]) {
        const pts = walk(half, bearing);
        const lowest = Math.min(...pts.map((p) => p[1]));
        expect(lowest, `${half} @ ${bearing}°`).toBeGreaterThanOrEqual(H - 1e-9);
      }
    }
  });

  it('starts and ends on the eaves and crowns low, so noon stays in frame', () => {
    const pts = walk('day', 0);
    expect(pts[0][1]).toBeCloseTo(H, 9);
    expect(pts[pts.length - 1][1]).toBeCloseTo(H, 9);
    const top = Math.max(...pts.map((p) => p[1]));
    expect(top).toBeGreaterThan(H + 0.3);
    expect(top).toBeLessThanOrEqual(H + 0.6 + 1e-9);
  });

  it('clears the walls across, and follows a room whose outline is off-centre', () => {
    const off = { cx: 1.5, cz: -0.5, width: 5, depth: 4 };
    const pts = walk('day', 0, off);
    // The rising end is beside the room, not over it.
    const [x0, , z0] = pts[0];
    expect(Math.hypot(x0 - off.cx, z0 - off.cz)).toBeCloseTo(5 / 2 + 0.6, 9);
    const xs = pts.map((p) => p[0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(off.cx, 1);
  });
});
