import { describe, it, expect } from 'vitest';
import {
  CAM_HEIGHT,
  defaultCal,
  calFromHfov,
  wallFrame,
  wallRowAtHeight,
  wallSpan,
  calibrateFromFloorLine,
  heightFromFloorLine,
  placeCeilingObject,
  placeFloorObject,
  placeWallObject,
  type CameraCal,
} from '@/lib/photo-geometry';
import { hfovFromFocal35 } from '@/lib/exif';
import type { CaptureSlot } from '@/lib/storage';
import { footprintForLayout, type Footprint } from '@/lib/footprint';
import {
  ALONG,
  bboxOfCeilingDisc,
  bboxOfFloorBox,
  bboxOfFloorCylinder,
  bboxOfFloorObject,
  bboxOfWallPanel,
  bboxOfWallSolid,
  inFrame,
  project,
} from './helpers/project';

const ROOM = { width: 6, depth: 4, height: 2.8, footprint: footprintForLayout('rect', 6, 4) };
/** ~106° hFOV — a phone ultrawide. The only common lens whose frame contains any
 *  ceiling at all from 1.5 m in a 2.8 m room; see `placeCeilingObject`. */
const WIDE: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
const CAL: CameraCal = { k: 1.2, aspect: 4 / 3 };
/** A depthless CARD — the footprint every fixture in this file below projects, and
 *  the case in which `placeFloorObject`'s depth terms collapse. Not a piece of
 *  furniture: nothing in the app produces a card, and the solid-footprint round
 *  trips that prove the placer are in their own describe at the bottom. It is here
 *  because the hand-computed cases above it were written against a card, and
 *  changing them to solids would have moved every number they were derived from by
 *  hand — which is the one property in this file worth keeping. */
const CARD = { depthM: 0 };

/** The framed wall's distance, read from the polygon — see `wallD`'s docblock. */
const wallD = (slot: CaptureSlot, room: { footprint: Footprint }) =>
  wallFrame(slot, room.footprint)!.distance;

/** A room with ONE wall dragged, which is the fixture every other room in this file
 *  cannot be. `moveWall` translates two vertices and re-derives width/depth from the
 *  new bounding box without recentring, so `depth/2` stops describing the wall while
 *  the polygon still does — and in a room centred on the lens the two are the same
 *  number, which is why nothing here could express the defect for as long as every
 *  fixture was centred. Both signs, because inward over-reads the distance and
 *  outward under-reads it, and a one-signed fixture cannot see a swapped comparison. */
const dragged = (side: 'n' | 's' | 'e' | 'w', by: number) => {
  const [hw, hd] = [3, 3];
  const box = { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd };
  if (side === 'n') box.minZ -= by;
  else if (side === 's') box.maxZ += by;
  else if (side === 'e') box.maxX += by;
  else box.minX -= by;
  return {
    width: box.maxX - box.minX,
    depth: box.maxZ - box.minZ,
    height: 2.7,
    footprint: [
      [box.minX, box.minZ],
      [box.maxX, box.minZ],
      [box.maxX, box.maxZ],
      [box.minX, box.maxZ],
    ] as Footprint,
  };
};

describe('the framed wall · one description of it, and the half that never moved', () => {
  it('reads n/s across the depth and e/w across the width, as the deleted pair did', () => {
    // `wallDistance` is gone, so this states the convention against the arithmetic it
    // used to be rather than against itself — an assertion that measures its own
    // subject is the shape `tests/module-tiling.test.ts` was caught by.
    expect(wallD('n', ROOM)).toBe(ROOM.depth / 2);
    expect(wallD('s', ROOM)).toBe(ROOM.depth / 2);
    expect(wallD('e', ROOM)).toBe(ROOM.width / 2);
    expect(wallD('w', ROOM)).toBe(ROOM.width / 2);
    expect(wallD('n', ROOM)).toBe(2);
    expect(wallD('e', ROOM)).toBe(3);
  });

  // The wall you stand `depth/2` from is the one that runs the room's full WIDTH, and
  // a `wallSpan` that agreed with itself but not with the distance would file every
  // photo against the wrong axis and still look reasonable.
  it('and the wall you are depth/2 from is the one that is width wide', () => {
    for (const slot of ['n', 'e', 's', 'w'] as const) {
      const near = wallD(slot, ROOM) * 2;
      const across = wallSpan(slot, ROOM);
      expect(near + across).toBe(ROOM.width + ROOM.depth);
      expect(across).not.toBe(near);
    }
    expect(wallSpan('n', ROOM)).toBe(6);
    expect(wallSpan('e', ROOM)).toBe(4);
  });

  // WHY `wallSpan` survived the deletion of its twin, made executable rather than
  // left as a paragraph in its docblock. A span is `maxX − minX` either way, because
  // `moveWall` re-derives width/depth from `footprintBounds` — so dragging a wall
  // moves the DISTANCE and the two ENDS INDIVIDUALLY and never the span. That is
  // also why the surface gate needed `left` and `right` separately: the quantity
  // `wallSpan` returns is exactly the one that carries no information about where
  // the wall is.
  it('a wall’s SPAN is the same in both conventions, dragged or not', () => {
    for (const side of ['n', 's', 'e', 'w'] as const) {
      for (const by of [1, 2, -0.5]) {
        const room = dragged(side, by);
        for (const slot of ['n', 's', 'e', 'w'] as const) {
          const frame = wallFrame(slot, room.footprint)!;
          expect(wallSpan(slot, room), `${side}${by} ${slot}`).toBeCloseTo(frame.right - frame.left, 12);
        }
      }
    }
  });

  // And the complement, which is the defect itself: the DISTANCE does move, and it
  // moves for BOTH slots on the dragged axis — the wall opposite the one you pulled
  // is now mis-measured too, in the other direction, because the bounding box grew
  // at one end and `depth/2` splits the difference.
  it('a wall’s DISTANCE moves when any wall on its axis is dragged', () => {
    const room = dragged('n', 1); // 6 × 6 room, north pulled out: box 6 × 7
    expect(room.depth).toBe(7);
    expect(wallD('n', room)).toBe(4); // the real wall
    expect(wallD('s', room)).toBe(3); // untouched, and also real
    expect(room.depth / 2).toBe(3.5); // what the deleted pair answered for BOTH
    // The perpendicular pair is unaffected in distance and grown in span.
    expect(wallD('e', room)).toBe(3);
    expect(wallSpan('e', room)).toBe(7);
  });
});

describe('calibrateFromFloorLine', () => {
  it('round-trips: floor line projected with known k recovers k (portrait shot)', () => {
    // Portrait orientation (aspect < 1) — the only case where a level camera
    // 1.5m up actually sees the wall-floor line of a nearby wall in frame.
    const PORTRAIT: CameraCal = { k: 1.2, aspect: 0.75 };
    const [, vFloor] = project('n', 0, 0, -2, PORTRAIT);
    expect(vFloor).toBeLessThan(0.99); // line is inside the frame
    const cal = calibrateFromFloorLine(vFloor, 'n', ROOM.footprint, PORTRAIT.aspect);
    expect(cal).not.toBeNull();
    expect(cal!.k).toBeCloseTo(PORTRAIT.k, 5);
  });

  it('returns null when the floor line would be outside a landscape frame', () => {
    const [, vFloor] = project('n', 0, 0, -2, CAL); // lands beyond v=1
    expect(calibrateFromFloorLine(vFloor, 'n', ROOM.footprint, CAL.aspect)).toBeNull();
  });

  it('rejects a floor line above the image centre', () => {
    expect(calibrateFromFloorLine(0.4, 'n', ROOM.footprint, 4 / 3)).toBeNull();
  });
});

describe('placeFloorObject', () => {
  it('recovers position and size on the N wall side', () => {
    // 1.6m-wide, 0.9m-tall sideboard at (0.8, -1.5), seen from the N camera.
    const box = bboxOfFloorObject('n', 0.8, -1.5, 1.6, 0.9, CAL);
    const g = placeFloorObject(box, 'n', ROOM.footprint, CAL, CARD)!;
    expect(g.position.x).toBeCloseTo(0.8, 2);
    expect(g.position.z).toBeCloseTo(-1.5, 2);
    expect(g.widthMM).toBeCloseTo(1600, -1);
    expect(g.heightMM).toBeCloseTo(900, -1);
    expect(g.yaw).toBeCloseTo(0);
  });

  it('recovers position via the mirrored S camera', () => {
    const box = bboxOfFloorObject('s', -0.5, 1.2, 0.6, 1.8, CAL);
    const g = placeFloorObject(box, 's', ROOM.footprint, CAL, CARD)!;
    expect(g.position.x).toBeCloseTo(-0.5, 2);
    expect(g.position.z).toBeCloseTo(1.2, 2);
    expect(g.heightMM).toBeCloseTo(1800, -1);
    expect(g.yaw).toBeCloseTo(Math.PI);
  });

  it('recovers position via the E camera (axes swapped)', () => {
    const box = bboxOfFloorObject('e', 2.0, 0.7, 1.0, 0.5, CAL);
    const g = placeFloorObject(box, 'e', ROOM.footprint, CAL, CARD)!;
    expect(g.position.x).toBeCloseTo(2.0, 2);
    expect(g.position.z).toBeCloseTo(0.7, 2);
    expect(g.widthMM).toBeCloseTo(1000, -1);
  });

  it('clamps distance to the wall (bbox bottom near the horizon)', () => {
    // Bottom edge barely below centre → naive distance would exceed the room.
    const g = placeFloorObject([0.45, 0.2, 0.1, 0.33], 'n', ROOM.footprint, CAL, CARD)!;
    expect(g.distance).toBeLessThanOrEqual(wallD('n', ROOM));
  });

  it('returns null when the bottom edge is above the horizon', () => {
    expect(placeFloorObject([0.4, 0.1, 0.2, 0.3], 'n', ROOM.footprint, CAL, CARD)).toBeNull();
  });
});

describe('placeWallObject', () => {
  it('recovers a TV mounted on the N wall — size and mount height', () => {
    // 1.2m × 0.7m panel centred 1.4m up at x = -0.6 on the N wall (z = -2).
    const [u1, vTop] = project('n', -0.6 - 0.6, 1.4 + 0.35, -2, CAL);
    const [u2, vBottom] = project('n', -0.6 + 0.6, 1.4 - 0.35, -2, CAL);
    const box: [number, number, number, number] = [u1, vTop, u2 - u1, vBottom - vTop];
    const g = placeWallObject(box, 'n', ROOM.footprint, CAL, CARD)!;
    expect(g.position.x).toBeCloseTo(-0.6, 2);
    expect(g.position.z).toBeCloseTo(-2, 2);
    expect(g.position.y).toBeCloseTo(1.4, 2);
    expect(g.widthMM).toBeCloseTo(1200, -1);
    expect(g.heightMM).toBeCloseTo(700, -1);
  });
});

// ── A floor piece is a SOLID, and that is what the placer inverts ─────────────
//
// The describe below is the proof of the near-face fix, and it is the assertion the
// suite did not have for as long as the suite existed. Every fixture above this
// point projects a depthless CARD — a rectangle offset along the wall axis only —
// for which a piece's near face and its centre plane are the same plane. That is
// exactly the quantity `placeFloorObject` was getting wrong, so it came back exact
// and the exactness was a property of the fixture. An 850 mm sofa was decoded
// 425 mm too close, a nightstand read ~130 mm too tall, and a floor lamp 81% too
// wide, with every gate green.
//
// So the fixtures here project solids: eight corners for a box footprint, tangent
// rim samples for a round one. The forward model and the inverse are genuinely
// different code — an extent over projected points versus three closed forms — so
// this is a round trip that can fail, which `tests/helpers/project.ts`'s own header
// is careful to say a round trip is not always.

/** The tangent bbox of a vertical cylinder worked out in CLOSED FORM, for a level
 *  lens: azimuth ± asin(r/m) for the columns, the near rim for the bottom row, and
 *  the near or far top rim for the top row depending on whether the piece's top is
 *  above the lens.
 *
 *  Beside the sampled projector rather than instead of it, and the pair is the
 *  point. `bboxOfFloorCylinder` samples 720 rim points, so its bbox is a polygon's
 *  and lands a micron or so inside the true tangent — small, but it plateaus rather
 *  than vanishing, and "small" is not a claim about which side of the seam an error
 *  is on. This says: with no sampling at all, the inverse is exact to twelve
 *  decimals. That is what lets `tests/detect-pipeline.test.ts` name its round
 *  allowance after the fixture instead of hoping. */
