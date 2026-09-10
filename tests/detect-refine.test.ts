import { describe, expect, it } from 'vitest';
import { dedupeDetections, geoRefine, refineDetections, type CalMap, type RoomDims } from '@/lib/detect-refine';
import {
  placeCeilingObject,
  placeFloorObject,
  placeWallObject,
  wallFrame,
  type CameraCal,
} from '@/lib/photo-geometry';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot } from '@/lib/storage';
import { anchorFor } from '@/lib/physics';
import { CATEGORIES, SHAPES, defaultAxisFor, defaultDepthFor, isRoundPart, type Category } from '@/lib/scene-spec';
import { bboxOfWallSolid } from './helpers/project';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { footprintForLayout, type Footprint } from '@/lib/footprint';

/** The framed wall's distance, read from the polygon. `wallDistance` — the
 *  `depth/2` / `width/2` pair every placer used to measure from — is deleted; this
 *  is the one description of the framed wall there is now, and a test asking for it
 *  asks the same function the placers do. */
const wallD = (slot: CaptureSlot, room: { footprint: Footprint }) =>
  wallFrame(slot, room.footprint)!.distance;

// The five contracts below are the ones every later phase of the detection plan
// has to keep. They deliberately do NOT re-test the projection maths — that is
// tests/photo-geometry.test.ts's job, against hand-computed cases. What geoRefine
// itself decides is *which* projection measures an object, and whether the AI's
// own numbers survive; that is what is pinned here, by comparing against the
// placer this detection should have gone through and asserting it did not go
// through the other one.

const ROOM: RoomDims = { width: 6, depth: 4, height: 2.8, footprint: footprintForLayout('rect', 6, 4) };
const CAL: CameraCal = { k: 1.2, aspect: 4 / 3 };
// 's' is deliberately absent — an unphotographed wall is a normal outcome.
const CALS: CalMap = { n: CAL, e: CAL, w: CAL };
// A ceiling needs a lens that can actually see one: at 66° level, a 2.8 m ceiling
// first enters frame 2.9 m away, past the wall being photographed. ~106° is a phone
// ultrawide. See placeCeilingObject.
const WIDE: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
const WIDE_CALS: CalMap = { n: WIDE, e: WIDE, w: WIDE };

// Bottom edge at v = 0.85, well below the horizon of a level camera, so
// placeFloorObject has a floor intersection to find.
const FLOOR_BOX: Detection['box'] = [0.4, 0.55, 0.2, 0.3];
// Bottom edge at v = 0.60 — still below the horizon, so BOTH placers return a
// result for it. That is what makes the wall case able to prove which one ran.
const WALL_BOX: Detection['box'] = [0.4, 0.4, 0.2, 0.2];
// Centre row at v = 0.17 — high in the frame and well ABOVE the horizon, which
// is where a ceiling fan lands. Only reachable with WIDE; under CAL the same box
// would be wall, and the anchor table is what routes it, not the box.
const CEILING_BOX: Detection['box'] = [0.33, 0.03, 0.29, 0.14];

function det(p: Partial<Detection> & Pick<Detection, 'category' | 'slot'>): Detection {
  return { label: 'thing', conf: 0.9, box: FLOOR_BOX, ...p };
}

