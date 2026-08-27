import { describe, it, expect } from 'vitest';
import { wallApertures } from '@/lib/apertures';
import { clampIntoFootprint, footprintForLayout, pointInFootprint, polygonCentroid, wallSegments, type Footprint } from '@/lib/footprint';
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

describe('placeNewPart keeps a drop inside the room', () => {
  // Both drop handlers used to clamp the drop point themselves, and both did it
  // only `if (!wallMounted)` — `isWallMountedPart`, true for a ceiling fan. A fan
  // rides no wall, so nothing above put it on one and that guard meant nothing
  // below pulled it in: a fan dragged out of the library landed exactly where the
  // pointer was released, outside the walls included. One clamp, in placeNewPart.
  //
  // The ceiling family no longer reaches that clamp on a normal drop — it hangs in
  // the middle of the room instead (`ceilingSpot`) — so the clamp's own edges are
  // exercised by floor pieces two describes down. What is tested here is that a fan
  // ignores the drop point, and that it stops ignoring it when the middle of the
  // room is a place there is no room at.
  const RECT6x4: Footprint = [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ];
  const room6x4 = { width: 6, depth: 4, height: 2.5, footprint: RECT6x4 };
  const FAN: [number, number, number] = [1000, 1000, 200];

  // This room spans x 0…6 and z 0…4, so the middle of it is (3, 2) and NOT the
  // origin — a centre written as [0, 0] would pass on the presets and fail here.
  it('hangs a ceiling fan in the middle of the room, wherever it was dropped', () => {
    for (const at of [[7.5, 2], [-1, -1], [0.2, 3.9], [3, 2]] as Array<[number, number]>) {
      const r = placeNewPart('fan', 'fan', FAN, room6x4, [], at);
      expect(r.pos[0], `dropped at ${at}`).toBeCloseTo(3, 6);
      expect(r.pos[2], `dropped at ${at}`).toBeCloseTo(2, 6);
      // …and hung at the ceiling, which is the half that was always right.
      expect(r.pos[1]).toBeCloseTo(2.35, 6);
      expect(r.rot).toBe(0);
    }
  });

  it('falls back to the drop point when the middle of the room is not in it', () => {
    // An L's bounding-box midpoint is the reflex corner it cuts away, so "the
    // middle of the room" is outside the room. Then where the user aimed is the
    // better answer, and it goes through the same bounds clamp as a floor piece.
    const L: Footprint = [
      [0, 0],
      [6, 0],
      [6, 2],
      [3, 2],
      [3, 4],
      [0, 4],
    ];
    expect(pointInFootprint(3, 2, L), 'the fixture must actually have its middle cut away').toBe(false);
    const room = { width: 6, depth: 4, height: 2.5, footprint: L };
    const r = placeNewPart('fan', 'fan', FAN, room, [], [5.9, 3.9]);
    // Half-width in from the bounding box, not 5.9 / 3.9 …
    expect(r.pos[0]).toBeCloseTo(5.5, 6);
    expect(r.pos[2]).toBeCloseTo(3.5, 6);
    // … and that is in the notch, exactly as it is for a floor piece. Same known
    // limitation, same place: when this starts passing as `true`, delete the
    // assertion, not the test.
    expect(pointInFootprint(r.pos[0], r.pos[2], L)).toBe(false);
  });

  it('does NOT yet keep a drop out of the quadrant an L cuts away', () => {
    // Written down rather than left as a surprise. `clampIntoFootprint` is the
    // function for this and it cannot do it: it walks the point toward
    // `polygonCentroid`, which averages the VERTICES rather than the area, and for
    // this L that average is (3, 2) — the reflex corner itself. Every step of the
    // walk stays inside the notch and the fallback returns the corner, which
    // `pointInFootprint` calls outside. Fixing it means changing
    // `polygonCentroid`, whose other caller derives every wall's inward normal
    // from it, so it is a separate change with its own risk.
    const L: Footprint = [
      [0, 0],
      [6, 0],
      [6, 2],
      [3, 2],
      [3, 4],
      [0, 4],
    ];
    expect(polygonCentroid(L)).toEqual([3, 2]);
    expect(pointInFootprint(3, 2, L)).toBe(false);
    expect(clampIntoFootprint(5, 3.5, L)).toEqual([3, 2]);

    const r = placeNewPart('chair', 'chair-dining', [500, 500, 900], { width: 6, depth: 4, height: 2.5, footprint: L }, [], [5, 3.5]);
    // The bounds clamp does its half — the piece's extents are inside the box…
    expect(r.pos[0]).toBeCloseTo(5, 6);
    expect(r.pos[2]).toBeCloseTo(3.5, 6);
    // …and the notch is still the notch. When this starts passing as `true`,
    // delete the assertion, not the test.
    expect(pointInFootprint(r.pos[0], r.pos[2], L)).toBe(false);
  });

  it('still puts a wall rider on the wall nearest where it was aimed', () => {
    // placeNewPart's own wall path is unchanged and must stay so: the drop point
    // decides WHICH wall, and the clamp must not run first and move it.
    const r = placeNewPart('tv', 'tv', [1200, 100, 700], room6x4, [], [5.9, 2]);
    expect(r.pos[0]).toBeGreaterThan(5.8);
    expect(Math.cos(r.rot)).toBeCloseTo(0);
  });
});

describe('placeNewPart: the two edges of that clamp', () => {
  const RECT6x4: Footprint = [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ];
  const room6x4 = { width: 6, depth: 4, height: 2.5, footprint: RECT6x4 };

  it('asks what is under the CLAMPED point, not under where the pointer let go', () => {
    // A tabletop-prone piece dropped outside the room was asking what it could
    // stand on out there — and the honest answer, nothing, put it on the floor
    // while the clamp then moved it on top of a table.
    const table = {
      id: 'table', name: 'table', category: 'table', shape: 'coffee-table',
      dimMM: [1200, 800, 750], pos: [5.5, 0, 2], rot: 0, locked: false,
    } as unknown as ScenePart;
    const r = placeNewPart('lamp', 'lamp-table', [300, 300, 400], room6x4, [table], [7.5, 2]);
    expect(r.pos[0]).toBeCloseTo(5.85, 6); // pulled in by its own half-width
    expect(r.pos[1]).toBeCloseTo(0.75, 6); // and it landed on the table it arrived over
  });

  it('centres a piece too big to be inset from both sides', () => {
    // Deliberately wider than the room. A piece that does not fit KEEPS its size
    // (rule 2 — say so, never silently resize it) and `lib/clearance.ts` is what
    // reports it, so this branch only decides where the oversized thing sits.
    // Without it the min beats the max and the piece is pinned against one wall,
    // which reads as a placement decision rather than as "it does not fit".
    const r = placeNewPart('sofa', 'sofa', [7000, 900, 800], room6x4, [], [1, 2]);
    expect(r.pos[0]).toBeCloseTo(3, 6);
    const deep = placeNewPart('sofa', 'sofa', [900, 5000, 800], room6x4, [], [3, 0.2]);
    expect(deep.pos[2]).toBeCloseTo(2, 6);
  });
});