function tangentBboxOfCylinder(
  f: number,
  lateral: number,
  diaM: number,
  hM: number,
  cal: CameraCal,
): [number, number, number, number] {
  const height = cal.height ?? CAM_HEIGHT;
  const rho = diaM / 2;
  const m = Math.hypot(f, lateral);
  const al = Math.atan2(lateral, f);
  const be = Math.asin(rho / m);
  const uOf = (t: number) => t / cal.k + 0.5;
  const vOf = (b: number) => 0.5 - (b * cal.aspect) / cal.k;
  const uL = uOf(Math.tan(al - be));
  const uR = uOf(Math.tan(al + be));
  const vBottom = vOf(-height / (f - rho));
  const vTop = vOf((hM - height) / (hM > height ? f - rho : f + rho));
  return [uL, vTop, uR - uL, vBottom - vTop];
}

describe('placeFloorObject over solids', () => {
  const TILTS = [0, 5, -5, 12, -12];
  const cal = (deg: number): CameraCal => ({ k: 1.2, aspect: 4 / 3, tiltRad: (deg * Math.PI) / 180 });

  it('recovers a real box exactly, at every tilt and on every wall', () => {
    // Position, width AND height, all four at once, because they all rode the same
    // near-face distance and so were all wrong together. The lateral offsets are
    // deliberately signed and non-zero: at x = 0 a sign error is invisible, and the
    // straddling case (the piece across its own view axis) and the off-to-one-side
    // case take DIFFERENT branches of the corner selection — one reads both edges on
    // the near face, the other reads one on each.
    for (const slot of ['n', 's', 'e', 'w'] as const) {
      for (const deg of TILTS) {
        for (const lateral of [0, 0.9, -1.1]) {
          const c = cal(deg);
          const box = bboxOfFloorBox(slot, ...place(slot, lateral, 1.6), 1.2, 0.95, 0.6, c);
          const g = placeFloorObject(box, slot, ROOM.footprint, c, { depthM: 0.6 })!;
          const where = `${slot} ${deg}° lat ${lateral}`;
          const [tx, tz] = place(slot, lateral, 1.6);
          expect(g.position.x, where).toBeCloseTo(tx, 9);
          expect(g.position.z, where).toBeCloseTo(tz, 9);
          expect(g.widthMM, where).toBe(1200);
          expect(g.heightMM, where).toBe(950);
        }
      }
    }
  });

  it('recovers a round footprint exactly from its own tangents, with no depth to assume', () => {
    // The half of this fix that owes the catalogue nothing: a circle's depth IS its
    // width, so the diameter is measured rather than assumed. `depthM` is passed a
    // deliberately WRONG number here to prove it — 2 m of depth on a 400 mm plant —
    // and the answer does not move, because the round branch never reads it.
    for (const lateral of [0, 1.3, -0.7]) {
      const c = cal(0);
      const box = tangentBboxOfCylinder(1.8, lateral, 0.4, 0.9, c);
      const g = placeFloorObject(box, 'n', ROOM.footprint, c, { depthM: 2, round: true })!;
      expect(g.position.x).toBeCloseTo(lateral, 12);
      expect(g.position.z).toBeCloseTo(-1.8, 12);
      expect(g.widthMM).toBe(400);
      expect(g.heightMM).toBe(900);
    }
  });

  it('reads a round footprint as a box only at a cost, which is why the branch exists', () => {
    // The reason `FloorFootprint.round` is not a nicety. A cylinder's silhouette is
    // its tangent span, which is NARROWER than the projection of its bounding
    // square, so a box inverse infers corners that are not on the object and comes
    // back badly narrow. Measured, so the branch has a number behind it rather than
    // an argument.
    const c = cal(0);
    const box = tangentBboxOfCylinder(1.8, 1.3, 0.4, 0.9, c);
    const asBox = placeFloorObject(box, 'n', ROOM.footprint, c, { depthM: 0.4, round: false })!;
    expect(asBox.widthMM).toBeLessThan(400 * 0.75);
  });

  it('is approximate for a round footprint under TILT, and here is how much', () => {
    // The one term in this fix that is not exact, measured rather than described. A
    // vertical tangent line's image column varies with the row, and the row at which
    // the tangency actually falls is not the bbox's own top row, so the azimuths are
    // read a little off. A 400 mm plant 1.5 m away: +6% of width at 5°, +13% at 12°,
    // and under 30 mm of position throughout.
    //
    // Bounded on BOTH sides. A floor under it, because the day someone makes this
    // exact the floor is what tells them — a bound that only caps an error cannot
    // notice it being fixed, and a stale "approximate" note is how a solved problem
    // stays open.
    let worstWidth = 0;
    let worstPos = 0;
    for (const deg of [5, -5, 12, -12]) {
      const c = cal(deg);
      const g = placeFloorObject(bboxOfFloorCylinder('n', 0.5, -1.5, 0.4, 0.9, c), 'n', ROOM.footprint, c, {
        depthM: 0.4,
        round: true,
      })!;
      worstWidth = Math.max(worstWidth, Math.abs(g.widthMM - 400) / 400);
      worstPos = Math.max(worstPos, Math.hypot(g.position.x - 0.5, g.position.z + 1.5));
    }
    expect(worstWidth).toBeGreaterThan(0.02);
    expect(worstWidth).toBeLessThan(0.2);
    expect(worstPos).toBeLessThan(0.05);
  });

  it('refuses a box with no width, on both branches', () => {
    // Reachable input, so a real assertion: `addManual` on the detect screen hands
    // over whatever rectangle the user's drag produced, and a press that never moved
    // is one.
    //
    // Asserted on the ANSWER rather than on a guard. The round branch used to carry
    // its own `beta > 0` refusal and this test was written for it — then mutation
    // showed that deleting the guard failed nothing, because a zero angular width
    // gives a zero radius and the shared `widthM <= 0.01` check refuses it either
    // way. The guard is gone; what the caller needs is still true, and this is where
    // it is held.
    const c = cal(0);
    const flat: [number, number, number, number] = [0.4, 0.5, 0, 0.3];
    expect(placeFloorObject(flat, 'n', ROOM.footprint, c, { depthM: 0.4, round: true })).toBeNull();
    expect(placeFloorObject(flat, 'n', ROOM.footprint, c, { depthM: 0.4 })).toBeNull();
  });

  it('clamps the assumed depth without touching the measured width', () => {
    // Two clamps, two jobs, and the second one is why this is asserted. The near
    // face is MEASURED, so it is bounded by the wall itself. The centre is
    // measurement plus an assumed depth, so it gets its own bound — the piece's back
    // may reach the wall and no further.
    //
    // Folding the depth into the first clamp instead is the obvious one-liner and it
    // is wrong: a catalogue depth too generous by 100 mm then shrinks a width that
    // was measured correctly, trading an exact size for an exact position. That is
    // an assumption corrupting an observation, and it is what the first draft of
    // this did — caught here, not reasoned about.
    const c = cal(0);
    // A piece hard against the far wall: near face at 3.6, so a 1.0 m depth would put
    // its back 0.6 m through the plaster of a wall 2 m away.
    const box = bboxOfFloorBox('n', 0, -1.9, 1.2, 0.95, 0.2, c);
    const tight = placeFloorObject(box, 'n', ROOM.footprint, c, { depthM: 1.0 })!;
    const loose = placeFloorObject(box, 'n', ROOM.footprint, c, { depthM: 0.2 })!;
    expect(tight.distance).toBeCloseTo(wallD('n', ROOM) - 0.5, 9);
    expect(tight.widthMM).toBe(loose.widthMM);

    // The HEIGHT is a different matter, and this is where it gets said rather than
    // discovered later. This piece's top is BELOW the lens, so the topmost row of
    // its silhouette is the FAR top edge — which means recovering its height needs
    // the far face's distance, which needs the depth. So an assumed depth does reach
    // the height of a low piece, and a five-times-too-generous one here costs 220 mm.
    //
    // That is not a defect to route around: reading it at the near face instead is
    // what made a nightstand ~130 mm too tall with a depth that was RIGHT. It is a
    // real term with a real source, and it belongs in
    // `docs/what-is-still-open.md` beside the sofa's position residual rather than in
    // a comment claiming the depth does not matter.
    expect(tight.heightMM).toBeLessThan(loose.heightMM);
    expect(loose.heightMM).toBe(950);
  });
});

describe('placeWallObject over solids', () => {
  const TILTS = [0, 5, -5, 12, -12];
  const cal = (deg: number): CameraCal => ({ k: 1.2, aspect: 4 / 3, tiltRad: (deg * Math.PI) / 180 });

  /** A wall piece on the N wall, seen from the N camera — the fronto-parallel case.
   *  It used to be written out here, taking a lateral offset and a distance and
   *  projecting through slot `n`, which made the wall a piece was MOUNTED on and the
   *  camera that saw it the same thing by construction. It delegates now, so the
   *  return-wall case is expressible (see `the framed surface`, below) and this
   *  describe is unchanged. */
  const wallBox = (lateral: number, yC: number, d: number, wM: number, hM: number, depthM: number, c: CameraCal) =>
    bboxOfWallSolid('n', 'n', lateral, yC, d, wM, hM, depthM, c);

  it('recovers a real wall solid exactly, at every tilt', () => {
    // Position, width, height and mount centre together, because all four rode the
    // plane the silhouette was read at. The deep case is the point: a 220 mm air
    // conditioner is what the catalogue ships, and at that depth the old placer read
    // it +21.7% wide and 91 mm too tall. Lateral offsets are signed and non-zero —
    // at 0 a sign error is invisible — and both the straddling and off-to-one-side
    // cases appear, which take different branches of the corner selection.
    const cases: Array<[string, number, number, number, number, number]> = [
      ['tv 60mm', 0.9, 1.2, 1.2, 0.7, 0.06],
      ['painting 30mm', -1.4, 1.5, 0.7, 0.5, 0.03],
      ['curtain 80mm', -0.3, 1.45, 1.4, 2.0, 0.08],
      ['ac unit 220mm', 1.1, 2.3, 0.8, 0.28, 0.22],
      ['a 400mm box', 0.0, 1.0, 0.6, 0.6, 0.4],
    ];
    for (const [name, lateral, yC, wM, hM, depthM] of cases) {
      for (const deg of TILTS) {
        const c = cal(deg);
        const d = wallD('n', ROOM);
        const g = placeWallObject(wallBox(lateral, yC, d, wM, hM, depthM, c), 'n', ROOM.footprint, c, { depthM })!;
        const where = `${name} at ${deg}°`;
        expect(g.position.x, where).toBeCloseTo(lateral, 9);
        // Its back is on the plaster, so its centre sits half a depth into the room.
        expect(g.position.z, where).toBeCloseTo(-(d - depthM / 2), 9);
        expect(g.position.y, where).toBeCloseTo(yC, 9);
        expect(g.widthMM, where).toBe(Math.round(wM * 1000));
        expect(g.heightMM, where).toBe(Math.round(hM * 1000));
      }
    }
  });

  it('and the depth is what a flat-panel decode was getting wrong', () => {
    // The before, so the fix has a number rather than a claim. Reading the same
    // silhouette as if it were flat on the plaster — which is what the placer did —
    // over-reads everything, and the deeper the piece the worse: this is the
    // assertion that would fail if someone reverted to `d` and kept the fixture.
    const c = cal(0);
    const d = wallD('n', ROOM);
    const deep = placeWallObject(wallBox(1.1, 2.3, d, 0.8, 0.28, 0.22, c), 'n', ROOM.footprint, c, { depthM: 0.22 })!;
    const asFlat = placeWallObject(wallBox(1.1, 2.3, d, 0.8, 0.28, 0.22, c), 'n', ROOM.footprint, c, { depthM: 0 })!;
    expect(deep.widthMM).toBe(800);
    expect(deep.heightMM).toBe(280);
    // Over-read by a fifth of its width and a third of its height.
    expect(asFlat.widthMM / 800).toBeGreaterThan(1.15);
    expect(asFlat.heightMM / 280).toBeGreaterThan(1.25);
  });
});