describe('geoRefine', () => {
  it('measures a floor-anchored detection through placeFloorObject', () => {
    const d = det({
      category: 'sofa',
      slot: 'n',
      // Absurd on purpose: the whole point is that these are discarded.
      position: { x: 99, y: 99, z: 99 },
      dimMM: [1, 2, 3],
    });
    // The footprint is written out rather than read back through `isRoundPart` and
    // `defaultDepthFor`: a test that recomputes the decision under test agrees with
    // itself whatever the decision is. A sofa is a box, and its catalogue depth is
    // 950 mm — both pinned on the next two lines so the literal cannot rot.
    expect(defaultDepthFor('sofa', 'sofa')).toBe(950);
    expect(isRoundPart('sofa')).toBe(false);
    const g = placeFloorObject(FLOOR_BOX, 'n', ROOM.footprint, CAL, { depthM: 0.95, round: false });
    expect(g).not.toBeNull();

    const out = geoRefine(d, CALS, ROOM);
    expect(out.position).toEqual(g!.position);
    // W and H are measured. So, now, is the DEPTH's effect on them: the bbox's
    // bottom edge is the sofa's near face, so pushing out to its centre takes a
    // depth, and a depth the AI guessed would be an AI-decided position. So the
    // floor branch discards the hint — the `2` this line used to assert was that
    // hint surviving — and writes the catalogue number it measured with, which is
    // also what the piece is drawn at.
    expect(out.dimMM).toEqual([g!.widthMM, 950, g!.heightMM]);
    // Independent of the placer: a floor anchor sits on the floor, and the sizes
    // are millimetres of furniture rather than metres or pixels.
    expect(out.position!.y).toBe(0);
    expect(out.dimMM![0]).toBeGreaterThan(100);
    expect(out.dimMM![2]).toBeGreaterThan(100);
    expect(out.dimMM![2]).toBeLessThan(3000);
  });

  it('inverts a ROUND floor piece as a cylinder, not as a box', () => {
    // The second half of the footprint decision, and it has to be asserted rather
    // than assumed: a cylinder's silhouette is its tangent span, so inverting one
    // as a box reads its depth off corners that are not on the object and comes
    // back badly narrow. `plant` is round in the catalogue and `sofa` is not, so
    // the two branches must give different answers for the same box.
    expect(isRoundPart('plant')).toBe(true);
    const asRound = placeFloorObject(FLOOR_BOX, 'n', ROOM.footprint, CAL, { depthM: 0.4, round: true })!;
    const asBox = placeFloorObject(FLOOR_BOX, 'n', ROOM.footprint, CAL, { depthM: 0.4, round: false })!;
    expect(asRound.widthMM).not.toBe(asBox.widthMM);

    const out = geoRefine(det({ category: 'plant', shape: 'plant', slot: 'n' }), CALS, ROOM);
    expect(out.position).toEqual(asRound.position);
    expect(out.position).not.toEqual(asBox.position);
    expect(out.dimMM).toEqual([asRound.widthMM, defaultDepthFor('plant', 'plant'), asRound.heightMM]);
  });

  it('measures a wall-anchored detection through placeWallObject, not the floor one', () => {
    const d = det({ category: 'painting', shape: 'painting', slot: 'n', box: WALL_BOX });
    expect(defaultDepthFor('painting', 'painting')).toBe(30);
    const wall = placeWallObject(WALL_BOX, 'n', ROOM.footprint, CAL, { depthM: 0.03, round: false });
    const floor = placeFloorObject(WALL_BOX, 'n', ROOM.footprint, CAL, { depthM: 0.03 });
    expect(wall).not.toBeNull();
    expect(floor).not.toBeNull(); // both are available, so the next line has teeth

    const out = geoRefine(d, CALS, ROOM);
    expect(out.position).toEqual(wall!.position);
    expect(out.position).not.toEqual(floor!.position);
    expect(out.dimMM).toEqual([wall!.widthMM, defaultDepthFor('painting', 'painting'), wall!.heightMM]);
    // A hung picture is off the floor; the floor placer would have said y = 0.
    expect(out.position!.y).toBeGreaterThan(0);
  });

  it('measures a ceiling item’s WIDTH and refuses to invent its height', () => {
    // This replaces the original "a ceiling anchor comes back untouched" contract,
    // changed deliberately rather than deleted. What is untouched is now the HEIGHT
    // — a fan photographed from below projects as a disc, so its bbox carries a
    // foreshortened diameter and no thickness at all.
    const g = placeCeilingObject(CEILING_BOX, 'n', ROOM, WIDE)!;
    expect(g).not.toBeNull(); // premise: this lens can see this ceiling
    const d = det({ category: 'fan', shape: 'fan', slot: 'n', box: CEILING_BOX });
    const out = geoRefine(d, WIDE_CALS, ROOM);
    expect(out).not.toBe(d);
    expect(out.dimMM![0]).toBe(g.widthMM);
    expect(out.position).toEqual(g.position);
    // Catalogue height, derived — never a literal, and never the bbox.
    expect(out.dimMM![2]).toBe(defaultAxisFor('fan', 'fan', 2));
  });

  it('still leaves a ceiling item untouched when no ceiling is in frame', () => {
    // The honest "nothing was measured here" answer that three later phases read by
    // reference identity. It survives Phase 7 — the refusal simply moved from the
    // anchor table to the lens. FLOOR_BOX sits below the horizon, which is where a
    // detector's fan box lands in every 66° level shot.
    const d = det({ category: 'fan', shape: 'fan', slot: 'n' });
    expect(geoRefine(d, CALS, ROOM)).toBe(d);
    expect(geoRefine(d, WIDE_CALS, ROOM)).toBe(d);
  });

  it('keeps the AI’s height hint for a ceiling item, and discards its width', () => {
    // Same split as everywhere else: an axis the camera measured overrides the
    // hint, an axis it cannot see falls back to one. clampDims gates both.
    const d = det({
      category: 'fan',
      shape: 'fan',
      slot: 'n',
      box: CEILING_BOX,
      dimMM: [4321, 1100, 333],
    });
    const out = geoRefine(d, WIDE_CALS, ROOM);
    expect(out.dimMM![0]).not.toBe(4321);
    expect(out.dimMM![1]).toBe(1100);
    expect(out.dimMM![2]).toBe(333);
  });

  it('still measures a curtain whose shape resolves to the ceiling', () => {
    // The `&& d.category !== 'curtain'` half of the ceiling guard. Cloth reaching
    // the ceiling is on the wall plane; a pendant lamp is not.
    const d = det({ category: 'curtain', shape: 'fan', slot: 'n', box: WALL_BOX });
    const out = geoRefine(d, CALS, ROOM);
    expect(out).not.toBe(d);
    expect(out.position).toEqual(
      placeWallObject(WALL_BOX, 'n', ROOM.footprint, CAL, { depthM: defaultDepthFor('curtain', 'fan') / 1000, round: false })!.position,
    );
  });

  it('leaves a detection from an uncalibrated slot completely untouched', () => {
    const d = det({ category: 'sofa', slot: 's', position: { x: 1, y: 0, z: 1 } });
    expect(geoRefine(d, CALS, ROOM)).toBe(d);
    expect(geoRefine(det({ category: 'sofa', slot: 'n' }), {}, ROOM)).toBeTruthy();
    expect(geoRefine(d, {}, ROOM)).toBe(d);
  });

  it('keeps the AI yaw when there is one, and takes the geometric yaw otherwise', () => {
    const g = placeFloorObject(FLOOR_BOX, 'w', ROOM.footprint, CAL, { depthM: 0.95, round: false })!;
    expect(g.yaw).not.toBe(0); // slot 'w' faces +X, so 0 is a distinguishable value

    expect(geoRefine(det({ category: 'sofa', slot: 'w', yaw: 1.23 }), CALS, ROOM).yaw).toBe(1.23);
    expect(geoRefine(det({ category: 'sofa', slot: 'w' }), CALS, ROOM).yaw).toBe(g.yaw);
    // A deliberate 0 is a yaw, not a missing yaw. `??` would in fact behave
    // identically here — `0 ?? x` is 0 — so the mutation this line actually
    // catches is `||`, which rotates every piece the AI said faces north.
    expect(geoRefine(det({ category: 'sofa', slot: 'w', yaw: 0 }), CALS, ROOM).yaw).toBe(0);
  });

  it('derives an in-range depth for every category when the AI gave none', () => {
    // The local detector supplies no dimMM at all, so this is its normal path,
    // not an edge case. The old literal 500 was outside the legal depth of four
    // of these — see the next test.
    for (const category of CATEGORIES) {
      // A ceiling category needs the lens and the frame position that can reach a
      // ceiling; every other category is measured from the nominal rig. The skip
      // this replaces ("ceiling anchor: never measured at all") stopped being true
      // in Phase 7, and a skip is a coverage hole that goes stale silently.
      const ceiling = anchorFor(category as Category, 'box') === 'ceiling';
      const out = geoRefine(
        det({ category, slot: 'n', box: ceiling ? CEILING_BOX : FLOOR_BOX }),
        ceiling ? WIDE_CALS : CALS,
        ROOM,
      );
      const r = dimRangeFor(category, 'box'); // 'box' is what geoRefine casts an absent shape to
      expect(out.dimMM, category).toBeDefined();
      expect(out.dimMM![1], category).toBeGreaterThanOrEqual(r.min[1]);
      expect(out.dimMM![1], category).toBeLessThanOrEqual(r.max[1]);
    }
  });

  it('gives the thin wall-mounted categories a depth the old literal could not', () => {
    // Proof of teeth that does not depend on the deleted code: 500 mm really is
    // illegal for each of these, so a regression to any literal near it fails
    // here. Note the list is FOUR, not five — a rug's D range is 400–4000 (its
    // 3–40 band is the H axis, the pile thickness), so 500 was always legal for
    // a rug. Anything that reads a "thin" category off the H axis is reading the
    // wrong number.
    const thin: Array<[Detection['category'], string]> = [
      ['tv', 'tv'],
      ['mirror', 'mirror'],
      ['painting', 'painting'],
      ['curtain', 'curtain'],
    ];
    for (const [category, shape] of thin) {
      const r = dimRangeFor(category, shape as never);
      expect(500, category).toBeGreaterThan(r.max[1]);
      const out = geoRefine(det({ category, shape, slot: 'n' }), CALS, ROOM);
      expect(out.dimMM![1], category).toBeGreaterThanOrEqual(r.min[1]);
      expect(out.dimMM![1], category).toBeLessThanOrEqual(r.max[1]);
    }
  });

  it('takes the AI depth hint on the CEILING branch and nowhere else', () => {
    // **This test used to assert the opposite for a wall piece**, and the reason it
    // changed is rule 2 rather than taste. Its comment read: "depth is the one axis
    // the cloud detector's guess is better than nothing on, which is why
    // lib/detection.ts keeps asking for dimMM" — true while depth was only the axis
    // nobody measured. It is now an INPUT to both the floor and wall placers, because
    // a bbox edge is a corner of a solid, so a depth the AI guessed would move a
    // measured width and height. Those two branches take the catalogue's.
    //
    // 45 mm is inside a painting's 15–60 band, so the floor/wall lines below cannot
    // pass by accident of clamping — the hint is discarded, not clamped away.
    const wall = geoRefine(
      det({ category: 'painting', shape: 'painting', slot: 'n', box: WALL_BOX, dimMM: [700, 45, 500] }),
      CALS,
      ROOM,
    );
    expect(wall.dimMM![1]).toBe(defaultDepthFor('painting', 'painting'));
    expect(wall.dimMM![1]).not.toBe(45);

    const floor = geoRefine(
      det({ category: 'sofa', shape: 'sofa', slot: 'n', box: FLOOR_BOX, dimMM: [2000, 800, 800] }),
      CALS,
      ROOM,
    );
    expect(floor.dimMM![1]).toBe(defaultDepthFor('sofa', 'sofa'));
    expect(floor.dimMM![1]).not.toBe(800);

    // The ceiling branch is where it survives, and that is not an oversight:
    // `placeCeilingObject` reads one row of a disc and takes no depth at all, so
    // nothing there turns the hint into a measurement. 1100 mm is inside a fan's
    // 900–1500 band, so this is the hint winning rather than a clamp landing on it.
    const ceiling = geoRefine(
      det({ category: 'fan', shape: 'fan', slot: 'n', box: CEILING_BOX, dimMM: [1000, 1100, 200] }),
      WIDE_CALS,
      ROOM,
    );
    expect(ceiling.dimMM![1]).toBe(1100);
    expect(defaultDepthFor('fan', 'fan')).not.toBe(1100); // premise: the two differ
  });
});

