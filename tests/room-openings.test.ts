// Where a room is entered, and where its light comes from.
//
// Until `lib/room-openings.ts` existed, no preset room had either — and the
// consequence was not cosmetic. Four rules went permanently quiet on every starter
// room (`door`, `entry`, `reach`, `cut-off`), `navigabilityCost` returned zero by its
// own no-door guard so the solver's reachability pass was inert, and — the reason
// anyone noticed — no wall had a reason to be the back wall, so the seeder chose by
// arithmetic and the result read as arbitrary.
//
// These hold the two rules that place them, plus the properties every consumer
// downstream assumes.

import { describe, expect, it } from 'vitest';
import { openingsForRoom } from '../lib/room-openings';
import { footprintForLayout, pointInFootprint, type Footprint, type LayoutId } from '../lib/footprint';
import { distToBoundary, localToWorld } from '../lib/geometry';
import { defaultScene } from '../lib/scene-spec';
import { roleOf } from '../lib/layout-rules';
import { analyzeRoom } from '../lib/clearance';

const PRESETS: Array<{ id: LayoutId; w: number; d: number }> = [
  { id: 'rect', w: 6.0, d: 4.0 },
  { id: 'l', w: 6.0, d: 4.7 },
  { id: 't', w: 5.5, d: 4.7 },
  { id: 'u', w: 6.0, d: 5.0 },
  { id: 'open', w: 7.5, d: 5.6 },
];

const HEIGHT = 2.8;

describe.each(PRESETS)('openings · $id', ({ id, w, d }) => {
  const poly = footprintForLayout(id, w, d);
  const openings = openingsForRoom(poly);

  it('gives the room a way in', () => {
    expect(openings.filter((o) => o.kind === 'door')).toHaveLength(1);
  });

  it('gives it daylight', () => {
    expect(openings.filter((o) => o.kind === 'window').length).toBeGreaterThanOrEqual(1);
  });

  it('puts every opening on a wall, inside the room', () => {
    for (const o of openings) {
      // Inside, not merely on the line: a point exactly ON a polygon's boundary is
      // not reliably inside it, and every opening placed on the line was reported as
      // not being in the room it is the way into.
      expect(pointInFootprint(o.x, o.z, poly), `${o.name} is not inside the room`).toBe(true);
      expect(distToBoundary(poly, o.x, o.z)).toBeLessThan(0.2);
    }
  });

  it('faces every opening into the room', () => {
    // `rot` is the yaw whose front (local +Z) points inward — the convention
    // `nearestEdge`, `BaySide` and `Draggable` all share. Getting the sign wrong here
    // is invisible on two of four walls, which is exactly how it shipped once before.
    for (const o of openings) {
      const [nx, nz] = localToWorld(o.rot, 0, 1);
      expect(pointInFootprint(o.x + nx * 0.3, o.z + nz * 0.3, poly), `${o.name} faces outward`).toBe(true);
    }
  });

  it('sets a sill a sofa passes under and a wardrobe does not', () => {
    // The one number that decides whether the thing under the window is a windowsill
    // or a fault. A sofa back is 880 mm and belongs under a window; a wardrobe is
    // 2100 mm and does not.
    for (const o of openings.filter((x) => x.kind === 'window')) {
      const sill = o.y - o.dimMM[2] / 2000;
      expect(sill).toBeGreaterThan(0.88);
      expect(sill).toBeLessThan(1.1);
    }
  });

  it('does not put the door on a wall the room cuts into itself', () => {
    // An L's or a T's short walls are the sides of its own notch, and a door there
    // opens into the wing rather than into the room: on the 6 × 4.7 L that filled the
    // wing with swing and route, and the reading nook the preset promises could not be
    // seeded at all. An outer wall is one the whole polygon lies behind.
    const door = openings.find((o) => o.kind === 'door')!;
    const [nx, nz] = localToWorld(door.rot, 0, 1);
    for (const [vx, vz] of poly) {
      expect((vx - door.x) * nx + (vz - door.z) * nz).toBeGreaterThan(-0.05);
    }
  });

  it('is the same every time', () => {
    expect(openingsForRoom(poly)).toEqual(openings);
  });
});

describe('the seeded room is arranged against its openings', () => {
  const seeded = (id: LayoutId, w: number, d: number) =>
    defaultScene(id, w, d, { footprint: footprintForLayout(id, w, d), height: HEIGHT });

  it.each(PRESETS)('$id opens with a door and a window in it', ({ id, w, d }) => {
    const roles = seeded(id, w, d).map(roleOf);
    expect(roles).toContain('door');
    expect(roles).toContain('window');
  });

  it.each(PRESETS)('$id has no finding about its own door or windows', ({ id, w, d }) => {
    // The whole point of seeding the openings FIRST: nothing may be placed in a
    // door's swing, across the route in from it, or in front of a window. A starter
    // room that fails its own check is the worst possible first impression, and these
    // four rules could not fail before because no preset had an opening to break.
    const parts = seeded(id, w, d);
    const issues = analyzeRoom(parts, { footprint: footprintForLayout(id, w, d), height: HEIGHT }).issues;
    const relevant = issues.filter((i) => ['door', 'entry', 'window', 'reach', 'cut-off'].includes(i.rule));
    expect(relevant.map((i) => `${i.rule}: ${i.detail}`)).toEqual([]);
  });

  it('keeps the screen off the door’s wall and off a window wall', () => {
    // The rule that replaced wall arithmetic with a rationale a person can read: the
    // focal wall is the one you face coming in, that is not the door's and not a
    // window's. A television in front of a window is the placement every viewing guide
    // names, and the room report would have raised it on the first open.
    for (const { id, w, d } of PRESETS) {
      const poly: Footprint = footprintForLayout(id, w, d);
      const parts = seeded(id, w, d);
      const tv = parts.find((p) => p.category === 'tv');
      if (!tv) continue;
      for (const o of openingsForRoom(poly)) {
        const sameWall =
          Math.abs(Math.cos(o.rot) - Math.cos(tv.rot)) < 0.1 && Math.abs(Math.sin(o.rot) - Math.sin(tv.rot)) < 0.1;
        const near = Math.hypot(o.x - tv.pos[0], o.z - tv.pos[2]) < 1.5;
        expect(sameWall && near, `${id}: the screen shares a wall with “${o.name}”`).toBe(false);
      }
    }
  });
});