/** A truth point given as (lateral, distance from the lens) in the slot's own frame,
 *  mapped to world x/z. The inverse of `project`'s first switch, and written out
 *  because a fixture that only ever tests slot `n` cannot see a slot table with two
 *  rows transposed. */
function place(slot: 'n' | 's' | 'e' | 'w', lateral: number, forward: number): [number, number] {
  switch (slot) {
    case 'n':
      return [lateral, -forward];
    case 's':
      return [-lateral, forward];
    case 'e':
      return [forward, lateral];
    case 'w':
      return [-forward, -lateral];
  }
}

describe('defaultCal', () => {
  it('uses a plausible phone FOV', () => {
    const cal = defaultCal(4 / 3);
    const hfov = (2 * Math.atan(cal.k / 2) * 180) / Math.PI;
    expect(hfov).toBeGreaterThan(55);
    expect(hfov).toBeLessThan(80);
  });
});

// ── Camera pose: tilt and height ───────────────────────────────────────────
// The module used to assume a level camera exactly CAM_HEIGHT off the floor.
// Both are now inputs, and these pin what knowing them is worth.

const DOWN_5: CameraCal = { k: 1.2, aspect: 4 / 3, tiltRad: (5 * Math.PI) / 180 };
const UP_5: CameraCal = { k: 1.2, aspect: 4 / 3, tiltRad: (-5 * Math.PI) / 180 };

describe('camera tilt', () => {
  it('recovers a centred object exactly when the tilt is known', () => {
    for (const cal of [DOWN_5, UP_5]) {
      const box = bboxOfFloorObject('n', 0, -1.5, 1.6, 0.9, cal);
      const g = placeFloorObject(box, 'n', ROOM.footprint, cal, CARD)!;
      expect(g.position.x).toBeCloseTo(0, 6);
      expect(g.position.z).toBeCloseTo(-1.5, 6);
      expect(g.heightMM).toBeCloseTo(900, -1);
    }
  });

  it('is EXACT off to one side too, and the reason it used not to be is written below', () => {
    // This test used to allow 60 mm of position and 90 mm of width here, under a
    // stated reason that turned out to be a claim rather than a fact: "the two rows
    // of the object project at different scales, so its bounding box is centred on
    // the WIDER row while the decode works from the bottom one — nothing can
    // recover that from a bbox alone."
    //
    // The first half is right and the conclusion is wrong. Which row is wider is not
    // unknowable: under tilt the lens's forward distance to a point depends on how
    // HIGH that point is (`forwardAtHeight`), so the bbox's left and right edges come
    // from the object's top corners at a known distance, not from its bottom ones.
    // Reading the width at the bottom row's distance is what those tolerances were
    // allowing for, and `floorFromBox` reads it at the corner's own instead. A
    // tolerance that could be tightened to nothing is the same defect as an
    // assertion that cannot fail, so it is nothing now — at four tilts rather than
    // two, since the residue this replaces grew with the angle.
    for (const deg of [5, -5, 12, -12]) {
      const cal: CameraCal = { k: 1.2, aspect: 4 / 3, tiltRad: (deg * Math.PI) / 180 };
      const g = placeFloorObject(bboxOfFloorObject('n', 0.8, -1.5, 1.6, 0.9, cal), 'n', ROOM.footprint, cal, CARD)!;
      expect(g.position.x, `${deg}°`).toBeCloseTo(0.8, 9);
      expect(g.position.z, `${deg}°`).toBeCloseTo(-1.5, 9);
      expect(g.widthMM, `${deg}°`).toBe(1600);
      expect(g.heightMM, `${deg}°`).toBe(900);
    }
  });

  it('mis-reads distance in BOTH directions when tilt is ignored', () => {
    // Tilting the lens down moves the scene UP the frame, so a floor point looks
    // nearer the horizon and decodes as FURTHER away. Tilting up does the
    // reverse. This is the largest error in the module when tilt is unknown.
    // Kept well clear of the far wall: the distance clamp would otherwise absorb
    // part of the error and understate it. (It bounds the damage in the product,
    // which is why a bad calibration shows up as furniture piled against the
    // opposite wall rather than outside the room.)
    const trueZ = -1.4;
    for (const [cal, dir] of [[DOWN_5, 'down'], [UP_5, 'up']] as const) {
      const box = bboxOfFloorObject('n', 0, trueZ, 1.0, 0.9, cal);
      const naive = placeFloorObject(box, 'n', ROOM.footprint, { k: cal.k, aspect: cal.aspect }, CARD)!;
      const aware = placeFloorObject(box, 'n', ROOM.footprint, cal, CARD)!;
      expect(aware.distance).toBeCloseTo(1.4, 6);
      expect(naive.distance).toBeLessThan(wallD('n', ROOM)); // not clamped
      const error = (naive.distance - 1.4) / 1.4;
      expect(Math.abs(error)).toBeGreaterThan(0.15);
      expect(dir === 'down' ? error : -error).toBeGreaterThan(0);
    }
  });

  it('recovers a wall-mounted panel under tilt EXACTLY, at four angles', () => {
    // Another tolerance that turned out to be a symptom rather than a limit. This
    // allowed 20 mm of position and 20 mm of height at one angle, for the same reason
    // the floor card did: the lateral extremes of a panel with height come from its
    // top corners, whose tilt-rotated forward distance differs from the row the
    // decode was reading. `lateralSpan` reads each edge at its own corner's distance,
    // so there is nothing left to allow — and it is checked at four angles rather
    // than one, since the residue this replaces grew with the angle.
    for (const deg of [5, -5, 12, -12]) {
      const cal: CameraCal = { k: 1.2, aspect: 4 / 3, tiltRad: (deg * Math.PI) / 180 };
      const box = bboxOfWallPanel('n', -0.6, 1.4, -2, 1.2, 0.7, cal);
      const g = placeWallObject(box, 'n', ROOM.footprint, cal, CARD)!;
      expect(g.position.x, `${deg}°`).toBeCloseTo(-0.6, 9);
      expect(g.position.y, `${deg}°`).toBeCloseTo(1.4, 9);
      expect(g.widthMM, `${deg}°`).toBe(1200);
      expect(g.heightMM, `${deg}°`).toBe(700);
    }
  });
});

describe('camera height', () => {
  it('scales a floor object in size AND position', () => {
    // Height is the term that sets the scale of the whole reconstruction: the
    // floor line fixes the ratios, the shooter's height turns them into metres.
    // This is the ±17% the fixed 1.5 m assumption cost on every measurement.
    const cal: CameraCal = { k: 1.2, aspect: 4 / 3, height: 1.3 };
    const box = bboxOfFloorObject('n', 0, -1.5, 1.6, 0.9, cal);
    const right = placeFloorObject(box, 'n', ROOM.footprint, cal, CARD)!;
    expect(right.position.z).toBeCloseTo(-1.5, 6);
    expect(right.widthMM).toBeCloseTo(1600, -1);

    const assumed = placeFloorObject(box, 'n', ROOM.footprint, { k: cal.k, aspect: cal.aspect }, CARD)!;
    const ratio = CAM_HEIGHT / 1.3;
    expect(assumed.distance / right.distance).toBeCloseTo(ratio, 6);
    expect(assumed.widthMM / right.widthMM).toBeCloseTo(ratio, 3);
  });
});

describe('heightFromFloorLine', () => {
  it('solves for the shooter height once the lens is known', () => {
    // The same equation calibrateFromFloorLine uses, inverted for the other
    // unknown — which is what EXIF makes possible. Portrait framing on the far
    // wall, the case where the floor line is actually inside the frame.
    const cal: CameraCal = { k: 1.2, aspect: 0.75, height: 1.62 };
    const [, vFloor] = project('e', 3, 0, 0, cal);
    expect(vFloor).toBeLessThan(0.99);
    expect(heightFromFloorLine(vFloor, 'e', ROOM.footprint, cal)).toBeCloseTo(1.62, 6);
  });

  it('solves it under tilt too', () => {
    const cal: CameraCal = { k: 1.2, aspect: 0.75, height: 1.35, tiltRad: (4 * Math.PI) / 180 };
    const [, vFloor] = project('n', 0, 0, -2, cal);
    expect(heightFromFloorLine(vFloor, 'n', ROOM.footprint, cal)).toBeCloseTo(1.35, 6);
  });

  it('refuses an answer that is not a person holding a phone', () => {
    // A rug edge or a skirting shadow mistaken for the floor line. Better to
    // report nothing than a confident wrong height.
    expect(heightFromFloorLine(0.55, 'n', ROOM.footprint, { k: 1.2, aspect: 0.75 })).toBeNull();
    expect(heightFromFloorLine(0.4, 'n', ROOM.footprint, { k: 1.2, aspect: 0.75 })).toBeNull();
  });
});

describe('calFromHfov', () => {
  it('round-trips a 35 mm-equivalent focal length into a usable calibration', () => {
    const cal = calFromHfov(hfovFromFocal35(26, 4 / 3)!, 4 / 3);
    const g = placeFloorObject(bboxOfFloorObject('n', 0, -1.2, 1.0, 0.8, cal), 'n', ROOM.footprint, cal, CARD)!;
    expect(g.position.z).toBeCloseTo(-1.2, 6);
    expect(g.widthMM).toBeCloseTo(1000, -1);
  });

  it('halves a wall-mounted TV when an ultrawide shot is read as 66°', () => {
    // Where the assumed FOV really hurts. A wall item's distance is PINNED to the
    // wall rather than derived from its bottom edge, so the angular size is not
    // divided back out and the whole error lands on the measurement.
    const wide = calFromHfov(hfovFromFocal35(13, 4 / 3)!, 4 / 3);
    const box = bboxOfWallPanel('n', 0, 1.4, -2, 1.4, 0.8, wide);
    const right = placeWallObject(box, 'n', ROOM.footprint, wide, CARD)!;
    const assumed = placeWallObject(box, 'n', ROOM.footprint, defaultCal(4 / 3), CARD)!;
    expect(right.widthMM).toBeCloseTo(1400, -1);
    expect(assumed.widthMM).toBeLessThan(right.widthMM * 0.55);
  });

  it('leaves a FLOOR object’s SIZE alone — the assumed FOV cancels out', () => {
    // Distance is H·aspect / ((v−0.5)·k) and width is that times k·Δu, so k
    // divides out exactly. Getting the lens wrong moves a floor-standing piece
    // around the room; it does not resize it. Near enough to the camera that the
    // wall clamp stays out of it — see below for what happens when it does not.
    const wide = calFromHfov(hfovFromFocal35(13, 4 / 3)!, 4 / 3);
    const box = bboxOfFloorObject('n', 0, -0.9, 1.6, 0.9, wide);
    const right = placeFloorObject(box, 'n', ROOM.footprint, wide, CARD)!;
    const assumed = placeFloorObject(box, 'n', ROOM.footprint, defaultCal(4 / 3), CARD)!;
    expect(assumed.distance).toBeLessThan(wallD('n', ROOM));
    expect(assumed.widthMM).toBe(right.widthMM);
    expect(assumed.heightMM).toBe(right.heightMM);
    expect(assumed.distance).toBeGreaterThan(right.distance * 1.8);
  });

  it('…until the wall clamp bites, which then shrinks it', () => {
    // Once the mis-scaled distance runs past the far wall it is clamped, and the
    // angular size is re-scaled to the clamped distance — so the cancellation
    // breaks and the piece comes out small as well as mislocated.
    const wide = calFromHfov(hfovFromFocal35(13, 4 / 3)!, 4 / 3);
    const box = bboxOfFloorObject('n', 0, -1.5, 1.6, 0.9, wide);
    const right = placeFloorObject(box, 'n', ROOM.footprint, wide, CARD)!;
    const assumed = placeFloorObject(box, 'n', ROOM.footprint, defaultCal(4 / 3), CARD)!;
    expect(assumed.distance).toBe(wallD('n', ROOM));
    expect(assumed.widthMM).toBeLessThan(right.widthMM * 0.7);
  });
});