// Lives in lib/scene-spec.ts, next to the CATEGORY_DEFAULTS table it reads, but
// geoRefine is its only consumer — so it is tested here.
describe('defaultDepthFor', () => {
  it('never returns a depth outside the governing range, for any category × shape', () => {
    for (const category of CATEGORIES) {
      for (const shape of SHAPES) {
        const r = dimRangeFor(category, shape);
        const d = defaultDepthFor(category, shape);
        expect(d, category + '/' + shape).toBeGreaterThanOrEqual(r.min[1]);
        expect(d, category + '/' + shape).toBeLessThanOrEqual(r.max[1]);
      }
    }
  });

  it('lets the named shape narrow the category default', () => {
    // A pendant lamp is not a floor lamp. The category default is the floor
    // lamp's 300 mm; 'lamp-pendant' caps at 800, 'lamp-table' at 450 — so this
    // asserts the shape is consulted at all, which a category-only lookup would
    // not be.
    expect(defaultDepthFor('lamp', 'lamp-floor')).toBe(300);
    expect(defaultDepthFor('painting', 'painting')).toBeLessThanOrEqual(60);
    // wardrobe D default 600, but a curtain's shape range caps depth at 200.
    expect(defaultDepthFor('wardrobe', 'curtain')).toBeLessThanOrEqual(200);
  });
});

