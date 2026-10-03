import { describe, it, expect } from 'vitest';
import { MIN_WALL_FACING, WALL_SWITCH_M, wallDragTarget, wallGrip, wallPlaneHit, wallTarget, wallUnderPointer } from '@/lib/wall-drag';
import { footprintForLayout } from '@/lib/footprint';
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
    // Literals, not floors: nine catalogue rows ride a wall and eight of them lift
    // (one TV since the Library stopped selling three sizes of the same drawing). A
    // new wall piece changes these and has to say which it is.
    expect(riders).toBe(9);
    expect(lifted.length).toBe(8);
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

// 6 × 6, 2.5 m high: edge 0 North (z = −3), 1 East (x = 3), 2 South, 3 West.
const ROOM = footprintForLayout('rect', 6, 6);
const H = 2.5;
const EYE: V3 = [0, 1.5, 0];

describe('wallUnderPointer', () => {
  it('is the wall the ray meets, where it meets it', () => {
    const n = wallUnderPointer(EYE, [0, 0, -1], ROOM, H)!;
    expect(n.index).toBe(0);
    close(n.hit, [0, 1.5, -3]);
    expect(wallUnderPointer(EYE, [1, 0.2, 0.5], ROOM, H)!.index).toBe(1);
    expect(wallUnderPointer(EYE, [0.3, -0.1, 1], ROOM, H)!.index).toBe(2);
  });

  it('is nothing when the pointer is on the floor or the ceiling', () => {
    // Down at the floor 1.5 m ahead: the ray reaches the North wall's plane 1.5 m
    // below the floor.
    expect(wallUnderPointer(EYE, [0, -1, -1], ROOM, H)).toBeNull();
    expect(wallUnderPointer(EYE, [0, 1, -1], ROOM, H)).toBeNull();
    // Just inside both, it is the wall.
    expect(wallUnderPointer(EYE, [0, -0.49, -1], ROOM, H)!.index).toBe(0);
    expect(wallUnderPointer(EYE, [0, 0.33, -1], ROOM, H)!.index).toBe(0);
  });

  it('from outside the room, is the wall seen through the culled one — never an outer face', () => {
    // The dollhouse camera out past the South wall, looking in: its ray crosses the
    // South wall's plane at 1.55 m, inside the wall's height, on the wrong side.
    const r = wallUnderPointer([0, 2, 8], [0, -1, -11], ROOM, H)!;
    expect(r.index).toBe(0);
  });

  it('only counts a hit on the wall itself, not on its line past the end', () => {
    // An L: the notch's West wall stands at x = 0.48 from z = 0.48 to 3. A ray east
    // at z = −1 crosses that line north of the wall's end, and goes on to the East wall.
    const L = footprintForLayout('l', 6, 6);
    const r = wallUnderPointer([-1, 1.5, -1], [1, 0, 0], L, H)!;
    expect(r.hit[0]).toBeCloseTo(3, 9);
    // Heading south into the notch it is the notch's own North wall, at z = 0.48.
    expect(wallUnderPointer([1.5, 1.5, -1], [0, 0, 1], L, H)!.hit[2]).toBeCloseTo(0.48, 9);
  });

  it('refuses a ray that grazes the wall', () => {
    // Close along the East wall, heading North: it meets that wall 2 m on, nearly
    // edge-on, and nothing else in the room. Steeper, and it is a wall again.
    expect(MIN_WALL_FACING).toBeGreaterThan(0.05);
    expect(wallUnderPointer([2.9, 1.5, 2], [0.05, 0, -1], ROOM, H)).toBeNull();
    expect(wallUnderPointer([2.9, 1.5, 2], [0.25, 0, -1], ROOM, H)!.index).toBe(1);
  });

  it('is the FIRST wall on the ray, in a room where a ray can meet two', () => {
    // An L, from its South-West leg towards the North-East: the notch's West wall at
    // x = 0.48 is met first, then — back in through the notch's other wall — the
    // East wall. The person is pointing at the first.
    const L = footprintForLayout('l', 6, 6);
    const r = wallUnderPointer([-2, 1.5, 2], [1, 0, -0.5], L, H)!;
    expect(r.hit[0]).toBeCloseTo(0.48, 9);
    // And the other way round the outline: the notch's North wall first, then the
    // South wall beyond the notch.
    const s = wallUnderPointer([2.5, 1.5, -1], [-0.9, 0, 1], L, H)!;
    expect(s.hit[2]).toBeCloseTo(0.48, 9);
  });
});

