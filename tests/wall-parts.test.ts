import { describe, it, expect } from 'vitest';
import { wallApertures } from '@/lib/apertures';
import { clampIntoFootprint, footprintForLayout, pointInFootprint, polygonCentroid, wallSegments, type Footprint } from '@/lib/footprint';
import { footExtentAlong, footFromPart, footInsidePoly, obbExtentAlong, type Poly } from '@/lib/geometry';
import { openingsForRoom } from '@/lib/room-openings';
import { anchorFor, groundY, ridesWall, snapToWall, wallStandoff, CURTAIN_STANDOFF } from '@/lib/physics';
import { defaultScene, isWallMountedPart, placeNewPart, type ScenePart } from '@/lib/scene-spec';
import { ROOM } from '@/lib/parts-catalog';
// `WALL_GAP` is imported rather than spelled where an assertion is about a piece's
// clamped position: writing `0.02` there would make this file go red for a re-tune it
// has no opinion about, and the message would be about a fan.
//
// **That is not a rule against pinning the constant, and reading it as one left it
// unnamed.** The bounds in `tests/layout-rules.test.ts` admitted anything in (0, 0.05),
// and every other assertion there measures agreement between paths, which survives a
// tune because all the paths move together. Measured: setting the gap to 0.03 turns six
// tests red, five of them in THIS file — so it was caught, but every message is about a
// fan in a 6 x 4 room and none mentions the gap, which is the shape of red somebody
// closes by editing the literal. It is pinned by name at its own home now; the
// positional assertions here stay derived.
import { WALL_GAP } from '@/lib/layout-rules';
import { containedXZ } from '@/lib/layout-settle';
import { interiorPoint } from '@/lib/footprint';
import { polygonWinding } from '@/lib/geometry';

/** `containedXZ` with the two arguments every caller derives the same way, so a test
 *  below reads as the question it is asking rather than as six lines of setup. */
function seat(dimMM: [number, number, number], rot: number, x: number, z: number, poly: Footprint): [number, number] {
  const p = poly as unknown as Poly;
  return containedXZ({ rot, dimMM }, x, z, p, interiorPoint(p) ?? polygonCentroid(poly), polygonWinding(p));
}
import { aabbExtents, localToWorld, nearestEdge, obbFromPart, obbInsidePoly } from '@/lib/geometry';
import { offeredSizes } from './helpers/offered-sizes';


const RECT: Footprint = footprintForLayout('rect', ROOM.width, ROOM.depth);
const H = ROOM.height;