describe('refineDetections', () => {
  // Two real chairs at opposite ends of the same wall, which the model reported
  // at the SAME made-up 3D position. Gemini guessing a position badly is not
  // hypothetical — replacing those guesses is the only reason geoRefine exists.
  const chairs = (): Detection[] => [
    det({ label: 'dining chair', category: 'chair', slot: 'n', box: [0.05, 0.55, 0.12, 0.3], position: { x: 0, y: 0.4, z: 0 } }),
    det({ label: 'dining chair', category: 'chair', slot: 'n', box: [0.80, 0.55, 0.12, 0.3], position: { x: 0, y: 0.4, z: 0 } }),
  ];

  it('merges on measured positions, not on the ones the AI guessed', () => {
    // The old order — dedupe inside the Gemini call, geometry afterwards on the
    // detect screen — saw only the guess, and threw one of the two chairs away.
    expect(dedupeDetections(chairs())).toHaveLength(1);
    // Measured first, the two are metres apart and both survive.
    const out = refineDetections(chairs(), CALS, ROOM);
    expect(out).toHaveLength(2);
    const [a, b] = out;
    expect(Math.hypot(a.position!.x - b.position!.x, a.position!.z - b.position!.z)).toBeGreaterThan(0.6);
  });

  it('still merges on the AI position when the room cannot be measured', () => {
    // No room dimensions means no calibration means nothing to measure. The
    // self-reported position is then all there is, and merging on it is the old
    // behaviour, kept on purpose: an unmeasurable photo is not a reason to stop
    // merging. Same two inputs as above — only the measurement is missing.
    expect(refineDetections(chairs(), CALS, null)).toHaveLength(1);
  });

  it('refines every detection it passes through', () => {
    const out = refineDetections(
      [det({ category: 'sofa', slot: 'n' }), det({ category: 'painting', shape: 'painting', slot: 'e', box: WALL_BOX })],
      CALS,
      ROOM,
    );
    expect(out).toHaveLength(2);
    for (const d of out) expect(d.dimMM).toBeDefined();
  });
});

