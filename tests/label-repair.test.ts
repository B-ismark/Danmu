import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptCandidate, candidatesFor, categoriesFittingSize, judgeLabel, judgeLabels, sizeFitsLabel, type LabelVerdict } from '@/lib/label-repair';
import { cutAxes, frameCuts, placeFloorObject, placeWallObject, wallFrame, type CameraCal, type ReadBounds } from '@/lib/photo-geometry';
import {
  CATEGORIES,
  PART_LIBRARY,
  buildSceneFromRoom,
  defaultAxisFor,
  defaultDepthFor,
  sceneShapeFor,
  type Category,
  type Shape,
} from '@/lib/scene-spec';
import { toRecord } from '@/lib/detection-record';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { geoMeasure, geoRefine, type CalMap, type RoomDims } from '@/lib/detect-refine';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot } from '@/lib/storage';
import { footprintForLayout, type Footprint } from '@/lib/footprint';
import { bboxOfCeilingDisc, bboxOfFloorBox, bboxOfFloorCylinder, bboxOfWallSolid } from './helpers/project';

/** The framed wall's distance, read from the polygon. `wallDistance` — the
 *  `depth/2` / `width/2` pair every placer used to measure from — is deleted; this
 *  is the one description of the framed wall there is now, and a test asking for it
 *  asks the same function the placers do. */
const wallD = (slot: CaptureSlot, room: { footprint: Footprint }) =>
  wallFrame(slot, room.footprint)!.distance;

const ROOM: RoomDims = { width: 6, depth: 4, height: 2.8, footprint: footprintForLayout('rect', 6, 4) };
const CAL: CameraCal = { k: 1.2, aspect: 4 / 3 };
const CALS: CalMap = { n: CAL, e: CAL, w: CAL }; // 's' deliberately uncalibrated
const WALL_BOX: Detection['box'] = [0.4, 0.4, 0.2, 0.2];
const FLOOR_BOX: Detection['box'] = [0.4, 0.55, 0.2, 0.3];
// A ~106° phone ultrawide: the only common lens whose frame contains any ceiling
// from 1.5 m in a 2.8 m room. See placeCeilingObject.
const WIDE: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
const WIDE_CALS: CalMap = { n: WIDE, e: WIDE, w: WIDE };
// Centre row high above the horizon — where a ceiling fixture lands. The wide one
// measures ~1.26 m (a plausible fan); the narrow one ~0.1 m (a hook).
const CEILING_BOX: Detection['box'] = [0.33, 0.03, 0.29, 0.14];
const HOOK_BOX: Detection['box'] = [0.47, 0.03, 0.023, 0.14];

function det(p: Partial<Detection> & Pick<Detection, 'category' | 'slot'>): Detection {
  return { label: 'thing', conf: 0.9, box: FLOOR_BOX, ...p };
}

// ── The six failures Design.md's benchmark actually documents ───────────────
// Measured sizes are the ones recorded there; the point of the table is that the
// arithmetic on real ranges reproduces the recorded outcome, including the two
// rows that must come back unchanged. A check that flags everything is worse than
// no check, because the user stops reading it.
const BENCHMARK: Array<{
  what: string;
  category: Category;
  shape: Shape | undefined;
  widthMM: number;
  heightMM: number;
  caught: boolean;
  why: string;
}> = [
  {
    what: 'a floor-length curtain called a bed',
    category: 'bed',
    shape: undefined,
    widthMM: 1400,
    heightMM: 2300,
    caught: true,
    why: 'too narrow AND too tall for any bed — fails both axes',
  },
  {
    what: 'a wall ledge called a desk',
    category: 'desk',
    shape: 'desk-standard',
    widthMM: 1200,
    heightMM: 130,
    caught: true,
    why: 'no desk is 130 mm tall',
  },
  {
    what: 'a ceiling fan called a lamp',
    category: 'lamp',
    shape: undefined,
    widthMM: 1200,
    heightMM: 300,
    caught: true,
    why: 'wider than the widest lamp',
  },
  {
    what: 'a ceiling hook called a ceiling fan',
    category: 'fan',
    shape: undefined,
    widthMM: 100,
    heightMM: 100,
    caught: true,
    why: 'a tenth of the narrowest fan — but see the ceiling test below',
  },
  {
    what: 'a garment rail called a wardrobe',
    category: 'wardrobe',
    shape: 'wardrobe',
    widthMM: 1000,
    heightMM: 1700,
    caught: false,
    why: 'legitimately wardrobe-shaped; only appearance separates them',
  },
  {
    what: 'a cardboard box called a picture frame',
    category: 'painting',
    shape: 'painting',
    widthMM: 400,
    heightMM: 400,
    caught: false,
    why: 'a 400 mm square really is a plausible framed print',
  },
];

describe('sizeFitsLabel', () => {
  for (const row of BENCHMARK) {
    it(`${row.caught ? 'rejects' : 'accepts'} ${row.what} — ${row.why}`, () => {
      expect(sizeFitsLabel(row.category, (row.shape ?? 'box') as Shape, row.widthMM, row.heightMM)).toBe(!row.caught);
    });
  }

  it('scores four of the six documented failures, not all six', () => {
    // The honest yield, and the number the SigLIP decision in the plan turns on.
    // Two rows are unreachable by any range check and this must keep saying so.
    expect(BENCHMARK.filter((r) => r.caught)).toHaveLength(4);
  });

  it('reads width and height, never the depth axis', () => {
    // A painting is 15–60 mm deep, and the D value reaching this module is a
    // derived default rather than a measurement. Testing it would compare an
    // invented number against the range it was invented from.
    const r = dimRangeFor('painting', 'painting');
    expect(r.min[1]).toBeGreaterThan(0); // there IS a depth band, deliberately unused
    expect(sizeFitsLabel('painting', 'painting', 800, 600)).toBe(true);
    // Height out of band is caught; the same value on the depth axis is not
    // consulted at all, which is why H is read from index 2 and not index 1.
    expect(sizeFitsLabel('painting', 'painting', 800, 2000)).toBe(false);
  });

  it('never accuses a catalog item of being the wrong thing', () => {
    // The sweep that stops this feature becoming a nuisance: every shipped part,
    // at its shipped size, under its own label. Mirrors tests/catalog.test.ts.
    const offenders = PART_LIBRARY.filter((i) => !sizeFitsLabel(i.category, i.shape, i.dimMM[0], i.dimMM[2]));
    expect(offenders.map((i) => `${i.label} · ${i.dimMM.join('×')}`)).toEqual([]);
  });
});

