import { describe, it, expect } from 'vitest';
import {
  CAM_HEIGHT,
  calForPhoto,
  defaultCal,
  calFromHfov,
  wallFrame,
  wallRowAtHeight,
  calibrateFromFloorLine,
  heightFromFloorLine,
  fitHeightToFloorLine,
  atLens,
  cutAxes,
  clipToFrame,
  cutByFrame,
  frameCuts,
  locateOnWall,
  placeCeilingObject,
  placeFloorObject,
  placeWallObject,
  pickLens,
  type CameraCal,
} from '@/lib/photo-geometry';
import { hfovFromFocal35 } from '@/lib/exif';
import type { CaptureSlot } from '@/lib/storage';
import { footprintForLayout, type Footprint, type LayoutId } from '@/lib/footprint';
import {
  ALONG,
  bboxOfCeilingDisc,
  bboxOfCeilingDiscInFrame,
  bboxOfFloorBox,
  bboxOfFloorBoxInFrame,
  bboxOfFloorCylinder,
  bboxOfFloorObject,
  bboxOfWallPanel,
  bboxOfWallSolid,
  inFrame,
  project,
  type Box,
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

/** What the retired ±half pair answered for a wall's LENGTH — the room's `width`
 *  across n/s and its `depth` across e/w. Written out here rather than imported,
 *  because `wallSpan` is deleted too: an assertion about a convention the module no
 *  longer holds has to state that convention itself, or it measures its own subject.
 *  It survived `wallDistance` by a commit, on the measured ground that a span is the
 *  one quantity the two conventions agree on — true of a rectangle, dragged or not,
 *  and false of every preset that cuts a corner out of the room. */
const bboxSide = (slot: CaptureSlot, room: { width: number; depth: number }) =>
  slot === 'n' || slot === 's' ? room.width : room.depth;

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
      const across = bboxSide(slot, ROOM);
      expect(near + across).toBe(ROOM.width + ROOM.depth);
      expect(across).not.toBe(near);
    }
    expect(bboxSide('n', ROOM)).toBe(6);
    expect(bboxSide('e', ROOM)).toBe(4);
  });

  // THE NO-OP PROOF, at the source rather than only in the baseline tables it keeps
  // byte-identical. `wallFrame` casts the view axis and takes the wall it hits; for a
  // rectangle that wall's own vertices ARE the bounding box's extremes, so the two
  // read the same doubles through the same subtraction and `toBe` is the honest
  // comparison — a tolerance here would hide exactly the drift this asserts against.
  // Dragged in both directions on all four sides, because inward over-reads the
  // distance and outward under-reads it, and a one-signed fixture cannot see a
  // swapped comparison.
  it('for a RECTANGLE the polygon and the bounding box are the same wall, bit for bit', () => {
    const cases = [{ ...ROOM }, ...(['n', 's', 'e', 'w'] as const).flatMap((side) => [1, 2, -0.5].map((by) => dragged(side, by)))];
    for (const room of cases) {
      const b = { minX: Math.min(...room.footprint.map((p) => p[0])), maxX: Math.max(...room.footprint.map((p) => p[0])), minZ: Math.min(...room.footprint.map((p) => p[1])), maxZ: Math.max(...room.footprint.map((p) => p[1])) };
      const want = {
        n: { distance: -b.minZ, left: b.minX, right: b.maxX },
        s: { distance: b.maxZ, left: -b.maxX, right: -b.minX },
        e: { distance: b.maxX, left: b.minZ, right: b.maxZ },
        w: { distance: -b.minX, left: -b.maxZ, right: -b.minZ },
      };
      for (const slot of ['n', 's', 'e', 'w'] as const) {
        expect(wallFrame(slot, room.footprint), `${room.width}x${room.depth} ${slot}`).toEqual(want[slot]);
        // …and the span is the one quantity that survives a drag unchanged, which is
        // why the surface gate needed `left` and `right` separately and not this.
        expect(wallFrame(slot, room.footprint)!.right - wallFrame(slot, room.footprint)!.left).toBe(bboxSide(slot, room));
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
    expect(bboxSide('e', room)).toBe(7);
    // …and for a rectangle the polygon agrees about the span, which is the half of
    // the old pair that was never wrong.
    const eFrame = wallFrame('e', room.footprint)!;
    expect(eFrame.right - eFrame.left).toBe(7);
  });
});

