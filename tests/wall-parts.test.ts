import { describe, it, expect } from 'vitest';
import { wallApertures } from '@/lib/apertures';
import { clampIntoFootprint, footprintForLayout, pointInFootprint, polygonCentroid, wallSegments, type Footprint } from '@/lib/footprint';
import { footFromPart, footInsidePoly, type Poly } from '@/lib/geometry';
import type { LayoutId } from '@/lib/storage';
import { openingsForRoom } from '@/lib/room-openings';
import { anchorFor, groundY, ridesWall, snapToWall, wallStandoff, CURTAIN_STANDOFF } from '@/lib/physics';
import { defaultScene, isWallMountedPart, placeNewPart, type ScenePart } from '@/lib/scene-spec';
import { ROOM } from '@/lib/parts-catalog';
import { aabbExtents, localToWorld, nearestEdge, obbFromPart, obbInsidePoly } from '@/lib/geometry';


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
    // Half-width in from the bounding box would be 5.5 / 3.5, and that is in the
    // notch. `intoRoom` now finishes on `containedXZ`, so the fan comes back inside
    // the house — the drop point still decides WHICH part of the room, which is what
    // "falls back to the drop point" means and is why this test is still about that.
    expect(pointInFootprint(r.pos[0], r.pos[2], L), `${r.pos} must be inside the L`).toBe(true);
    // The whole 1000 mm fan, not just its centre: a centre clamp would satisfy the
    // line above with half the blades through the wall, and that distinction is the
    // entire reason `containedXZ` reads a footprint.
    expect(footInsidePoly(footFromPart(r.pos, r.rot, FAN), L as unknown as Poly)).toBe(true);
    // Pinned beside the property so a walk that starts landing somewhere else shows
    // up as a diff rather than a shrug. Measured, not chosen.
    expect(r.pos[0]).toBeCloseTo(5.48, 6);
    expect(r.pos[2]).toBeCloseTo(1.48, 6);
  });

  it('keeps a drop out of the quadrant an L cuts away', () => {
    // This test used to be called `does NOT yet keep a drop out of…` and its last
    // assertion was `false`. Both flipped together, which is what the note left here
    // asked whoever landed the fix to do.
    //
    // The history, because it is two different reasons and only the second one was
    // this change's. FIRST: `clampIntoFootprint` could not do it — it walked the point
    // toward `polygonCentroid`, which averages the VERTICES rather than the area, and
    // for this L that average is (3, 2), the reflex corner itself. Every step of the
    // walk stayed inside the notch. Fixed earlier: the clamp aims at `interiorPoint`,
    // which checks its answer, and the first two assertions below are the fixture
    // stating the trap and the clamp stepping round it.
    //
    // SECOND, and this is the part that just landed: `placeNewPart`'s `intoRoom` did
    // the BOUNDS inset and only that, so a drop into an L's notch was inside the box
    // and outside the room — and no amount of fixing the clamp changes a caller that
    // never calls it. It now finishes on `containedXZ` from `lib/layout-settle.ts`,
    // which is what `contain` was already doing for every solved placement.
    //
    // **And the clamp it calls is deliberately NOT `clampIntoFootprint`**, which is
    // still exercised below and still not what `placeNewPart` uses: that one puts a
    // POINT inside the polygon, and a point 5 cm inside the leg of a U satisfies it
    // with a 2 m sofa mostly through the plaster. So the last two assertions here are
    // a pair on purpose — the centre inside the room, and then the whole footprint
    // inside it, which is the stronger claim and the one that was missing.
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
    // The property is the promise in the name; the literal is pinned beside it so a
    // walk that starts landing somewhere else shows up as a diff rather than a shrug.
    const c = clampIntoFootprint(5, 3.5, L);
    expect(pointInFootprint(c[0], c[1], L), `${c} must be inside the L`).toBe(true);
    expect(c).toEqual([2.75, 1.85]);

    const r = placeNewPart('chair', 'chair-dining', [500, 500, 900], { width: 6, depth: 4, height: 2.5, footprint: L }, [], [5, 3.5]);
    // (5, 3.5) is inside the bounding box and inside the notch, so the bounds inset
    // alone left it there and returned it unchanged. Now:
    expect(pointInFootprint(r.pos[0], r.pos[2], L), `${r.pos} must be inside the L`).toBe(true);
    expect(footInsidePoly(footFromPart(r.pos, r.rot, [500, 500, 900]), L as unknown as Poly)).toBe(true);
    // X is untouched — 5 is in the leg of the L, and nothing needed to move it. The
    // asymmetry is the point: a fix that simply dragged the piece toward the middle
    // would move both coordinates, and this pins that only the one that was wrong
    // moved. Measured.
    expect(r.pos[0]).toBeCloseTo(5, 6);
    expect(r.pos[2]).toBeCloseTo(1.73, 6);
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
    // 5.83, not 5.85. The bounds inset pulls it in by its own half-width to exactly
    // flush with the wall, and `containedXZ` then adds `WALL_GAP` — 20 mm — because a
    // footprint whose corners sit ON the boundary is not INSIDE the polygon.
    //
    // That 20 mm is the settle path's own number and reaching the add path is the
    // point rather than a side effect: `contain` has always held every SOLVED
    // placement 20 mm off the plaster, so an added piece sitting flush meant adding a
    // sofa and then pressing Suggest moved it 20 mm for no reason the user could see.
    // Two answers to "how close to the wall does furniture go"; now one.
    expect(r.pos[0]).toBeCloseTo(5.83, 6);
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

describe('a floor-standing piece is added facing its wall', () => {
  // `placeNewPart` ended `rot: 0` for everything that stands on the floor, so three
  // beds dropped at three different walls all pointed the same way — headboards
  // north, two of them into open floor. Reported as "all beds face that side".
  //
  // The room already prices this: `lib/layout-score.ts` charges a `prefers-wall`
  // piece `FACING_GAIN * angleCost(yaw, edge.yaw)`, so Shuffle turns them the moment
  // it runs. The defect was that adding produced a heading the solver would
  // immediately overrule.
  const room = { width: ROOM.width, depth: ROOM.depth, height: H, footprint: RECT };
  const BED: [number, number, number] = [900, 2000, 600];

  it('takes a different heading at each of the four walls', () => {
    // The asymmetric check: a bed at the north wall and a bed at the west wall must
    // NOT agree. Testing one wall proves nothing — `rot: 0` passes that.
    const drops: Array<[string, [number, number]]> = [
      ['north', [0, -ROOM.depth / 2 + 0.6]],
      ['south', [0, ROOM.depth / 2 - 0.6]],
      ['west', [-ROOM.width / 2 + 0.6, 0]],
      ['east', [ROOM.width / 2 - 0.6, 0]],
    ];
    const rots = drops.map(([, at]) => placeNewPart('bed', 'bed-single', BED, room, [], at).rot);
    // Four walls, four distinct headings, and each one is the yaw `snapToWall`
    // reports for the wall the drop was nearest — the same answer wall-mounted
    // pieces have always been given, read from the same function.
    expect(new Set(rots.map((r) => r.toFixed(4))).size).toBe(4);
    for (const [i, [, at]] of drops.entries()) {
      expect(rots[i]).toBeCloseTo(snapToWall([at[0], 0, at[1]], BED, RECT).rot ?? 0, 6);
    }
  });

  it('leaves a piece with no wall affinity alone', () => {
    // The negative control. `plant` is 'free' and a lamp is 'free'; turning those to
    // face a wall would be inventing an opinion the room does not have. Without this
    // the test above passes for an implementation that turns everything.
    const at: [number, number] = [-ROOM.width / 2 + 0.6, 0];
    expect(placeNewPart('plant', 'plant', [500, 500, 1200], room, [], at).rot).toBe(0);
    expect(placeNewPart('lamp', 'lamp-floor', [400, 400, 1500], room, [], at).rot).toBe(0);
  });

  it('does not move the piece — only turns it', () => {
    // The promise this keeps: dropped where you aimed. Only the yaw comes from the
    // wall, so a bed dropped a metre off the wall stays a metre off it. A version
    // that also snapped would make a bed ride its wall on add and not on the next
    // drag, since `lib/drag-resolve.ts` snaps `ridesWall` pieces only.
    //
    // The drop point is deliberately well inside the room: this is about the SNAP,
    // and the containment clamp below is allowed to move a piece dropped near a wall.
    // Asserting "never moves" at any drop point is what let that clamp stay
    // rotation-blind, since the two promises look identical from the middle of the
    // floor and only one of them is real.
    const at: [number, number] = [-1.2, -0.8];
    const free = placeNewPart('plant', 'plant', [500, 500, 1200], room, [], at);
    const bed = placeNewPart('bed', 'bed-single', BED, room, [], at);
    expect(bed.pos[0]).toBeCloseTo(free.pos[0], 6);
    expect(bed.pos[2]).toBeCloseTo(free.pos[2], 6);
  });

  // A DOUBLE bed, and that is the whole fixture decision: 1600 × 2000. The three
  // tests above use a 900 × 2000 single and assert only `rot`, so not one of them
  // could see that every bed added at the east or west wall stood 200 mm inside the
  // plaster — `intoRoom` inset the drop point by the UNROTATED half-extents and the
  // yaw was chosen afterwards, on the line that returns.
  //
  // Both halves of that fixture matter. A piece whose plan is square has the same
  // extent at every angle and cannot express this at all; and the north and south
  // walls give a yaw of 0 or 180°, where the unrotated extents ARE the rotated ones.
  // So it takes a non-square piece AND the two walls nobody measured — the symmetric
  // case is exactly where a handedness hides.
  const DOUBLE: [number, number, number] = [1600, 2000, 600];
  const WALLS: Array<[string, [number, number]]> = [
    ['north', [0, -ROOM.depth / 2 + 0.3]],
    ['south', [0, ROOM.depth / 2 - 0.3]],
    ['west', [-ROOM.width / 2 + 0.3, 0]],
    ['east', [ROOM.width / 2 - 0.3, 0]],
  ];

  it('ends up INSIDE the room at all four walls, which needs the rotated extent', () => {
    for (const [name, at] of WALLS) {
      const { pos, rot } = placeNewPart('bed', 'bed-double', DOUBLE, room, [], at);
      // Shrunk by 10 mm on each plan axis, which is not a fudge to get a pass — it is
      // the same box `resolvePlacement` tests with (`slightlyShrunk`), and the reason
      // it exists there is worth knowing here. A piece clamped EXACTLY flush to a wall
      // has its corners on the polygon's own edge, and whether an edge-parity test
      // calls that inside comes down to floating-point noise in how the corner was
      // reached: measured, a bed flush to the north wall of a 6 × 4 read inside while
      // the mirror placement at the south wall read outside. Both flush, opposite
      // answers. The 10 mm asks "is any of this meaningfully out of the room" instead
      // of "which way did the last bit round", and a 200 mm overhang is still 200 mm.
      const box = obbFromPart(pos, rot, [DOUBLE[0] - 10, DOUBLE[1] - 10, DOUBLE[2]]);
      expect(obbInsidePoly(box, RECT), `a double bed dropped at the ${name} wall is not in the room`).toBe(true);
    }
  });

  it('is clamped by the extent it will actually have, not the one it was handed', () => {
    // The arithmetic, stated rather than inferred from the polygon test above: at the
    // west wall the yaw is ±90°, so the piece's extent along X is its 1000 mm half-
    // DEPTH, and its centre can be no nearer the wall than that. The old code allowed
    // 800 mm — its half-width — and the 200 mm difference is what the test above sees
    // as geometry outside the room.
    const [, at] = WALLS[2]; // west
    const { pos, rot } = placeNewPart('bed', 'bed-double', DOUBLE, room, [], at);
    const { ex } = aabbExtents(rot, DOUBLE);
    expect(ex).toBeCloseTo(DOUBLE[1] / 2000, 6); // turned: the depth is the X extent
    expect(pos[0]).toBeCloseTo(-ROOM.width / 2 + ex, 6);
    // …and it is genuinely a different number from the rotation-blind one, or this
    // whole fixture is measuring nothing.
    expect(ex).not.toBeCloseTo(DOUBLE[0] / 2000, 3);
  });

  it('still leaves a piece dropped clear of the walls exactly where it landed', () => {
    // The negative control for the clamp, and the promise `does not move the piece`
    // above is really making: the rotated extent must bite only where it has to.
    const at: [number, number] = [0.4, -0.5];
    const { pos } = placeNewPart('bed', 'bed-double', DOUBLE, room, [], at);
    expect(pos[0]).toBeCloseTo(at[0], 6);
    expect(pos[2]).toBeCloseTo(at[1], 6);
  });
});
