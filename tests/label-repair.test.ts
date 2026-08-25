import { describe, expect, it } from 'vitest';
import { categoriesFittingSize, judgeLabel, judgeLabels, sizeFitsLabel } from '@/lib/label-repair';
import { placeFloorObject, placeWallObject, type CameraCal } from '@/lib/photo-geometry';
import { PART_LIBRARY, type Category, type Shape } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import type { CalMap, RoomDims } from '@/lib/detect-refine';
import type { Detection } from '@/lib/detection';

const ROOM: RoomDims = { width: 6, depth: 4, height: 2.8 };
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
    const g = placeWallObject(WALL_BOX, 'n', ROOM, CAL)!;
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
    const g = placeFloorObject(WALL_BOX, 'n', ROOM, CAL)!;
    const v = judgeLabel(det({ category: 'bed', slot: 'n', box: WALL_BOX }), CALS, ROOM);
    expect(v.status).toBe('suspect');
    if (v.status !== 'suspect') return;
    expect(v.measured).toEqual({ width: g.widthMM, height: g.heightMM });
    expect(v.allowed.width).toEqual([dimRangeFor('bed', 'box').min[0], dimRangeFor('bed', 'box').max[0]]);
    expect(v.failed).toEqual(['width', 'height']); // a 480 mm wide, 1.68 m tall bed
  });

  it('re-measures every candidate under its own anchor', () => {
    // The re-entrancy point. A candidate's category picks its anchor and the anchor
    // picks the projection, so the detection offered back has been measured again
    // rather than carrying the numbers taken under the wrong word.
    const v = judgeLabel(det({ category: 'bed', slot: 'n', box: WALL_BOX }), CALS, ROOM);
    if (v.status !== 'suspect') throw new Error('expected suspect');
    expect(v.candidates.length).toBeGreaterThan(0);
    for (const c of v.candidates) {
      expect(c.detection.category).toBe(c.category);
      expect(c.detection.shape).toBeUndefined(); // the shape went with the old word
      expect(c.detection.dimMM).toBeDefined();
      // Whatever it now measures, it fits the word being offered — otherwise it is
      // not a repair.
      expect(sizeFitsLabel(c.category, 'box', c.detection.dimMM![0], c.detection.dimMM![2])).toBe(true);
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
    expect(v.measured.width).toBeLessThan(dimRangeFor('fan', 'fan').min[0]);
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
});