describe('wallDragTarget — a wall piece follows the wall the pointer is on', () => {
  // A TV hung on the North wall, gripped 0.2 m right of its centre and 0.1 up.
  const tv: V3 = [0, 1.4, -2.95];
  const grip = { along: 0.2, up: 0.1 };

  it('stays on its own wall while the pointer is on it', () => {
    const t = wallDragTarget(EYE, [0.5, 0, -1], tv, 0, grip, ROOM, H)!;
    // 1.5 m along the plane through the TV, 2.95 m out.
    close(t, [1.475 - 0.2, 1.4, -2.95]);
  });

  it('crosses the room to the wall across from it', () => {
    const t = wallDragTarget(EYE, [0, 0, 1], tv, 0, grip, ROOM, H)!;
    // On the South wall the TV faces North; seen from the room its right is West,
    // and the grip keeps its side: the centre is 0.2 m East of the pointer at x = 0.
    close(t, [0.2, 1.4, 3]);
  });

  it('turns onto the wall round the corner once clear of the corner, and not before', () => {
    // A TV near the East end, the pointer on the East wall at z = −3 + off.
    const near: V3 = [2.2, 1.4, -2.95];
    const at = (off: number): V3 => [3 - EYE[0], 0, -3 + off - EYE[2]];
    const stay = wallDragTarget(EYE, at(WALL_SWITCH_M - 0.01), near, 0, grip, ROOM, H)!;
    // Held on the North wall's plane — `resolvePlacement` does the rest there.
    expect(stay[2]).toBeCloseTo(-2.95, 9);
    const go = wallDragTarget(EYE, at(WALL_SWITCH_M + 0.01), near, 0, grip, ROOM, H)!;
    // On the East wall, facing West: seen from the room its right is South, so the
    // centre goes 0.2 m North of the pointer — past the corner, which is the
    // resolve's to clamp, as it is for the North wall's own ends.
    close(go, [3, 1.4, -3 + WALL_SWITCH_M + 0.01 - 0.2]);
  });

  it('keeps the same margin going back', () => {
    // Now on the East wall (facing West), just below the corner; the pointer
    // returns to the North wall 0.1 m from it.
    const east: V3 = [2.95, 1.4, -2.6];
    const rot = -Math.PI / 2;
    const back = wallDragTarget(EYE, [3 - 0.1 - EYE[0], 0, -3 - EYE[2]], east, rot, grip, ROOM, H)!;
    expect(back[0]).toBeCloseTo(2.95, 9);
  });

  it('turns round an inside corner as well as an outside one', () => {
    // An L: a print on the notch's North wall (z = 0.48, facing North), the pointer
    // on the notch's West wall 1.5 m South of the corner they share. That wall is on
    // the far side of this one's plane from the room, and it is still 1.5 m off it.
    const L = footprintForLayout('l', 6, 6);
    const print: V3 = [1.5, 1.4, 0.45];
    const t = wallDragTarget([-1, 1.5, -1], [0.48 + 1, 0, 1.98 + 1], print, Math.PI, grip, L, H)!;
    expect(t[0]).toBeCloseTo(0.48, 9);
  });

  it('stays on its wall when the pointer reaches it through the cut-away face', () => {
    // The dollhouse view: the camera outside the South wall, which is the one cut
    // away, and the pointer on a TV hung on it. The ray goes on to meet the North
    // wall's inner face — which is not what the pointer is on.
    const south: V3 = [0, 1.4, 2.95];
    const cam: V3 = [0, 2, 8];
    const t = wallDragTarget(cam, [0.5, 1.4 - 2, 2.95 - 8], south, Math.PI, grip, ROOM, H)!;
    expect(t[2]).toBeCloseTo(2.95, 9);
    // From higher up, over the top of that wall, the pointer is on the far wall:
    // the ray clears the cut-away wall at 2.86 m, above its 2.5.
    const over = wallDragTarget([0, 4, 8], [0, -2.5, -11], south, Math.PI, grip, ROOM, H)!;
    expect(over[2]).toBeCloseTo(-3, 9);
  });

  it('stays on its wall with the pointer on the floor', () => {
    // Down at the floor near the South wall: the North wall's plane is behind the
    // camera, so the frame is skipped rather than jumping the TV anywhere.
    expect(wallDragTarget(EYE, [0, -1, 1], tv, 0, grip, ROOM, H)).toBeNull();
  });
});