describe('placeCeilingObject', () => {
  // A 1.2 m fan that is BOTH fully inside the room and fully inside an ultrawide
  // frame only exists on the long axis: it has to sit past ~1.9 m for its near rim
  // to drop into frame, and its far rim must still clear the wall. On the 4 m axis
  // those two windows do not overlap — which is itself the finding, and the reason
  // the fixtures below use slot 'e' at x = 2.0 in a 6 m-wide room.
  const FAN_M = 1.2;
  const fanBox = (cal: CameraCal) => bboxOfCeilingDisc('e', 2.0, 0, FAN_M, cal, ROOM.height);

  it('recovers a fan’s diameter from an ultrawide shot', () => {
    const box = fanBox(WIDE);
    expect(box[1]).toBeGreaterThan(0); // premise: the whole disc is inside the frame
    expect(box[1] + box[3]).toBeLessThan(1);
    const g = placeCeilingObject(box, 'e', ROOM, WIDE)!;
    expect(g).not.toBeNull();
    expect(g.distance).toBeLessThan(wallD('e', ROOM)); // premise: unclamped
    // Within 8%, and UNDER rather than over. The residual is the plate's own
    // foreshortening — the bbox spans a range of distances and one row has to
    // stand for all of them — so this reads a fan slightly small rather than
    // inventing one slightly large.
    expect(g.widthMM).toBeLessThan(FAN_M * 1000);
    expect(g.widthMM).toBeGreaterThan(FAN_M * 1000 * 0.92);
  });

  it('reads the MIDDLE row, not the top — the top under-reads by a quarter', () => {
    // The mutation this test exists to catch, as arithmetic rather than a comment.
    // Intersecting the bbox's TOP edge measures the disc's nearest rim and then
    // applies its full angular width at that shorter distance, which lands further
    // from the truth than the catalogue default it was meant to improve on.
    const box = fanBox(WIDE);
    const g = placeCeilingObject(box, 'e', ROOM, WIDE)!;
    // Same maths as the placer, with `by` in place of `by + bh / 2`.
    const rise = ROOM.height - CAM_HEIGHT;
    const upTop = ((0.5 - box[1]) * WIDE.k) / WIDE.aspect;
    const wTop = (rise / upTop) * box[2] * WIDE.k;
    expect(wTop).toBeLessThan(FAN_M * 0.8);
    expect(g.widthMM / 1000).toBeGreaterThan(wTop * 1.2);
    // And the reason it matters: the top row is WORSE than not measuring at all.
    // 1000 mm is the fan entry in CATEGORY_DEFAULTS.
    expect(Math.abs(wTop * 1000 - FAN_M * 1000)).toBeGreaterThan(Math.abs(1000 - FAN_M * 1000));
    expect(Math.abs(g.widthMM - FAN_M * 1000)).toBeLessThan(Math.abs(1000 - FAN_M * 1000));
  });

  it('measures no height at all, and the type says so', () => {
    const box = fanBox(WIDE);
    const g = placeCeilingObject(box, 'e', ROOM, WIDE)!;
    // A disc has no thickness in its bbox — the vertical extent IS the
    // foreshortened diameter. Anything derived from it would be a fabrication, so
    // the shape carries no height key to fabricate into.
    expect('heightMM' in g).toBe(false);
    expect(box[3]).toBeGreaterThan(0.01); // there IS vertical extent, deliberately unread
  });

  it('puts it on the ceiling plane and inside the room', () => {
    const box = bboxOfCeilingDisc('e', 1.2, 0, 1.1, WIDE, ROOM.height);
    const g = placeCeilingObject(box, 'e', ROOM, WIDE)!;
    expect(g.position.y).toBe(ROOM.height);
    expect(g.distance).toBeLessThanOrEqual(wallD('e', ROOM));
    expect(Math.abs(g.position.x)).toBeLessThanOrEqual(ROOM.width / 2 + 1e-9);
    expect(Math.abs(g.position.z)).toBeLessThanOrEqual(ROOM.depth / 2 + 1e-9);
  });

  it('a level 66° frame contains no ceiling to measure', () => {
    // Not a limitation being tolerated — a fact being reported, and the reason
    // Phase 7 of the detection plan pays off on real phone captures rather than on
    // the nominal capture rig. From 1.5 m with a ~24° vertical half-angle the
    // ceiling of a 2.8 m room first appears 2.9 m away, past the wall being
    // photographed. It is the same geometry that puts the wall-FLOOR line outside
    // a landscape frame, at the other edge of the image.
    const box = fanBox(CAL);
    expect(box[1] + box[3]).toBeLessThan(0); // the whole disc is above the frame
    // The ultrawide is what changes the answer — same fan, same room, in frame.
    expect(fanBox(WIDE)[1]).toBeGreaterThan(0);
  });

  it('refuses a box at or below the horizon', () => {
    // A box whose centre row is at or below the horizon cannot be on the ceiling
    // from a camera looking level or up: the ray never rises to the slab.
    expect(placeCeilingObject([0.3, 0.5, 0.3, 0.2], 'n', ROOM, CAL)).toBeNull();
    expect(placeCeilingObject([0.3, 0.7, 0.3, 0.2], 'n', ROOM, WIDE)).toBeNull();
  });

  it('refuses a shallow ray that reaches the ceiling only past the wall', () => {
    // The refusal that replaced a clamp, and the one that matters most: this box is
    // ABOVE the horizon, so the old code found an intersection 4.35 m out, pulled it
    // back to the 2 m wall, and reported the angular width at that distance. In a
    // level 66° frame there is no ceiling in shot at all, so what it was measuring
    // was a picture frame, read out as an undersized ceiling fan: the width is
    // computed at the CLAMPED distance, so it is wrong by however far the clamp
    // moved it. Refusing hands the detection back untouched, which is what happened
    // before this function existed.
    expect(placeCeilingObject([0.3, 0.3, 0.3, 0.1], 'n', ROOM, WIDE)).toBeNull();
    expect(placeCeilingObject(fanBox(WIDE), 'e', ROOM, CAL)).toBeNull();
    // The same geometry on the axis that IS long enough still measures.
    expect(placeCeilingObject(fanBox(WIDE), 'e', ROOM, WIDE)).not.toBeNull();
  });

  it('refuses a camera at or above the slab', () => {
    const box = bboxOfCeilingDisc('n', 0, -2.5, 1.2, WIDE, ROOM.height);
    expect(placeCeilingObject(box, 'n', { ...ROOM, height: 1.5 }, WIDE)).toBeNull();
    expect(placeCeilingObject(box, 'n', { ...ROOM, height: 1.2 }, WIDE)).toBeNull();
  });
});

// ── The framed surface: a bound that FALSIFIES an assumption ─────────────────
//
// `placeWallObject` and `placeCeilingObject` do not measure the distance to their
// subject, they assume it — one plane at `wallDistance`, one at the slab. The decoded
// lateral offset is a test of that assumption, and neither function used to make it:
// the wall placer had no lateral bound at all, and the ceiling placer's refusal covered
// the wall-normal axis only while its docstring read as though it covered both.
//
// On an ultrawide every ordinary room has picture beyond the ends of the wall being
// photographed, and what is out there is the RETURN wall. So these are not exotic
// inputs: every box below is asserted `inFrame`, because a box a detector could not
// have handed over proves nothing.
// The numbers every docblock and every document about this gate quotes, computed HERE
// and printed on every green run.
//
// They were published from a scratch script that re-implemented the placer's arithmetic
// in node — measured carefully, against the wrong subject. The real code disagrees: the
// shipped print fixture decodes 893 × 803, not the 960 × 711 that reached four files,
// and the HEIGHT error is the larger of the two and went unmentioned. `docs/traps.md`
// carries the lesson; this table is the remedy. Call the function.
//
// `WIDE_BOUND` is how the fabrication is shown at all: a footprint stretched along the
// lens's lateral axis only, so `wallFrame.distance` still agrees with `wallDistance`
// (the gate stays live rather than going inert) and its ends are simply too far away to
// reach. Nothing is disabled to produce this column.
describe('the framed surface · what the gate refuses, measured', () => {
  const WIDE: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
  const room = (w: number, d: number, h: number) => ({
    width: w,
    depth: d,
    height: h,
    footprint: footprintForLayout('rect', w, d),
  });
  /** Same walls, same distances, lateral ends pushed out of reach. */
  const unbounded = (r: ReturnType<typeof room>, view: 'n' | 's' | 'e' | 'w') => {
    const far = 500;
    const fp: Footprint =
      view === 'e' || view === 'w'
        ? [
            [-r.width / 2, -far],
            [r.width / 2, -far],
            [r.width / 2, far],
            [-r.width / 2, far],
          ]
        : [
            [-far, -r.depth / 2],
            [far, -r.depth / 2],
            [far, r.depth / 2],
            [-far, r.depth / 2],
          ];
    return { ...r, footprint: fp };
  };

  type Row = {
    name: string;
    room: string;
    truthW: number;
    truthH: number;
    lateral: number;
    end: number;
    decW: number;
    decH: number;
    refused: boolean;
  };

  const wallRow = (
    name: string,
    r: ReturnType<typeof room>,
    lateral: number,
    wM: number,
    hM: number,
    depthM: number,
  ): Row => {
    const box = bboxOfWallSolid('n', 'e', lateral, 1.5, wallD('n', r), wM, hM, depthM, WIDE);
    expect(inFrame(box), name).toBe(true);
    const free = placeWallObject(box, 'e', unbounded(r, 'e').footprint, WIDE, { depthM })!;
    return {
      name,
      room: `${r.width}×${r.depth}`,
      truthW: wM * 1000,
      truthH: hM * 1000,
      lateral: Math.abs(free.position.z),
      end: wallSpan('e', r) / 2,
      decW: free.widthMM,
      decH: free.heightMM,
      refused: placeWallObject(box, 'e', r.footprint, WIDE, { depthM }) === null,
    };
  };

  const ceilRow = (name: string, r: ReturnType<typeof room>, lateral: number, yC: number, sizeM: number): Row => {
    const box = bboxOfWallSolid('n', 'e', lateral, yC, wallD('n', r), sizeM, sizeM, 0, WIDE);
    expect(inFrame(box), name).toBe(true);
    const free = placeCeilingObject(box, 'e', unbounded(r, 'e'), WIDE)!;
    return {
      name,
      room: `${r.width}×${r.depth}`,
      truthW: sizeM * 1000,
      truthH: NaN,
      lateral: Math.abs(free.position.z),
      end: wallSpan('e', r) / 2,
      decW: free.widthMM,
      decH: NaN,
      refused: placeCeilingObject(box, 'e', r, WIDE) === null,
    };
  };

  const R64 = room(6, 4, 2.8);
  const R76 = room(7, 6, 2.7);
  const ROWS: Row[] = [
    wallRow('print · SHIPPED', R64, 2.2, 0.7, 0.5, 0.03),
    wallRow('print · 7×6', R76, 2.8, 0.7, 0.5, 0.03),
    wallRow('curtain · SHIPPED', R64, 2.25, 1.4, 0.5, 0.08),
    ceilRow('vent · SHIPPED', R64, 2.0, 2.5, 0.3),
    ceilRow('vent · 7×6', R76, 2.727, 2.48, 0.3),
  ];

  const pct = (a: number, b: number) => (Number.isNaN(a) ? '     --' : `${(((a - b) / b) * 100).toFixed(1).padStart(6)}%`);
  console.log(
    [
      '\nthe framed surface · what a return-wall piece decodes as, and whether the gate refuses it',
      '  fixture             room   truth W×H    lateral  wall end   decoded W×H     dW      dH   gate',
      ...ROWS.map(
        (r) =>
          `  ${r.name.padEnd(18)} ${r.room.padEnd(6)} ${String(r.truthW).padStart(4)}×${Number.isNaN(r.truthH) ? ' -- ' : String(r.truthH).padEnd(4)} ` +
          `${r.lateral.toFixed(3).padStart(8)}  ${r.end.toFixed(2).padStart(8)}   ` +
          `${String(r.decW).padStart(4)}×${Number.isNaN(r.decH) ? ' -- ' : String(r.decH).padEnd(4)} ` +
          `${pct(r.decW, r.truthW)} ${pct(r.decH, r.truthH)}  ${r.refused ? 'REFUSED' : 'accepted'}`,
      ),
    ].join('\n'),
  );

  it('every row is a fabrication the gate refuses', () => {
    for (const r of ROWS) {
      expect(r.refused, r.name).toBe(true);
      expect(r.lateral, r.name).toBeGreaterThan(r.end);
      expect(r.decW, r.name).toBeGreaterThan(r.truthW);
    }
  });

  it('and the numbers the documents quote come from this table', () => {
    const [shipped, prose] = ROWS;
    // The SHIPPED fixture — what the assertions in this file actually exercise.
    expect(shipped.decW).toBe(893);
    expect(shipped.decH).toBe(803);
    expect(shipped.lateral).toBeCloseTo(2.764, 3);
    // The height error is the BIGGER one, which no document said.
    expect((shipped.decH - shipped.truthH) / shipped.truthH).toBeGreaterThan(
      (shipped.decW - shipped.truthW) / shipped.truthW,
    );
    // The 7×6 room the prose used to describe — 949 × 708, not the 960 × 711 published.
    expect(prose.decW).toBe(949);
    expect(prose.decH).toBe(708);
    expect(prose.lateral).toBeCloseTo(3.774, 3);
  });
});

