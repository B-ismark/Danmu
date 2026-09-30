import { describe, it, expect } from 'vitest';
import { MIN_WALL_FACING, wallGrip, wallPlaneHit, wallTarget } from '@/lib/wall-drag';
import { followsPointerUp, ridesWall } from '@/lib/physics';
import { PART_LIBRARY } from '@/lib/scene-spec';

type V3 = [number, number, number];
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('followsPointerUp', () => {
  it('is every wall rider but the door, which stands on the floor', () => {
    expect(followsPointerUp('tv', 'tv')).toBe(true);
    expect(followsPointerUp('painting', 'painting')).toBe(true);
    expect(followsPointerUp('curtain', 'curtain')).toBe(true);
    expect(followsPointerUp('other', 'window')).toBe(true);
    expect(followsPointerUp('door', 'door')).toBe(false);
    // Not a wall piece at all: a ceiling fan keeps its height, a sofa its floor.
    expect(followsPointerUp('fan', 'fan')).toBe(false);
    expect(followsPointerUp('sofa', 'sofa')).toBe(false);
  });

  it('never lifts anything that does not ride a wall, across the whole catalogue', () => {
    // Swept rather than sampled: a shape that inherits its category's anchor is
    // exactly the case a hand-picked list misses.
    const lifted: string[] = [];
    let riders = 0;
    for (const e of PART_LIBRARY) {
      if (ridesWall(e.category, e.shape)) riders++;
      if (followsPointerUp(e.category, e.shape)) {
        expect(ridesWall(e.category, e.shape)).toBe(true);
        lifted.push(e.shape);
      }
    }
    // Literals, not floors: eleven catalogue rows ride a wall and ten of them lift
    // (three TVs). A new wall piece changes these and has to say which it is.
    expect(riders).toBe(11);
    expect(lifted.length).toBe(10);
    expect(lifted).not.toContain('door');
  });
});

describe('wallPlaneHit', () => {
  // A TV on the north wall, facing south (+Z): rot 0, front (0, 1).
  const tv: V3 = [1, 1.4, 0.03];

  it('meets the wall plane through the piece where the ray does', () => {
    // Camera in the room, looking back at the wall and a little up.
    const hit = wallPlaneHit([1.5, 1.2, 3], [0, 0.1, -1], tv, 0)!;
    close(hit, [1.5, 1.2 + 0.1 * 2.97, 0.03]);
  });

  it('refuses a ray that grazes the wall, and one that meets it behind the camera', () => {
    const grazing: V3 = [1, 0, -(MIN_WALL_FACING * 0.9)];
    expect(wallPlaneHit([0, 1.4, 3], grazing, tv, 0)).toBeNull();
    expect(wallPlaneHit([1, 1.4, 3], [0, 0, 1], tv, 0)).toBeNull();
  });

  it('follows the piece round a corner: the plane is the one its angle faces', () => {
    // On the west wall, facing east (+X): rot π/2.
    const hit = wallPlaneHit([3, 1, 0.5], [-1, 0, 0], [0.03, 1.4, 0], Math.PI / 2)!;
    close(hit, [0.03, 1, 0.5]);
  });
});

describe('the grip stays under the pointer', () => {
  it('round-trips on one wall', () => {
    const pos: V3 = [1, 1.4, 0.03];
    const grab: V3 = [1.25, 1.55, 0.03];
    const g = wallGrip(grab, pos, 0);
    expect(g.along).toBeCloseTo(0.25, 12);
    expect(g.up).toBeCloseTo(0.15, 12);
    // Pointer moves 0.5 m right and 0.3 m up: the piece moves exactly that.
    close(wallTarget([1.75, 1.85, 0.03], g, 0), [1.5, 1.7, 0.03]);
  });

  it('is laid along the NEW wall after a corner, not the old one', () => {
    // Gripped 0.2 m to the piece's right on the north wall. On the west wall
    // (rot π/2) the piece's right is −Z, so the origin sits 0.2 m toward +Z of
    // the pointer — the grip kept in the piece's frame, not the room's.
    const g = wallGrip([1.2, 1.4, 0.03], [1, 1.4, 0.03], 0);
    close(wallTarget([0.03, 1.5, 1], g, Math.PI / 2), [0.03, 1.5, 1.2]);
  });
});