describe('categoriesFittingSize', () => {
  it('offers curtain for the 1400 × 2300 that is not a bed', () => {
    const fits = categoriesFittingSize(1400, 2300, 'bed');
    expect(fits).toContain('curtain');
    expect(fits).not.toContain('bed');
  });

  it('never offers `other`, whose band fits nearly everything', () => {
    expect(categoriesFittingSize(600, 800)).not.toContain('other');
    expect(dimRangeFor('other', 'box').max[0]).toBeGreaterThan(3000); // i.e. it would have fitted
  });

  it('returns nothing at all for a size no furniture is', () => {
    // 8 m wide is outside every band. An empty list is a real answer — a flag
    // with no repair — and the caller must not read it as "no problem".
    expect(categoriesFittingSize(8000, 8000)).toEqual([]);
  });

  it('orders by how comfortably the size sits in each band', () => {
    const fits = categoriesFittingSize(450, 550);
    expect(fits.length).toBeGreaterThan(1);
    // Ordering is by margin, so the first entry is at least as comfortable as the
    // last. Asserting the relation rather than a name keeps this from breaking
    // every time a band is retuned.
    const margin = (c: Category) => {
      const r = dimRangeFor(c, 'box');
      const w = Math.min(450 - r.min[0], r.max[0] - 450) / (r.max[0] - r.min[0]);
      const h = Math.min(550 - r.min[2], r.max[2] - 550) / (r.max[2] - r.min[2]);
      return Math.min(w, h);
    };
    expect(margin(fits[0])).toBeGreaterThanOrEqual(margin(fits[fits.length - 1]));
  });
});

