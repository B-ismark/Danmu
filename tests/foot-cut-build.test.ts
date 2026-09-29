// § 49.14, measured and decided against: building a floor piece cut at its foot at its
// kind's TYPICAL size, held inside what the photo allows, instead of at its reading.
//
// The first measurement of that idea used § 49.10's fixture, where three of six pieces
// ARE the catalogue's typical height, so on those a typical size cannot be wrong, and it
// looked like a clear win (heights more than 10% off, 19 → 4). This fixture puts every
// kind at 0.75, 1 and 1.3 times its typical width and 0.8, 1 and 1.2 times its typical
// height, so the typical rows are a third rather than a half, and reports the other two
// thirds on their own. There the idea is WORSE on the count that matters: more pieces
// built more than 10% off than building at the reading, on both axes. A halfway blend is
// measured too, and is not built either: it helps heights and costs widths, and "half"
// is a constant fitted to this fixture. Printed on every green run (see
// `--disableConsoleIntercept` in CLAUDE.md), and the counts are pinned as literals, so
// a change to the placer that moves them has to say so here.
import { describe, expect, it } from 'vitest';
import { clipToFrame, cutAxes, frameCuts, wallFrame, type CameraCal, type ReadBound } from '@/lib/photo-geometry';
import { defaultAxisFor, defaultDepthFor, type Category, type Shape } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { geoMeasure, type RoomDims } from '@/lib/detect-refine';
import type { Detection } from '@/lib/detection';
import { footprintForLayout } from '@/lib/footprint';
import { bboxOfFloorBox } from './helpers/project';

const ROOM: RoomDims = { width: 6, depth: 4, height: 2.8, footprint: footprintForLayout('rect', 6, 4) };
const WIDE: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
const KINDS: Array<[Category, Shape]> = [
  ['nightstand', 'nightstand'],
  ['sofa', 'sofa'],
  ['table', 'coffee-table'],
  ['wardrobe', 'wardrobe'],
  ['shelf', 'bookshelf'],
  ['desk', 'desk-standard'],
];

/** The idea: the typical size, inside the side of the reading the placer reported. The
 *  lens floor on an `upper` height never binds on this fixture, since every kind whose
 *  top ray rises (wardrobe, bookshelf) is typically taller than the 1.5 m lens, so
 *  dropping it changes no count: an equivalent mutant, checked, not a hole. */
const atTypical = (v: number, b: ReadBound, typ: number) =>
  b.kind === 'upper' ? Math.min(Math.max(typ, b.floorMM), v) : b.kind === 'lower' ? Math.max(Math.min(typ, b.ceilMM), v) : v;
const halfway = (v: number, b: ReadBound, typ: number) => (v + atTypical(v, b, typ)) / 2;

type Tally = { n: number; off: [number, number, number]; err: [number, number, number] };

/** Every foot-cut, top-whole row of the fixture, each bounded axis tallied three ways:
 *  as read, at typical, halfway. */
function measure() {
  const out: Record<'width' | 'height', Record<'off' | 'typical', Tally>> = {
    width: { off: blank(), typical: blank() },
    height: { off: blank(), typical: blank() },
  };
  let rows = 0;
  const wd = wallFrame('n', ROOM.footprint)!.distance;
  for (const tilt of [0, -10, -20])
    for (const [category, shape] of KINDS) {
      const r = dimRangeFor(category, shape);
      const typ = [defaultAxisFor(category, shape, 0), defaultAxisFor(category, shape, 2)] as const;
      const depth = defaultDepthFor(category, shape) / 1000;
      for (const fw of [0.75, 1, 1.3])
        for (const fh of [0.8, 1, 1.2])
          for (const gap of [0, 0.3, 0.8]) {
            const truth = [
              Math.min(Math.max(typ[0] * fw, r.min[0]), r.max[0]),
              Math.min(Math.max(typ[1] * fh, r.min[2]), r.max[2]),
            ] as const;
            if (wd - gap - depth <= 0) continue;
            const cal = { ...WIDE, tiltRad: (tilt * Math.PI) / 180 };
            const raw = bboxOfFloorBox('n', 0.3, -(wd - gap - depth / 2), truth[0] / 1000, truth[1] / 1000, depth, cal);
            const box = raw && clipToFrame(raw as Detection['box']);
            if (!box) continue;
            const c = frameCuts(box);
            if (!c.bottom || c.top) continue;
            const d: Detection = { label: category, conf: 0.9, category, shape, slot: 'n', box };
            const { row, bounds } = geoMeasure(d, { n: cal }, ROOM);
            if (row === d || !row.dimMM) continue;
            rows++;
            const read = [row.dimMM[0], row.dimMM[2]] as const;
            (['width', 'height'] as const).forEach((axis, i) => {
              const b = bounds[axis];
              if (b.kind === 'exact' || (axis === 'width' && cutAxes(box, 'floor').width)) return;
              const t = out[axis][(i === 0 ? fw : fh) === 1 ? 'typical' : 'off'];
              t.n++;
              [read[i], atTypical(read[i], b, typ[i]), halfway(read[i], b, typ[i])].forEach((v, j) => {
                const e = Math.abs(v - truth[i]) / truth[i];
                t.err[j] += e;
                if (e > 0.1) t.off[j]++;
              });
            });
          }
    }
  return { rows, out };
}
function blank(): Tally {
  return { n: 0, off: [0, 0, 0], err: [0, 0, 0] };
}

describe('a floor piece cut at its foot, built at typical instead of at its reading (§ 49.14)', () => {
  const { rows, out } = measure();
  const pct = (t: Tally) => t.err.map((e) => Math.round((100 * e) / t.n));

  it('prints the measurement', () => {
    console.log('\n§ 49.14 · foot-cut floor pieces, more than 10% off (mean error): as read · at typical · halfway');
    for (const axis of ['width', 'height'] as const)
      for (const kind of ['off', 'typical'] as const) {
        const t = out[axis][kind];
        const m = pct(t);
        console.log(`  ${axis.padEnd(6)} ${kind === 'off' ? 'off typical' : 'at typical '} n=${String(t.n).padStart(3)}  ${t.off.map((o, j) => `${o} (${m[j]}%)`).join(' · ')}`);
      }
  });

  it('is a fixture whose typical rows are a third, not a half', () => {
    expect(rows).toBe(342);
    expect([out.width.off.n, out.width.typical.n, out.height.off.n, out.height.typical.n]).toEqual([126, 61, 225, 117]);
  });

  it('builds MORE off-typical pieces more than 10% off at typical than at the reading', () => {
    expect(out.width.off.off).toEqual([65, 90, 69]);
    expect(out.height.off.off).toEqual([90, 135, 75]);
    // …while on the typical rows it cannot miss, which is what the first measurement saw.
    expect(out.width.typical.off.slice(0, 2)).toEqual([31, 0]);
    expect(out.height.typical.off.slice(0, 2)).toEqual([54, 0]);
  });
});