// § 44's largest filed residual: `wallFrame` read the polygon's BOUNDS, so retiring
// the ±half pair fixed the off-centre rectangle and left an L, T or U measured to the
// box around it.
//
// The rooms here are the five the layout picker ships, at the dimensions it ships them
// at, because reachability is one press: "Photograph my real room first (optional)" is
// offered for whichever preset is selected, and `roomFootprint` hands that preset's
// polygon to all five measurement sites. Not a hypothetical room shape.
//
// The table prints on every green run, and every number this commit publishes comes
// out of it. `docs/traps.md` carries why: the figures that reached six files last time
// were measured against a re-implementation of the placer in a scratch script — careful
// measurement of the wrong subject. Call the function.
describe('the framed wall in a room that is not a box', () => {
  const PRESETS: Array<[LayoutId, number, number]> = [
    ['rect', 6.0, 4.0],
    ['l', 6.0, 4.7],
    ['t', 5.5, 4.7],
    ['u', 6.0, 5.0],
    ['open', 7.5, 5.6],
  ];
  /** What the retired pair answered for the framed wall's DISTANCE: `depth/2` across
   *  n/s, `width/2` across e/w. Stated here, not imported, for `bboxSide`'s reason. */
  const bboxDist = (slot: CaptureSlot, w: number, d: number) =>
    slot === 'n' || slot === 's' ? d / 2 : w / 2;

  /** Where a preset's own vertex list puts the wall a given slot faces — the truth this
   *  describe measures `wallFrame` against, read OFF THE INPUT rather than copied from
   *  `footprintForLayout`'s constants. The first version of these tests wrote `0.22 * w`
   *  and `0.42 * d` by hand, which is a second copy of a number the fixture already
   *  holds: the same shape as the hand-typed truth row a review caught in § 44's own
   *  table, one notch milder. Each reader below asserts the vertex is the one it thinks
   *  it is, so a change to the preset fails loudly rather than silently re-pointing the
   *  truth at something else. */
  const vertex = (layout: LayoutId, w: number, d: number, i: number) => footprintForLayout(layout, w, d)[i];

  it('prints what the bounding box said and what the wall is', () => {
    const out: string[] = [
      '\n§ 44b · the framed wall, per shipping preset · bbox convention vs the polygon',
      'preset  W × D      slot   bbox d   poly d    ratio   bbox ends        poly ends        fabrication',
    ];
    for (const [layout, w, d] of PRESETS) {
      const fp = footprintForLayout(layout, w, d);
      for (const slot of ['n', 'e', 's', 'w'] as const) {
        const frame = wallFrame(slot, fp);
        const bd = bboxDist(slot, w, d);
        const half = bboxSide(slot, { width: w, depth: d }) / 2;
        // How much picture the surface gate used to accept beyond the real wall's own
        // ends — the width of the window a return-wall fabrication had to land in.
        const fab = frame ? Math.max(0, frame.left - -half) + Math.max(0, half - frame.right) : NaN;
        out.push(
          `${layout.padEnd(6)}  ${`${w} × ${d}`.padEnd(9)}  ${slot}    ${bd.toFixed(3).padStart(6)}   ` +
            (frame
              ? `${frame.distance.toFixed(3).padStart(6)}  ${(bd / frame.distance).toFixed(3).padStart(6)}×  ` +
                `${`${(-half).toFixed(2)} … ${half.toFixed(2)}`.padEnd(15)}  ` +
                `${`${frame.left.toFixed(2)} … ${frame.right.toFixed(2)}`.padEnd(15)}  ${fab.toFixed(2)} m`
              : `  null       —     ${`${(-half).toFixed(2)} … ${half.toFixed(2)}`.padEnd(15)}  the lens has no wall ahead of it`),
        );
      }
    }
    console.log(out.join('\n'));
    // A printed table nobody reads is this repo's own recurring failure, so the two
    // rows that carry the finding are assertions as well as output.
    // The stem's east wall, from the `t`'s own vertex list: vertices 3 and 4 are its two
    // ends, so they share an x and that x IS the wall. Asserted, so this cannot quietly
    // start reading some other edge.
    const stemA = vertex('t', 5.5, 4.7, 3);
    const stemB = vertex('t', 5.5, 4.7, 4);
    expect(stemA[0], 'premise: the stem wall is vertical').toBe(stemB[0]);
    // …and it is the `t`'s stem rather than any preset's third vertex. Worth pinning
    // because `u`'s vertex 3 has the SAME x — both presets narrow to 0.22 of the width —
    // so swapping the preset here is an equivalent mutant, and an assertion whose only
    // mutation is equivalent has not been shown to fail at all.
    expect(stemA[0]).toBeCloseTo(0.22 * 5.5, 12);
    expect(vertex('l', 5.5, 4.7, 3)[0]).not.toBeCloseTo(stemA[0], 6);
    expect(wallFrame('e', footprintForLayout('t', 5.5, 4.7))!.distance).toBeCloseTo(stemA[0], 12);
    expect(wallFrame('n', footprintForLayout('u', 6.0, 5.0))).toBeNull();
  });

  // The stem's own half-width, from `footprintForLayout`'s constant rather than from
  // the answer being checked — an assertion that reads its subject back to itself is
  // the shape `tests/module-tiling.test.ts` was caught by.
  it('a t’s stem wall is where the preset put it, and its box is 2.27× further', () => {
    const [w, d] = [5.5, 4.7];
    const fp = footprintForLayout('t', w, d);
    const stemX = vertex('t', w, d, 3)[0];
    expect(stemX, 'premise: the stem wall is vertical').toBe(vertex('t', w, d, 4)[0]);
    for (const slot of ['e', 'w'] as const) {
      expect(wallFrame(slot, fp)!.distance, slot).toBeCloseTo(stemX, 12);
      expect(bboxDist(slot, w, d)).toBeCloseTo(w / 2, 12);
      // Dimension-INDEPENDENT: the ratio is (w/2) ÷ stemX and stemX is a fixed fraction
      // of w, so every `t` room is out by the same factor. Published as though it were
      // one room's measurement; it is a property of the preset.
      expect(bboxDist(slot, w, d) / wallFrame(slot, fp)!.distance).toBeCloseTo(2.2727, 4);
    }
    // The two slots along the other axis were right all along: the north bar runs the
    // full width and the stem's end is the full depth away. So this is not "l/t/u are
    // broken" but three of the `t`'s own four walls, and six of the presets' twenty —
    // which is what a fixture sweeping all four slots on all five presets is for, and
    // why the tally in the docs is swept rather than eyeballed. (It was published as
    // "four of sixteen" here and "three of sixteen, and five more" everywhere else;
    // both flattered, `open`'s four walls having been left out of the denominator.)
    for (const slot of ['n', 's'] as const) {
      expect(wallFrame(slot, fp)!.distance, slot).toBeCloseTo(d / 2, 12);
    }
    // …and the ENDS move on three of the four, which is the gate's half of the defect.
    expect(wallFrame('s', fp)!.right).toBeCloseTo(stemX, 12); // the stem, not the bar
    expect(bboxSide('s', { width: w, depth: d }) / 2).toBeCloseTo(w / 2, 12);
  });

  it('so a 700 × 500 print on that wall stops coming back 1614 × 1153', () => {
    const [w, d] = [5.5, 4.7];
    const fp = footprintForLayout('t', w, d);
    const stem = wallFrame('e', fp)!.distance;
    const box = bboxOfWallSolid('e', 'e', 0, 1.5, stem, 0.7, 0.5, 0.03, WIDE);
    expect(inFrame(box)).toBe(true);
    const got = placeWallObject(box, 'e', { height: 2.8, footprint: fp }, WIDE, { depthM: 0.03 })!;
    expect(got.widthMM).toBeCloseTo(700, 6);
    expect(got.heightMM).toBeCloseTo(500, 6);
    // What it WAS, pinned by handing the same photograph the bounding box as a room
    // rather than by mutating the placer — so this row survives a refactor and cannot
    // quietly become the same number as the row above it.
    const asBox = placeWallObject(box, 'e', { height: 2.8, footprint: footprintForLayout('rect', w, d) }, WIDE, { depthM: 0.03 })!;
    expect(Math.round(asBox.widthMM)).toBe(1614);
    expect(Math.round(asBox.heightMM)).toBe(1153);
    // And the cancellation, because it is the reason nothing caught this: the 66°
    // default standing in for a real ultrawide is wrong the other way by almost the
    // same factor, so the shipped answer was +12.9% — ordinary slop — and got WORSE as
    // the calibration improved.
    const withDefault = placeWallObject(box, 'e', { height: 2.8, footprint: footprintForLayout('rect', w, d) }, defaultCal(4 / 3), { depthM: 0.03 })!;
    expect(withDefault.widthMM / 700 - 1).toBeCloseTo(0.129, 3);
    const fixedWithDefault = placeWallObject(box, 'e', { height: 2.8, footprint: fp }, defaultCal(4 / 3), { depthM: 0.03 })!;
    // Fixing the footprint leaves the lens error alone and nothing else: −51% is
    // `k` at 66° against a 106° photograph, which is § 28's item and not this one.
    expect(fixedWithDefault.widthMM / 700 - 1).toBeCloseTo(-0.51, 2);
  });

  // Not a mis-measured wall but a mis-placed CAMERA, and the file used to say the first
  // thing: that a `u`'s notch puts the wall ahead of a north-facing lens at `z = 0`
  // while the bounds answer `depth/2`. The notch's inner face is at
  // `−depth/2 + 0.5·depth` — exactly zero, for every `u` room — so the rig stands the
  // lens ON that wall and there is no wall ahead of it at all.
  it('the u preset stands the camera on one of its own walls', () => {
    for (const [w, d] of [[6, 5], [4, 4], [7.5, 3.2], [2.4, 9.6]] as Array<[number, number]>) {
      const fp = footprintForLayout('u', w, d);
      expect(fp[2][1], `${w}×${d}`).toBe(0); // the notch's inner face, exactly on the lens
      expect(wallFrame('n', fp), `${w}×${d}`).toBeNull();
      // The other three walls are real and still measured — a preset is not refused
      // wholesale, which is what a bounds-shaped refusal would have done.
      for (const slot of ['e', 's', 'w'] as const) expect(wallFrame(slot, fp), slot).not.toBeNull();
      expect(bboxDist('n', w, d)).toBe(d / 2); // what the bounds answered about the void
    }
  });

  // The three roles, on a room a user can pick rather than on a two-point polygon: a
  // PREMISE returns null, a GATE goes inert, a CLAMP goes inert with its arithmetic
  // guard intact. Every one of them reached at once, by one photograph.
  it('and every site takes its own no-frame branch there', () => {
    const fp = footprintForLayout('u', 6, 5);
    const room = { height: 2.7, footprint: fp };
    // premises
    expect(calibrateFromFloorLine(0.8, 'n', fp, 4 / 3)).toBeNull();
    expect(heightFromFloorLine(0.8, 'n', fp, WIDE)).toBeNull();
    const wallBox = bboxOfWallSolid('n', 'n', 0, 1.5, 2.5, 0.7, 0.5, 0.03, WIDE);
    expect(placeWallObject(wallBox, 'n', { height: 2.8, footprint: fp }, WIDE, { depthM: 0.03 })).toBeNull();
    // A GATE goes inert, and inertness is only visible against a fixture the live
    // bound would refuse: a ceiling disc 3.0 m ahead, where the bounding box this used
    // to read answers 2.5. The slab's height still locates its plane, so there is a
    // measurement to keep — only the bound is missing.
    const box3m = { height: 2.7, footprint: footprintForLayout('rect', 6, 5) };
    const disc = bboxOfCeilingDisc('n', 0, -3.0, 1.0, WIDE, 2.6);
    expect(inFrame(disc)).toBe(true);
    expect(placeCeilingObject(disc, 'n', room, WIDE)).not.toBeNull();
    expect(placeCeilingObject(disc, 'n', box3m, WIDE)).toBeNull();
    // A CLAMP goes inert while its arithmetic guard stays, and the same fixture shows
    // it: a near face MEASURED at 3.0 m keeps its distance where there is no
    // trustworthy plaster to bound it, and is pulled back to 2.5 where there is. A
    // bound may falsify an assumption and may never overrule a measurement — with no
    // bound, the measurement stands.
    // (wM, hM, depthM) — the fixture's depth has to be the depth the placer is told,
    // or the near face and the centre disagree by half their difference and the row
    // reads like a clamp that fired. `docs/traps.md` has this transposition already.
    const floor = bboxOfFloorBox('n', 0, -3.2, 1.0, 0.8, 0.4, WIDE);
    expect(inFrame(floor)).toBe(true);
    const free = placeFloorObject(floor, 'n', { height: 2.8, footprint: fp }, WIDE, { depthM: 0.4 })!;
    const bound = placeFloorObject(floor, 'n', box3m, WIDE, { depthM: 0.4 })!;
    expect(free.distance).toBeCloseTo(3.2, 6);
    // …and where there IS plaster, the CENTRE clamp puts the piece's back on it, so
    // its centre lands half a depth in front. Two clamps, two subjects — the near face
    // is measured and the centre is measurement plus a catalogue depth — which is why
    // this is `frame.distance − depthM/2` and not the near clamp's own bound.
    expect(bound.distance).toBeCloseTo(2.5 - 0.4 / 2, 6);
  });

  // The gate's half of the defect, and the payoff that reaches a user: a fabrication on
  // the return wall used to land inside the bounds' ends and be measured as if it were
  // on the framed one. The `l` is the sharp case because its DISTANCES were right, so
  // nothing else about that photograph looks wrong.
  it('the surface gate stops taking an l’s return wall for the framed one', () => {
    const [w, d] = [6.0, 4.7];
    const fp = footprintForLayout('l', w, d);
    const east = wallFrame('e', fp)!;
    expect(east.distance).toBeCloseTo(w / 2, 12); // the plane was never wrong here
    // The east wall's south end, from the `l`'s own vertex list: vertex 2 is where the
    // cut-away corner meets it. ONE binding for the premise and the value, so mutating
    // the index moves both — written the other way first, and then the premise went on
    // guarding vertex 2 while the value came from vertex 3.
    const corner = vertex('l', w, d, 2);
    expect(corner[0], 'premise: this vertex is ON the east wall').toBeCloseTo(w / 2, 12);
    expect(east.right).toBeCloseTo(corner[1], 12);
    expect(bboxSide('e', { width: w, depth: d }) / 2).toBeCloseTo(d / 2, 12); // the old bound
    // Inside the real wall: measured, and exactly.
    const on = bboxOfWallSolid('e', 'e', 0.2, 1.5, east.distance, 0.7, 0.5, 0.03, WIDE);
    expect(inFrame(on)).toBe(true);
    const kept = placeWallObject(on, 'e', { height: 2.8, footprint: fp }, WIDE, { depthM: 0.03 })!;
    expect(kept.widthMM).toBeCloseTo(700, 6);
    // Past it, and still well inside the bounds' 2.35 m — refused now, measured before.
    const off = bboxOfWallSolid('e', 'e', 1.5, 1.5, east.distance, 0.7, 0.5, 0.03, WIDE);
    expect(inFrame(off)).toBe(true);
    expect(placeWallObject(off, 'e', { height: 2.8, footprint: fp }, WIDE, { depthM: 0.03 })).toBeNull();
    expect(placeWallObject(off, 'e', { height: 2.8, footprint: footprintForLayout('rect', w, d) }, WIDE, { depthM: 0.03 })).not.toBeNull();
  });

  // Two walls facing the lens on ONE view axis, which is the fixture the whole preset
  // sweep could not build: every ray out of a preset leaves the room exactly once, so
  // "the nearest candidate" and "the farthest" agree everywhere and choosing the wrong
  // one is a surviving mutant. A footprint whose arms wrap around the view axis — two
  // areas joined by a corridor, which `readFootprint` accepts and no preset makes —
  // separates them: the axis exits at 1 m, crosses outside, re-enters, and exits again
  // at 7 m, so there are candidates at both and only the first is photographable.
  it('takes the NEAREST wall facing it, on an axis that leaves the room twice', () => {
    // x ∈ [−3, 3] × z ∈ [−7, 3], less a notch x ∈ [−3, 2] × z ∈ [−5, −1].
    const c: Footprint = [
      [-3, 3],
      [3, 3],
      [3, -7],
      [-3, -7],
      [-3, -5],
      [2, -5],
      [2, -1],
      [-3, -1],
    ];
    const frame = wallFrame('n', c)!;
    expect(frame.distance).toBe(1);
    // …and its own ends, which really are asymmetric: that wall stops at x = 2 where
    // the corridor opens, and the bounding box would have said ±3 on both sides.
    expect(frame.left).toBe(-3);
    expect(frame.right).toBe(2);
    // The far arm's wall faces the lens too and is 7 m away; naming it would be naming
    // a wall with a room's worth of outdoors in between.
    expect(frame.distance).not.toBe(7);
    // The complement, so this is not just "the smaller number": from the SOUTH the
    // only facing wall is the far one, and 3 m is the answer no nearest-vs-farthest
    // rule can get wrong.
    expect(wallFrame('s', c)!.distance).toBe(3);
  });

  // § 44's second filed residual, closed by the same change rather than by a second
  // test: the old origin check was `left < 0 && right > 0` on the BOUNDS, which an L
  // whose cut-away quadrant contains the lens passes on every axis while the camera
  // stands outdoors. The facing test is the honest one — the nearest wall the view axis
  // crosses is one seen from inside, or the lens is not in this room.
  it('refuses a lens standing in an l’s cut-away quadrant, which the bounds passed', () => {
    const [w, d] = [6.0, 4.7];
    // Translate the preset so the removed quadrant covers the origin.
    const fp = footprintForLayout('l', w, d).map(([x, z]) => [x - 1.5, z - 1.2]) as Footprint;
    const xs = fp.map((pt) => pt[0]);
    const zs = fp.map((pt) => pt[1]);
    // The premise: the OLD test passes on all four slots, because the origin is inside
    // the bounding box even though it is outside the room.
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(0);
    expect(Math.min(...zs)).toBeLessThan(0);
    expect(Math.max(...zs)).toBeGreaterThan(0);
    for (const slot of ['n', 'e', 's', 'w'] as const) expect(wallFrame(slot, fp), slot).toBeNull();
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
    const g = placeFloorObject(box, 'n', ROOM, CAL, CARD)!;
    expect(g.position.x).toBeCloseTo(0.8, 2);
    expect(g.position.z).toBeCloseTo(-1.5, 2);
    expect(g.widthMM).toBeCloseTo(1600, -1);
    expect(g.heightMM).toBeCloseTo(900, -1);
    expect(g.yaw).toBeCloseTo(0);
  });

  it('recovers position via the mirrored S camera', () => {
    const box = bboxOfFloorObject('s', -0.5, 1.2, 0.6, 1.8, CAL);
    const g = placeFloorObject(box, 's', ROOM, CAL, CARD)!;
    expect(g.position.x).toBeCloseTo(-0.5, 2);
    expect(g.position.z).toBeCloseTo(1.2, 2);
    expect(g.heightMM).toBeCloseTo(1800, -1);
    expect(g.yaw).toBeCloseTo(Math.PI);
  });

  it('recovers position via the E camera (axes swapped)', () => {
    const box = bboxOfFloorObject('e', 2.0, 0.7, 1.0, 0.5, CAL);
    const g = placeFloorObject(box, 'e', ROOM, CAL, CARD)!;
    expect(g.position.x).toBeCloseTo(2.0, 2);
    expect(g.position.z).toBeCloseTo(0.7, 2);
    expect(g.widthMM).toBeCloseTo(1000, -1);
  });

  it('clamps distance to the wall (bbox bottom near the horizon)', () => {
    // Bottom edge barely below centre → naive distance would exceed the room.
    const g = placeFloorObject([0.45, 0.2, 0.1, 0.33], 'n', ROOM, CAL, CARD)!;
    expect(g.distance).toBeLessThanOrEqual(wallD('n', ROOM));
  });

  it('returns null when the bottom edge is above the horizon', () => {
    expect(placeFloorObject([0.4, 0.1, 0.2, 0.3], 'n', ROOM, CAL, CARD)).toBeNull();
  });
});