// The presets app/onboarding/layout-pick offers, at the sizes it offers them —
// PARSED from that page, which is also the list `tests/scene-seed.test.ts` and
// `tests/starter-navigability.test.ts` read. 'custom' is in `LAYOUT_IDS` but is
// not a preset anyone can pick.
//
// This was hand-typed, and its comment cited scene-seed's copy — which no longer
// exists, so the one pointer a reader could follow to find the duplication led
// nowhere. Four files claiming to hold "the picker's list" is four chances to be
// gating a room the picker has stopped offering.
const PRESETS = offeredSizes().map((o) => ({ id: o.id, w: o.width, d: o.depth }));

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
  // The ceiling family reaches that clamp on an AIMED drop and not on an unaimed one.
  // It used to be the other way round for every drop — a fan hung in the middle of the
  // room wherever the pointer went — and the user reversed that on 2026-09-04 (§ H.3
  // residue 1: an explicit aim overrides the midpoint default). So what is tested here
  // is that a fan honours the drop point, that it still hangs in the middle when there
  // was no drop point, and that the unaimed midpoint is tested against the polygon
  // rather than assumed.
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
  it('hangs a ceiling fan in the middle of the room when nobody aimed it', () => {
    const r = placeNewPart('fan', 'fan', FAN, room6x4, []);
    expect(r.pos[0]).toBeCloseTo(3, 6);
    expect(r.pos[2]).toBeCloseTo(2, 6);
    // …and hung at the ceiling. Both halves of this: the literal, which pins the
    // policy (it was 2.35 — `roomHeight - 0.15`, the flat drop § 35 removed — and a
    // 200 mm fan's rod stopped 50 mm short of a 2.5 m slab), and the agreement with
    // `groundY`, which pins the wiring. Either alone is half a test: the literal
    // cannot see `placeNewPart` stop calling `groundY`, and the agreement cannot see
    // both of them move together.
    expect(r.pos[1]).toBeCloseTo(2.38, 6);
    expect(r.pos[1], 'the drop path and the physics path are one answer')
      .toBeCloseTo(groundY('fan', 'fan', FAN, room6x4.height), 9);
    expect(r.rot).toBe(0);
  });

  it('hangs it where it was dropped when somebody did aim it', () => {
    // § H.3 residue 1, answered by the user on 2026-09-04: an explicit aim overrides
    // `ceilingSpot`'s midpoint default. Before that, all four rows below returned the
    // midpoint (3, 2) — which is why the fourth row is here and why it is last. It IS
    // the midpoint, so it is the one aim whose answer did not change, and a table of
    // only that row would have passed against both behaviours. The first three are the
    // asymmetry that can see the reversal; the fourth is the case that must NOT move.
    //
    // The expected points are derived from the fixture, not copied out of a run: the
    // bounds clamp at the fan's own half-extent (500 mm in from x 0…6 and z 0…4), and
    // then `WALL_GAP` more, because `intoRoom` finishes on `containedXZ` and that
    // function's acceptance test counts the 20 mm as part of being inside. Reading the
    // constant rather than typing 5.48 is the point: if `WALL_GAP` moves, these move
    // with it and the test still says what it means.
    const EX = 6 - 0.5 - WALL_GAP; // hard against the east wall
    const WX = 0 + 0.5 + WALL_GAP; // …the west
    const SZ = 4 - 0.5 - WALL_GAP; // …the south
    const NZ = 0 + 0.5 + WALL_GAP; // …the north
    const rows: Array<[[number, number], [number, number]]> = [
      [[7.5, 2], [EX, 2]],
      [[-1, -1], [WX, NZ]],
      [[0.2, 3.9], [WX, SZ]],
      [[3, 2], [3, 2]],
    ];
    for (const [at, want] of rows) {
      const r = placeNewPart('fan', 'fan', FAN, room6x4, [], at);
      expect(r.pos[0], `dropped at ${at}`).toBeCloseTo(want[0], 6);
      expect(r.pos[2], `dropped at ${at}`).toBeCloseTo(want[1], 6);
      // The height and the heading are NOT part of the reversal and must not move
      // with it — a fan still hangs at the slab and still faces nowhere in particular.
      expect(r.pos[1], `dropped at ${at}`).toBeCloseTo(groundY('fan', 'fan', FAN, room6x4.height), 9);
      expect(r.rot, `dropped at ${at}`).toBe(0);
    }
    // The whole 1000 mm fan inside the room, not just its centre — the clamp is a
    // clamp on the piece, and an aim past a wall is the case that proves it.
    const past = placeNewPart('fan', 'fan', FAN, room6x4, [], [7.5, 2]);
    expect(footInsidePoly(footFromPart(past.pos, past.rot, FAN), RECT6x4 as unknown as Poly)).toBe(true);
  });

  it('an UNAIMED fan is contained at the room MIDPOINT, on the one preset where that matters', () => {
    // **The `u`, and it has to be the `u`.** The unaimed midpoint used to be gated with
    // `pointInFootprint(mx, mz)` — a test on the POINT, not on the piece — and returned
    // raw whenever that passed. On the shipped `u` at 6 x 5 the bounds midpoint is
    // (0, 0), sitting exactly ON the notch's inner edge, so the point test answers TRUE
    // and a 1000 mm fan centred there hangs half over the cut-away quadrant. Swept
    // across all five presets with no aim, `u` is the only one that failed.
    //
    // Every other preset was structurally incapable of showing it. The shipped `l`
    // removes only its south-east quadrant, so its midpoint is strictly INSIDE the arm
    // and the fan fits; an earlier version of this test used a hand-built L whose
    // midpoint was one of its own VERTICES, which made the whole case turn on the strict
    // `<` in `pointInFootprint` rather than on any property of the room.
    const poly = footprintForLayout('u', 6, 5);
    const room = { width: 6, depth: 5, height: 2.5, footprint: poly };
    // The fixture must really be the pathological one, or this test is about nothing:
    // the midpoint reads INSIDE as a point and the fan centred there does NOT fit.
    expect(pointInFootprint(0, 0, poly), 'the U midpoint must read inside as a point').toBe(true);
    expect(
      footInsidePoly(footFromPart([0, 2.38, 0], 0, FAN, true), poly as unknown as Poly),
      'a fan centred on that midpoint must NOT fit — otherwise there is no defect here',
    ).toBe(false);

    const r = placeNewPart('fan', 'fan', FAN, room, []);
    expect(footInsidePoly(footFromPart(r.pos, r.rot, FAN, true), poly as unknown as Poly)).toBe(true);
    // Pinned as a number as well as a property, because "inside the U" is satisfied by
    // most of the floor. It is the midpoint pushed clear of the notch — NOT the world
    // origin clamped into the room, which is what the old fallback answered and which
    // says nothing about a room whose walls have been dragged off centre.
    expect(r.pos[0]).toBeCloseTo(0, 6);
    expect(r.pos[2]).toBeCloseTo(0.52, 6);
  });

  it('keeps an AIMED fan inside the house, not merely inside the bounding box', () => {
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
    // the house — the drop point still decides WHICH part of the room, and the
    // containment is what keeps honouring an aim from being licence to hang a fan in
    // the garden. That is the half of this test the § H.3 reversal did not change.
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

  it('leaves exactly WALL_GAP at all four walls, not at two of them', () => {
    // The defect, in one sentence: acceptance was `footInsidePoly`, and `pointInPoly`'s
    // ray test is half-open in z, so a footprint corner lying exactly on min-x or
    // min-z read INSIDE while its mirror on max-x / max-z read outside. A piece
    // dropped flush was therefore returned untouched at the west and north walls and
    // pushed 20 mm off at the east and south. Measured on a 6 × 4 with a 300 mm piece
    // before the fix: **0.000 / 0.020 / 0.000 / 0.020**.
    //
    // `WALL_GAP`'s own docblock in `lib/layout-rules.ts` says "every path that puts
    // something against a wall has to agree on it" and names three that did not. A
    // path that disagrees with itself on two of its own four walls is a fourth.
    //
    // All four in one loop deliberately: choosing examples is how the first version of
    // this missed it, and either single-ended test is green on the half that works.
    // `containedXZ` directly rather than through `placeNewPart`, because the add path
    // also clamps dimensions and turns floor pieces to face their wall, and neither
    // belongs in an assertion about a gap.
    const S: [number, number, number] = [300, 300, 1500];
    const h = 0.15;
    for (const [name, x, z, axis] of [
      ['west', h, 2, 0],
      ['east', 6 - h, 2, 0],
      ['north', 3, h, 2],
      ['south', 3, 4 - h, 2],
    ] as Array<[string, number, number, 0 | 2]>) {
      const [sx, sz] = seat(S, 0, x, z, RECT6x4);
      const far = axis === 0 ? 6 : 4;
      const at = axis === 0 ? sx : sz;
      expect(Math.min(at - h, far - at - h), `the ${name} wall`).toBeCloseTo(WALL_GAP, 6);
    }
  });

  it('clears BOTH walls of a corner when the piece is not square', () => {
    // The regression this pins was found by danmu-bc on a built tree, and it is why
    // `worstWall` ranks by deficit rather than by distance. `nearestEdge` orders walls
    // by how far the piece's CENTRE is from each; what a containment push has to clear
    // is the piece's own extent along that wall MINUS how far in it already is. The
    // two orderings agree only when hw === hd. A 1200 × 600 wardrobe dropped flush
    // into a corner violates both walls by 20 mm, but the near wall (0.30 m) is still
    // nearest after being cleared, so iteration 2 computed `push = 0` and broke with
    // the far wall untouched — handing the answer to the lerp, whose step is
    // `0.1 × |x0 - centre|`. Measured on the shipped branch: **240 mm / 170 mm off two
    // walls the piece was dropped flush against**, and 500 mm / 460 mm in a 12 × 10.
    //
    // Two rooms, and the second is not redundant: the displacement is a FRACTION of
    // the room, so one room's numbers are equally consistent with a fixed 240 mm
    // error. 8 × 6 is chosen because its half-extents differ from the 6 × 4 the
    // four-wall test above uses, so the two cannot share a failure.
    //
    // And 30° as well as 0°, because at 0° the piece's extents are its own half-sizes
    // and every wrong-axis substitution is still a plausible number; at 30° they are
    // 0.6696 / 0.5598 and nothing but the rotated extent lands on 20 mm.
    const SIZE: [number, number, number] = [1200, 600, 2000];
    for (const rot of [0, Math.PI / 6]) {
      const { ex, ez } = aabbExtents(rot, SIZE);
      for (const [w, d] of [[6, 4], [8, 6]] as Array<[number, number]>) {
        const poly = footprintForLayout('rect', w, d);
        for (const sx of [1, -1]) {
          for (const sz of [1, -1]) {
            // The flush centre. `footprintForLayout` is CENTRED on the origin — which
            // the first draft of this test got wrong, and the 1.24 m it then measured
            // was the fixture, not the code.
            const x0 = sx * (w / 2 - ex);
            const z0 = sz * (d / 2 - ez);
            const [x, z] = seat(SIZE, rot, x0, z0, poly);
            const where = `${w}x${d} rot ${rot.toFixed(3)} corner (${sx > 0 ? '+' : '-'}x, ${sz > 0 ? '+' : '-'}z)`;
            expect(Math.min(x + w / 2 - ex, w / 2 - x - ex), `${where}: X`).toBeCloseTo(WALL_GAP, 6);
            expect(Math.min(z + d / 2 - ez, d / 2 - z - ez), `${where}: Z`).toBeCloseTo(WALL_GAP, 6);
          }
        }
      }
    }
  });

  it('sends a piece dropped OUTSIDE back the short way, not the deep way', () => {
    // The other half of the same rule, and why `worstWall` declines to answer when the
    // centre is out of the room. A deficit is "how much more clearance this wall
    // wants", so for a piece already outside, the wall of GREATEST deficit is the one
    // it is furthest beyond — ranking by it sends the piece the longest way back.
    //
    // Measured while building the fix, on this exact fixture: deficit-ranked, the fan
    // came back at (2.48, 3.48) — 3.45 m from where it was aimed and in the L's OTHER
    // ARM. Nearest-wall, it comes back at (5.48, 1.48), 2.46 m away and in the arm it
    // was pointing at. Both are legally inside with 20 mm to spare, which is precisely
    // why `footInsidePoly` alone cannot tell them apart, and why this measures the
    // DISTANCE MOVED and not only the legality.
    const L: Footprint = [
      [0, 0],
      [6, 0],
      [6, 2],
      [3, 2],
      [3, 4],
      [0, 4],
    ];
    const at: [number, number] = [5.9, 3.9];
    expect(pointInFootprint(at[0], at[1], L), 'the drop must be in the cut-away quadrant').toBe(false);
    const [sx, sz] = seat(FAN, 0, at[0], at[1], L);
    expect(footInsidePoly(footFromPart([sx, 0, sz], 0, FAN), L as unknown as Poly)).toBe(true);
    const moved = Math.hypot(sx - at[0], sz - at[1]);
    // Pinned as a number so a walk that starts going the deep way shows up as a diff.
    expect(moved).toBeCloseTo(2.456, 3);
    expect(moved, 'the deep answer was 3.45 m — anything near that is the wrong wall').toBeLessThan(3);
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

    // ── The two assertions above are consistent with containment being NEVER
    // REACHED, and were for as long as they existed. Both only say "the centred
    // answer survived", which is equally true of a `containedXZ` that correctly
    // declines to move an unseatable piece and of an `intoRoom` that never calls it.
    // Three additions, because the discrimination takes all three:
    //
    // 1. It genuinely does not fit. Were this ever true, the answer above would be an
    //    ACCEPTANCE rather than the least-bad position kept, and the pair would be
    //    measuring a different branch from the one its comment describes.
    expect(
      footInsidePoly(footFromPart(r.pos, r.rot, [7000, 900, 800]), RECT6x4 as unknown as Poly),
      'a 7 m sofa in a 6 m room must NOT come back seated — the centred answer is the least-bad one',
    ).toBe(false);
    // 2. The oversized axis is centred and the axis that FITS is contained — the
    //    assertion that cannot pass if containment was skipped. Dropped at z = 3.9 in
    //    a 4 m room, a 900 mm-deep sofa has 3.55 as its flush centre and 3.53 once the
    //    gap is honoured; a skipped containment leaves it at 3.55.
    const mixed = placeNewPart('sofa', 'sofa', [7000, 900, 800], room6x4, [], [1, 3.9]);
    expect(mixed.pos[0], 'still centred on the axis it cannot fit').toBeCloseTo(3, 6);
    expect(mixed.pos[2], 'and contained on the axis it can').toBeCloseTo(4 - 0.45 - WALL_GAP, 6);
    // 3. …and that is a different number from the flush one, or assertion 2 is
    //    satisfied by doing nothing.
    expect(mixed.pos[2]).not.toBeCloseTo(4 - 0.45, 4);
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
    // `+ WALL_GAP`, and this assertion used to read without it — which is exactly what
    // the four-wall test below now pins. The bed at the WEST wall came back precisely
    // flush while its mirror at the east wall came back 20 mm off, because acceptance
    // was `footInsidePoly` and `pointInPoly`'s ray test is half-open in z: a foot
    // corner sitting on min-x reads INSIDE and its twin on max-x reads outside. So
    // this fixture was pinning the asymmetry rather than catching it.
    expect(pos[0]).toBeCloseTo(-ROOM.width / 2 + ex + WALL_GAP, 6);
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

describe('a ROUND piece is measured as the ellipse it draws, not as its box', () => {
  // `escape` honours `circle` through `footCorners`; the shortfall did not, so `Seat.out`
  // and `Seat.short` described two different pieces and were then ranked as one. The
  // numbers are the whole finding: at 45 degrees a 1200 mm round piece's bounding box
  // reaches 0.8485 m along a world axis and its footprint reaches 0.6000 m.
  const SIZE: [number, number, number] = [1200, 1200, 400];

  it('the two extents differ by (root2 - 1) * r at 45 degrees, and by nothing at 0', () => {
    const at = (rot: number) => {
      const f = footFromPart([0, 0, 0], rot, SIZE, true);
      return { box: obbExtentAlong(f, 1, 0), foot: footExtentAlong(f, 1, 0) };
    };
    // At 0 degrees a square box and its inscribed circle have the same reach along x, so
    // this axis alone cannot tell the two functions apart — which is exactly why the
    // rotated case is the one that matters.
    const zero = at(0);
    expect(zero.box).toBeCloseTo(0.6, 9);
    expect(zero.foot).toBeCloseTo(0.6, 9);

    const tilt = at(Math.PI / 4);
    expect(tilt.box).toBeCloseTo(0.6 * Math.SQRT2, 6);
    expect(tilt.foot).toBeCloseTo(0.6, 9);
    expect(tilt.box - tilt.foot).toBeCloseTo(0.6 * (Math.SQRT2 - 1), 6);

    // A NON-round piece must be untouched by the new branch, or this is a change to
    // every other caller as well.
    const sq = footFromPart([0, 0, 0], Math.PI / 4, SIZE, false);
    expect(footExtentAlong(sq, 1, 0)).toBeCloseTo(obbExtentAlong(sq, 1, 0), 12);
  });

  it('and a round piece already at WALL_GAP is left alone, at every angle', () => {
    // The consequence, and the reason this is a defect rather than a rounding difference:
    // the box overstates the reach, so the shortfall was positive for a piece that was
    // already correctly placed and `contain` pushed it 249 mm further in — then again on
    // the next settle, since nothing about the position made the answer stable.
    const r = 0.6;
    const poly = footprintForLayout('rect', 6, 4);
    for (const rot of [0, Math.PI / 8, Math.PI / 4, Math.PI / 3, 1.1]) {
      for (const [x0, z0] of [
        [-(3 - r - WALL_GAP), 0],
        [3 - r - WALL_GAP, 0],
        [0, -(2 - r - WALL_GAP)],
        [0, 2 - r - WALL_GAP],
      ] as Array<[number, number]>) {
        const p = poly as unknown as Poly;
        const [x1, z1] = containedXZ(
          { rot, dimMM: SIZE, circle: true },
          x0,
          z0,
          p,
          interiorPoint(p) ?? polygonCentroid(poly),
          polygonWinding(p),
        );
        expect(Math.hypot(x1 - x0, z1 - z0), `rot ${rot.toFixed(2)} at (${x0}, ${z0})`).toBeLessThan(1e-6);
      }
    }
  });
});