describe('the framed surface', () => {
  const WALLD = (slot: 'n' | 's' | 'e' | 'w') => wallD(slot, ROOM);
  const HALF = (slot: 'n' | 's' | 'e' | 'w') => wallSpan(slot, ROOM) / 2;

  // The FALSE-POSITIVE direction first, and deliberately so: a gate that refuses real
  // furniture is this repo's worst failure — a piece that never appears leaves no
  // trace — and it is worth more than the gate itself. Written before either refusal.
  it('accepts every legitimate wall piece, out to the wall’s own end', () => {
    const SLOTS = ['n', 's', 'e', 'w'] as const;
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    let atTheEnd = 0;
    let skipped = 0;
    let measured = 0;
    for (const slot of SLOTS) {
      for (const cal of [wide, { ...wide, tiltRad: (5 * Math.PI) / 180 }, { ...wide, tiltRad: (-12 * Math.PI) / 180 }]) {
        for (const frac of [0, 0.4, -0.4, 0.8, -0.8, 0.99, -0.99]) {
          const lateral = HALF(slot) * frac;
          const d = WALLD(slot);
          const box = bboxOfWallSolid(slot, slot, lateral, 1.5, d, 0.7, 0.5, 0.03, cal);
          // A wall wider than the frame is the good case and the reason nothing here is
          // tuned: no in-frame column can decode past the end of such a wall, so the
          // gate CANNOT fire on it. Those combinations are skipped and counted rather
          // than measured, per `inFrame`'s own rule.
          if (!inFrame(box)) {
            skipped++;
            continue;
          }
          const g = placeWallObject(box, slot, ROOM.footprint, cal, { depthM: 0.03 });
          const where = `${slot} at ${frac} of the half-span, tilt ${cal.tiltRad ?? 0}`;
          expect(g, where).not.toBeNull();
          expect(g!.widthMM, where).toBe(700);
          expect(g!.heightMM, where).toBe(500);
          // The OFFSET too, not only the size. Without this a gate that accepted the
          // piece and mislaid it would pass — the test's own subject is acceptance, and
          // "accepted" and "accepted in the right place" are different claims.
          // Projected back through `ALONG`, not read off a world axis: image-right is
          // −X on `s` and −Z on `w`, so picking x-or-z by slot gets the sign wrong on
          // half of them — which is exactly what the first version of this line did.
          const [ax, az] = ALONG[slot];
          const lat = g!.position.x * ax + g!.position.z * az;
          expect(lat, where).toBeCloseTo(lateral, 9);
          measured++;
          if (Math.abs(frac) === 0.99) atTheEnd++;
        }
      }
    }
    // The boundary has to have been exercised somewhere, or the sweep proves only that
    // the middle of a wall is safe. It is `e` and `w` that reach it here: their walls
    // are 4 m across a 3 m viewing distance, so the wall's end is inside the frame,
    // while `n`/`s` are 6 m across 2 m and run past it.
    // Counted as LITERALS, not floors. `toBeGreaterThan(0)` is what let nine fixture
    // mutants live: a wrong row just pushes boxes off the frame, `skipped` absorbs it,
    // and the sweep can lose 21 of its 60 measured rows while staying green.
    // `docs/traps.md` says exactly this about a sweep that reports a count.
    expect(measured).toBe(60);
    expect(skipped).toBe(24);
    expect(atTheEnd).toBe(12);
    expect(measured + skipped).toBe(4 * 3 * 7);
  });

  it('accepts every legitimate ceiling piece, including one centred at the wall', () => {
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    // (lateral, forward). The at-the-wall rows sit further forward on purpose: a disc's
    // widest image point is where the ray is TANGENT to its rim, which is nearer the
    // camera than its lateral extreme, so a 0.9 m disc centred on the wall line at 2.0 m
    // has its tangent point outside a 106° frame. That is the fixture being honest about
    // an ultrawide, not the gate — hence `inFrame` asserted on every row.
    const rows: Array<[number, number]> = [
      [0, 2.0],
      [1.0, 2.0],
      [-1.0, 2.0],
      [1.9, 2.6],
      [-1.9, 2.6],
      [1.95, 2.6],
      [-1.95, 2.6],
    ];
    // 1.95 of a 2.0 half-span, not 2.0 itself. A centre exactly ON the wall line decodes
    // to 2.0000000000000004 and is refused, and that is a floating-point boundary rather
    // than a behaviour: nothing real sits there — a fan centred on the plaster is half
    // buried in it — so it is recorded here instead of asserted either way. Both placers
    // do it, and the margins the gate exists for are 600–800 mm.
    expect(HALF('e')).toBe(2);
    for (const [lateral, forward] of rows) {
      const box = bboxOfCeilingDisc('e', forward, lateral, 0.9, wide, ROOM.height);
      expect(inFrame(box), `${lateral}`).toBe(true);
      // A disc centred ON the wall line is kept: the gate tests the CENTRE, and pulling
      // the rim inside the room is `contain`'s job downstream, not a measurement's.
      expect(placeCeilingObject(box, 'e', ROOM, wide), `${lateral}`).not.toBeNull();
    }
  });

  // Now the refusals. Each is a PAIR — the same piece through its own camera must come
  // back exact — because a lone `toBeNull` passes for any reason at all, including a
  // fixture that is simply nonsense.
  // The one input that can make this gate refuse a REAL piece, and the sweep above is
  // structurally blind to it: it builds every box with the same `cal` it decodes with, so
  // the lens is always exactly known. The floor-exemption test twelve lines further down
  // already ran three lenses over one photograph — the tool was in the file and was not
  // pointed at the gate it was written for.
  it('refuses further in as the assumed lens widens, and never on an under-read one', () => {
    const lens = (deg: number) => calFromHfov(deg, 4 / 3);
    // A legitimate east-wall print, photographed on `truth` and decoded believing
    // `assumed`. `placeWallObject` pins its distance to the wall, so `lateralSpan`
    // returns `tanX(u)·z` with `z` room-derived: the decoded offset is EXACTLY
    // proportional to `cal.k`, with none of the cancellation `placeFloorObject` enjoys.
    // So the refusal threshold moves as `1/r`, and the room never changes.
    const largestAccepted = (truthDeg: number, assumedDeg: number) => {
      let best = 0;
      // Integer-stepped, not `frac += 0.05`: accumulating the step lands on
      // 1.0000000000000002 and the reported threshold stops being a round number.
      for (let i = 1; i <= 20; i++) {
        const frac = i / 20;
        const lateral = HALF('e') * frac;
        const box = bboxOfWallSolid('e', 'e', lateral, 1.5, WALLD('e'), 0.7, 0.5, 0.03, lens(truthDeg));
        if (!inFrame(box)) continue;
        if (placeWallObject(box, 'e', ROOM.footprint, lens(assumedDeg), { depthM: 0.03 })) best = frac;
      }
      return best;
    };

    const ROWS = [
      [100, 106],
      [90, 106],
      [80, 106],
      [66, 106],
      [106, 66], // the under-read direction
    ] as Array<[number, number]>;
    console.log(
      [
        '\nthe framed surface · where the gate starts refusing a LEGITIMATE wall piece, by lens error',
        '  true  believed   k ratio   last accepted   size also wrong by',
        ...ROWS.map(([t, a]) => {
          const r = lens(a).k / lens(t).k;
          return (
            `  ${String(t).padStart(4)}° ${String(a).padStart(7)}°   ${r.toFixed(3).padStart(7)}   ` +
            `${largestAccepted(t, a).toFixed(2).padStart(13)}   ${(((r - 1) * 100) | 0).toString().padStart(6)}%`
          );
        }),
      ].join('\n'),
    );

    // Over-read: the threshold really does move in, and it moves in FURTHER the wider the
    // error. Asserted as an ordering rather than as five literals, because the fractions
    // are a 0.05 grid and the ordering is the claim.
    const over = ROWS.slice(0, 4).map(([t, a]) => largestAccepted(t, a));
    for (let i = 1; i < over.length; i++) expect(over[i]).toBeLessThanOrEqual(over[i - 1]);
    expect(over[0]).toBeLessThan(1); // even 6° of error costs the outer edge of the wall
    expect(over[3]).toBeLessThan(0.6); // 66° read as 106° costs about half the wall

    // Under-read never refuses, and this is the direction every document named as though
    // it were the whole story. A narrower assumed lens pulls every offset INWARD, so a
    // fabrication hides there and a real piece is never touched.
    expect(largestAccepted(106, 66)).toBe(1);

    // The trade, stated where it can be checked rather than argued in prose: an over-read
    // lens has already inflated the SIZE by the same ratio, so the measurement the gate
    // discards was worthless anyway. `halves a wall-mounted TV when an ultrawide shot is
    // read as 66°` is the same proportionality in the other direction.
    const box = bboxOfWallSolid('e', 'e', HALF('e') * 0.5, 1.5, WALLD('e'), 0.7, 0.5, 0.03, lens(80));
    const wrong = placeWallObject(box, 'e', ROOM.footprint, lens(106), { depthM: 0.03 })!;
    expect(wrong.widthMM / 700).toBeCloseTo(lens(106).k / lens(80).k, 2);
  });

  it('refuses a print on the RETURN wall, and measures the same print on its own', () => {
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    // A 700 × 500 print on the N wall, 800 mm from the north-east corner. The E camera
    // is 3 m from its own wall and sees 4 m of room across it, so this is well inside
    // the east photo — and reading it against the east wall's plane fabricates both its
    // offset and its size.
    const onNorth = (view: 'n' | 'e') =>
      bboxOfWallSolid('n', view, 2.2, 1.5, WALLD('n'), 0.7, 0.5, 0.03, wide);
    expect(inFrame(onNorth('e'))).toBe(true);
    expect(inFrame(onNorth('n'))).toBe(true);

    // Its own camera measures it exactly — so the fixture is a real piece of furniture.
    const own = placeWallObject(onNorth('n'), 'n', ROOM.footprint, wide, { depthM: 0.03 })!;
    expect(own.widthMM).toBe(700);
    expect(own.heightMM).toBe(500);
    expect(own.position.x).toBeCloseTo(2.2, 9);

    // The framed wall's camera refuses it. Ungated it decoded ~2.73 m along a wall whose
    // half-span is 2.0, at ~36% too wide — bigger than the air conditioner error that
    // § 42.4 was written around. What it does NOT do is delete the row: see
    // `tests/detect-refine.test.ts`, where the count is measured rather than argued.
    expect(placeWallObject(onNorth('e'), 'e', ROOM.footprint, wide, { depthM: 0.03 })).toBeNull();
  });

  it('tests the CENTRE, because the wholly-off-the-wall variant leaks', () => {
    // The choice between "centre past the end" and "no part of it on the wall" is a real
    // fork, and it needed a fixture to settle rather than an example. The print above
    // does NOT settle it — both variants refuse that one, which is why the looser mutant
    // survived a first round of mutation with every assertion green.
    //
    // A 1400 × 500 curtain on the N wall, its far edge 250 mm from the north-east corner
    // and wholly inside both the room and the east photo's frame, is what separates them:
    // wide enough that its decoded near edge falls back inside the east wall while its
    // centre does not. Under the loose variant it is ACCEPTED as 1815 × 942 at 2.86 m
    // along a wall whose half-span is 2.0 — +30% wide, +88% tall, 860 mm past the end.
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    const curtain = (view: 'n' | 'e') =>
      bboxOfWallSolid('n', view, 2.25, 1.5, WALLD('n'), 1.4, 0.5, 0.08, wide);
    expect(inFrame(curtain('e'))).toBe(true);
    expect(2.25 + 1.4 / 2).toBeLessThanOrEqual(ROOM.width / 2); // premise: it is IN the room
    expect(placeWallObject(curtain('n'), 'n', ROOM.footprint, wide, { depthM: 0.08 })!.widthMM).toBe(1400);
    expect(placeWallObject(curtain('e'), 'e', ROOM.footprint, wide, { depthM: 0.08 })).toBeNull();
  });

  // Why `placeFloorObject` is exempt — and it is a property, not a preference. Adding the
  // gate there is a mutant that SURVIVES the whole suite, so the exemption cannot rest on
  // an assertion; it rests on this. A floor decode's lateral offset is INVARIANT to the
  // assumed lens, because distance goes as 1/k and the tangent goes as k, so the two
  // cancel — the same cancellation the `leaves a FLOOR object's SIZE alone` test above
  // pins for the width. A piece inside the room therefore decodes inside `±wallSpan/2`
  // whatever the camera is believed to be, and the gate could never fire on it. Which is
  // the whole shape of the rule: a bound may falsify an ASSUMPTION, and the wall and
  // ceiling placers assume their plane, while this one measures it.
  it('needs no gate: a floor piece’s lateral offset does not depend on the lens', () => {
    const truth = calFromHfov(90, 4 / 3);
    const assumed = calFromHfov(106, 4 / 3);
    const narrow = calFromHfov(66, 4 / 3);
    for (const z of [1.2, 1.5, 1.9]) {
      // 2.6 m out on the E wall's axis: far enough that a level 90° frame still catches
      // the bottom edge, near enough that a 600 mm-deep box does not put its BACK through
      // the plaster at 3.0 m — which the first version of this fixture did, and it read as
      // a 27 mm invariance failure rather than as a box standing inside a wall.
      const box = bboxOfFloorBox('e', 2.6, z, 0.6, 0.8, 0.6, truth); // (w, h, depth)
      expect(inFrame(box), `${z}`).toBe(true);
      // One photograph, three beliefs about the lens that took it.
      const lat = (cal: CameraCal) => placeFloorObject(box, 'e', ROOM.footprint, cal, { depthM: 0.6 })!.position.z;

      // Exact at the truth, and FIRST-ORDER invariant when the lens is over-read: the
      // near face is measured (∝ 1/k) and the tangent goes as k, so those cancel. The
      // residual has a named cause rather than a tolerance — the catalogue DEPTH does not
      // scale with either, so the far face used in the corner selection is slightly
      // misplaced. Measured at 30 mm on a 600 mm box read 33% too wide.
      expect(lat(truth), `${z} truth`).toBeCloseTo(z, 9);
      // Bounded as a FRACTION, not an absolute, because the residual is proportional to
      // the offset — 30 mm at 1.2 m and 54 mm at 1.9 m, ~2.8% either way — which is the
      // signature of a mis-scaled depth rather than a fixed error, and an absolute bound
      // would have hidden that by needing a different number at each row.
      expect(Math.abs(lat(assumed) - z) / z, `${z} over-read`).toBeLessThan(0.03);

      // Under-read, the near-face clamp at the wall bites and the answer moves INWARD —
      // the direction that cannot trip a bound. Asserted as a direction, because a
      // loosened tolerance here would hide which way it went, and which way is the point.
      expect(Math.abs(lat(narrow)), `${z} under-read`).toBeLessThan(z);

      // The load-bearing half: whatever the camera is believed to be, a piece inside the
      // room decodes inside the wall's own half-span. Which is ALMOST why a gate here
      // could not fire, and the almost is worth the line: at 1.9 of a 2.0 half-span an
      // over-read lens reaches 1.954, so a piece within ~3% of the wall's end WOULD be
      // refused by one — refusing a measurement over a lens error, which is the direction
      // the rule forbids. So the exemption is a decision, not a vacuous case.
      for (const cal of [truth, assumed, narrow]) {
        expect(Math.abs(lat(cal)), `${z} @ k=${cal.k}`).toBeLessThan(HALF('e'));
      }
    }
  });

  it('refuses a return-wall piece on every pair of adjacent walls', () => {
    // The refusal above is written for ONE corner, mounting on `n` and viewing from
    // `e`. That leaves three of the four walls unreachable as a mount, which is how a
    // hand-kept slot table went nine mutants deep without a failure. Both rooms below
    // are needed and the reason is geometric: a wall only shows its neighbour when it
    // is narrow relative to its own viewing distance (`span < 2·tan(hFOV/2)·distance`), so in a 6 × 4 room only `e`/`w` can see a return wall, and the
    // transpose is what makes `n`/`s` the seeing pair.
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    const rooms = [
      { width: 6, depth: 4, height: 2.8, footprint: footprintForLayout('rect', 6, 4) },
      { width: 4, depth: 6, height: 2.8, footprint: footprintForLayout('rect', 4, 6) },
    ];
    let pairs = 0;
    for (const room of rooms) {
      const seeing = room.width > room.depth ? (['e', 'w'] as const) : (['n', 's'] as const);
      const mounts = room.width > room.depth ? (['n', 's'] as const) : (['e', 'w'] as const);
      for (const mount of mounts) {
        for (const view of seeing) {
          // 800 mm in from the shared corner, on the mount wall.
          const half = wallSpan(mount, room) / 2;
          const toward = view === 'e' || view === 's' ? 1 : -1;
          const lateral = (half - 0.8) * toward * (mount === 's' || mount === 'w' ? -1 : 1);
          const d = wallD(mount, room);
          const own = bboxOfWallSolid(mount, mount, lateral, 1.5, d, 0.7, 0.5, 0.03, wide);
          const seen = bboxOfWallSolid(mount, view, lateral, 1.5, d, 0.7, 0.5, 0.03, wide);
          const where = `${mount} seen from ${view} in ${room.width}×${room.depth}`;
          if (!inFrame(seen)) continue;
          pairs++;
          // Measured exactly by its own camera…
          const g = placeWallObject(own, mount, room.footprint, wide, { depthM: 0.03 })!;
          expect(g, where).not.toBeNull();
          expect(g.widthMM, where).toBe(700);
          // …and refused by the neighbour's.
          expect(placeWallObject(seen, view, room.footprint, wide, { depthM: 0.03 }), where).toBeNull();
        }
      }
    }
    // Literal, so a slot table that silently stops being exercised fails here.
    expect(pairs).toBe(8);
  });

  // ── The bound is the WALL's, not the bounding box's ───────────────────────
  //
  // These two are the assertions the first version of this gate could not make,
  // because every fixture in the file is a room centred on the lens — where a
  // bounding-box dimension and the wall's real reach are the same number. An
  // off-centre footprint is one wall drag away and it separates them.
  it('accepts a correctly measured piece past ±half, when the wall really reaches', () => {
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    // A 6 × 6 room with the east wall dragged out a metre: the stored bounding box is
    // 7 × 6, so the north wall runs x ∈ [−3, +4] while ±half still says ±3.5. The
    // north wall's DISTANCE is untouched at 3, so the plane is right and only the
    // bound was ever wrong — which is why the old excuse for the bbox bound ("both
    // wrong the same way") did not describe this case.
    const off = {
      width: 7,
      depth: 6,
      height: 2.7,
      footprint: [
        [-3, -3],
        [4, -3],
        [4, 3],
        [-3, 3],
      ] as Footprint,
    };
    // The framed wall's own distance is untouched by an EAST drag, which is what makes
    // this the case the gate alone could fix: the plane was right and only the bound
    // was wrong. (§ 44's case is the complementary one — drag the wall being
    // photographed — and it is the `dragged` fixture at the top of this file.)
    expect(wallD('n', off)).toBe(3);
    expect(off.depth / 2, 'premise: the retired pair agreed here').toBe(3);
    expect(wallSpan('n', off) / 2).toBe(3.5); // the bound that used to apply
    for (const [lateral, verdict] of [
      [3.2, 'accepted'],
      [3.52, 'accepted'], // REFUSED before this read the polygon
    ] as Array<[number, string]>) {
      // 3.52 is near the top of what is usable, and the limit is the FRAME rather than
      // the gate: a 700 mm print centred much further out puts its near-face corner
      // past the edge of a 106° picture, and `inFrame` refuses to measure a box a
      // detector could not have handed over.
      const box = bboxOfWallSolid('n', 'n', lateral, 1.5, wallD('n', off), 0.7, 0.5, 0.03, wide);
      expect(inFrame(box), `${lateral}`).toBe(true);
      expect(lateral + 0.35, `${lateral} premise: in the room`).toBeLessThanOrEqual(4);
      const g = placeWallObject(box, 'n', off.footprint, wide, { depthM: 0.03 });
      expect(g, `${lateral} ${verdict}`).not.toBeNull();
      // And measured exactly, which is the point: what the old bound discarded was
      // not a fabrication, it was this.
      expect(g!.widthMM, `${lateral}`).toBe(700);
      expect(g!.heightMM, `${lateral}`).toBe(500);
      expect(g!.position.x, `${lateral}`).toBeCloseTo(lateral, 9);
    }

    // And the ASYMMETRY itself, which is what reading a polygon buys over reading a
    // number. The same wall stops at x = −3, so a piece decoded at −3.4 is round the
    // corner even though it is well inside `|x| ≤ 4`. Without this, `Math.abs(right) <=
    // frame.right` is a mutant that SURVIVES: it agrees with the real bound on every
    // centred room and on the two rows above, so the whole point of F1 would rest on
    // fixtures that cannot tell the two apart.
    const past = bboxOfWallSolid('n', 'n', -3.4, 1.5, wallD('n', off), 0.7, 0.5, 0.03, wide);
    expect(inFrame(past)).toBe(true);
    expect(-3.4 + 0.35, 'premise: past the wall’s own west end').toBeLessThan(-3);
    expect(Math.abs(-3.4), 'premise: a symmetric bound would accept it').toBeLessThan(3.5);
    expect(placeWallObject(past, 'n', off.footprint, wide, { depthM: 0.03 })).toBeNull();
  });

  // **A footprint that cannot answer means different things to a PLANE and to a
  // BOUND, and this pair is where that distinction is pinned.** `wallFrame` declines a
  // polygon with fewer than three points, a NaN vertex, or one the lens does not stand
  // inside. Until the ±half pair was retired, a wall piece still had a plane in such a
  // room — `depth/2` always answers — so the only question was whether the GATE fired,
  // and the answer was no: `if (!frame) return false` was a surviving mutant until a
  // two-point footprint was built, because every other fixture hands over a rectangle.
  // Now a wall piece has no plane at all there, and the two halves separate.
  const BROKEN: Footprint = [
    [-3, -2],
    [3, -2],
  ];

  it('refuses a WALL piece when the footprint cannot locate the plane', () => {
    // Not a regression from the sentence above, and worth reading as the rule rather
    // than as a reversal: there is no honest fallback for a plane. The bounding box WAS
    // the fallback, and inverting a measurement against a wall that might be anywhere
    // is the confident wrong number this module refuses everywhere else. Refusing costs
    // the measurement and not the piece — `geoRefine` hands the detection straight back
    // and `lib/label-repair.ts` reads that identity as unmeasurable.
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    expect(wallFrame('e', BROKEN), 'premise: no frame').toBeNull();
    const box = bboxOfWallSolid('e', 'e', 0.8, 1.5, WALLD('e'), 0.7, 0.5, 0.03, wide);
    expect(inFrame(box), 'premise: an ordinary, measurable box').toBe(true);
    // The same box in a room whose polygon DOES answer measures exactly, which is what
    // makes the null above a refusal rather than a broken placer.
    const ok = placeWallObject(box, 'e', ROOM.footprint, wide, { depthM: 0.03 });
    expect(ok!.widthMM).toBe(700);
    expect(ok!.heightMM).toBe(500);
    expect(placeWallObject(box, 'e', BROKEN, wide, { depthM: 0.03 })).toBeNull();
  });

  it('still measures a CEILING piece there, because the slab’s plane is the room’s height', () => {
    // The other half, and the only remaining route to the gate's own no-frame rule now
    // that the wall placer returns before reaching it. `placeCeilingObject` intersects a
    // plane located by `room.height`, which no footprint can move — so both of its gates
    // are bounds on an assumption rather than the assumption itself, and a polygon that
    // cannot say where the walls are leaves them INERT. `if (!frame) return true` in
    // `onFramedSurface`, and `frame &&` on the forward gate, are both pinned here.
    // The same 1.1 m disc `'puts it on the ceiling plane and inside the room'` uses. No
    // `inFrame` premise here, deliberately: a ceiling disc seen from below on a 106°
    // lens legitimately runs its bbox to the frame's own edge, so that gate is the
    // wrong question for this fixture. The premise that carries the meaning is the
    // first assertion — the piece IS measurable in a room whose polygon answers — so a
    // null in the second line is the footprint's doing and nothing else's.
    const disc = bboxOfCeilingDisc('e', 1.2, 0, 1.1, WIDE, ROOM.height);
    const good = placeCeilingObject(disc, 'e', ROOM, WIDE);
    expect(good, 'premise: measurable in a room with a polygon').not.toBeNull();
    const g = placeCeilingObject(disc, 'e', { height: ROOM.height, footprint: BROKEN }, WIDE);
    expect(g).not.toBeNull();
    expect(g!.widthMM).toBe(good!.widthMM);
  });

  it('and still measures a FLOOR piece there, because its distance was never assumed', () => {
    // The third role, and the one the other two are defined against. `placeFloorObject`
    // MEASURES its distance from the bottom row, so the polygon was never its plane —
    // only its two CLAMPS. A clamp with no trustworthy bound goes inert and the
    // measurement stands: *a bound may falsify an assumption and may never overrule a
    // measurement*, which is this function's own two-clamp split read one level up.
    // Substituting the bounding box here would be a bound overruling an observation on
    // an input nothing checked.
    const lens: CameraCal = { ...WIDE, height: 1.5 };
    const chest = { depthM: 0.4 };
    // (slot, x, z, wM, hM, depthM, cal). No `inFrame` premise, and for the reason this
    // module's own header gives: a LEVEL frame does not reach the floor near the lens,
    // so a close floor piece legitimately runs its bbox past the bottom edge. The
    // premises that carry the meaning are the two below — the piece measures in a room
    // whose polygon answers, and it sits clear of that room's own clamp, so what the
    // last assertion compares is a measurement against a measurement rather than one
    // bound against another.
    const box = bboxOfFloorBox('n', 0.5, -1.4, 1.2, 0.8, 0.4, lens);
    const good = placeFloorObject(box, 'n', ROOM.footprint, lens, chest);
    expect(good, 'premise: measurable in a room with a polygon').not.toBeNull();
    expect(good!.distance, 'premise: clear of that room’s clamp').toBeLessThan(
      ROOM.depth / 2 - chest.depthM / 2 - 1e-9,
    );
    const g = placeFloorObject(box, 'n', BROKEN, lens, chest);
    expect(g).not.toBeNull();
    expect(g!.widthMM, 'width is a measurement either way').toBe(good!.widthMM);
    expect(g!.distance, 'and so is the distance').toBeCloseTo(good!.distance, 12);
    expect(g!.distance, 'recovered exactly, not bounded into place').toBeCloseTo(1.4, 9);
  });

  it('but the 0.3 m lower guard is NOT conditional, on an input where it bites', () => {
    // Split out from the case above rather than appended to it, because appended it was
    // an assertion that could not fail: that fixture decodes at 1.4 m, so
    // `expect(distance).toBeGreaterThan(0.3)` was true of any implementation at all.
    // Mutation found it — moving `Math.max(near, 0.3)` inside the `if (frame)` beside it
    // survived a full run. The guard is arithmetic rather than a bound on the room (a
    // face AT the lens mirrors the piece in silence), so it must fire whether or not the
    // footprint can answer, and this is an input at which the difference is observable.
    const steep: CameraCal = { k: 2 * Math.tan(((66 / 2) * Math.PI) / 180), aspect: 4 / 3, height: 0.8, tiltRad: 0.9 };
    const g = placeFloorObject([0.3, 0.8, 0.4, 0.1], 'n', BROKEN, steep, CARD)!;
    expect(g, 'premise: it does return a placement').not.toBeNull();
    expect(g.distance, 'clamped to the guard, not past it').toBe(0.3);
    // And the premise that makes that a clamp rather than a coincidence: the same box in
    // a room whose polygon answers lands on the same guard, so 0.3 is the floor and not
    // this footprint's doing.
    expect(placeFloorObject([0.3, 0.8, 0.4, 0.1], 'n', ROOM.footprint, steep, CARD)!.distance).toBe(0.3);
  });

  it('refuses in a framed-wall-dragged room too, where it used to go inert', () => {
    // **This assertion is inverted from the one it replaces, and the inversion is the
    // payoff of retiring the ±half pair.** The gate used to compare the polygon's
    // distance against `wallDistance`'s and, where they disagreed — the FRAMED wall
    // itself dragged, as opposed to the one opposite — decline to fire at all, because
    // the plane it would be bounding was wrong too. That was honest while two
    // conventions existed and it meant the gate said nothing in exactly the room it was
    // built for: a room whose walls someone had moved. `placeWallObject` reads the same
    // frame now, so there is nothing left to be inert about.
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    // East wall dragged INWARD to x = 2.5: the stored box is 5.5 × 4, so the deleted
    // pair answered 2.75 for a wall that is really 2.5 away — over-reading every
    // lateral offset by 10%, which is what would have cleared an honest bound.
    const draggedRoom = {
      width: 5.5,
      depth: 4,
      height: 2.8,
      footprint: [
        [-3, -2],
        [2.5, -2],
        [2.5, 2],
        [-3, 2],
      ] as Footprint,
    };
    expect(draggedRoom.width / 2, 'premise: the two conventions disagreed here').toBe(2.75);
    expect(wallFrame('e', draggedRoom.footprint)!.distance).toBe(2.5);

    // The same return-wall print the centred room refuses. Refused in both rooms now.
    const box = bboxOfWallSolid('n', 'e', 2.2, 1.5, WALLD('n'), 0.7, 0.5, 0.03, wide);
    expect(placeWallObject(box, 'e', ROOM.footprint, wide, { depthM: 0.03 })).toBeNull();
    expect(placeWallObject(box, 'e', draggedRoom.footprint, wide, { depthM: 0.03 })).toBeNull();

    // And it is a REFUSAL rather than the gate being unreachable: a legitimate piece on
    // that same dragged east wall still measures, exactly. Without this the assertion
    // above would pass for a placer that had simply stopped working in dragged rooms.
    const real = bboxOfWallSolid('e', 'e', 0.6, 1.5, 2.5, 0.7, 0.5, 0.03, wide);
    const g = placeWallObject(real, 'e', draggedRoom.footprint, wide, { depthM: 0.03 });
    expect(g).not.toBeNull();
    expect(g!.widthMM).toBe(700);
    expect(g!.heightMM).toBe(500);
  });

  it('refuses a ceiling ray that leaves the room SIDEWAYS, which the old gate could not see', () => {
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    // A 300 mm vent high on the N wall, 300 mm below the slab, read as a ceiling piece
    // from the E photo.
    const box = bboxOfWallSolid('n', 'e', 2.0, 2.5, WALLD('n'), 0.3, 0.3, 0, wide);
    expect(inFrame(box)).toBe(true);

    // The PREMISE, asserted rather than assumed: the existing wall-normal gate does not
    // catch this. Same arithmetic as the placer, with the middle row, so the test cannot
    // pass for the wrong reason — which is what a bare `toBeNull` here would have done.
    const uC = box[0] + box[2] / 2;
    const vC = box[1] + box[3] / 2;
    // The placer's own three lines, tilt terms included, rather than the level-camera
    // shorthand this used to carry: `ray` returns `up = tanY·cosθ − sinθ` and
    // `fwd = tanY·sinθ + cosθ`, and the old version wrote `up` as a bare `tanY` and `fwd`
    // as the literal `1` — correct only at zero tilt, which this cal happens to be, under
    // a comment claiming "same arithmetic as the placer". Add tilt to the row and the
    // premise would have quietly started measuring a different quantity than the gate it
    // is asserting about. A no-op multiply also survives lint, so nothing flagged it.
    const tilt = wide.tiltRad ?? 0;
    const tanY = ((0.5 - vC) * wide.k) / wide.aspect;
    const up = tanY * Math.cos(tilt) - Math.sin(tilt);
    const fwd = tanY * Math.sin(tilt) + Math.cos(tilt);
    const t = (ROOM.height - CAM_HEIGHT) / up;
    expect(t * fwd).toBeLessThanOrEqual(WALLD('e')); // forward distance, inside the bound
    expect(Math.abs(t * ((uC - 0.5) * wide.k))).toBeGreaterThan(HALF('e')); // but outside sideways

    expect(placeCeilingObject(box, 'e', ROOM, wide)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------
// § 44 · the ±half pair retired, measured end to end
//
// Every other fixture in this file is a room centred on the lens, where `depth/2` and
// the polygon's own bound are the same number — so for as long as that was the whole
// harness, no assertion here COULD express what reading a bounding box costs. It is the
// third time this file has turned on that, after the depthless floor card and the
// depthless wall panel.
//
// **How the retired convention is measured without re-implementing it.** Reading the
// bounding box is exactly "treat a centred rectangle of the polygon's own bbox as if it
// were the room", so `bboxAsRoom` below hands the placers that rectangle and every
// number in the tables comes from the real functions. `docs/traps.md`'s entry is precise
// about why that matters: the last two numbers published about this module were measured
// against a scratch re-implementation, which is careful measurement of the wrong subject.
// ---------------------------------------------------------------------------------
describe('§ 44 · reading the polygon instead of its bounding box', () => {
  /** The retired convention, expressed as a fixture rather than as arithmetic: a room
   *  whose polygon IS its own bounding box, centred on the lens. `wallFrame` then
   *  returns exactly what `wallDistance` used to. */
  const bboxAsRoom = (r: { width: number; depth: number; height: number }) => ({
    ...r,
    footprint: footprintForLayout('rect', r.width, r.depth),
  });

  const LEVEL: CameraCal = { ...WIDE, height: 1.5 };
  /** 6 × 6 room, north wall pulled OUT a metre. The bbox is 6 × 7, so the retired pair
   *  answered 3.5 m for a wall that is really 4 — and answered 3.5 for the SOUTH wall
   *  too, which nobody moved, because a bounding box splits the difference. */
  const OUT = dragged('n', 1);
  /** …and pulled IN, because inward over-reads where outward under-reads, and a
   *  one-signed fixture cannot see a swapped comparison. */
  const IN = dragged('n', -1);

  it('the fixture can express the defect at all, which is the check on the check', () => {
    expect(OUT.depth).toBe(7);
    expect(wallD('n', OUT)).toBe(4);
    expect(wallD('n', bboxAsRoom(OUT)), 'the retired pair').toBe(3.5);
    expect(IN.depth).toBe(5);
    expect(wallD('n', IN)).toBe(2);
    expect(wallD('n', bboxAsRoom(IN)), 'the retired pair, other sign').toBe(2.5);
  });

  it('solves the LENS from the wall’s real distance', () => {
    // The first rung of the ladder, so an error here scales everything above it: `k`
    // comes out proportional to 1/d and every width, height and lateral offset in the
    // module is proportional to `k`.
    for (const [name, room, truthD, bboxD] of [
      ['out', OUT, 4, 3.5],
      ['in', IN, 2, 2.5],
    ] as const) {
      const vFloor = wallRowAtHeight(0, truthD, LEVEL)!;
      expect(vFloor, `${name}: floor line in frame`).toBeGreaterThan(0.52);
      expect(vFloor, `${name}: floor line in frame`).toBeLessThan(0.99);
      const solved = calibrateFromFloorLine(vFloor, 'n', room.footprint, LEVEL.aspect, {
        height: LEVEL.height,
      })!;
      expect(solved.k, `${name}: exact`).toBeCloseTo(LEVEL.k, 12);
      // And what the bounding box did instead — proportional to 1/d, so the ratio is
      // the distances', not a fitted number.
      const wrong = calibrateFromFloorLine(vFloor, 'n', bboxAsRoom(room).footprint, LEVEL.aspect, {
        height: LEVEL.height,
      })!;
      expect(wrong.k / solved.k, `${name}: 1/d`).toBeCloseTo(truthD / bboxD, 9);
    }
  });

  it('solves the CAMERA HEIGHT from it too, where no cancellation is available', () => {
    // H is directly proportional to D, and this rung is only climbed when the lens is
    // already KNOWN — which is exactly the case the lens solver's cancellation below
    // does not cover. So this one was simply wrong: 1.3125 m for a 1.5 m camera.
    const vFloor = wallRowAtHeight(0, 4, LEVEL)!;
    expect(heightFromFloorLine(vFloor, 'n', OUT.footprint, WIDE)).toBeCloseTo(1.5, 12);
    expect(heightFromFloorLine(vFloor, 'n', bboxAsRoom(OUT).footprint, WIDE)).toBeCloseTo(1.3125, 9);
  });

  it('gates a CEILING ray against the real wall, so it stops refusing real ones', () => {
    // `placeCeilingObject`'s forward gate — an intersection past the framed wall never
    // touched the ceiling — was reading the bounding box, and this is the direction that
    // costs something: in a room whose north wall was dragged OUT, the slab really does
    // run to 4 m, so every legitimate fan or vent between 3.5 and 4 was REFUSED. A gate
    // discarding correct measurements is the same defect the surface gate was fixed for,
    // one axis over. (Mutation found this: reading the bbox here survived the whole
    // suite until this existed, because every other room in the file is centred.)
    for (const fwd of [3.6, 3.7, 3.9]) {
      const disc = bboxOfCeilingDisc('n', 0.3, -fwd, 0.9, WIDE, OUT.height);
      expect(inFrame(disc), `${fwd}: in frame`).toBe(true);
      const g = placeCeilingObject(disc, 'n', OUT, WIDE);
      expect(g, `${fwd}: inside the real wall, so measured`).not.toBeNull();
      expect(g!.distance, `${fwd}`).toBeGreaterThan(OUT.depth / 2);
      expect(g!.distance, `${fwd}`).toBeLessThanOrEqual(4);
      // What the bounding box did with the same disc.
      expect(placeCeilingObject(disc, 'n', bboxAsRoom(OUT), WIDE), `${fwd}: bbox refused it`).toBeNull();
    }
    // And it still refuses what is genuinely past the wall, so the assertions above are
    // not simply the gate having been switched off.
    const beyond = bboxOfCeilingDisc('n', 0.3, -4.6, 0.9, WIDE, OUT.height);
    expect(placeCeilingObject(beyond, 'n', OUT, WIDE)).toBeNull();
  });

  it('measures a WALL piece against the plane the wall is actually on', () => {
    for (const [name, room, truthD] of [
      ['out', OUT, 4],
      ['in', IN, 2],
    ] as const) {
      const box = bboxOfWallSolid('n', 'n', 0.8, 1.5, truthD, 0.7, 0.5, 0.03, LEVEL);
      expect(inFrame(box), `${name}: in frame`).toBe(true);
      const g = placeWallObject(box, 'n', room.footprint, LEVEL, { depthM: 0.03 })!;
      expect(g, `${name}`).not.toBeNull();
      expect(g.widthMM, `${name}: width`).toBe(700);
      expect(g.heightMM, `${name}: height`).toBe(500);
      expect(g.position.x, `${name}: lateral`).toBeCloseTo(0.8, 9);
      expect(g.distance, `${name}: forward`).toBeCloseTo(truthD - 0.015, 9);
    }
  });

  it('clamps a FLOOR piece against the real wall, not the bounding box', () => {
    // The floor placer MEASURES its distance, so the pair was never its plane — it was
    // its two clamps. Which still matters: a floor position reaches the user, unlike a
    // wall piece's, and a bound in the wrong place either lets a sofa through the
    // plaster or pulls a correctly measured one off it.
    const sofa = { depthM: 0.85 };
    // A 2.0 × 0.85 × 0.8 sofa with its BACK on the real north wall at z = −4, so its
    // centre is half a depth in at z = −3.575. (slot, x, z, wM, hM, depthM, cal.)
    const box = bboxOfFloorBox('n', 0.5, -(4 - 0.425), 2.0, 0.8, 0.85, LEVEL);
    expect(inFrame(box), 'premise: in frame — far enough out that a level frame reaches it').toBe(true);
    const g = placeFloorObject(box, 'n', OUT.footprint, LEVEL, sofa)!;
    // Recovered, not clamped: the bound sits exactly here, so the assertion has to say
    // which one it is testing. `4 − 0.425` is what the MEASUREMENT gives, and the two
    // agreeing is the piece being against its own wall rather than the clamp landing on
    // the right answer by luck — which an earlier draft of this test did.
    expect(g.distance, 'measured centre, half a depth off the real wall').toBeCloseTo(3.575, 6);
    expect(g.widthMM, 'and the width is untouched').toBe(2000);
    // The bounding box pulls the same MEASURED piece 500 mm off its own wall, and it is
    // the clamp that does it — the measurement was identical in both rooms.
    const clamped = placeFloorObject(box, 'n', bboxAsRoom(OUT).footprint, LEVEL, sofa)!;
    expect(clamped.distance, 'the retired bound').toBeCloseTo(3.5 - 0.425, 6);
    expect(g.distance - clamped.distance).toBeCloseTo(0.5, 6);
    expect(clamped.widthMM, 'and it costs the position, not the size').toBe(2000);
  });

  // **The reason all five sites had to move in one commit, and it is measured rather
  // than argued.** A `k` solved from too short a distance is too LARGE by exactly the
  // ratio the placers then divide back out, since a wall piece's size goes as `k · d`
  // and both terms carry the same assumed `d`. So on the floor-line path the sizes were
  // already right while the distance was 500 mm out — and migrating one half without
  // the other breaks the cancellation in whichever direction you picked. Nothing on the
  // EXIF or vanishing-point path ever had it, because there `k` is known independently.
  it('prints what a HALF-migration would have cost, both ways', () => {
    const truthD = 4;
    const boxD = OUT.depth / 2;
    /** The piece, named once, because the fixture and the table's own truth row are two
     *  readers of one fact and used to be two hand-written copies of it. See `row` below
     *  for what that cost. */
    const TRUTH = { lateral: 0.8, yC: 1.5, wM: 0.7, hM: 0.5, depthM: 0.03 };
    const mm = (m: number) => Math.round(m * 1000);
    /** Its back is on the plaster, so its centre sits half a depth into the room — the
     *  same expression `placeWallObject` states, which is what the § 44 row must return
     *  rather than merely print alongside. */
    const truthDist = truthD - TRUTH.depthM / 2;
    const vFloor = wallRowAtHeight(0, truthD, LEVEL)!;
    const kBbox = calibrateFromFloorLine(vFloor, 'n', bboxAsRoom(OUT).footprint, LEVEL.aspect, {
      height: LEVEL.height,
    })!;
    const kReal = calibrateFromFloorLine(vFloor, 'n', OUT.footprint, LEVEL.aspect, {
      height: LEVEL.height,
    })!;
    const box = bboxOfWallSolid(
      'n',
      'n',
      TRUTH.lateral,
      TRUTH.yC,
      truthD,
      TRUTH.wM,
      TRUTH.hM,
      TRUTH.depthM,
      LEVEL,
    );
    const rows: Array<[string, CameraCal, Footprint]> = [
      ['shipped   · k from bbox, plane from bbox', kBbox, bboxAsRoom(OUT).footprint],
      ['half      · k from bbox, plane from polygon', kBbox, OUT.footprint],
      ['half      · k from polygon, plane from bbox', kReal, bboxAsRoom(OUT).footprint],
      ['§ 44      · both from the polygon', kReal, OUT.footprint],
      ['EXIF      · k KNOWN, plane from bbox', LEVEL, bboxAsRoom(OUT).footprint],
      ['EXIF+§ 44 · k KNOWN, plane from polygon', LEVEL, OUT.footprint],
    ];
    // ONE formatter, for the measured rows and for the truth row alike — which is the
    // whole fix rather than a tidy-up. A row the others are read against cannot be a
    // second, hand-kept copy of the fixture, and this one was: moving the fixture's
    // lateral printed a `§ 44` row of 1.0000 directly above a `truth` row of 0.8000 — a
    // table contradicting itself — with all 65 tests green. Rule 2 names that shape
    // outright, *a displayed measurement hand-typed next to the thing it describes*, and
    // it survived review twice because the eye goes to the derived header one line up.
    // The caption and the dW denominator carried their own copies of 700 as well.
    const row = (label: string, widthMM: number, heightMM: number, x: number, dist: number) =>
      `${label.padEnd(44)} ${String(widthMM).padStart(6)}  ${String(heightMM).padStart(6)}  ${
        `${(((widthMM - mm(TRUTH.wM)) / mm(TRUTH.wM)) * 100).toFixed(1)}%`.padStart(6)
      }  ${x.toFixed(4).padStart(7)}  ${dist.toFixed(3).padStart(6)}`;
    const out: string[] = [
      `\n§ 44 · a ${mm(TRUTH.wM)} × ${mm(TRUTH.hM)} print on a north wall dragged out to ` +
        `${truthD.toFixed(1)} m (its bounding box says ${boxD.toFixed(1)})`,
      'configuration                                 width  height   dW      pos.x    dist',
    ];
    const got: Record<string, { w: number; h: number; x: number; dist: number }> = {};
    for (const [label, cal, fp] of rows) {
      const g = placeWallObject(box, 'n', fp, cal, { depthM: TRUTH.depthM })!;
      got[label] = { w: g.widthMM, h: g.heightMM, x: g.position.x, dist: g.distance };
      out.push(row(label, g.widthMM, g.heightMM, g.position.x, g.distance));
    }
    out.push(row('truth', mm(TRUTH.wM), mm(TRUTH.hM), TRUTH.lateral, truthDist));
    console.log(out.join('\n'));

    const at = (k: string) => got[rows.find((r) => r[0].startsWith(k))![0]];
    // What shipped: sizes right by cancellation, distance 500 mm out.
    expect(at('shipped').w).toBe(699);
    expect(at('shipped').h).toBe(499);
    // Either half alone: ±13–14%, and in OPPOSITE directions. These two assertions are
    // the whole argument for one commit rather than three.
    expect(at('half      · k from bbox, plane from polygon').w).toBe(800);
    expect(at('half      · k from polygon, plane from bbox').w).toBe(611);
    // The fix, and the case that never had a cancellation to lose.
    expect(at('§ 44').w).toBe(700);
    expect(at('§ 44').h).toBe(500);
    expect(at('EXIF      ').w).toBe(611);
    expect(at('EXIF+§ 44').w).toBe(700);

    // **The two columns nothing pinned**, which is how the truth row could contradict the
    // table above it in silence — every assertion here was a width or a height, and the
    // position half of the defect was printed and checked by nothing. Derived from
    // `TRUTH`, so moving the fixture now fails here instead of printing a contradiction.
    expect(at('§ 44').x, 'the fix recovers the lateral offset').toBeCloseTo(TRUTH.lateral, 9);
    expect(at('§ 44').dist, 'and the distance').toBeCloseTo(truthDist, 9);
    // And this item's headline figure: the bounding box put the plane 500 mm short, which
    // is the half that survived the cancellation and reached the user.
    expect(at('shipped').dist, 'the retired plane, half the bbox').toBeCloseTo(
      boxD - TRUTH.depthM / 2,
      9,
    );
    expect(at('§ 44').dist - at('shipped').dist, 'the headline: 500 mm').toBeCloseTo(0.5, 9);
  });
});