describe('placeWallObject', () => {
  it('recovers a TV mounted on the N wall — size and mount height', () => {
    // 1.2m × 0.7m panel centred 1.4m up at x = -0.6 on the N wall (z = -2).
    const [u1, vTop] = project('n', -0.6 - 0.6, 1.4 + 0.35, -2, CAL);
    const [u2, vBottom] = project('n', -0.6 + 0.6, 1.4 - 0.35, -2, CAL);
    const box: [number, number, number, number] = [u1, vTop, u2 - u1, vBottom - vTop];
    const g = placeWallObject(box, 'n', ROOM, CAL, CARD)!;
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
          const g = placeFloorObject(box, slot, ROOM, c, { depthM: 0.6 })!;
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
    // On the ultrawide, because at 1.2 the plant's foot is below the bottom of the
    // frame: a box past the frame is not one a detector returns, and one that reaches
    // its edge is read as cut off there (`frameCuts`), whose near face is bounded
    // rather than measured.
    for (const lateral of [0, 1.3, -0.7]) {
      const c = WIDE;
      const box = tangentBboxOfCylinder(1.8, lateral, 0.4, 0.9, c);
      const g = placeFloorObject(box, 'n', ROOM, c, { depthM: 2, round: true })!;
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
    const asBox = placeFloorObject(box, 'n', ROOM, c, { depthM: 0.4, round: false })!;
    expect(asBox.widthMM).toBeLessThan(400 * 0.75);
  });

  it('is exact for a round footprint under TILT too, each side read at its own end', () => {
    // A side of a round piece is a vertical line on it, and its column is extreme at one
    // end of that line: which end goes by the tilt and by the half of the photo the side is
    // in. The first version read both sides on the box's top row, and this test pinned what
    // that cost as a band, with a floor under it so that the day it became exact the floor
    // would say so. It did. Read at their own ends, the sides give the size exactly and the
    // position to a hundredth of a millimetre, at every tilt here.
    //
    // The piece is whole in the photo, which is asserted, and that took moving it. The band
    // was measured on a plant 1.5 m out on the 1.2 lens, whose box ran past the frame's
    // bottom at every tilt — a box no detector returns, whose bottom edge is a base the photo
    // did not show. So on the ultrawide, 3.6 m out in a deeper room, where the frame's bottom
    // at 20° up still clears its foot. There, straddling the view axis the first version was
    // nearly right, its two sides' errors cancelling; to one side, a 400 mm plant read 420 at
    // 5° down and 501 at 20° up, and stood 67 mm from where it was.
    const DEEP = { width: 6, depth: 8, height: 2.8, footprint: footprintForLayout('rect', 6, 8) };
    for (const lateral of [0, 1.2, -1.2]) {
      for (const deg of [5, -5, 12, -12, 20, -20]) {
        const c = { ...WIDE, tiltRad: (deg * Math.PI) / 180 };
        const box = bboxOfFloorCylinder('n', lateral, -3.6, 0.4, 0.9, c);
        const where = `${lateral} m, ${deg}°`;
        expect(frameCuts(box), where).toEqual({ left: false, right: false, top: false, bottom: false });
        const g = placeFloorObject(box, 'n', DEEP, c, { depthM: 0.4, round: true })!;
        expect([g.widthMM, g.heightMM], where).toEqual([400, 900]);
        expect(Math.hypot(g.position.x - lateral, g.position.z + 3.6), where).toBeLessThan(1e-5);
      }
    }
  });

  it('is exact close up and tipped steeply down, on the widest lenses', () => {
    // Where the test above does not reach, and where the first version of the per-side read
    // failed. It iterated the height to 1e-9 in twenty passes, and close to the lens, tipped
    // steeply down, that fixed point runs at 0.9 a pass and slower: 73 of these pieces, whole
    // in the photo, came back unmeasured, each within millimetres of its size when the count
    // ran out. The height is solved in one division now, so every one is exact. The count is
    // a literal, so the grid cannot quietly lose the pieces it is here for.
    const DEEP = { width: 6, depth: 8, height: 2.8, footprint: footprintForLayout('rect', 6, 8) };
    let whole = 0;
    for (const lens of [66, 106, 120])
      for (const deg of [25, 35, 45])
        for (const dist of [1.0, 1.5])
          for (const lateral of [-1.5, -0.6, 0, 0.6, 1.5])
            for (const dia of [0.25, 0.5, 0.9])
              for (const h of [0.4, 0.9]) {
                const c = { k: 2 * Math.tan(((lens / 2) * Math.PI) / 180), aspect: 4 / 3, tiltRad: (deg * Math.PI) / 180 };
                const box = bboxOfFloorCylinder('n', lateral, -dist, dia, h, c);
                const cut = frameCuts(box);
                if (cut.left || cut.right || cut.top || cut.bottom) continue;
                whole++;
                const where = `${lens}°, ${deg}° down, ${dist} m, ${lateral} m, ${dia} × ${h}`;
                const g = placeFloorObject(box, 'n', DEEP, c, { depthM: dia, round: true });
                expect(g, where).not.toBeNull();
                expect([g!.widthMM, g!.heightMM], where).toEqual([Math.round(dia * 1000), Math.round(h * 1000)]);
                expect(Math.hypot(g!.position.x - lateral, g!.position.z + dist), where).toBeLessThan(1e-5);
              }
    expect(whole).toBe(370);
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
    expect(placeFloorObject(flat, 'n', ROOM, c, { depthM: 0.4, round: true })).toBeNull();
    expect(placeFloorObject(flat, 'n', ROOM, c, { depthM: 0.4 })).toBeNull();
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
    // The ultrawide, so the piece's foot is in the picture (see the round test above).
    const c = WIDE;
    // A piece hard against the far wall: near face at 1.8, so a 1.0 m depth would put
    // its back 0.8 m through the plaster of a wall 2 m away.
    const box = bboxOfFloorBox('n', 0, -1.9, 1.2, 0.95, 0.2, c);
    const tight = placeFloorObject(box, 'n', ROOM, c, { depthM: 1.0 })!;
    const loose = placeFloorObject(box, 'n', ROOM, c, { depthM: 0.2 })!;
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
        const g = placeWallObject(wallBox(lateral, yC, d, wM, hM, depthM, c), 'n', ROOM, c, { depthM })!;
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
    const deep = placeWallObject(wallBox(1.1, 2.3, d, 0.8, 0.28, 0.22, c), 'n', ROOM, c, { depthM: 0.22 })!;
    const asFlat = placeWallObject(wallBox(1.1, 2.3, d, 0.8, 0.28, 0.22, c), 'n', ROOM, c, { depthM: 0 })!;
    expect(deep.widthMM).toBe(800);
    expect(deep.heightMM).toBe(280);
    // Over-read by a fifth of its width and a third of its height.
    expect(asFlat.widthMM / 800).toBeGreaterThan(1.15);
    expect(asFlat.heightMM / 280).toBeGreaterThan(1.25);
  });
});

describe('a box the edge of the photo cut off', () => {
  // The frame's edge is not an edge of the piece: the piece carries on past it by an
  // amount the photo does not hold. So a cut axis is a LOWER bound, and the placers
  // grow it to what a whole one of the kind measures — from the edge the photo DID
  // see, and never past the wall's end or the floor. What the tests below hold is
  // that growth and its three limits, each against the answer with no `whole` at all,
  // so a number here is the placer's own rather than one this file chose.
  const level: CameraCal = { k: 1.2, aspect: 4 / 3 };
  /** A piece's whole box clipped to the frame, which keeps the column of a corner the
   *  frame hid: what a detector returns only where the silhouette crosses the edge
   *  square on, as a wall piece's here does. A floor box is `drawn` instead. */
  const clip = ([x, y, w, h]: readonly number[]): [number, number, number, number] => {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    return [x0, y0, Math.min(1, x + w) - x0, Math.min(1, y + h) - y0];
  };
  /** What a detector returns for a floor box running out of the picture: the outline
   *  inside the frame (§ 49.16, § 49.20). A fixture that photographs one and finds it
   *  out of the picture is a mistake in the fixture. */
  const drawn = (box: Box | null): Box => {
    if (!box) throw new Error('a floor box this test photographs is not in the picture');
    return box;
  };
  const frameN = wallFrame('n', ROOM.footprint)!;

  it('reads a cut from a box within FRAME_EDGE of the frame, and not from one further in', () => {
    expect(frameCuts([0.01, 0.2, 0.3, 0.3])).toEqual({ left: true, right: false, top: false, bottom: false });
    expect(frameCuts([0.011, 0.2, 0.3, 0.3]).left).toBe(false);
    expect(frameCuts([0.6, 0.6, 0.4, 0.4])).toEqual({ left: false, right: true, top: false, bottom: true });
    expect(frameCuts([0.6, 0.6, 0.38, 0.38])).toEqual({ left: false, right: false, top: false, bottom: false });
    // A floor piece's bottom is its foot, which says where it stands and not how tall
    // it is; a wall piece cut at the bottom is short.
    expect(cutAxes([0.3, 0.5, 0.2, 0.5], 'floor')).toEqual({ width: false, height: false });
    expect(cutAxes([0.3, 0.5, 0.2, 0.5], 'wall')).toEqual({ width: false, height: true });
    expect(cutAxes([0, 0, 0.2, 0.5], 'floor')).toEqual({ width: true, height: true });
  });

  it('grows a wall piece cut at the side from the edge it saw, to a whole one', () => {
    // A 1 m print whose left half is past the left of the frame.
    const d = wallD('n', ROOM);
    const box = clip(bboxOfWallSolid('n', 'n', -1.2, 1.5, d, 1.0, 0.6, 0.03, level));
    expect(frameCuts(box).left).toBe(true);
    const foot = { depthM: 0.03 };
    const seen = placeWallObject(box, 'n', ROOM, level, foot)!;
    const grown = placeWallObject(box, 'n', ROOM, level, { ...foot, whole: { widthM: 0.8, heightM: 0.6 } })!;
    // Without a whole one to go on, the part in view — and its seen edge is the print's.
    expect(seen.position.x + seen.widthMM / 2000).toBeCloseTo(-0.7, 9);
    expect(seen.widthMM).toBeLessThan(800);
    // With one: the typical 800, still ending where the photo saw it end.
    expect(grown.widthMM).toBe(800);
    expect(grown.position.x + grown.widthMM / 2000).toBeCloseTo(-0.7, 9);
    // The uncut axis is measured, and a typical height does not touch it.
    expect(grown.heightMM).toBe(seen.heightMM);
    expect(grown.position.y).toBeCloseTo(seen.position.y, 9);
    // A whole one SMALLER than the part in view is no bound at all: what was seen stays.
    const small = placeWallObject(box, 'n', ROOM, level, { ...foot, whole: { widthM: 0.2, heightM: 0.2 } })!;
    expect([small.widthMM, small.position.x]).toEqual([seen.widthMM, seen.position.x]);
  });

  it('stops growing at the end of the wall', () => {
    const d = wallD('n', ROOM);
    const box = clip(bboxOfWallSolid('n', 'n', -1.2, 1.5, d, 1.0, 0.6, 0.03, level));
    // A typical one longer than the plaster between the seen edge and the corner.
    const g = placeWallObject(box, 'n', ROOM, level, { depthM: 0.03, whole: { widthM: 3, heightM: 0.6 } })!;
    expect(g.position.x - g.widthMM / 2000).toBeCloseTo(frameN.left, 9);
    expect(g.widthMM).toBe(Math.round((-0.7 - frameN.left) * 1000));
  });

  it('grows a piece cut on both sides evenly, and slides it inside the wall', () => {
    // The photo saw neither end, so there is no edge to grow from — only the middle it
    // saw. In a room whose east wall was dragged out, the north wall runs −3 to +6
    // and a lens at the origin sees about −1.8 to +1.8 of it.
    const room = dragged('e', 3);
    const f = wallFrame('n', room.footprint)!;
    expect([f.left, f.right]).toEqual([-3, 6]); // premise
    const d = wallD('n', room);
    const box = clip(bboxOfWallSolid('n', 'n', 0, 1.5, d, 20, 0.6, 0.03, level));
    expect(frameCuts(box)).toMatchObject({ left: true, right: true });
    const at = (widthM: number) => {
      const g = placeWallObject(box, 'n', room, level, { depthM: 0.03, whole: { widthM, heightM: 0.6 } })!;
      return [g.position.x - g.widthMM / 2000, g.position.x + g.widthMM / 2000].map((x) => Math.round(x * 1000) / 1000);
    };
    expect(at(5)).toEqual([-2.5, 2.5]); // fits: even
    expect(at(7)).toEqual([-3, 4]); // would pass the west corner: slid back inside
    expect(at(12)).toEqual([-3, 6]); // longer than the wall: the wall
    // Shorter than what was seen: what was seen, read where the print's face is,
    // 30 mm off the plaster (0.6 × 2.97).
    expect(at(1)).toEqual([-1.782, 1.782]);
  });

  it('grows a wall piece cut at the bottom downward, and not through the floor', () => {
    // A curtain from 2.3 m to the floor; a level 1.2 lens sees the wall down to 0.6 m.
    const d = wallD('n', ROOM);
    const box = clip(bboxOfWallSolid('n', 'n', 0.2, 1.15, d, 1.4, 2.3, 0.08, level));
    expect(frameCuts(box)).toEqual({ left: false, right: false, top: false, bottom: true });
    const foot = { depthM: 0.08 };
    const seen = placeWallObject(box, 'n', ROOM, level, foot)!;
    const top = seen.position.y + seen.heightMM / 2000;
    expect(top).toBeCloseTo(2.3, 9);
    const typical = placeWallObject(box, 'n', ROOM, level, { ...foot, whole: { widthM: 1.4, heightM: 2.2 } })!;
    expect(typical.heightMM).toBe(2200);
    expect(typical.position.y + typical.heightMM / 2000).toBeCloseTo(2.3, 9);
    // A typical one taller than the wall below the seen top stands on the floor.
    const tall = placeWallObject(box, 'n', ROOM, level, { ...foot, whole: { widthM: 1.4, heightM: 2.6 } })!;
    expect(tall.heightMM).toBe(2300);
    expect(tall.position.y - tall.heightMM / 2000).toBeCloseTo(0, 9);
    // The width was in view, and is measured whatever the whole one says.
    expect([typical.widthMM, tall.widthMM]).toEqual([1400, 1400]);
  });

  it('grows a wall piece cut at the top upward, and not through the ceiling', () => {
    // A curtain hung from 0.8 m, running out of the top of a frame that sees this
    // wall from 0.6 m to 2.4 m. The room is 2.8 m tall.
    const d = wallD('n', ROOM);
    const box = clip(bboxOfWallSolid('n', 'n', 0.2, 1.75, d, 1.4, 1.9, 0.08, level));
    expect(frameCuts(box)).toEqual({ left: false, right: false, top: true, bottom: false });
    const foot = { depthM: 0.08 };
    const seen = placeWallObject(box, 'n', ROOM, level, foot)!;
    expect(seen.position.y - seen.heightMM / 2000).toBeCloseTo(0.8, 9);
    expect(seen.position.y + seen.heightMM / 2000).toBeLessThan(2.45);
    const typical = placeWallObject(box, 'n', ROOM, level, { ...foot, whole: { widthM: 1.4, heightM: 1.8 } })!;
    expect(typical.heightMM).toBe(1800);
    expect(typical.position.y - typical.heightMM / 2000).toBeCloseTo(0.8, 9);
    // A typical one taller than the wall above the seen foot stops at the ceiling,
    // where before it read 2300 and ran 300 mm through the slab.
    const tall = placeWallObject(box, 'n', ROOM, level, { ...foot, whole: { widthM: 1.4, heightM: 2.3 } })!;
    expect(tall.heightMM).toBe(2000);
    expect(tall.position.y + tall.heightMM / 2000).toBeCloseTo(ROOM.height, 9);
    // A ceiling lower than what the photo saw bounds the assumption, not the
    // measurement: the seen part stays.
    const low = placeWallObject(box, 'n', { ...ROOM, height: 2.0 }, level, { ...foot, whole: { widthM: 1.4, heightM: 2.3 } })!;
    expect(low.heightMM).toBe(seen.heightMM);
    expect(low.position.y).toBeCloseTo(seen.position.y, 9);
  });

  it('places a floor piece cut at the side from its inner edge, where the box alone reads short or below nothing; at the corner, § 49.21 is pinned', () => {
    // A bookshelf against the north wall near its east end, on the ultrawide, cut off
    // at the right. The outer edge is the frame, not the near corner `lateralSpan`
    // takes it for, so the box on its own is a sliver — or, nearer the corner, less
    // than nothing, and refused. Its inner edge is its far-left corner, which the photo
    // did see, so a typical bookshelf grown from there IS this one, to the millimetre.
    const z = -(wallD('n', ROOM) - 0.175);
    const foot = { depthM: 0.35 };
    const whole = { widthM: 0.9, heightM: 1.8 };
    const box = drawn(bboxOfFloorBoxInFrame('n', 2.5, z, 0.9, 1.8, 0.35, WIDE));
    expect(frameCuts(box)).toEqual({ left: false, right: true, top: false, bottom: false });
    expect(placeFloorObject(box, 'n', ROOM, WIDE, foot)!.widthMM).toBeLessThan(200);
    const g = placeFloorObject(box, 'n', ROOM, WIDE, { ...foot, whole })!;
    expect(g.widthMM).toBe(900);
    expect(g.position.x).toBeCloseTo(2.5, 9);
    expect(g.position.z).toBeCloseTo(z, 9);
    expect(g.heightMM).toBe(1800);
    // 0.2 m further east. Refused on its own; grown, it stops at the wall's end rather
    // than stand 150 mm through the east wall.
    const corner = drawn(bboxOfFloorBoxInFrame('n', 2.7, z, 0.9, 1.8, 0.35, WIDE));
    expect(placeFloorObject(corner, 'n', ROOM, WIDE, foot)).toBeNull();
    const c = placeFloorObject(corner, 'n', ROOM, WIDE, { ...foot, whole })!;
    // To the millimetre its width is rounded to.
    expect(c.position.x + c.widthMM / 2000).toBeCloseTo(frameN.right, 3);
    // Its inner edge reads 51 mm east of the truth's 2.25. Here the frame hid the near
    // foot through its side, so the box's bottom row is where the outline crosses that
    // edge and not the foot, and the distance is read there (§ 49.21). The whole box
    // clipped to the frame, as this fixture boxed it until § 49.20, kept the foot's row,
    // and the edge read exact.
    expect(c.position.x - c.widthMM / 2000).toBeCloseTo(2.3011, 4);
  });

  it('reads nothing off a foot-cut box with no height, rather than a width of Infinity', () => {
    // A saved record keeps its box raw when the frame clip refuses it, so a box whose
    // bottom row is above its top can still reach the placer. Its side has nothing above
    // the bottom row, so there is no side to read: at 10° and 20° up, an empty side read
    // as a width of Infinity at no position.
    const box: [number, number, number, number] = [0.4, 1.0, 0.2, -0.004];
    expect(frameCuts(box).bottom).toBe(true);
    for (const tilt of [-10, -20]) {
      const cal = { ...WIDE, tiltRad: (tilt * Math.PI) / 180 };
      expect(placeFloorObject(box, 'n', ROOM, cal, { depthM: 0.4 })).toBeNull();
    }
  });

  it('never slides a grown piece off the part of it the photo saw', () => {
    // A floor piece's lateral is measured, so a sighting can reach past the end of a
    // wall the room says is there — here the north wall starts at x = −1 and the photo
    // saw the piece from about −1.33. Growing it is an assumption; sliding it back
    // inside the wall would trim what was seen to make room for what was assumed.
    const room = dragged('w', -2);
    expect(wallFrame('n', room.footprint)!.left).toBe(-1); // premise
    const low = { ...WIDE, height: 0.6 }; // low enough that its foot is in frame
    const box = drawn(bboxOfFloorBoxInFrame('n', 0, -1.3, 10, 0.5, 0.6, low));
    expect(frameCuts(box)).toEqual({ left: true, right: true, top: false, bottom: false });
    const foot = { depthM: 0.6 };
    const seen = placeFloorObject(box, 'n', room, low, foot)!;
    const seenLeft = seen.position.x - seen.widthMM / 2000;
    expect(seenLeft).toBeLessThan(-1.3);
    const g = placeFloorObject(box, 'n', room, low, { ...foot, whole: { widthM: 3.5, heightM: 0.5 } })!;
    expect(g.widthMM).toBe(3500);
    expect(g.position.x - g.widthMM / 2000).toBeCloseTo(seenLeft, 3);
  });

  it('bounds the near face of a floor piece cut at the bottom by the wall behind it', () => {
    // At a level 1.2 lens the floor of this room is never in view: the bottom row of
    // the frame meets it past the far wall, so every floor piece is cut at the bottom
    // and its near face is not measured. It is bounded — the piece stands in front of
    // the wall, so its near face is at most a depth short of it — and for a piece
    // against the wall that bound is exact.
    const d = wallD('n', ROOM);
    const box = drawn(bboxOfFloorBoxInFrame('n', 0.3, -(d - 0.25), 1.2, 0.95, 0.5, level));
    expect(frameCuts(box).bottom).toBe(true);
    const g = placeFloorObject(box, 'n', ROOM, level, { depthM: 0.5 })!;
    expect(g.distance).toBeCloseTo(d - 0.25, 9);
    // Measured at the right distance, the width is the piece's — read at the wall
    // instead it would be a third too wide.
    expect(g.widthMM).toBe(1200);
    expect(g.heightMM).toBe(950);
    expect(g.position.x).toBeCloseTo(0.3, 9);
  });

  it('grows a floor piece cut at the top to a whole one, and keeps a taller one as seen', () => {
    // A 2.4 m wardrobe against the wall, whose top runs out of a level 1.2 frame.
    const d = wallD('n', ROOM);
    const box = drawn(bboxOfFloorBoxInFrame('n', -0.5, -(d - 0.3), 1.0, 2.4, 0.6, level));
    expect(frameCuts(box).top).toBe(true);
    const foot = { depthM: 0.6 };
    const seen = placeFloorObject(box, 'n', ROOM, level, foot)!;
    // The part in view: up to where the frame's top row crosses its near face.
    expect(seen.heightMM).toBe(2130);
    const grown = placeFloorObject(box, 'n', ROOM, level, { ...foot, whole: { widthM: 1.0, heightM: 2.3 } })!;
    expect(grown.heightMM).toBe(2300);
    // The width was in view: measured, whatever the typical one says.
    expect(grown.widthMM).toBe(1000);
    const short = placeFloorObject(box, 'n', ROOM, level, { ...foot, whole: { widthM: 1.0, heightM: 1.0 } })!;
    expect(short.heightMM).toBe(seen.heightMM);
  });

  it('grows a floor piece cut at the top only as far as the ceiling, and keeps what it saw', () => {
    // The same wardrobe in a 2.2 m room — low, or a rough ceiling guess. Grown to a
    // typical 2.3 m it would stand 100 mm through the slab, and it did.
    const d = wallD('n', ROOM);
    const box = drawn(bboxOfFloorBoxInFrame('n', -0.5, -(d - 0.3), 1.0, 2.4, 0.6, level));
    const foot = { depthM: 0.6, whole: { widthM: 1.0, heightM: 2.3 } };
    const low = { ...ROOM, height: 2.2 };
    const g = placeFloorObject(box, 'n', low, level, foot)!;
    expect(g.heightMM).toBe(2200);
    expect(g.widthMM).toBe(1000);
    // Lower than what the photo saw, the ceiling bounds nothing: 2130 was measured.
    const lower = placeFloorObject(box, 'n', { ...ROOM, height: 2.0 }, level, foot)!;
    expect(lower.heightMM).toBe(2130);
    // Only a cut piece grows at all: one whose top is in view is its own height,
    // however tall a typical one is and however much room the ceiling leaves.
    const chest = drawn(bboxOfFloorBoxInFrame('n', -0.5, -(d - 0.3), 1.0, 0.9, 0.6, level));
    expect(frameCuts(chest).top).toBe(false);
    expect(placeFloorObject(chest, 'n', low, level, foot)!.heightMM).toBe(900);
  });

  it('grows a cut piece unbounded in a room with no usable height, rather than into NaN', () => {
    // `migrateRoom` does not validate a height, and `Math.min(x, NaN)` is NaN: before
    // the guard both placers answered a NaN height, and the wall one a NaN position.
    const d = wallD('n', ROOM);
    const wardrobe = drawn(bboxOfFloorBoxInFrame('n', -0.5, -(d - 0.3), 1.0, 2.4, 0.6, level));
    const curtain = clip(bboxOfWallSolid('n', 'n', 0.2, 1.75, d, 1.4, 1.9, 0.08, level));
    const whole = { widthM: 1.4, heightM: 2.3 };
    for (const height of [Number.NaN, 0]) {
      const room = { ...ROOM, height };
      const g = placeFloorObject(wardrobe, 'n', room, level, { depthM: 0.6, whole })!;
      expect(g.heightMM).toBe(2300);
      const w = placeWallObject(curtain, 'n', room, level, { depthM: 0.08, whole })!;
      expect(w.heightMM).toBe(2300);
      expect(w.position.y - w.heightMM / 2000).toBeCloseTo(0.8, 9);
    }
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

  const kOf = (hfovDeg: number) => 2 * Math.tan(((hfovDeg / 2) * Math.PI) / 180);
  const hfovOf = (k: number) => (2 * Math.atan(k / 2) * 180) / Math.PI;

  it('lays the lens across the LONG side, whichever way the phone was held', () => {
    // The independent half: EXIF's own conversion apportions the 35 mm diagonal by the
    // photo's aspect, so the same lens held upright has a narrower horizontal field. The
    // default must turn by the same ratio, and this never reads `defaultCal`'s arithmetic.
    for (const [wide, tall] of [[4 / 3, 3 / 4], [16 / 9, 9 / 16], [3 / 2, 2 / 3]]) {
      const exif = kOf(hfovFromFocal35(26, tall)!) / kOf(hfovFromFocal35(26, wide)!);
      expect(defaultCal(tall).k / defaultCal(wide).k).toBeCloseTo(exif, 9);
      expect(defaultCal(tall).aspect).toBe(tall);
      expect(defaultCal(wide).k).toBe(defaultCal(4 / 3).k);
    }
    expect(defaultCal(1).k).toBe(defaultCal(4 / 3).k);
  });

  it('reads an UPRIGHT photo at its real size — measured, against the lens it was taken on', () => {
    // The phone whose landscape field IS the default, found by bisection on EXIF's
    // conversion, then held upright. A 4 × 6 m room so a level lens 3 m from the wall
    // sees a chest of drawers whole; every box is checked uncut, so the error measured
    // is the lens and nothing else.
    const landscape = hfovOf(defaultCal(4 / 3).k);
    let lo = 10;
    let hi = 60;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (hfovFromFocal35(mid, 4 / 3)! > landscape) lo = mid;
      else hi = mid;
    }
    const truth = calFromHfov(hfovFromFocal35(lo, 3 / 4)!, 3 / 4);
    const fp = footprintForLayout('rect', 4, 6);
    const d = 3;
    // What the default returned for this photo before it turned with the phone.
    const before: CameraCal = { k: defaultCal(4 / 3).k, aspect: 3 / 4 };
    const pieces = [
      { name: 'print', wall: true, w: 0.7, h: 0.5, depth: 0.03, box: bboxOfWallSolid('n', 'n', 0.3, 1.5, d, 0.7, 0.5, 0.03, truth) },
      { name: 'TV', wall: true, w: 1.1, h: 0.65, depth: 0.06, box: bboxOfWallSolid('n', 'n', -0.2, 1.2, d, 1.1, 0.65, 0.06, truth) },
      { name: 'chest', wall: false, w: 0.8, h: 0.9, depth: 0.45, x: 0.4, z: -d + 0.225, box: bboxOfFloorBox('n', 0.4, -d + 0.225, 0.8, 0.9, 0.45, truth) },
    ];
    const read = (cal: CameraCal) =>
      pieces.map((p) => {
        const g = (p.wall ? placeWallObject : placeFloorObject)(p.box, 'n', { height: 2.8, footprint: fp }, cal, { depthM: p.depth })!;
        const off = p.wall ? 0 : Math.hypot(g.position.x - p.x!, g.position.z - p.z!);
        return { name: p.name, w: g.widthMM / (p.w * 1000) - 1, h: g.heightMM / (p.h * 1000) - 1, off };
      });
    for (const p of pieces) expect(inFrame(p.box)).toBe(true);
    const was = read(before);
    const now = read(defaultCal(3 / 4));
    const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
    console.log(
      'upright photo on the assumed lens, before → after:\n' +
        was.map((b, i) => `  ${b.name.padEnd(6)} width ${pct(b.w)} → ${pct(now[i].w)}, height ${pct(b.h)} → ${pct(now[i].h)}${b.off ? `, off by ${b.off.toFixed(2)} → ${now[i].off.toFixed(2)} m` : ''}`).join('\n'),
    );
    for (const r of now) {
      expect(Math.abs(r.w)).toBeLessThan(0.01);
      expect(Math.abs(r.h)).toBeLessThan(0.01);
      expect(r.off).toBeLessThan(0.01);
    }
    // The fixture can express the defect: read on the old default, the wall pieces
    // came back a third too big and the chest stood well off its wall.
    expect(was[0].w).toBeGreaterThan(0.25);
    expect(was[1].w).toBeGreaterThan(0.25);
    expect(was[2].off).toBeGreaterThan(0.3);
  });

  it('is the lens the ladder falls back to for an upright photo with nothing else to go on', () => {
    const cal = calForPhoto(
      { aspect: 3 / 4, view: {}, exifHfov: null, vanishing: null, floorLine: null },
      'n',
      footprintForLayout('rect', 4, 6),
    );
    expect(cal).toEqual(defaultCal(3 / 4));
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
      const g = placeFloorObject(box, 'n', ROOM, cal, CARD)!;
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
      const g = placeFloorObject(bboxOfFloorObject('n', 0.8, -1.5, 1.6, 0.9, cal), 'n', ROOM, cal, CARD)!;
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
      const naive = placeFloorObject(box, 'n', ROOM, { k: cal.k, aspect: cal.aspect }, CARD)!;
      const aware = placeFloorObject(box, 'n', ROOM, cal, CARD)!;
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
      const g = placeWallObject(box, 'n', ROOM, cal, CARD)!;
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
    const right = placeFloorObject(box, 'n', ROOM, cal, CARD)!;
    expect(right.position.z).toBeCloseTo(-1.5, 6);
    expect(right.widthMM).toBeCloseTo(1600, -1);

    const assumed = placeFloorObject(box, 'n', ROOM, { k: cal.k, aspect: cal.aspect }, CARD)!;
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

describe('a floor line ties the height to the lens', () => {
  // A 106° photo taken 1.3 m up, of the north wall 2 m away, on a phone that wrote
  // no focal length. One line is one equation in the lens and the height, so
  // whichever of the two it was spent on is that other one's answer only.
  const TRUE: CameraCal = { ...WIDE, height: 1.3 };
  const [, vFloor] = project('n', 0, 0, -2, TRUE);
  const K40 = 2 * Math.tan((20 * Math.PI) / 180);

  it('keeps the line where it solved against an assumed unknown, and only there', () => {
    expect(calibrateFromFloorLine(vFloor, 'n', ROOM.footprint, WIDE.aspect)!.floorLine).toBe(vFloor);
    const fitted = fitHeightToFloorLine(vFloor, 'n', ROOM.footprint, WIDE)!;
    expect(fitted.floorLine).toBe(vFloor);
    expect(fitted.height).toBeCloseTo(1.3, 9);
    // A height the person gave holds, so the line only solved the lens, and it is
    // doubted along with it.
    expect('floorLine' in calibrateFromFloorLine(vFloor, 'n', ROOM.footprint, WIDE.aspect, { height: 1.3 })!).toBe(false);
    expect(fitHeightToFloorLine(0.55, 'n', ROOM.footprint, { k: 1.2, aspect: 0.75 })).toBeNull();
  });

  it('re-asks the line at another lens, so the true lens gives back the true height', () => {
    // Against the assumed 1.5 m the line reads a lens too wide; carried to the true
    // lens, that 1.5 m would be a camera the photo contradicts.
    const solved = calibrateFromFloorLine(vFloor, 'n', ROOM.footprint, WIDE.aspect)!;
    expect(solved.k).toBeGreaterThan(WIDE.k * 1.1);
    const back = atLens(solved, WIDE.k, 'n', ROOM.footprint)!;
    expect(back.k).toBe(WIDE.k);
    expect(back.height).toBeCloseTo(1.3, 9);
    expect(back.floorLine).toBe(vFloor);
    // So every lens on the line sees a floor point at the same distance: here, the
    // foot of the wall itself.
    for (const k of [WIDE.k, 2.2, 3.2]) {
      const c = atLens(solved, k, 'n', ROOM.footprint)!;
      expect(project('n', 0, 0, -2, c)[1], `k ${k}`).toBeCloseTo(vFloor, 9);
    }
  });

  it('refuses a lens the line would need a camera out of reach for', () => {
    // At 40° the same line is a camera 0.36 m off the floor.
    const solved = calibrateFromFloorLine(vFloor, 'n', ROOM.footprint, WIDE.aspect)!;
    expect(atLens(solved, K40, 'n', ROOM.footprint)).toBeNull();
  });

  it('swaps the lens alone where nothing ties them', () => {
    const held: CameraCal = { ...WIDE, height: 1.3, tiltRad: 0.05, lens: 'assumed' };
    expect(atLens(held, K40, 'n', ROOM.footprint)).toEqual({ ...held, k: K40 });
  });
});

describe('calFromHfov', () => {
  it('round-trips a 35 mm-equivalent focal length into a usable calibration', () => {
    const cal = calFromHfov(hfovFromFocal35(26, 4 / 3)!, 4 / 3);
    const g = placeFloorObject(bboxOfFloorObject('n', 0, -1.2, 1.0, 0.8, cal), 'n', ROOM, cal, CARD)!;
    expect(g.position.z).toBeCloseTo(-1.2, 6);
    expect(g.widthMM).toBeCloseTo(1000, -1);
  });

  it('halves a wall-mounted TV when an ultrawide shot is read as 66°', () => {
    // Where the assumed FOV really hurts. A wall item's distance is PINNED to the
    // wall rather than derived from its bottom edge, so the angular size is not
    // divided back out and the whole error lands on the measurement.
    const wide = calFromHfov(hfovFromFocal35(13, 4 / 3)!, 4 / 3);
    const box = bboxOfWallPanel('n', 0, 1.4, -2, 1.4, 0.8, wide);
    const right = placeWallObject(box, 'n', ROOM, wide, CARD)!;
    const assumed = placeWallObject(box, 'n', ROOM, defaultCal(4 / 3), CARD)!;
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
    const right = placeFloorObject(box, 'n', ROOM, wide, CARD)!;
    const assumed = placeFloorObject(box, 'n', ROOM, defaultCal(4 / 3), CARD)!;
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
    const right = placeFloorObject(box, 'n', ROOM, wide, CARD)!;
    const assumed = placeFloorObject(box, 'n', ROOM, defaultCal(4 / 3), CARD)!;
    expect(assumed.distance).toBe(wallD('n', ROOM));
    expect(assumed.widthMM).toBeLessThan(right.widthMM * 0.7);
  });
});

describe('pickLens', () => {
  it('calls a lens measured only when EXIF gave it', () => {
    // A measured lens is held still by the repeat check and an assumed one is swept
    // across every lens a phone could have, so this one word decides whether one
    // piece seen from two walls can come back together.
    expect(pickLens(78, 95)).toEqual({ hfov: 78, lens: 'measured' });
    expect(pickLens(78, null)).toEqual({ hfov: 78, lens: 'measured' });
    expect(pickLens(null, 95)).toEqual({ hfov: 95, lens: 'assumed' });
    expect(pickLens(null, null)).toBeNull();
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
    // Near enough that the top of the frame cuts it, boxed as a detector would box it.
    const box = bboxOfCeilingDiscInFrame('e', 1.2, 0, 1.1, WIDE, ROOM.height)!;
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
describe('placeCeilingObject · a disc the top of the frame cut (§ 49.13)', () => {
  // One room, one photo, every disc the sweep can put on its ceiling: three sizes on a
  // 0.5 × 0.1 m grid, level and tipped up 10° and 20° and down 5°, on the 106° lens a
  // ceiling needs. The 6 m depth is what lets a disc sit near enough for the top of
  // the frame to cut it and far enough for the rest to be in view.
  const SQUARE = { height: 2.8, footprint: footprintForLayout('rect', 6, 6) };
  const RISE = SQUARE.height - CAM_HEIGHT;
  type Fixture = { cal: CameraCal; D: number; x: number; z: number; box: Box };
  const fixtures: Fixture[] = [];
  for (const tiltDeg of [0, -10, -20, 5]) {
    const cal: CameraCal = { ...WIDE, tiltRad: (tiltDeg * Math.PI) / 180 };
    for (const D of [0.9, 1.2, 1.5]) {
      for (let xi = -20; xi <= 20; xi += 5) {
        for (let zi = 5; zi <= 29; zi++) {
          const x = xi / 10;
          const z = -zi / 10;
          if (Math.abs(x) + D / 2 > 3 || Math.abs(z) + D / 2 > 3) continue;
          const box = bboxOfCeilingDiscInFrame('n', x, z, D, cal, SQUARE.height);
          if (box && box[2] > 0.01 && box[3] > 0.01) fixtures.push({ cal, D, x, z, box });
        }
      }
    }
  }
  const underTop = (b: Box) => {
    const c = frameCuts(b);
    return c.top && !c.left && !c.right && !c.bottom;
  };
  const uncut = fixtures.filter((f) => !cutByFrame(f.box));
  const topCut = fixtures.filter((f) => underTop(f.box));

  /** What the placer read before § 49.13, on every box: the ray through the box's
   *  middle row, where it meets the slab. Written out here so the BEFORE figures can
   *  be printed beside the after — and checked against the placer itself on every
   *  whole disc, where it still reads exactly this, so they are the placer's own
   *  figures and not a second implementation's. */
  const middleRow = (b: Box, cal: CameraCal) => {
    const th = cal.tiltRad ?? 0;
    const tanUp = ((0.5 - (b[1] + b[3] / 2)) * cal.k) / cal.aspect;
    const t = RISE / (tanUp * Math.cos(th) - Math.sin(th));
    return {
      x: t * (b[0] + b[2] / 2 - 0.5) * cal.k,
      z: -t * (tanUp * Math.sin(th) + Math.cos(th)),
      widthMM: Math.round(t * b[2] * cal.k * 1000),
    };
  };
  /** Twice `DISC_FIT` (`lib/photo-geometry.ts`): a box shorter than this is not solved. */
  const SLIVER = 0.04;
  const readErr = (g: { widthMM: number }, D: number) => Math.abs(g.widthMM / 1000 / D - 1);
  const posErr = (g: { x: number; z: number }, f: Fixture) => Math.hypot(g.x - f.x, g.z - f.z);

  it('draws the box a detector draws: the disc’s box clipped to the frame is wider', () => {
    expect([fixtures.length, uncut.length, topCut.length]).toEqual([1894, 636, 556]);
    // Where nothing is cut the two helpers must agree, which is what validates the
    // new one against the proven one rather than trusting they were written to match.
    let worst = 0;
    for (const f of uncut) {
      const whole = bboxOfCeilingDisc('n', f.x, f.z, f.D, f.cal, SQUARE.height);
      worst = Math.max(worst, ...whole.map((v, i) => Math.abs(v - f.box[i])));
    }
    expect(worst).toBeLessThan(1e-5);
    // Where the top is cut, clipping the disc's own box keeps widest points the frame
    // cut away. 415 of the 556 are narrower drawn as they are seen; the other 141 are
    // cut short of their widest points, and there the two boxes are one box.
    const clip = (b: Box): Box => {
      const y0 = Math.max(0, b[1]);
      return [b[0], y0, b[2], b[1] + b[3] - y0];
    };
    const narrower = topCut.filter((f) => {
      const clipped = clip(bboxOfCeilingDisc('n', f.x, f.z, f.D, f.cal, SQUARE.height));
      return f.box[2] < clipped[2] - 1e-6;
    });
    expect(narrower).toHaveLength(415);
  });

  it('reads every other disc on its middle row, as before — which is how the before figures are the placer’s own', () => {
    // Whole, cut at a side, and cut at the top AND a side: only a cut at the top alone
    // is solved, so everywhere else the placer must still be the middle row exactly.
    const rest = fixtures.filter((f) => !underTop(f.box));
    expect(rest.filter((f) => !cutByFrame(f.box))).toHaveLength(636);
    let read = 0;
    for (const f of rest) {
      const g = placeCeilingObject(f.box, 'n', SQUARE, f.cal);
      if (!g) continue;
      read++;
      const m = middleRow(f.box, f.cal);
      expect(g.position.x).toBeCloseTo(m.x, 9);
      expect(g.position.z).toBeCloseTo(m.z, 9);
      expect(g.widthMM).toBe(m.widthMM);
    }
    expect(read).toBe(1338);
  });

  it('reads a disc the top cut exactly, where the middle row read it 18% wide and 273 mm out — all but the slivers', () => {
    let worstW = 0;
    let worstP = 0;
    let beforeW = 0;
    let beforeP = 0;
    let beforeOver10 = 0;
    let nowW = 0;
    let nowP = 0;
    let nowOver10 = 0;
    let slivers = 0;
    for (const f of topCut) {
      const g = placeCeilingObject(f.box, 'n', SQUARE, f.cal)!;
      const m = middleRow(f.box, f.cal);
      if (f.box[3] < SLIVER) {
        // Too thin to solve from, so read as before (see the noisy sweep below for why).
        slivers++;
        expect(g.widthMM).toBe(m.widthMM);
        expect(g.position.z).toBeCloseTo(m.z, 9);
      } else {
        worstW = Math.max(worstW, Math.abs(g.widthMM - f.D * 1000));
        worstP = Math.max(worstP, posErr(g.position, f));
      }
      nowW += readErr(g, f.D);
      nowP += posErr(g.position, f);
      if (readErr(g, f.D) > 0.1) nowOver10++;
      beforeW += readErr(m, f.D);
      beforeP += posErr(m, f);
      if (readErr(m, f.D) > 0.1) beforeOver10++;
    }
    const n = topCut.length;
    console.log(
      `§ 49.13 · ${n} discs cut at the top · middle row ${((100 * beforeW) / n).toFixed(1)}% wide, ` +
        `${((1000 * beforeP) / n).toFixed(0)} mm out, ${beforeOver10} past 10% · now ${((100 * nowW) / n).toFixed(1)}%, ` +
        `${((1000 * nowP) / n).toFixed(0)} mm, ${nowOver10} past 10%, exact on ${n - slivers} (worst ${worstW} mm wide, ` +
        `${(1000 * worstP).toExponential(1)} mm out) and ${slivers} slivers as before`,
    );
    expect(slivers).toBe(43);
    expect(worstW).toBe(0);
    // The helper finds a chord's ends by bisection and the rim by 1440 samples, so
    // exact means to a few thousandths of a millimetre.
    expect(worstP).toBeLessThan(1e-5);
    expect((100 * beforeW) / n).toBeCloseTo(17.9, 1);
    expect((1000 * beforeP) / n).toBeCloseTo(273, 0);
    expect(beforeOver10).toBe(397);
    expect((100 * nowW) / n).toBeCloseTo(4.1, 1);
    expect((1000 * nowP) / n).toBeCloseTo(42, 0);
    expect(nowOver10).toBe(43);
  });

  it('with every seen edge moved by up to 2% of the frame, halves both errors and reads no box past twice its width', () => {
    // A cloud model's box is often this far out. Eight draws a disc from a fixed seed;
    // the cut edge stays where it is, because the frame is not noisy. A box no disc
    // under the cut draws is read on the middle row, as before — and that is
    // recognisable from outside, as an answer equal to the middle row's.
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const NOISE = 0.02;
    let n = 0;
    let fellBack = 0;
    let w = 0;
    let p = 0;
    let beforeW = 0;
    let beforeP = 0;
    let fallbackW = 0;
    // The tail, which a mean can hide: reads more than twice the real width, and
    // reads more than 25 points worse than the middle row's on the same box.
    let over100 = 0;
    let beforeOver100 = 0;
    let worse25 = 0;
    let worst = 0;
    for (const f of topCut) {
      for (let k = 0; k < 8; k++) {
        const j = () => (rand() * 2 - 1) * NOISE;
        const x0 = f.box[0] + j();
        const x1 = f.box[0] + f.box[2] + j();
        const y1 = f.box[1] + f.box[3] + j();
        const box: Box = [x0, f.box[1], x1 - x0, y1 - f.box[1]];
        if (!(box[2] > 0.005 && box[3] > 0.005)) continue;
        n++;
        const g = placeCeilingObject(box, 'n', SQUARE, f.cal)!;
        const m = middleRow(box, f.cal);
        const same = g.widthMM === m.widthMM && Math.abs(g.position.z - m.z) < 1e-9;
        if (same) {
          fellBack++;
          fallbackW += readErr(m, f.D);
        }
        w += readErr(g, f.D);
        p += posErr(g.position, f);
        if (readErr(g, f.D) > 1) over100++;
        if (readErr(m, f.D) > 1) beforeOver100++;
        if (readErr(g, f.D) - readErr(m, f.D) > 0.25) worse25++;
        worst = Math.max(worst, readErr(g, f.D));
        beforeW += readErr(m, f.D);
        beforeP += posErr(m, f);
      }
    }
    console.log(
      `§ 49.13 · ${n} noisy boxes · middle row ${((100 * beforeW) / n).toFixed(1)}% / ${((1000 * beforeP) / n).toFixed(0)} mm · ` +
        `now ${((100 * w) / n).toFixed(1)}% / ${((1000 * p) / n).toFixed(0)} mm · ${fellBack} fell back, ` +
        `read ${((100 * fallbackW) / fellBack).toFixed(1)}% there · worst ${(100 * worst).toFixed(0)}%, ` +
        `${over100} past 100% (middle row ${beforeOver100}), ${worse25} more than 25 points worse than the middle row`,
    );
    expect(n).toBe(4407);
    expect(fellBack).toBe(446);
    expect((100 * beforeW) / n).toBeCloseTo(18.1, 1);
    expect((1000 * beforeP) / n).toBeCloseTo(274, 0);
    expect((100 * w) / n).toBeCloseTo(9.5, 1);
    expect((1000 * p) / n).toBeCloseTo(117, 0);
    // Where it falls back it reads as the middle row always did: no better, no worse.
    expect((100 * fallbackW) / fellBack).toBeCloseTo(39.2, 1);
    // Without the sliver rule: 16 past 100%, the worst 222%, and 60 more than 25 points worse.
    expect(over100).toBe(0);
    expect(beforeOver100).toBe(0);
    expect(worst).toBeLessThan(0.75);
    expect(worse25).toBe(22);
  });

  it('falls back on the middle row where no disc under the cut draws the box', () => {
    // A 500 mm pendant whose whole shade is in frame, boxed by a second model that
    // took in its flex up to the top of the picture: the box touches the frame's
    // edge and no disc cut there draws it. Refused, the row would keep no position
    // and could not merge with the other photo's sighting of the same light.
    const cal = WIDE;
    const shade = bboxOfCeilingDiscInFrame('n', 0.5, -2.2, 0.5, cal, SQUARE.height)!;
    expect(frameCuts(shade).top, 'premise: the shade itself is not cut').toBe(false);
    const flex: Box = [shade[0], 0, shade[2], shade[1] + shade[3]];
    const g = placeCeilingObject(flex, 'n', SQUARE, cal)!;
    const m = middleRow(flex, cal);
    expect(g.widthMM).toBe(m.widthMM);
    expect(g.position.z).toBeCloseTo(m.z, 9);
  });

  it('reads a disc whose centre is behind the pivot, which a lens tipped down puts ahead of it', () => {
    // Tipped down 5°, every column's line meets the slab 114 mm ahead of the lens. A
    // 3 m disc centred 100 mm ahead is behind that point, and a 120° frame still shows
    // only the part of it well ahead of both. The first version refused every centre
    // behind the pivot. Restoring that filter today refuses 13 discs tall enough to read
    // in the wider sweep, every one on this lens tipped down, and changes 2 more over the
    // lens.
    const cal: CameraCal = { k: 2 * Math.tan((60 * Math.PI) / 180), aspect: 4 / 3, tiltRad: (5 * Math.PI) / 180 };
    expect(RISE * Math.tan(cal.tiltRad!), 'premise: the pivot is past the centre').toBeGreaterThan(0.1);
    const box = bboxOfCeilingDiscInFrame('n', 0, -0.1, 3, cal, SQUARE.height)!;
    expect(underTop(box), 'premise: cut at the top only').toBe(true);
    expect(box[3], 'premise: not a sliver').toBeGreaterThanOrEqual(SLIVER);
    const g = placeCeilingObject(box, 'n', SQUARE, cal)!;
    expect(g.widthMM).toBe(3000);
    expect(g.position.x).toBeCloseTo(0, 5);
    expect(g.position.z).toBeCloseTo(-0.1, 5);
  });

  it('leaves a disc right over the lens to the middle row, because nothing is placed there', () => {
    // Its centre is 0 ahead, and `placeCeilingObject` refuses a distance that is not
    // ahead of the lens — so taking the true disc would drop the row's position, the
    // thing the fallback exists to keep. 63 of 6205 boxes in the wider sweep, slivers aside.
    const cal: CameraCal = { k: 2 * Math.tan((40 * Math.PI) / 180), aspect: 4 / 3, tiltRad: (-10 * Math.PI) / 180 };
    const box = bboxOfCeilingDiscInFrame('n', 0, 0, 3, cal, SQUARE.height)!;
    expect(underTop(box), 'premise: cut at the top only').toBe(true);
    const g = placeCeilingObject(box, 'n', SQUARE, cal)!;
    const m = middleRow(box, cal);
    expect(g.widthMM).toBe(m.widthMM);
    expect(g.position.z).toBeCloseTo(m.z, 9);
  });

  it('leaves a disc centred behind the lens to the middle row, rather than refusing it', () => {
    // Tipped 45° up, the frame's top edge looks past the vertical, so a 1.2 m disc
    // centred 200 mm BEHIND the lens is cut at the top with its far rim well ahead. The
    // true disc is behind the lens, where nothing is placed; taking it would refuse a
    // row the middle row places, and lose the position the merge needs. 178 of 473 such
    // discs in a sweep of lenses tipped up 10° to 75°.
    const cal: CameraCal = { ...WIDE, tiltRad: (-45 * Math.PI) / 180 };
    const box = bboxOfCeilingDiscInFrame('n', 0, 0.2, 1.2, cal, SQUARE.height)!;
    expect(underTop(box), 'premise: cut at the top only').toBe(true);
    expect(box[3], 'premise: not a sliver').toBeGreaterThanOrEqual(SLIVER);
    const g = placeCeilingObject(box, 'n', SQUARE, cal)!;
    const m = middleRow(box, cal);
    expect(m.z, 'premise: the middle row reads it ahead of the lens').toBeLessThan(0);
    expect(g.widthMM).toBe(m.widthMM);
    expect(g.position.z).toBeCloseTo(m.z, 9);
  });

  it('reads a box a detector ran past the top as the box the photo shows, once clipped (§ 49.15)', () => {
    // A model regresses a box for a piece the frame cuts, and nothing stops that box
    // running past the edge. Run every top-cut box past the frame by d, then hand it to
    // the placer as the on-device detector used to (near edge set to the frame, size
    // kept, so the far edge moves down by d), as the cloud rows used to (not clipped at
    // all), and through `clipToFrame`. The solve stands on the far edge, the disc's far
    // rim, and on the top row, the frame's own edge: the first way moves one, the
    // second the other.
    expect(topCut.every((f) => f.box[1] === 0), 'premise: every one of them is cut, not inside the edge band').toBe(true);
    const run = (f: Fixture, d: number): Box => [f.box[0], -d, f.box[2], f.box[3] + d];
    const sizeKept = (b: Box): Box => [Math.max(0, Math.min(1, b[0])), Math.max(0, Math.min(1, b[1])), Math.min(1, b[2]), Math.min(1, b[3])];
    const read = (d: number, hand: (b: Box) => Box) => {
      let w = 0;
      let p = 0;
      let past = 0;
      for (const f of topCut) {
        const g = placeCeilingObject(hand(run(f, d)), 'n', SQUARE, f.cal)!;
        w += readErr(g, f.D);
        p += posErr(g.position, f);
        if (readErr(g, f.D) > 0.1) past++;
      }
      const n = topCut.length;
      return `${((100 * w) / n).toFixed(1)}% / ${((1000 * p) / n).toFixed(0)} mm / ${past}`;
    };
    const asSeen = read(0, (b) => b);
    const kept = [read(0.01, sizeKept), read(0.02, sizeKept)];
    const raw = [read(0.01, (b) => b), read(0.02, (b) => b)];
    console.log(`§ 49.15 · ${topCut.length} top-cut discs · as seen ${asSeen} · run 1% / 2% past the top: size kept ${kept.join(', ')} · unclipped ${raw.join(', ')}`);
    expect(asSeen).toBe('4.1% / 42 mm / 43');
    expect(kept).toEqual(['7.1% / 102 mm / 70', '9.9% / 155 mm / 116']);
    expect(raw).toEqual(['6.4% / 54 mm / 78', '8.2% / 58 mm / 133']);
    // Clipped, the overrun is gone: every reading is the one the photo's own box gives.
    for (const d of [0.005, 0.01, 0.02, 0.05]) {
      for (const f of topCut) {
        const g = placeCeilingObject(clipToFrame(run(f, d))!, 'n', SQUARE, f.cal)!;
        const want = placeCeilingObject(f.box, 'n', SQUARE, f.cal)!;
        expect(g.widthMM).toBe(want.widthMM);
        expect(g.position.x).toBeCloseTo(want.position.x, 9);
        expect(g.position.z).toBeCloseTo(want.position.z, 9);
      }
    }
  });

  it('reads a disc cut at the top AND the bottom on its middle row', () => {
    // Tipped 60° up, a 66° frame is filled by a 2 m disc: no far edge in view, so
    // there is nothing to solve from and the placer must not try.
    const cal: CameraCal = { k: 2 * Math.tan((33 * Math.PI) / 180), aspect: 4 / 3, tiltRad: (-60 * Math.PI) / 180 };
    const box = bboxOfCeilingDiscInFrame('n', 0, -1.1, 2, cal, SQUARE.height)!;
    const cuts = frameCuts(box);
    expect([cuts.top, cuts.bottom, cuts.left, cuts.right], 'premise: top and bottom').toEqual([true, true, false, false]);
    const g = placeCeilingObject(box, 'n', SQUARE, cal)!;
    const m = middleRow(box, cal);
    expect(g.widthMM).toBe(m.widthMM);
    expect(g.position.z).toBeCloseTo(m.z, 9);
  });
});

describe('clipToFrame · a detector’s box is what is in the photo (§ 49.15)', () => {
  it('keeps a box inside the frame exactly as it is', () => {
    // Exactly, not to a tolerance: every whole box in every pinned table passes through
    // this, and a box rebuilt from its corners moves in its last bit.
    expect(clipToFrame([0.2, 0.3, 0.4, 0.5])).toEqual([0.2, 0.3, 0.4, 0.5]);
    expect(clipToFrame([0, 0, 1, 1])).toEqual([0, 0, 1, 1]);
  });

  it('cuts a box that runs past an edge at that edge, and keeps the far one where it was', () => {
    // Past the top: the bottom row stays at 0.45. The clamp this replaced kept the
    // height, which put the bottom at 0.5.
    const top = clipToFrame([0.2, -0.05, 0.3, 0.5])!;
    expect(top[1]).toBe(0);
    expect(top[1] + top[3]).toBeCloseTo(0.45, 12);
    expect(top[0] + top[2]).toBeCloseTo(0.5, 12);
    // Past the left: the right edge stays at 0.3.
    const left = clipToFrame([-0.1, 0.2, 0.4, 0.3])!;
    expect(left[0]).toBe(0);
    expect(left[0] + left[2]).toBeCloseTo(0.3, 12);
    // Past the right and the bottom: cut at 1.
    const far = clipToFrame([0.7, 0.8, 0.5, 0.4])!;
    expect(far[0]).toBeCloseTo(0.7, 12);
    expect(far[0] + far[2]).toBeCloseTo(1, 12);
    expect(far[1] + far[3]).toBeCloseTo(1, 12);
    // Past all four: the whole photo.
    const all = clipToFrame([-0.2, -0.1, 1.5, 1.3])!;
    expect(all.slice(0, 2)).toEqual([0, 0]);
    expect(all[2]).toBeCloseTo(1, 12);
    expect(all[3]).toBeCloseTo(1, 12);
  });

  it('has no box for one wholly outside the photo, or for something that is not a box', () => {
    expect(clipToFrame([1.1, 0.2, 0.3, 0.3])).toBeNull();
    expect(clipToFrame([0.2, -0.5, 0.3, 0.4])).toBeNull();
    expect(clipToFrame([0.2, 0.2, 0, 0.3])).toBeNull();
    expect(clipToFrame([0.2, 0.2, -0.1, 0.3])).toBeNull();
    // Touching the edge from outside is no area either.
    expect(clipToFrame([1, 0.2, 0.3, 0.3])).toBeNull();
    expect(clipToFrame([0.2, 0.2, Number.NaN, 0.3])).toBeNull();
    expect(clipToFrame([0.2, 0.2, Infinity, 0.3])).toBeNull();
    // Numbers written as text are not a box, even where arithmetic would coerce them
    // into one: '0.2' + '1' concatenates to 0.21, so this one would come back a box
    // 1 wide standing at 0.2, running off the photo it was just clipped to.
    expect(clipToFrame(['0.2', '0', '1', '1'] as unknown as number[])).toBeNull();
    expect(clipToFrame([0.2, 0.2, 0.3])).toBeNull();
    expect(clipToFrame([0.2, 0.2, 0.3, 0.3, 0.1])).toBeNull();
  });
});

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
    const free = placeWallObject(box, 'e', unbounded(r, 'e'), WIDE, { depthM })!;
    return {
      name,
      room: `${r.width}×${r.depth}`,
      truthW: wM * 1000,
      truthH: hM * 1000,
      lateral: Math.abs(free.position.z),
      end: wallFrame('e', r.footprint)!.right,
      decW: free.widthMM,
      decH: free.heightMM,
      refused: placeWallObject(box, 'e', r, WIDE, { depthM }) === null,
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
      end: wallFrame('e', r.footprint)!.right,
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
  const HALF = (slot: 'n' | 's' | 'e' | 'w') => wallFrame(slot, ROOM.footprint)!.right;

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
          const g = placeWallObject(box, slot, ROOM, cal, { depthM: 0.03 });
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
        if (placeWallObject(box, 'e', ROOM, lens(assumedDeg), { depthM: 0.03 })) best = frac;
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
    const wrong = placeWallObject(box, 'e', ROOM, lens(106), { depthM: 0.03 })!;
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
    const own = placeWallObject(onNorth('n'), 'n', ROOM, wide, { depthM: 0.03 })!;
    expect(own.widthMM).toBe(700);
    expect(own.heightMM).toBe(500);
    expect(own.position.x).toBeCloseTo(2.2, 9);

    // The framed wall's camera refuses it. Ungated it decoded ~2.73 m along a wall whose
    // half-span is 2.0, at ~36% too wide — bigger than the air conditioner error that
    // § 42.4 was written around. What it does NOT do is delete the row: see
    // `tests/detect-refine.test.ts`, where the count is measured rather than argued.
    expect(placeWallObject(onNorth('e'), 'e', ROOM, wide, { depthM: 0.03 })).toBeNull();
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
    expect(placeWallObject(curtain('n'), 'n', ROOM, wide, { depthM: 0.08 })!.widthMM).toBe(1400);
    expect(placeWallObject(curtain('e'), 'e', ROOM, wide, { depthM: 0.08 })).toBeNull();
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
      const lat = (cal: CameraCal) => placeFloorObject(box, 'e', ROOM, cal, { depthM: 0.6 })!.position.z;

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
          const half = wallFrame(mount, room.footprint)!.right;
          const toward = view === 'e' || view === 's' ? 1 : -1;
          const lateral = (half - 0.8) * toward * (mount === 's' || mount === 'w' ? -1 : 1);
          const d = wallD(mount, room);
          const own = bboxOfWallSolid(mount, mount, lateral, 1.5, d, 0.7, 0.5, 0.03, wide);
          const seen = bboxOfWallSolid(mount, view, lateral, 1.5, d, 0.7, 0.5, 0.03, wide);
          const where = `${mount} seen from ${view} in ${room.width}×${room.depth}`;
          if (!inFrame(seen)) continue;
          pairs++;
          // Measured exactly by its own camera…
          const g = placeWallObject(own, mount, room, wide, { depthM: 0.03 })!;
          expect(g, where).not.toBeNull();
          expect(g.widthMM, where).toBe(700);
          // …and refused by the neighbour's.
          expect(placeWallObject(seen, view, room, wide, { depthM: 0.03 }), where).toBeNull();
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
    expect(bboxSide('n', off) / 2).toBe(3.5); // the bound that used to apply
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
      const g = placeWallObject(box, 'n', off, wide, { depthM: 0.03 });
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
    expect(placeWallObject(past, 'n', off, wide, { depthM: 0.03 })).toBeNull();
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
    const ok = placeWallObject(box, 'e', ROOM, wide, { depthM: 0.03 });
    expect(ok!.widthMM).toBe(700);
    expect(ok!.heightMM).toBe(500);
    expect(placeWallObject(box, 'e', { height: 2.8, footprint: BROKEN }, wide, { depthM: 0.03 })).toBeNull();
  });

  it('still measures a CEILING piece there, because the slab’s plane is the room’s height', () => {
    // The other half, and the only remaining route to the gate's own no-frame rule now
    // that the wall placer returns before reaching it. `placeCeilingObject` intersects a
    // plane located by `room.height`, which no footprint can move — so both of its gates
    // are bounds on an assumption rather than the assumption itself, and a polygon that
    // cannot say where the walls are leaves them INERT. `if (!frame) return true` in
    // `onFramedSurface`, and `frame &&` on the forward gate, are both pinned here.
    // The same 1.1 m disc `'puts it on the ceiling plane and inside the room'` uses,
    // which the top of a 106° frame cuts — boxed as the part of it in view, which is
    // the box a detector draws. The premise that carries the meaning is the first
    // assertion — the piece IS measurable in a room whose polygon answers — so a null
    // in the second line is the footprint's doing and nothing else's.
    const disc = bboxOfCeilingDiscInFrame('e', 1.2, 0, 1.1, WIDE, ROOM.height)!;
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
    const good = placeFloorObject(box, 'n', ROOM, lens, chest);
    expect(good, 'premise: measurable in a room with a polygon').not.toBeNull();
    expect(good!.distance, 'premise: clear of that room’s clamp').toBeLessThan(
      ROOM.depth / 2 - chest.depthM / 2 - 1e-9,
    );
    const g = placeFloorObject(box, 'n', { height: 2.8, footprint: BROKEN }, lens, chest);
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
    const g = placeFloorObject([0.3, 0.8, 0.4, 0.1], 'n', { height: 2.8, footprint: BROKEN }, steep, CARD)!;
    expect(g, 'premise: it does return a placement').not.toBeNull();
    expect(g.distance, 'clamped to the guard, not past it').toBe(0.3);
    // And the premise that makes that a clamp rather than a coincidence: the same box in
    // a room whose polygon answers lands on the same guard, so 0.3 is the floor and not
    // this footprint's doing.
    expect(placeFloorObject([0.3, 0.8, 0.4, 0.1], 'n', ROOM, steep, CARD)!.distance).toBe(0.3);
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
    expect(placeWallObject(box, 'e', ROOM, wide, { depthM: 0.03 })).toBeNull();
    expect(placeWallObject(box, 'e', draggedRoom, wide, { depthM: 0.03 })).toBeNull();

    // And it is a REFUSAL rather than the gate being unreachable: a legitimate piece on
    // that same dragged east wall still measures, exactly. Without this the assertion
    // above would pass for a placer that had simply stopped working in dragged rooms.
    const real = bboxOfWallSolid('e', 'e', 0.6, 1.5, 2.5, 0.7, 0.5, 0.03, wide);
    const g = placeWallObject(real, 'e', draggedRoom, wide, { depthM: 0.03 });
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
      const g = placeWallObject(box, 'n', room, LEVEL, { depthM: 0.03 })!;
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
    const g = placeFloorObject(box, 'n', OUT, LEVEL, sofa)!;
    // Recovered, not clamped: the bound sits exactly here, so the assertion has to say
    // which one it is testing. `4 − 0.425` is what the MEASUREMENT gives, and the two
    // agreeing is the piece being against its own wall rather than the clamp landing on
    // the right answer by luck — which an earlier draft of this test did.
    expect(g.distance, 'measured centre, half a depth off the real wall').toBeCloseTo(3.575, 6);
    expect(g.widthMM, 'and the width is untouched').toBe(2000);
    // The bounding box pulls the same MEASURED piece 500 mm off its own wall, and it is
    // the clamp that does it — the measurement was identical in both rooms.
    const clamped = placeFloorObject(box, 'n', bboxAsRoom(OUT), LEVEL, sofa)!;
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
      const g = placeWallObject(box, 'n', { height: 2.8, footprint: fp }, cal, { depthM: TRUTH.depthM })!;
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

// ── Where a return-wall piece hangs ───────────────────────────────────────────
//
// `placeWallObject` refuses a piece the photo caught on a wall it was not pointed at,
// and the room then had nowhere to hang it but the wall it WAS pointed at — a phantom
// a corner away from the real one. `locateOnWall` answers where it is instead, from
// the line of sight through the box's centre and the room's own outline. Every
// fixture below is a POINT on the body's mid-plane with a box drawn round its image,
// because the claim under test is the ray-to-wall arithmetic: a box's centre is not
// the image of its body's centre under perspective, and a fixture that mixed the two
// would be measuring the fixture.
describe('locateOnWall', () => {
  const EPS = 1e-4;
  /** A detector box a hair wide, centred on the image of one world point. */
  const at = (view: CaptureSlot, x: number, y: number, z: number, c: CameraCal) => {
    const [u, v] = project(view, x, y, z, c);
    return [u - EPS, v - EPS, 2 * EPS, 2 * EPS] as [number, number, number, number];
  };
  const tilted = (deg: number): CameraCal => ({ ...WIDE, tiltRad: (deg * Math.PI) / 180 });
  const DEPTH = 0.08;

  /** The mid-plane point `along` metres from the middle of wall `wall` in the 6 × 4
   *  room, and the heading of that wall — written out rather than derived, so the
   *  yaw convention is stated here and not read off the code under test. */
  const onWall = (wall: CaptureSlot, along: number): [number, number, number] => {
    const inset = DEPTH / 2;
    if (wall === 'n') return [along, -2 + inset, 0];
    if (wall === 's') return [along, 2 - inset, Math.PI];
    if (wall === 'e') return [3 - inset, along, -Math.PI / 2];
    return [-3 + inset, along, Math.PI / 2];
  };

  it('finds the wall the line of sight meets, from every photo that sees it', () => {
    // Every (photo, wall) pair where the spot is in shot: the framed wall itself, and the
    // return walls, which are the case this function exists for. A 106° lens, three tilts,
    // and two off-centre spots per wall, one each side, so a swapped axis cannot pass and
    // the east and west photos each reach a return wall at BOTH edges of the frame. (The
    // north and south photos reach neither: from 1.96 m a 106° lens spans 5.2 m of a 6 m
    // wall, so their return walls are out of shot, which is the room and not a gap.)
    const walls: Array<[CaptureSlot, number]> = [
      ['n', 2.2], ['n', -2.4], ['s', -1.9], ['s', 2.3],
      ['e', -1.3], ['e', 1.2], ['w', 1.1], ['w', -1.4],
    ];
    let located = 0;
    let returnWall = 0;
    for (const view of ['n', 'e', 's', 'w'] as const) {
      for (const [wall, along] of walls) {
        for (const deg of [0, 5, -8]) {
          const c = tilted(deg);
          const [x, z, yaw] = onWall(wall, along);
          // Only what the photo actually has in frame. `project` answers for a point
          // BEHIND the lens too — mirrored, in frame — so ahead-of-the-lens is its own
          // test, written out per view like the yaw above.
          const ahead = { n: -z, s: z, e: x, w: -x }[view];
          if (!(ahead > 0)) continue;
          const box = at(view, x, 1.4, z, c);
          if (!(box[0] > 0 && box[0] + box[2] < 1 && box[1] > 0 && box[1] + box[3] < 1)) continue;
          const g = locateOnWall(box, view, ROOM.footprint, c, { depthM: DEPTH });
          const where = `${wall} wall from the ${view} photo at ${deg}°`;
          expect(g, where).not.toBeNull();
          expect(g!.position.x, where).toBeCloseTo(x, 3);
          expect(g!.position.z, where).toBeCloseTo(z, 3);
          expect(g!.position.y, where).toBeCloseTo(1.4, 3);
          // `toBe`, not `toBeCloseTo`: −0 and −π are the same heading and not the same
          // number, and `slotToWorld` hands out 0 and π.
          expect(g!.yaw, where).toBe(yaw);
          located++;
          if (wall !== view) returnWall++;
        }
      }
    }
    // Literals, so a fixture change that quietly drops the return walls out of frame
    // fails here rather than passing on the framed-wall cases alone.
    expect([located, returnWall]).toEqual([36, 12]);
  });

  it('places the piece where `placeWallObject` refused to measure it', () => {
    // The fixture the refusal is filed with: a 700 × 500 print 800 mm from the north-east
    // corner, which the east photo catches on its return wall. Measured, it was 28% too
    // wide; refused, it was hung on the east wall. Located, it is on the north wall where
    // it is, and its size is still nobody's claim.
    const c = WIDE;
    const box = bboxOfWallSolid('n', 'e', 2.2, 1.5, wallD('n', ROOM), 0.7, 0.5, 0.03, c);
    expect(placeWallObject(box, 'e', ROOM, c, { depthM: 0.03 })).toBeNull();
    const g = locateOnWall(box, 'e', ROOM.footprint, c, { depthM: 0.03 })!;
    expect(g.yaw).toBe(0); // the north wall, facing into the room
    expect(g.position.z).toBeCloseTo(-2 + 0.015, 9); // on its mid-plane, exactly
    // Along the wall and up it, only as close as a box centre is to its body's centre
    // at a grazing 54°: the ray is exact, the point it is fired through is not.
    expect(Math.abs(g.position.x - 2.2)).toBeLessThan(0.15);
    expect(Math.abs(g.position.y - 1.5)).toBeLessThan(0.05);
  });

  it('solves on the wall itself, so a wall that is not square to the photo is exact', () => {
    // A room with its north-east corner cut at 45°. Solving against the framed wall's
    // distance, or against an axis, would land the piece off this wall by up to half
    // its length; solving on the wall's own line moved in along its normal cannot.
    const cut: Footprint = [[-3, -2], [2, -2], [3, -1], [3, 2], [-3, 2]];
    const [nx, nz] = [Math.SQRT1_2, -Math.SQRT1_2]; // outward
    const mid = [2.5 - (nx * DEPTH) / 2, -1.5 - (nz * DEPTH) / 2] as const;
    for (const view of ['e', 'n'] as const) {
      const c = view === 'n' ? calFromHfov(120, 4 / 3) : WIDE;
      const box = at(view, mid[0], 1.2, mid[1], c);
      const g = locateOnWall(box, view, cut, c, { depthM: DEPTH })!;
      expect(g, view).not.toBeNull();
      expect(g.position.x, view).toBeCloseTo(mid[0], 3);
      expect(g.position.z, view).toBeCloseTo(mid[1], 3);
      expect(g.yaw, view).toBeCloseTo(-Math.PI / 4, 9);
    }
  });

  it('refuses a line of sight that leaves the room', () => {
    // A U-shaped room stands the lens ON the notch's inner wall (filed as a mis-placed
    // camera), so the east photo's left half looks out through the notch. A ray there
    // first crosses the notch's side wall from OUTSIDE, and whatever the box shows is
    // not on this room's walls.
    const u = footprintForLayout('u', 6, 5);
    const c = WIDE;
    const out = at('e', 2.0, 1.4, -0.8, c);
    expect(out[0] + out[2] / 2).toBeLessThan(0.5); // the left half: toward the notch
    expect(locateOnWall(out, 'e', u, c, { depthM: DEPTH })).toBeNull();
    // The right half of the same photo looks into the room, and is answered.
    const [x, z] = [2.0, 2.5 - DEPTH / 2];
    const inRoom = locateOnWall(at('e', x, 1.4, z, c), 'e', u, c, { depthM: DEPTH })!;
    expect(inRoom.position.x).toBeCloseTo(x, 3);
    expect(inRoom.position.z).toBeCloseTo(z, 3);
    expect(inRoom.yaw).toBe(Math.PI);
  });

  it('lets a line of sight through a corner reach the wall behind it', () => {
    // The same U's east photo, dead centre: the line of sight runs along the notch's inner
    // face and through the corner where the notch's side wall ends. It touches that wall,
    // from outside, at one point — the graze `wallFrame` refuses to call an obstruction,
    // and for the same reason: counting it refuses the east wall the whole centre column
    // is looking at. A box centred on the column EXACTLY, because the graze is exact.
    const u = footprintForLayout('u', 6, 5);
    expect(u).toContainEqual([0.22 * 6, 0]); // the corner, on the column
    const c = WIDE;
    const x = 3 - DEPTH / 2;
    const [, v] = project('e', x, 1.4, 0, c);
    const g = locateOnWall([0.25, v - EPS, 0.5, 2 * EPS], 'e', u, c, { depthM: DEPTH })!;
    expect(g).not.toBeNull();
    expect(g.position.x).toBeCloseTo(x, 3);
    expect(g.position.z).toBeCloseTo(0, 9);
    expect(g.position.y).toBeCloseTo(1.4, 3);
    expect(g.yaw).toBe(-Math.PI / 2);
  });

  it('takes the first wall the line of sight meets, and only where that wall is', () => {
    // A U with the lens in one arm: looking east, the arm's own wall is 1 m ahead, the
    // notch's far side is 3 m (seen from outside), and the far arm's wall 5 m. Two rules
    // make this answer right, and each one has a line of sight here that only it decides.
    const arm: Footprint = [[-1, -2], [1, -2], [1, 1], [3, 1], [3, -2], [5, -2], [5, 3], [-1, 3]];
    expect(wallFrame('e', arm)).not.toBeNull();
    const c = WIDE;
    // The NEAREST wall: a TV on the arm's wall. The farthest crossing is a wall of this
    // room seen from inside too, with the notch in between.
    const near = locateOnWall(at('e', 1 - DEPTH / 2, 1.4, -0.5, c), 'e', arm, c, { depthM: DEPTH })!;
    expect(near).not.toBeNull();
    expect(near.position.x).toBeCloseTo(1 - DEPTH / 2, 3);
    expect(near.position.z).toBeCloseTo(-0.5, 3);
    expect(near.yaw).toBe(-Math.PI / 2);
    // Only WHERE the wall is: a print on the south wall, seen past the end of the arm.
    // Its line of sight crosses the arm wall's LINE 184 mm beyond the wall's end, and a
    // wall's line is not a wall.
    const [px, pz] = [2.5, 3 - DEPTH / 2];
    expect(pz / px).toBeGreaterThan(1); // the ray's z at x = 1: past z = 1, the arm's end
    const far = locateOnWall(at('e', px, 1.4, pz, c), 'e', arm, c, { depthM: DEPTH })!;
    expect(far).not.toBeNull();
    expect(far.position.x).toBeCloseTo(px, 3);
    expect(far.position.z).toBeCloseTo(pz, 3);
    expect(far.yaw).toBe(Math.PI);
  });

  it('places a deep piece on its own mid-plane, however close its wall passes the lens', () => {
    // A 1.2 m galley kitchen's side wall, met at a slant near the edge of an ultrawide:
    // 480 mm ahead along the view axis, 600 mm from the lens across it. An air
    // conditioner is 220 mm deep. Along the view axis the wall is close enough to look
    // too near for that depth; the plaster is not, and the piece is placed at half its
    // own depth off it — not at a depth shortened to suit the view axis.
    const galley: Footprint = [[-0.6, -2], [0.6, -2], [0.6, 2], [-0.6, 2]];
    const c = WIDE;
    const depthM = 0.22;
    const [x, z] = [0.6 - depthM / 2, -(0.6 - depthM / 2) / 1.25];
    const g = locateOnWall(at('n', x, 1.7, z, c), 'n', galley, c, { depthM })!;
    expect(g).not.toBeNull();
    expect(g.position.x).toBeCloseTo(x, 3);
    expect(g.position.z).toBeCloseTo(z, 3);
    expect(g.yaw).toBe(-Math.PI / 2);
  });

  it('answers nothing where there is no room to look into', () => {
    // The north photo of a U has no wall ahead of the lens at all.
    expect(wallFrame('n', footprintForLayout('u', 6, 5))).toBeNull();
    expect(locateOnWall([0.45, 0.4, 0.1, 0.1], 'n', footprintForLayout('u', 6, 5), WIDE, { depthM: DEPTH })).toBeNull();
    // A line of sight pointing behind the lens: the bottom of a frame tipped 80° down.
    const down = tilted(80);
    expect(locateOnWall([0.45, 0.9, 0.1, 0.1], 'n', ROOM.footprint, down, { depthM: DEPTH })).toBeNull();
    // …and the top of the same frame, which does meet a wall, is answered — so the line
    // above is the guard and not the tilt.
    expect(locateOnWall([0.45, 0.0, 0.1, 0.02], 'n', ROOM.footprint, down, { depthM: DEPTH })).not.toBeNull();
    // An outline with a NaN in it is not an outline, and is answered nothing — in either
    // winding. (That holds without asking `wallFrame`: the NaN reaches the winding's sign,
    // and through it every wall's normal. It is a regression check, not the gate's test.)
    const box = at('n', 0.5, 1.4, -2 + DEPTH / 2, WIDE);
    for (const outline of [ROOM.footprint, [...ROOM.footprint].reverse()]) {
      expect(locateOnWall(box, 'n', outline, WIDE, { depthM: DEPTH })).not.toBeNull();
      const broken: Footprint = outline.map(([x, z], i) => (i === 2 ? [NaN, z] : [x, z]));
      expect(locateOnWall(box, 'n', broken, WIDE, { depthM: DEPTH })).toBeNull();
    }
    // The one line of sight a scan of the walls WOULD answer from a photo with no wall
    // ahead: from a lens standing on a U's notch, a ray through the notch's far corner
    // exactly. Touching a corner is no obstruction, so the arm's wall beyond it is met
    // from inside. But the camera is not in the room it is said to be photographing,
    // and a photo whose premise fails is answered nothing everywhere, not at one ray.
    // The lens is 90° wide, so the box centre at 0.75 is a ray of exactly 0.5 across per
    // metre forward, and the corner at (1, −2) is exactly on it.
    const notch: Footprint = [[-3, -2], [-1, -2], [-1, 0], [1, 0], [1, -2], [3, -2], [3, 2], [-3, 2]];
    const square: CameraCal = { k: 2, aspect: 4 / 3 };
    expect(wallFrame('n', notch)).toBeNull();
    expect(locateOnWall([0.7, 0.45, 0.1, 0.1], 'n', notch, square, { depthM: DEPTH })).toBeNull();
    // A piece whose middle would be behind the camera: the lens 100 mm from its framed
    // wall, and a 220 mm air conditioner on it. The same spot with a print is answered.
    const tight: Footprint = [[-0.1, -2], [3, -2], [3, 2], [-0.1, 2]];
    const spot = at('w', -0.1, 1.45, 0.05, WIDE);
    expect(locateOnWall(spot, 'w', tight, WIDE, { depthM: 0.22 })).toBeNull();
    expect(locateOnWall(spot, 'w', tight, WIDE, { depthM: 0.03 })).not.toBeNull();
  });
});
