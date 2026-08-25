import { describe, it, expect } from 'vitest';
import { wallApertures } from '@/lib/apertures';
import { footprintForLayout, wallSegments, type Footprint } from '@/lib/footprint';
import type { LayoutId } from '@/lib/storage';
import { openingsForRoom } from '@/lib/room-openings';
import { anchorFor, groundY, ridesWall, snapToWall, wallStandoff, CURTAIN_STANDOFF } from '@/lib/physics';
import { defaultScene, isWallMountedPart, placeNewPart, type ScenePart } from '@/lib/scene-spec';
import { ROOM } from '@/lib/parts-catalog';
import { localToWorld, nearestEdge } from '@/lib/geometry';

const RECT: Footprint = footprintForLayout('rect', ROOM.width, ROOM.depth);
const H = ROOM.height;

// The presets app/onboarding/layout-pick offers, at the sizes it offers them —
// the same list `tests/scene-seed.test.ts` sweeps. 'custom' is in `LAYOUT_IDS`
// but is not a preset anyone can pick.
const PRESETS: Array<{ id: LayoutId; w: number; d: number }> = [
  { id: 'rect', w: 6.0, d: 4.0 },
  { id: 'l', w: 6.0, d: 4.7 },
  { id: 't', w: 5.5, d: 4.7 },
  { id: 'u', w: 6.0, d: 5.0 },
  { id: 'open', w: 7.5, d: 5.6 },
];

// ─────────────────────────────────────────────────────────────────────────────
// A door is drawn by one file, positioned by three others and cut out of the
// wall by a fifth. Nothing typechecks the agreement between them, and all three
// producers disagreed at once: the seeded door hung h/2 above its own hole, a
// detected door got a hole half its height, and a door added from the catalog
// cut none at all. These are the assertions that would have caught each.
// ─────────────────────────────────────────────────────────────────────────────
describe('a door stands on the floor and is centred on its own hole', () => {
  const DOOR: [number, number, number] = [900, 50, 2100];

  it('anchors wall-floor — centred geometry, bottom edge on the floor', () => {
    expect(anchorFor('door', 'door')).toBe('wall-floor');
    // The whole point of the anchor: the centre sits at exactly half the height,
    // so a mesh drawn AROUND the origin reaches the floor and no further.
    expect(groundY('door', 'door', DOOR, H)).toBeCloseTo(DOOR[2] / 2000, 6);
  });

  it('counts as wall-mounted, which is what makes the hole get cut at all', () => {
    // `wallApertures` skips anything with `wallMounted` false. When `anchorFor`
    // said 'floor' this was false, so a catalog door was a panel against an
    // unbroken wall.
    expect(isWallMountedPart('door', 'door')).toBe(true);
    expect(ridesWall('door', 'door')).toBe(true);
  });

  it('cuts a hole that starts at the floor and is as tall as the door', () => {
    const p: ScenePart = {
      id: 'door-1',
      category: 'door',
      name: 'Door',
      shape: 'door',
      pos: [0, groundY('door', 'door', DOOR, H), -ROOM.depth / 2 + 0.04],
      rot: 0,
      dimMM: DOOR,
      locked: false,
      wallMounted: true,
    };
    const holes = wallApertures([p], RECT, wallSegments(RECT), H);
    const a = [...holes.values()][0]?.[0];
    expect(a).toBeDefined();
    // `MARGIN` in apertures.ts keeps the hole 20 mm inside the wall outline so
    // Earcut is never handed a coincident edge — so the floor edge is 0.02, not 0.
    expect(a!.floorY).toBeCloseTo(0.02, 6);
    expect(a!.y1 - a!.y0).toBeCloseTo(DOOR[2] / 1000 - 0.02, 6);
  });

  it('is seeded at the height the anchor asks for, in every preset', () => {
    // `room-openings.ts` authors the door's Y itself. That is fine as long as it
    // is the SAME number `groundY` would have given — the two drifting by h/2 is
    // the bug this whole describe block exists for.
    for (const { id, w, d } of PRESETS) {
      const poly = footprintForLayout(id, w, d);
      for (const o of openingsForRoom(poly)) {
        if (o.kind !== 'door') continue;
        expect(o.y, `${id} door y`).toBeCloseTo(groundY('door', 'door', o.dimMM, H), 6);
      }
    }
  });

  it('spawns against a wall rather than in the middle of the room', () => {
    // Not cosmetic: `wallApertures` cuts the hole in whichever wall is NEAREST,
    // so a door left at the centre punched a hole in a wall it was nowhere near.
    const room = { width: ROOM.width, depth: ROOM.depth, height: H, footprint: RECT };
    const { pos, wallMounted } = placeNewPart('door', 'door', DOOR, room, []);
    expect(wallMounted).toBe(true);
    expect(pos[1]).toBeCloseTo(DOOR[2] / 2000, 6);
    const near = nearestEdge(RECT, pos[0], pos[2]);
    expect(near!.dist).toBeLessThan(DOOR[1] / 1000 + 0.1);
  });

  it('takes the wall nearest where it was dropped, not nearest the centre', () => {
    const room = { width: ROOM.width, depth: ROOM.depth, height: H, footprint: RECT };
    const west = placeNewPart('door', 'door', DOOR, room, [], [-ROOM.width / 2 + 0.3, 0]);
    const east = placeNewPart('door', 'door', DOOR, room, [], [ROOM.width / 2 - 0.3, 0]);
    expect(west.pos[0]).toBeLessThan(0);
    expect(east.pos[0]).toBeGreaterThan(0);
  });

  it('leaves a ceiling fan in the middle of the room', () => {
    // `isWallMountedPart` is true for a fan too — its geometry is centred — so
    // the spawn snap has to key off `ridesWall`, not off that.
    expect(ridesWall('fan', 'fan')).toBe(false);
    const room = { width: ROOM.width, depth: ROOM.depth, height: H, footprint: RECT };
    const { pos } = placeNewPart('fan', 'fan', [1000, 1000, 200], room, []);
    expect(pos[0]).toBeCloseTo(0, 6);
    expect(pos[2]).toBeCloseTo(0, 6);
  });
});