describe('judgeLabel', () => {
  it('says nothing about a detection nothing measured', () => {
    // No calibration for that slot, and a ceiling anchor. Both are honest silences
    // rather than clean bills of health, and the difference matters: a caller that
    // treats `unmeasured` as `ok` claims the geometry agreed with the AI.
    expect(judgeLabel(det({ category: 'bed', slot: 's' }), CALS, ROOM).status).toBe('unmeasured');
    expect(judgeLabel(det({ category: 'fan', shape: 'fan', slot: 'n' }), CALS, ROOM).status).toBe('unmeasured');
  });

  it('clears a word the measurement agrees with', () => {
    const g = placeWallObject(WALL_BOX, 'n', ROOM, CAL, {
      depthM: defaultDepthFor('painting', 'painting') / 1000,
    })!;
    expect(sizeFitsLabel('painting', 'painting', g.widthMM, g.heightMM)).toBe(true); // premise
    expect(judgeLabel(det({ category: 'painting', shape: 'painting', slot: 'n', box: WALL_BOX }), CALS, ROOM)).toEqual({
      status: 'ok',
    });
  });

  it('reports the measurement and the band it missed, not a sentence about them', () => {
    // Same box, called a bed. The UI writes the copy; this hands over numbers so
    // that what is displayed is derived from the range rather than typed beside it.
    //
    // Measured by the FLOOR placer, note — a bed is floor-anchored, so the same
    // pixels that measure 480 x 360 as a hung painting measure 480 x 1680 as
    // something standing on the floor. That is exactly why a repaired word has to
    // be re-measured rather than keeping the numbers taken under the old one.
    //
    // And judged as the bed the ROOM would build from that row — `sceneShapeFor`,
    // not `box`. The row names no shape, which is what the on-device detector
    // hands over, and a band taken from a shape nothing builds is a band for
    // nothing.
    const shape = sceneShapeFor('bed', 'thing', undefined);
    expect(shape).not.toBe('box'); // premise: a bed with no shape is still built as a bed
    const g = placeFloorObject(WALL_BOX, 'n', ROOM, CAL, {
      depthM: defaultDepthFor('bed', shape) / 1000,
    })!;
    const v = judgeLabel(det({ category: 'bed', slot: 'n', box: WALL_BOX }), CALS, ROOM);
    expect(v.status).toBe('suspect');
    if (v.status !== 'suspect') return;
    // A whole box is read as a size, so each axis is one number at both ends.
    expect(v.measured).toEqual({ width: [g.widthMM, g.widthMM], height: [g.heightMM, g.heightMM] });
    expect(v.bounded).toBeUndefined();
    expect(v.allowed.width).toEqual([dimRangeFor('bed', shape).min[0], dimRangeFor('bed', shape).max[0]]);
    expect(v.failed).toEqual(['width', 'height']); // a 480 mm wide, 1.68 m tall bed
  });

  it('re-measures every candidate under its own anchor', () => {
    // The re-entrancy point. A candidate's category picks its anchor and the anchor
    // picks the projection, so the detection offered back has been measured again
    // rather than carrying the numbers taken under the wrong word.
    //
    // The row carries a bed's shape hint, which is a shape the catalogue knows and so
    // one `sceneShapeFor` would honour for ANY category — a sofa candidate built as a
    // double bed — unless it is dropped with the word it came with.
    const v = judgeLabel(det({ category: 'bed', shape: 'bed-double', slot: 'n', box: WALL_BOX }), CALS, ROOM);
    if (v.status !== 'suspect') throw new Error('expected suspect');
    expect(v.candidates.length).toBeGreaterThan(0);
    for (const c of v.candidates) {
      expect(c.detection.category).toBe(c.category);
      // The shape the new category makes of the row's words — the old category's
      // hint does not come with it — and that is the shape it was measured as.
      const shape = sceneShapeFor(c.category, 'thing', undefined);
      expect(c.detection.shape).toBe(shape);
      expect(c.detection.dimMM).toBeDefined();
      // Whatever it now measures, it fits the word being offered as the shape it
      // will be built as — otherwise it is not a repair.
      expect(sizeFitsLabel(c.category, shape, c.detection.dimMM![0], c.detection.dimMM![2])).toBe(true);
    }
    // Most comfortable fit first. The list is re-sorted after re-measuring, so
    // this is a different sort from the one categoriesFittingSize does and needs
    // its own assertion.
    const margins = v.candidates.map((c) => c.margin);
    expect(margins).toEqual([...margins].sort((x, y) => y - x));
  });

  it('drops the AI depth hint along with the word it belonged to', () => {
    const v = judgeLabel(
      det({ category: 'bed', slot: 'n', box: WALL_BOX, dimMM: [1900, 1234, 600] }),
      CALS,
      ROOM,
    );
    if (v.status !== 'suspect') throw new Error('expected suspect');
    for (const c of v.candidates) expect(c.detection.dimMM![1]).not.toBe(1234);
  });

  it('changes nothing it is given', () => {
    const d = det({ category: 'bed', slot: 'n', box: WALL_BOX });
    const before = JSON.stringify(d);
    judgeLabel(d, CALS, ROOM);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('judgeLabel — a box the edge of the photo cut', () => {
  // A cut axis is grown to the kind's typical size (`PieceFootprint.whole`), so it
  // comes back inside the band of whatever word asked for it. Judging the word on it
  // is the catalogue judging the catalogue — the same trap the ceiling rows avoid.
  const LEFT_CUT: Detection['box'] = [0, 0.4, 0.2, 0.2];

  it('accuses a word only on the axes the photo showed whole', () => {
    // WALL_BOX called a bed fails on both axes (above). Run it off the left of the
    // frame and only its height is evidence any more.
    const v = judgeLabel(det({ category: 'bed', slot: 'n', box: LEFT_CUT }), CALS, ROOM);
    expect(v.status).toBe('suspect');
    if (v.status !== 'suspect') return;
    expect(v.failed).toEqual(['height']);
    expect(v.cut).toEqual(['width']);
    // …and the width is not reported as measured, because it was not: printing it
    // would print the typical bed as what the camera saw.
    expect(Object.keys(v.measured)).toEqual(['height']);
  });

  it('says which axis it could not judge on a row it clears', () => {
    const v = judgeLabel(det({ category: 'painting', shape: 'painting', slot: 'n', box: LEFT_CUT }), CALS, ROOM);
    expect(v).toEqual({ status: 'ok', cut: ['width'] });
  });

  it('gives no verdict when the edge cut every axis it could judge', () => {
    // Off the left and the top: a hung piece of which the photo measured nothing.
    const box: Detection['box'] = [0, 0, 0.3, 0.3];
    const v = judgeLabel(det({ category: 'painting', shape: 'painting', slot: 'n', box }), CALS, ROOM);
    expect(v).toEqual({ status: 'unmeasured', cut: ['width', 'height'] });
  });

  it('offers a better word on the measured axes alone', () => {
    // 2.3 m tall and 100 mm wide is no curtain, but with the width cut off only the
    // 2.3 m is evidence, and a curtain is that tall.
    expect(categoriesFittingSize(100, 2300)).not.toContain('curtain');
    expect(categoriesFittingSize(100, 2300, undefined, ['height'])).toContain('curtain');
  });

  it('never ranks a word the photo measured nothing of above one it measured', () => {
    // Off the left and the foot. As a floor word the foot is not a size cut, so a
    // wardrobe is still judged on its height; as a wall word it is, so a painting has
    // no axis left — it cannot fit, and it used to fit vacuously and sort first. The
    // judge's repairs drop it; a word the user TYPED keeps it, last and flagged,
    // because dropping it left a lamp called "ceiling fan" (`tests/label-suggest.test.ts`).
    const box: Detection['box'] = [0, 0.5, 0.3, 0.5];
    const d = det({ category: 'bed', slot: 'n', box });
    const offered = candidatesFor(d, ['painting', 'wardrobe'], CALS, ROOM, { requireFit: false });
    expect(offered.map((c) => [c.category, c.unmeasured ?? false])).toEqual([['wardrobe', false], ['painting', true]]);
    expect(candidatesFor(d, ['painting'], CALS, ROOM)).toEqual([]);
  });
});

describe('judgeLabel — a floor piece cut at its foot (§ 49.10)', () => {
  // A box that reaches the bottom of the photo has no seen near edge, so
  // `placeFloorObject` reads it at the far end of where it could stand — the last row's
  // ray, or its back on the plaster. Seven pieces, projected from the truth 0, 300 and
  // 800 mm off the north wall on the 106° lens, level and tipped UP 10° and 20° — a
  // negative `tiltRad`, the phone angled to get the ceiling in, which is how people
  // photograph a room; kept are the rows the frame cut at the foot and not the top,
  // that the placer measured.
  const clip = ([x, y, w, h]: readonly number[]): Detection['box'] => {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    return [x0, y0, Math.min(1, x + w) - x0, Math.min(1, y + h) - y0];
  };
  const PIECES: Array<[Category, Shape, number, number]> = [
    ['nightstand', 'nightstand', 450, 550],
    ['sofa', 'sofa', 2000, 800],
    ['table', 'coffee-table', 1000, 450],
    ['wardrobe', 'wardrobe', 1200, 2000],
    ['shelf', 'bookshelf', 800, 1800],
    ['desk', 'desk-standard', 1200, 750],
    ['bed', 'bed-double', 1600, 500],
  ];
  const calAt = (tiltDeg: number): CameraCal => ({ ...WIDE, tiltRad: (tiltDeg * Math.PI) / 180 });
  const boxOf = (category: Category, shape: Shape, w: number, h: number, gap: number, cal: CameraCal) => {
    const depth = defaultDepthFor(category, shape) / 1000;
    const z = -(wallD('n', ROOM) - gap - depth / 2);
    return clip(bboxOfFloorBox('n', 0.3, z, w / 1000, h / 1000, depth, cal));
  };
  const ROWS = [0, -10, -20].flatMap((tiltDeg) =>
    PIECES.flatMap(([category, shape, w, h]) =>
      [0, 0.3, 0.8].flatMap((gap) => {
        const cal = calAt(tiltDeg);
        const box = boxOf(category, shape, w, h, gap, cal);
        const c = frameCuts(box);
        const d = det({ category, shape, slot: 'n', box });
        const { row, bounds } = geoMeasure(d, { n: cal }, ROOM);
        const read = row.dimMM;
        return c.bottom && !c.top && read ? [{ d, cal, truth: [w, h] as const, read, bounds }] : [];
      }),
    ),
  );

  /** Where each uncut axis's truth sits against the bound the placer reported. */
  const tally = (rows: ReadonlyArray<{ d: Detection; truth: readonly [number, number]; read: readonly number[]; bounds: ReadBounds }>) => {
    const t = { widthLarge: 0, widthCut: 0, heightLow: 0, heightHigh: 0, exact: 0 };
    for (const { d, truth, read, bounds } of rows) {
      if (cutAxes(d.box, 'floor').width) t.widthCut++;
      else {
        // The most it can be: at or above the truth.
        expect(bounds.width.kind).toBe('upper');
        expect(read[0]).toBeGreaterThanOrEqual(truth[0]);
        if (read[0] > truth[0]) t.widthLarge++;
      }
      const h = bounds.height;
      if (read[2] < truth[1]) {
        t.heightLow++;
        // Read low, and bounded above by the lens: a falling top ray is below it.
        expect(h.kind === 'lower' && truth[1] <= h.ceilMM).toBe(true);
      } else if (read[2] > truth[1]) {
        t.heightHigh++;
        expect(h.kind === 'upper' && truth[1] >= h.floorMM).toBe(true);
      } else t.exact++;
    }
    return t;
  };

  it('reads each axis on the side its placer says, never the other', () => {
    expect(ROWS).toHaveLength(44);
    // Every direction the rule allows is exercised, so the fixture can tell them apart.
    expect(tally(ROWS)).toEqual({ widthLarge: 14, widthCut: 16, heightLow: 16, heightHigh: 12, exact: 16 });
  });

  // The round placer is a different solve — tangents to a circle, not corners of a box —
  // so it is asked the same question on its own fixture: every round floor kind as a
  // cylinder of its catalogue width and height, on the same walls and tilts.
  const ROUND: Array<[Category, Shape]> = [['fan', 'fan-standing'], ['plant', 'plant'], ['lamp', 'lamp-floor'], ['chair', 'stool']];
  const roundRows = (tiltDeg: number) =>
    ROUND.flatMap(([category, shape]) =>
      [0, 0.3, 0.8].flatMap((gap) => {
        const cal = calAt(tiltDeg);
        const dia = defaultAxisFor(category, shape, 0), h = defaultAxisFor(category, shape, 2);
        const z = -(wallD('n', ROOM) - gap - dia / 2000);
        const box = clip(bboxOfFloorCylinder('n', 0.3, z, dia / 1000, h / 1000, cal));
        const c = frameCuts(box);
        const d = det({ category, shape, slot: 'n', box });
        const { row, bounds } = geoMeasure(d, { n: cal }, ROOM);
        const read = row.dimMM;
        return c.bottom && !c.top && read ? [{ d, cal, truth: [dia, h] as const, read, bounds }] : [];
      }),
    );

  it('reads a round piece on the same sides, and never calls it the wrong size', () => {
    const rows = [0, -10, -20].flatMap(roundRows);
    expect(rows).toHaveLength(29);
    expect(tally(rows)).toEqual({ widthLarge: 26, widthCut: 1, heightLow: 11, heightHigh: 12, exact: 6 });
    expect(rows.filter(({ d, cal }) => judgeLabel(d, { n: cal }, ROOM).status === 'suspect')).toEqual([]);
  });

  it('pins the one place a round reading crosses its bound: the lens tipped down', () => {
    // `floorFromRound` reads its tangents on the top row with the lens tipped down and
    // carries a residual of its own there. Of the five rows 10° down, one crosses: a
    // standing fan 300 mm off its wall, 13 mm narrower than the most it can be and 3 mm
    // taller than the least. Pinned so that growing shows, and still no accusation.
    const rows = roundRows(10);
    expect(rows).toHaveLength(5);
    const crossed = rows.filter(({ truth, read, bounds }) =>
      read[0] < truth[0] || (bounds.height.kind === 'lower' ? read[2] > truth[1] : read[2] < truth[1]),
    );
    expect(crossed.map(({ d, truth, read }) => [d.shape, truth[0], read[0], truth[1], read[2]])).toEqual([
      ['fan-standing', 650, 637, 900, 903],
    ]);
    expect(rows.filter(({ d, cal }) => judgeLabel(d, { n: cal }, ROOM).status === 'suspect')).toEqual([]);
  });

  it('pins where the bound leans on the catalogue depth: a shallow piece on the wall', () => {
    // The far end is the piece's back on the plaster at its kind's TYPICAL depth. A sofa
    // shallower than a typical sofa's 950, pushed against the wall, has its near face
    // further out than that, so it reads short of the most-it-can-be the bound claims.
    const level = calAt(0);
    const read = (depthM: number) => {
      const z = -(wallD('n', ROOM) - depthM / 2);
      const box = clip(bboxOfFloorBox('n', 0.3, z, 2.0, 0.8, depthM, level));
      const { row, bounds } = geoMeasure(det({ category: 'sofa', shape: 'sofa', slot: 'n', box }), { n: level }, ROOM);
      expect(frameCuts(box)).toMatchObject({ bottom: true, left: false, right: false });
      expect(bounds.width.kind).toBe('upper');
      return row.dimMM![0];
    };
    expect(defaultDepthFor('sofa', 'sofa')).toBe(950);
    expect([read(0.95), read(0.75), read(0.6)]).toEqual([2000, 1680, 1500]);
  });

  it('never calls a correct word the wrong size here', () => {
    // Judged both ways on the uncut axes, six of the forty-four readings of a correctly
    // named piece fall outside its own band — which is the defect this fixture exists
    // to show it can express.
    const twoSided = ROWS.filter(({ d, read }) => {
      const r = dimRangeFor(d.category, d.shape as Shape);
      const w = !cutAxes(d.box, 'floor').width && (read[0] < r.min[0] || read[0] > r.max[0]);
      return w || read[2] < r.min[2] || read[2] > r.max[2];
    });
    expect(twoSided).toHaveLength(6);
    expect(ROWS.filter(({ d, cal }) => judgeLabel(d, { n: cal }, ROOM).status === 'suspect')).toEqual([]);
  });

  it('withdraws the two accusations § 49.10 was measured on', () => {
    const level = calAt(0);
    // 800 mm off the wall, an 800 mm sofa reads 333 tall — read low, as a piece below
    // the lens is — and a 2.0 m wardrobe reads 2667, read high. Judged both ways, the
    // sofa was too short for a sofa and the wardrobe too tall for a wardrobe.
    const sofa = det({ category: 'sofa', shape: 'sofa', slot: 'n', box: boxOf('sofa', 'sofa', 2000, 800, 0.8, level) });
    const wardrobe = det({ category: 'wardrobe', shape: 'wardrobe', slot: 'n', box: boxOf('wardrobe', 'wardrobe', 1200, 2000, 0.8, level) });
    expect(geoRefine(sofa, { n: level }, ROOM).dimMM![2]).toBe(333);
    expect(geoRefine(wardrobe, { n: level }, ROOM).dimMM![2]).toBe(2667);
    expect(judgeLabel(sofa, { n: level }, ROOM)).toEqual({ status: 'ok', cut: ['width'], bounded: ['height'] });
    expect(judgeLabel(wardrobe, { n: level }, ROOM)).toEqual({ status: 'ok', cut: ['width'], bounded: ['height'] });
    // A word the reading could still be is offered without the "camera does not agree"
    // caveat the scan screen hangs on a negative margin: the bound puts the truth on
    // the band's edge, not outside it.
    const [offer] = candidatesFor(wardrobe, ['wardrobe'], { n: level }, ROOM, { requireFit: false });
    expect(offer.margin).toBe(0);
  });

  it('still catches a wrong word on the side the reading speaks for', () => {
    const level = calAt(0);
    const on = (box: Detection['box'], category: Category) =>
      judgeLabel(det({ category, slot: 'n', box }), { n: level }, ROOM);
    const failed = (v: ReturnType<typeof judgeLabel>) => (v.status === 'suspect' ? v.failed : v.status);
    // A width read at its largest that is still narrower than any bed.
    expect(failed(on(boxOf('nightstand', 'nightstand', 450, 550, 0.3, level), 'bed'))).toEqual(['width']);
    // Heights read at the far end are bounded by the lens on their other side: the
    // coffee table's top is below the camera wherever it stands, so it is no wardrobe…
    expect(failed(on(boxOf('table', 'coffee-table', 1000, 450, 0.3, level), 'wardrobe'))).toEqual(['height']);
    // …and the wardrobe's is above it, so it is no nightstand.
    expect(failed(on(boxOf('wardrobe', 'wardrobe', 1200, 2000, 0.3, level), 'nightstand'))).toEqual(['height']);
  });

  it('says which of its numbers are limits, and on which side', () => {
    // What the scan screen prints after "Measured". A limit printed as its one number
    // reads as a size, so the verdict carries where the truth can be: the least and the
    // most, the same number twice only when the reading is a size.
    const level = calAt(0);
    const on = (box: Detection['box'], category: Category) => {
      const { candidates: _c, ...v } = judgeLabel(det({ category, slot: 'n', box }), { n: level }, ROOM) as Extract<
        LabelVerdict,
        { status: 'suspect' }
      >;
      return v;
    };
    // The wardrobe called a nightstand: its width is cut, so absent; its height is read
    // high, so it is at most 2756 and at least the 1.5 m lens its top is above.
    expect(on(boxOf('wardrobe', 'wardrobe', 1200, 2000, 0.8, level), 'nightstand')).toEqual({
      status: 'suspect',
      failed: ['height'],
      allowed: { width: [300, 700], height: [350, 800] },
      measured: { height: [1500, 2756] },
      cut: ['width'],
      bounded: ['height'],
    });
    // The coffee table called a wardrobe: seen whole across, so its width is at most what
    // was read; its top is below the lens, read low, so its height is at least 265.
    expect(on(boxOf('table', 'coffee-table', 1000, 450, 0.3, level), 'wardrobe')).toEqual({
      status: 'suspect',
      failed: ['height'],
      allowed: { width: [600, 4000], height: [1600, 2600] },
      measured: { width: [0, 1273], height: [265, 1500] },
      bounded: ['width', 'height'],
    });
  });

  it('offers the right word back where only the bound lets it fit', () => {
    // The wardrobe 800 mm off its wall, called a nightstand: caught on its height. Read
    // as a wardrobe it is 2667, past the tallest wardrobe — but that reading is the
    // most it can be, so the repair list still carries the word that was right.
    const level = calAt(0);
    const box = boxOf('wardrobe', 'wardrobe', 1200, 2000, 0.8, level);
    const v = judgeLabel(det({ category: 'nightstand', slot: 'n', box }), { n: level }, ROOM);
    // First, and not merely listed: five words tie on the band's edge here, and the scan
    // screen shows two chips. Ordered by the catalogue the wardrobe came last; by how
    // far each word's band is from the reading as read, it comes first.
    expect(v.status === 'suspect' && v.candidates.map((c) => [c.category, c.margin])).toEqual([
      ['wardrobe', 0],
      ['plant', 0],
      ['shelf', 0],
      ['fridge', 0],
      ['lamp', 0],
    ]);
  });

  it('puts the right word where the scan screen shows it more often', () => {
    // Of the wrong words caught on the fixture, how often the right one is first, and
    // how often it is among the two chips the scan screen shows. Ties broken by the
    // catalogue's order: 37 first and 112 of the two. Broken by a share of each band's
    // span: 47 and 130. By the factor the reading would have to move: 56 and 130.
    let caught = 0, first = 0, shown = 0;
    for (const { d, cal } of ROWS) {
      for (const category of CATEGORIES) {
        if (category === 'other' || category === d.category) continue;
        const v = judgeLabel(det({ category, slot: 'n', box: d.box }), { n: cal }, ROOM);
        if (v.status !== 'suspect') continue;
        caught++;
        const i = v.candidates.findIndex((c) => c.category === d.category);
        if (i === 0) first++;
        if (i === 0 || i === 1) shown++;
      }
    }
    expect([caught, first, shown]).toEqual([328, 56, 130]);
  });

  it('still catches half the wrong words in the fixture', () => {
    // Every other category's word on every row, where its own placer measured it. Of
    // 665, the rule catches 328; judged both ways it caught 485 and accused six
    // correct words doing it. The 157 between are words one photograph cannot rule
    // out once the piece may stand anywhere nearer — § 49.10 has the trade.
    let judged = 0, caught = 0;
    for (const { d, cal } of ROWS) {
      for (const category of CATEGORIES) {
        if (category === 'other' || category === d.category) continue;
        const v = judgeLabel(det({ category, slot: 'n', box: d.box }), { n: cal }, ROOM);
        if (v.status === 'unmeasured') continue;
        judged++;
        if (v.status === 'suspect') caught++;
      }
    }
    expect([judged, caught]).toEqual([665, 328]);
  });
});

describe('judgeLabels', () => {
  it('returns one verdict per detection, in order', () => {
    const dets = [
      det({ category: 'painting', shape: 'painting', slot: 'n', box: WALL_BOX }),
      det({ category: 'bed', slot: 'n', box: WALL_BOX }),
      det({ category: 'fan', shape: 'fan', slot: 'n' }),
    ];
    expect(judgeLabels(dets, CALS, ROOM).map((v) => v.status)).toEqual(['ok', 'suspect', 'unmeasured']);
  });

  it('judges nothing when the room cannot be measured', () => {
    // No room means no calibration means no evidence. Every row is unmeasured, and
    // in particular none is `ok` — the geometry never agreed with anything.
    const dets = [det({ category: 'bed', slot: 'n', box: WALL_BOX })];
    expect(judgeLabels(dets, CALS, null).map((v) => v.status)).toEqual(['unmeasured']);
  });
});

describe('judgeLabel — ceiling items', () => {
  it('delivers the benchmark’s ceiling-hook row, on width alone', () => {
    // §3 of the detection plan listed "a ceiling hook called a ceiling fan" as a
    // real finding that arithmetic could reach but geoRefine could not, because
    // nothing measured a ceiling. 100 mm against a fan's 900 mm floor is now an
    // actual measurement rather than a table lookup.
    const v = judgeLabel(det({ category: 'fan', shape: 'fan', slot: 'n', box: HOOK_BOX }), WIDE_CALS, ROOM);
    expect(v.status).toBe('suspect');
    if (v.status !== 'suspect') return;
    expect(v.failed).toEqual(['width']);
    // Nothing measured a height, so none is reported. A caller printing a fallback
    // here would put a catalogue default on screen after the word "Measured".
    expect(v.measured.height).toBeUndefined();
    // Read as a size, not a limit: one number at both ends.
    const [least, most] = v.measured.width!;
    expect(least).toBe(most);
    expect(most).toBeLessThan(dimRangeFor('fan', 'fan').min[0]);
    expect(v.bounded).toBeUndefined();
  });

  it('never accuses a ceiling word on a height it did not measure', () => {
    // A plausible fan width, carrying an AI height hint far outside the fan band.
    // The hint survives into dimMM — clampDims gates it downstream, as it gates
    // every hint — but it is NOT evidence against the word, because one model
    // produced both the word and the number. They agree by construction.
    const tall = det({
      category: 'fan',
      shape: 'fan',
      slot: 'n',
      box: CEILING_BOX,
      dimMM: [1, 1000, 3000],
    });
    expect(3000).toBeGreaterThan(dimRangeFor('fan', 'fan').max[2]); // premise
    expect(sizeFitsLabel('fan', 'fan', 1260, 3000)).toBe(false); // …and would fail
    expect(judgeLabel(tall, WIDE_CALS, ROOM).status).toBe('ok');
  });

  it('clears a plausible fan', () => {
    const v = judgeLabel(det({ category: 'fan', shape: 'fan', slot: 'n', box: CEILING_BOX }), WIDE_CALS, ROOM);
    expect(v).toEqual({ status: 'ok' });
  });

  it('still says nothing when no ceiling is in frame', () => {
    // Narrow level lens: placeCeilingObject refuses, geoRefine returns its input,
    // and identity is still how measurability is established.
    expect(judgeLabel(det({ category: 'fan', shape: 'fan', slot: 'n', box: CEILING_BOX }), CALS, ROOM).status).toBe(
      'unmeasured',
    );
  });

  it('WITHDRAWS a verdict on a return-wall piece rather than accusing it', () => {
    // `onFramedSurface` was described as stopping `judgeLabel` accusing a correctly
    // identified piece. For the print that was the wrong way round and needed a test to
    // see it: `painting`'s band is 150–2400 × 150–1800, so the fabricated 893 × 803 sat
    // comfortably inside and the old answer was **`ok`** — a false clean bill, not an
    // accusation. What the refusal buys here is that the clean bill is withdrawn.
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    const cals: CalMap = { n: wide, e: wide, s: wide, w: wide };
    const onNorth = (view: 'n' | 'e') =>
      det({
        label: 'framed print',
        category: 'painting',
        shape: 'painting',
        slot: view,
        box: bboxOfWallSolid('n', view, 2.2, 1.5, wallD('n', ROOM), 0.7, 0.5, 0.03, wide),
      });
    // Its own camera measures it and clears it, for the right reason.
    expect(judgeLabel(onNorth('n'), cals, ROOM).status).toBe('ok');
    // The neighbour's camera now says nothing at all, where it used to say `ok` about a
    // piece it had sized 28% wide and 61% tall.
    expect(judgeLabel(onNorth('e'), cals, ROOM).status).toBe('unmeasured');
    // And the band is why `ok` was reachable — pinned, so the reason cannot rot.
    const band = dimRangeFor('painting', 'painting');
    expect(band.min[0]).toBeLessThan(893);
    expect(band.max[0]).toBeGreaterThan(893);
    expect(band.max[2]).toBeGreaterThan(803);
  });
});

describe('judgeLabel — a ceiling piece the edge of the photo cut', () => {
  // A 1200 mm ceiling fan, projected from the truth. A ceiling piece is read on one
  // row of its disc and never grown, so an edge of the frame anywhere on it leaves no
  // width to judge: cut at the side it reads long or short depending on where it
  // hangs, and cut at the top — a fan near a level lens, the usual case — long.
  const deep: RoomDims = { width: 6, depth: 6, height: 2.8, footprint: footprintForLayout('rect', 6, 6) };
  const clip = ([x, y, w, h]: readonly number[]): Detection['box'] => {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    return [x0, y0, Math.min(1, x + w) - x0, Math.min(1, y + h) - y0];
  };
  const fan = (x: number, z: number) =>
    det({ category: 'fan', shape: 'fan', slot: 'n', box: clip(bboxOfCeilingDisc('n', x, z, 1.2, WIDE, deep.height)) });
  const read = (d: Detection) => geoRefine(d, WIDE_CALS, deep).dimMM![0];

  it('judges a fan wholly in view', () => {
    const whole = fan(0, -2);
    expect(frameCuts(whole.box)).toEqual({ left: false, right: false, top: false, bottom: false });
    expect(read(whole)).toBe(1145);
    expect(judgeLabel(whole, WIDE_CALS, deep)).toEqual({ status: 'ok' });
  });

  it('gives no verdict on a fan cut at the side', () => {
    // Read 17% long here, and 22% short 600 mm further east: no bound either way.
    const side = fan(1.8, -2);
    expect(frameCuts(side.box)).toEqual({ left: false, right: true, top: false, bottom: false });
    expect(read(side)).toBe(1402);
    const further = fan(2.4, -2);
    expect(frameCuts(further.box)).toEqual({ left: false, right: true, top: false, bottom: false });
    expect(read(further)).toBe(935);
    expect(judgeLabel(further, WIDE_CALS, deep)).toEqual({ status: 'unmeasured', cut: ['width'] });
    expect(judgeLabel(side, WIDE_CALS, deep)).toEqual({ status: 'unmeasured', cut: ['width'] });
    // And its mirror image, off the left.
    const left = fan(-1.8, -2);
    expect(frameCuts(left.box)).toEqual({ left: true, right: false, top: false, bottom: false });
    expect(judgeLabel(left, WIDE_CALS, deep)).toEqual({ status: 'unmeasured', cut: ['width'] });
  });

  it('withdraws the accusation from a fan cut at the top', () => {
    const top = fan(0, -1.2);
    expect(frameCuts(top.box)).toEqual({ left: false, right: false, top: true, bottom: false });
    // Past the widest fan there is, so this correct fan was called too big for one.
    expect(read(top)).toBe(1748);
    expect(read(top)).toBeGreaterThan(dimRangeFor('fan', 'fan').max[0]);
    expect(judgeLabel(top, WIDE_CALS, deep)).toEqual({ status: 'unmeasured', cut: ['width'] });
    // Nearer, longer; further out, where the frame only grazes it, nearly right — and
    // still not judged, which is the price: one edge cannot say how much it took.
    expect(read(fan(0, -0.9))).toBe(2498);
    const grazed = fan(0, -1.8);
    expect(frameCuts(grazed.box).top).toBe(true);
    expect(read(grazed)).toBe(1196);
    expect(judgeLabel(grazed, WIDE_CALS, deep)).toEqual({ status: 'unmeasured', cut: ['width'] });
  });

  it('is still BUILT from the cut width, clamped to the band — § 49.13, measured and not fixed', () => {
    // Not judged is not not used: the room is built from what `geoRefine` wrote, and
    // the clamp hides by how much. A literal on purpose, so the fix turns it red.
    const build = (d: Detection) =>
      buildSceneFromRoom({
        id: 'r',
        createdAt: 1,
        name: 'R',
        layoutId: 'rect',
        width: deep.width,
        depth: deep.depth,
        height: deep.height,
        detectedObjects: [toRecord(geoRefine(d, WIDE_CALS, deep), 0, true, () => 'u-1')],
      });
    const [top] = build(fan(0, -1.2));
    expect(top.shape).toBe('fan');
    expect(top.dimMM[0]).toBe(1500);
    expect(top.dimMM[0]).toBe(dimRangeFor('fan', 'fan').max[0]);
    // A side cut inside the band goes in as read.
    expect(build(fan(1.8, -2))[0].dimMM[0]).toBe(1402);
  });

  it('gives no verdict on a fan cut at the bottom, from a phone pointed at the ceiling', () => {
    const steep: CameraCal = { k: 2 * Math.tan(((66 / 2) * Math.PI) / 180), aspect: 4 / 3, tiltRad: (-60 * Math.PI) / 180 };
    const cals: CalMap = { n: steep };
    const d = det({ category: 'fan', shape: 'fan', slot: 'n', box: clip(bboxOfCeilingDisc('n', 0, -2, 1.2, steep, deep.height)) });
    expect(frameCuts(d.box)).toEqual({ left: false, right: false, top: false, bottom: true });
    expect(geoRefine(d, cals, deep).dimMM![0]).toBe(1111);
    expect(judgeLabel(d, cals, deep)).toEqual({ status: 'unmeasured', cut: ['width'] });
  });
});

describe('judgeLabel — on the plane its placer read it on', () => {
  it('judges a curtain given a ceiling shape as the wall piece it was measured as', () => {
    // Cloth on a wall whatever the anchor table calls its shape: `geoRefine` measures
    // this row with the WALL placer, which saw its width and grew the height the top of
    // the frame cut. Read as a ceiling piece it was "cut" on the width it had measured
    // and silent on the height it had grown.
    const clip = ([x, y, w, h]: readonly number[]): Detection['box'] => {
      const x0 = Math.max(0, x), y0 = Math.max(0, y);
      return [x0, y0, Math.min(1, x + w) - x0, Math.min(1, y + h) - y0];
    };
    const box = clip(bboxOfWallSolid('n', 'n', 0.2, 1.75, wallD('n', ROOM), 1.4, 1.9, 0.08, CAL));
    expect(frameCuts(box)).toEqual({ left: false, right: false, top: true, bottom: false });
    const d = det({ label: 'curtain', category: 'curtain', shape: 'lamp-pendant', slot: 'n', box });
    expect(sceneShapeFor('curtain', d.label, d.shape)).toBe('lamp-pendant');
    const v = judgeLabel(d, { n: CAL }, ROOM);
    expect(v.status).toBe('suspect');
    if (v.status !== 'suspect') return;
    expect(v.cut).toEqual(['height']);
    expect(v.failed).toEqual(['width']);
    expect(Object.keys(v.measured)).toEqual(['width']);
  });
});

describe('accepting a repair', () => {
  // The scan screen works its verdicts out from a copy of the rows that ignores
  // colour, so the photo's sample landing does not re-run every check. A candidate can
  // therefore be measured from the row as it was BEFORE its colour arrived.
  const before = det({ label: 'Sofa', category: 'sofa', slot: 'n', box: [0.175, 0.75, 0.65, 0.1] });
  const now: Detection = { ...before, color: '#7a5c3e' };
  const [bed] = candidatesFor(before, ['bed'], CALS, ROOM);

  it('keeps the colour the photo gave the row', () => {
    expect(bed, 'fixture must offer a repair').toBeDefined();
    expect(bed.detection.color, 'fixture must predate the colour').toBeUndefined();
    const out = acceptCandidate(now, bed, 'Double bed');
    expect(out.color).toBe('#7a5c3e');
    // Everything the word decides comes from the candidate.
    expect(out.category).toBe('bed');
    expect(out.shape).toBe(bed.detection.shape);
    expect(out.dimMM).toEqual(bed.detection.dimMM);
    expect(out.label).toBe('Double bed');
  });

  it('writes no colour key for a row that has none yet', () => {
    // So the next sample still sees a row "missing colour" and paints it.
    expect('color' in acceptCandidate(before, bed, 'Bed')).toBe(false);
    // And never the candidate's own: it is the same row's, from earlier.
    const stale = { ...bed, detection: { ...bed.detection, color: '#111111' } };
    expect('color' in acceptCandidate(before, stale, 'Bed')).toBe(false);
  });
});

describe('a repair is built as the shape it was measured as', () => {
  // A light the detector called a ceiling fan: high in a wide frame, 400-odd mm across,
  // which no fan is and a pendant is.
  const LIGHT_BOX: Detection['box'] = [0.45, 0.03, 0.09, 0.14];
  const fan = det({ label: 'Ceiling fan', category: 'fan', slot: 'n', box: LIGHT_BOX });

  // What accepting it does on the scan screen: the candidate's detection, relabelled
  // with the category's plain name — then saved and built like any kept row.
  const accept = (cand: { category: Category; detection: Detection }, label: string) => {
    const rec = toRecord({ ...cand.detection, label }, 0, true, () => 'u-1');
    return buildSceneFromRoom({
      id: 'r',
      createdAt: 1,
      name: 'R',
      layoutId: 'rect',
      width: ROOM.width,
      depth: ROOM.depth,
      height: ROOM.height,
      detectedObjects: [rec],
    });
  };

  it('offers the light as the pendant its words make it, and builds a pendant', () => {
    const [lamp] = candidatesFor(fan, ['lamp'], WIDE_CALS, ROOM);
    expect(lamp).toBeDefined();
    // Measured on the ceiling, width alone — the pendant's plane — and called one.
    expect(lamp.detection.shape).toBe('lamp-pendant');
    expect(lamp.name).toBe('Pendant lamp');
    const parts = accept(lamp, 'Lamp');
    expect(parts).toHaveLength(1);
    expect(accept(lamp, lamp.name!)[0].shape).toBe('lamp-pendant');
    // The defect: a blank shape resolved from "Lamp" at build time is a floor lamp,
    // so a piece measured on the ceiling stood on the floor at a pendant's width.
    expect(parts[0].shape).toBe('lamp-pendant');
  });

  it('judges it against the band of the shape it carries', () => {
    const [lamp] = candidatesFor(fan, ['lamp'], WIDE_CALS, ROOM, { requireFit: false });
    const pendant = dimRangeFor('lamp', 'lamp-pendant');
    const w = lamp.detection.dimMM![0];
    // Width alone, as a ceiling piece is measured — the height in dimMM is the
    // catalogue's, not a measurement — and inside the PENDANT's band, whose floor is
    // not a plain lamp's.
    expect(pendant.min[0]).not.toBe(dimRangeFor('lamp', 'box').min[0]); // premise
    expect(lamp.margin).toBeCloseTo(Math.min(w - pendant.min[0], pendant.max[0] - w) / (pendant.max[0] - pendant.min[0]), 9);
  });

  // 134 mm across: inside a plain lamp's band (from 120) and under any pendant's (from
  // 150). Judged as the shape it would be built as, it is not a pendant, so it is not
  // offered as a repair; the looser band would have offered it.
  it('does not offer a light narrower than any pendant as one', () => {
    const thin = { ...fan, box: [0.47, 0.03, 0.031, 0.14] as Detection['box'] };
    const [measured] = candidatesFor(thin, ['lamp'], WIDE_CALS, ROOM, { requireFit: false });
    expect(measured.detection.dimMM![0]).toBeGreaterThan(dimRangeFor('lamp', 'box').min[0]); // premise
    expect(measured.detection.dimMM![0]).toBeLessThan(dimRangeFor('lamp', 'lamp-pendant').min[0]); // premise
    expect(candidatesFor(thin, ['lamp'], WIDE_CALS, ROOM)).toEqual([]);
  });

  // A 1.56 m row: a double bed's width, well past any single's. The words ("sofa")
  // name no kind of bed, so the plain one alone — a single bed — rejected it, and
  // before the shape was carried it was offered and then built squeezed to 1.2 m.
  const WIDE_BOX: Detection['box'] = [0.175, 0.75, 0.65, 0.1];
  const sofa = det({ label: 'sofa', category: 'sofa', slot: 'n', box: WIDE_BOX });

  it('measures the other kinds when the words name none, and says which it chose', () => {
    const [bed] = candidatesFor(sofa, ['bed'], CALS, ROOM);
    expect(bed).toBeDefined();
    expect(bed.detection.shape).toBe('bed-double');
    expect(bed.name).toBe('Double bed');
    const w = bed.detection.dimMM![0];
    expect(sizeFitsLabel('bed', 'bed-single', w, bed.detection.dimMM![2])).toBe(false); // premise
    expect(sizeFitsLabel('bed', 'bed-double', w, bed.detection.dimMM![2])).toBe(true);
    // Accepted under the name its chip shows, it builds the double bed it was measured
    // as, at the width it was measured at — nothing squeezed to fit.
    const [part] = accept(bed, bed.name!);
    expect(part.shape).toBe('bed-double');
    expect(part.dimMM[0]).toBe(w);
    // A typed word is answered the same way: the kind that fits, over the plain one that does not.
    expect(candidatesFor(sofa, ['bed'], CALS, ROOM, { requireFit: false })[0].detection.shape).toBe('bed-double');
  });

  it('keeps the plain kind when it fits, even where another kind fits too', () => {
    const chair = det({ label: 'thing', category: 'bed', slot: 'n', box: [0.375, 0.75, 0.25, 0.1] });
    const [c] = candidatesFor(chair, ['chair'], CALS, ROOM);
    expect(c.detection.shape).toBe('chair-dining');
    expect(c.name).toBeUndefined();
    // premise: the office chair fits this row as well, so the rule is what chose
    const office = candidatesFor({ ...chair, label: 'office chair' }, ['chair'], CALS, ROOM);
    expect(office[0]?.detection.shape).toBe('chair-office');
  });

  it('reaches another kind only where the plain one misfits', () => {
    const tall = det({ label: 'thing', category: 'bed', slot: 'n', box: [0.375, 0.65, 0.25, 0.2] });
    const [c] = candidatesFor(tall, ['chair'], CALS, ROOM);
    expect([c.detection.shape, c.name]).toEqual(['chair-office', 'Office chair']);
  });

  it('of several kinds that fit where the plain one does not, takes the most comfortable', () => {
    const row = det({ label: 'thing', category: 'bed', slot: 'n', box: [0.37, 0.68, 0.26, 0.1] });
    const [c] = candidatesFor(row, ['chair'], CALS, ROOM);
    const [arm] = candidatesFor({ ...row, label: 'armchair' }, ['chair'], CALS, ROOM);
    expect(candidatesFor({ ...row, label: 'dining chair' }, ['chair'], CALS, ROOM)).toEqual([]); // premise: plain misfits
    expect(arm.detection.shape).toBe('chair-armchair'); // premise: and an armchair fits too
    expect(c.detection.shape).toBe('chair-office');
    expect(c.margin).toBeGreaterThan(arm.margin);
  });

  it('leaves words that name a kind alone, fitting or not', () => {
    // "single bed" at 1.56 m: the user's or the detector's word, not second-guessed.
    const said = { ...sofa, label: 'single bed' };
    expect(candidatesFor(said, ['bed'], CALS, ROOM)).toEqual([]);
    const [kept] = candidatesFor(said, ['bed'], CALS, ROOM, { requireFit: false });
    expect([kept.detection.shape, kept.name]).toEqual(['bed-single', undefined]);
    expect(kept.margin).toBeLessThan(0);
  });

  // The fix leans on one fact the scan screen holds: every label it writes onto an
  // accepted repair is a category's plain name, which never outvotes a shape the row
  // carries. Read from the screen itself, since that is where the words live — a
  // label like "Ceiling light" added there would build every accepted lamp as a
  // pendant whatever it was measured as.
  it('the scan screen only ever writes labels that leave the shape alone', () => {
    const src = readFileSync(join(process.cwd(), 'app/onboarding/detect/page.tsx'), 'utf8');
    const start = src.indexOf('const MANUAL_CATEGORIES');
    const table = src.slice(start, src.indexOf('\n];', start));
    const pairs = [...table.matchAll(/\{ value: '([a-z-]+)', label: '([^']+)' \}/g)].map((m) => [m[1], m[2]] as const);
    expect(pairs.map(([v]) => v).sort()).toEqual([...CATEGORIES].sort());
    for (const [value, label] of pairs) {
      const cat = value as Category;
      for (const shape of new Set(PART_LIBRARY.filter((p) => p.category === cat).map((p) => p.shape))) {
        if (shape === 'box') continue;
        expect([cat, label, sceneShapeFor(cat, label, shape)]).toEqual([cat, label, shape]);
      }
    }
  });
});