// ── What a REFUSED placement costs, measured rather than argued ──────────────
//
// `onFramedSurface` refuses a piece decoded outside the framed wall. The question this
// describe exists to answer is what that costs downstream, because the first version of
// the docblock in `lib/photo-geometry.ts` claimed the refusal removed a duplicate ROW
// and it does not — the count was reasoned, not measured, which is the mistake this file
// keeps catching. Both directions are pinned here so the next reader does not have to
// re-derive them.
describe('a refused placement', () => {
  const W: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
  const WCALS: CalMap = { n: W, e: W, s: W, w: W };

  /** One 700 × 500 print on the N wall, 800 mm from the north-east corner, as seen
   *  from whichever camera. `e` is the return-wall sighting an ultrawide catches. */
  const print = (view: 'n' | 'e'): Detection => ({
    label: 'framed print',
    conf: 0.9,
    category: 'painting',
    shape: 'painting',
    slot: view,
    box: bboxOfWallSolid('n', view, 2.2, 1.5, wallD('n', ROOM), 0.7, 0.5, 0.03, W),
  });

  it('keeps the detection and drops only the measurement', () => {
    // The refusal path is `return d` — the SAME object — which is what
    // `lib/label-repair.ts` reads as "unmeasurable" via identity. The piece still reaches
    // the scene; it is the fabricated numbers that go, not the furniture. "A piece that
    // never appears leaves no trace" is the failure this repo fears, and this is why the
    // gate does not cause it.
    //
    // Object identity is the whole assertion here. Two lines checking that the SEED's own
    // `dimMM`/`position` are still undefined used to sit below it, presented as evidence;
    // `geoRefine` spreads and never mutates its argument, so they were assertions about a
    // literal three lines up and could not fail for any change to the gate.
    const seed = print('e');
    expect(geoRefine(seed, WCALS, ROOM)).toBe(seed);
    // …and the same detection through its own camera is NOT returned by identity, which is
    // what makes the line above a test of the refusal rather than of `geoRefine` at large.
    const measured = geoRefine(print('n'), WCALS, ROOM);
    expect(measured.dimMM).toBeDefined();
  });

  it('on the CLOUD path the fallback is the AI’s size, not the catalogue’s', () => {
    // The claim this replaces said a refused piece "still appears at its catalogue size".
    // False on the path that spends the user's quota: `buildSceneFromRoom` prefers the
    // detector's own `dimMM` through `clampDims` and reaches `cfg.dim` only when there is
    // no hint at all — and `lib/detect-prompt.ts` asks the model for `dimMM` AND
    // `position`. The fixture above carries neither, because that is the on-device shape,
    // so it could not express the case the claim was about.
    const cloud: Detection = {
      ...print('e'),
      dimMM: [1500, 40, 1100], // a generous guess, well inside `painting`'s band
      position: { x: 2.9, y: 1.5, z: -1.6 },
    };
    const refused = geoRefine(cloud, WCALS, ROOM);
    expect(refused).toBe(cloud); // still refused
    // The hint SURVIVES the refusal — this is the honest contract.
    expect(refused.dimMM).toEqual([1500, 40, 1100]);
    expect(refused.position).toBeDefined();
  });

  it('and a refused CLOUD row can change the merge, where an on-device one cannot', () => {
    // The other half of the same fixture gap. `dedupeDetections` bails only when a
    // position is MISSING, so a refused row that kept the model's own position is still
    // compared — and two sightings 0.3 m apart in `painting`'s 0.35 m tier merge to one.
    // So "two rows in, two rows out, before and after" was true of the fixture, not of
    // the gate.
    const near = (view: 'n' | 'e', z: number): Detection => ({
      ...print(view),
      position: { x: 2.2, y: 1.5, z },
    });
    const merged = refineDetections([near('n', -1.9), near('e', -1.7)], WCALS, ROOM);
    expect(merged).toHaveLength(1);
  });

  it('does NOT change the row count — the duplicate survives either way', () => {
    // Two sightings of one print, in the ON-DEVICE shape (no `dimMM`, no `position` of
    // their own). Measured, they are ~1.0 m apart against `painting`'s 0.35 m tier, so
    // both survive; refused, the second has no position at all and `dedupeDetections`
    // declines to compare a missing one — so both survive again. Two in, two out, before
    // and after the gate.
    //
    // Scoped to that shape deliberately: the test above shows a refused CLOUD row keeping
    // its own position and merging. The gate buys size and verdicts, not de-duplication,
    // and the row count was never its to move — but the reason it does not move here is
    // the fixture, not the gate, and the first version of this comment claimed the latter.
    const out = refineDetections([print('n'), print('e')], WCALS, ROOM);
    expect(out).toHaveLength(2);

    const own = out.find((d) => d.slot === 'n')!;
    expect(own.dimMM![0]).toBe(700);
    expect(own.dimMM![2]).toBe(500);
    expect(own.position!.x).toBeCloseTo(2.2, 9);

    const returned = out.find((d) => d.slot === 'e')!;
    expect(returned.dimMM).toBeUndefined();
    expect(returned.position).toBeUndefined();
  });
});