describe('a curtain hangs in front of the window, not inside it', () => {
  it('stands off the wall by its own depth plus the standoff', () => {
    expect(wallStandoff('curtain')).toBe(CURTAIN_STANDOFF);
    expect(wallStandoff('window')).toBe(0);
    const dim: [number, number, number] = [1600, 80, 2200];
    const flush = snapToWall([0, 0, -2], dim, RECT);
    const stood = snapToWall([0, 0, -2], dim, RECT, wallStandoff('curtain'));
    // North wall: +Z is into the room, so standing off means a LARGER z.
    expect(stood.z - flush.z).toBeCloseTo(CURTAIN_STANDOFF, 6);
  });

  it('hangs clear of every window it dresses, in every preset', () => {
    for (const { id, w, d } of PRESETS) {
      const parts = defaultScene(id, w, d);
      const curtains = parts.filter((p) => p.shape === 'curtain');
      const windows = parts.filter((p) => p.shape === 'window');
      if (curtains.length === 0) continue;
      expect(curtains.length, `${id} curtains vs windows`).toBe(windows.length);
      for (const c of curtains) {
        // Its window is the one it shares a wall and a centre line with.
        const w = windows.find((q) => Math.abs(q.rot - c.rot) < 0.01)!;
        expect(w, `${id}: a curtain with no window`).toBeDefined();
        // Distance along the window's OWN facing direction, which is the only
        // reading that works on all four walls of an L or a T.
        const [fx, fz] = localToWorld(w.rot, 0, 1);
        const ahead = (c.pos[0] - w.pos[0]) * fx + (c.pos[2] - w.pos[2]) * fz;
        // Clear of the window's front face, and the cloth is genuinely in front
        // of the glass rather than merely offset by a z-fight epsilon.
        expect(ahead, `${id} curtain standoff`).toBeGreaterThanOrEqual(
          w.dimMM[1] / 2000 + CURTAIN_STANDOFF - 1e-6,
        );
      }
    }
  });

  it('does not hang through the ceiling', () => {
    // `groundY`'s 'ceiling' branch hangs a small thing just under the slab, and a
    // 2.6 m curtain is not a small thing: it put the CENTRE at roomHeight - 0.15.
    const dim: [number, number, number] = [1600, 80, 2600];
    const y = groundY('curtain', 'curtain', dim, H);
    expect(y + dim[2] / 2000).toBeLessThanOrEqual(H + 1e-9);
    expect(y - dim[2] / 2000).toBeGreaterThanOrEqual(-1e-9);
  });
});
