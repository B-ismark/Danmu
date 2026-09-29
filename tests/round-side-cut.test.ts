// § 49.9, measured and not built: a ROUND floor piece the photo's side edge cuts off.
//
// `floorFromRound` solves a disc from its box's two sides as the disc's two tangents. When
// the frame cuts one side, that side is the photo's edge, not the disc's. The filed idea
// was to solve from the one real side and the catalogue diameter instead. It was built and
// measured in two rounds, and what the measurement found is three mechanisms rather than
// one. That is the reason it is not shipped, and `docs/what-is-still-open.md` § 49.9 has
// the numbers. This fixture pins what the placer does TODAY, so the next attempt has
// something to beat and has to say what it moved.
//
// Every round floor kind stands as a cylinder at 0.75, 1 and 1.3 times its typical width,
// clamped to its band, because the fix assumes the typical width and § 49.14 showed that a
// fixture made mostly of typical pieces cannot tell you whether that assumption is right.
// Each one is placed 0, 300 and 800 mm off the north wall, on the 106° lens, level and
// tipped 10° up and down, and moved so that the frame's right or left edge cuts it. The box
// is the in-frame silhouette (`framedExtent`, § 49.16), not a clamp of the whole one.
// Printed on every green run (see `--disableConsoleIntercept` in CLAUDE.md).
import { describe, expect, it } from 'vitest';
import { frameCuts, wallFrame, type CameraCal } from '@/lib/photo-geometry';
import { defaultAxisFor, type Category, type Shape } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { geoMeasure, type RoomDims } from '@/lib/detect-refine';
import type { Detection } from '@/lib/detection';
import { footprintForLayout } from '@/lib/footprint';
import { floorCylinderPoints, framedExtent, project } from './helpers/project';

const ROOM: RoomDims = { width: 6, depth: 4, height: 2.8, footprint: footprintForLayout('rect', 6, 4) };
const WIDE: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
const KINDS: Array<[Category, Shape]> = [['fan', 'fan-standing'], ['plant', 'plant'], ['lamp', 'lamp-floor'], ['chair', 'stool']];
const TILTS = [0, -10, 10] as const;
const inPhoto = ([u, v]: [number, number]) => u >= 0 && u <= 1 && v >= 0 && v <= 1;

type Row = {
  /** Cut at the side only, so its base row is read as seen, or at its foot too, so its
   *  distance is assumed (the piece stood back against its wall, § 49.10). */
  foot: boolean;
  tilt: number;
  gap: number;
  typical: boolean;
  /** Centre error in metres: forward, positive toward the far wall, and along it. Only
   *  their sizes are read. */
  dErr: number;
  latErr: number;
  /** Where the placer stood it, and the width it was built at. */
  forward: number;
  widthM: number;
  /** Facts about the fixture itself, from the forward projection and not from the placer:
   *  whether the point of the base nearest the lens is in the photo, and whether any of
   *  the base is. */
  nearestInPhoto: boolean;
  baseInPhoto: boolean;
};

function measure(): Row[] {
  const out: Row[] = [];
  const wd = wallFrame('n', ROOM.footprint)!.distance;
  for (const tilt of TILTS)
    for (const [category, shape] of KINDS) {
      const r = dimRangeFor(category, shape);
      const typ = defaultAxisFor(category, shape, 0);
      const h = defaultAxisFor(category, shape, 2) / 1000;
      for (const fw of [0.75, 1, 1.3])
        for (const gap of [0, 0.3, 0.8])
          // The centre's offset from the frame edge's azimuth line, in radii: mostly in the
          // photo, about half, and more out than in.
          for (const s of [-0.6, -0.2, 0.2])
            for (const side of [1, -1]) {
              const diaMM = Math.min(Math.max(typ * fw, r.min[0]), r.max[0]);
              const dia = diaMM / 1000;
              const f = wd - gap - dia / 2;
              const cal = { ...WIDE, tiltRad: (tilt * Math.PI) / 180 };
              const x = side * (f * (WIDE.k / 2) + (s * dia) / 2);
              const pts = floorCylinderPoints(x, -f, dia, h);
              const box = framedExtent(pts.map((p) => project('n', ...p, cal)));
              if (!box) continue;
              const c = frameCuts(box);
              if (c.left === c.right || c.top) continue;
              const d: Detection = { label: category, conf: 0.9, category, shape, slot: 'n', box };
              const { row } = geoMeasure(d, { n: cal }, ROOM);
              if (row === d || !row.dimMM || !row.position) continue;
              out.push({
                foot: c.bottom,
                tilt,
                gap,
                typical: diaMM === typ,
                dErr: -row.position.z - f,
                latErr: row.position.x - x,
                forward: -row.position.z,
                widthM: row.dimMM[0] / 1000,
                nearestInPhoto: inPhoto(project('n', x, 0, -(f - dia / 2), cal)),
                baseInPhoto: pts.some((p) => p[1] === 0 && inPhoto(project('n', ...p, cal))),
              });
            }
    }
  return out;
}

type Cell = { n: number; dOff: number; latOff: number; dMM: number; latMM: number };
function cell(rows: Row[]): Cell {
  const mean = (k: 'dErr' | 'latErr') => Math.round((1000 * rows.reduce((a, r) => a + Math.abs(r[k]), 0)) / rows.length);
  return {
    n: rows.length,
    dOff: rows.filter((r) => Math.abs(r.dErr) > 0.1).length,
    latOff: rows.filter((r) => Math.abs(r.latErr) > 0.1).length,
    dMM: mean('dErr'),
    latMM: mean('latErr'),
  };
}

describe('a round floor piece cut at one side of the photo, as placed today (§ 49.9)', () => {
  const rows = measure();
  const table = (foot: boolean) =>
    Object.fromEntries(TILTS.map((t) => [t, cell(rows.filter((r) => r.foot === foot && r.tilt === t))]));

  it('prints the measurement', () => {
    console.log('\n§ 49.9 · round floor pieces cut at one side: rows · distance / lateral more than 100 mm off · mean error (mm)');
    for (const foot of [false, true])
      for (const t of TILTS) {
        const c = cell(rows.filter((r) => r.foot === foot && r.tilt === t));
        const lens = t === 0 ? 'level     ' : t < 0 ? `${-t}° up    ` : `${t}° down  `;
        console.log(`  ${foot ? 'side + foot' : 'side only  '} ${lens} n=${String(c.n).padStart(3)}  ${c.dOff} / ${c.latOff}  (${c.dMM} / ${c.latMM})`);
      }
  });

  it('pins the table, so a change to the round placer has to say what it moved', () => {
    expect(rows).toHaveLength(644);
    expect(table(false)).toEqual({
      0: { n: 54, dOff: 0, latOff: 18, dMM: 42, latMM: 65 },
      [-10]: { n: 46, dOff: 22, latOff: 24, dMM: 170, latMM: 214 },
      10: { n: 136, dOff: 8, latOff: 124, dMM: 45, latMM: 246 },
    });
    expect(table(true)).toEqual({
      0: { n: 162, dOff: 124, latOff: 122, dMM: 366, latMM: 361 },
      [-10]: { n: 166, dOff: 138, latOff: 122, dMM: 377, latMM: 347 },
      10: { n: 80, dOff: 74, latOff: 54, dMM: 297, latMM: 174 },
    });
  });

  // What the candidate ran into, pinned on the fixture's own projection rather than on the
  // placer, so each holds whatever the placer does next.
  it('hides the point of its base nearest the lens, so its bottom row is not its near face', () => {
    // A disc's nearest point sits straight ahead of its centre, and at the edge of a 106°
    // lens that is further out than the edge. The bottom row is then where the frame's edge
    // crosses the base, further off than the near face: the one-sided solve as first
    // written read it as the near face, and came back further out than the solve it
    // replaced. Level and tipped up, every row; tipped down, a fifth.
    const hidden = TILTS.map((t) => {
      const seen = rows.filter((r) => !r.foot && r.tilt === t);
      return [seen.length, seen.filter((r) => !r.nearestInPhoto).length];
    });
    expect(hidden).toEqual([[54, 54], [46, 46], [136, 28]]);
  });

  it('tipped up, shows none of its base at all, and the placer stands it on the wall', () => {
    // Its lowest point in the photo is where its own side leaves through the frame's edge,
    // above the floor, and no row of it is cut at the foot, so that point is read as a floor
    // contact, beyond the wall, and the centre's clamp stands the piece against it.
    const up = rows.filter((r) => !r.foot && r.tilt === -10);
    expect([up.length, up.filter((r) => !r.baseInPhoto).length]).toEqual([46, 46]);
    expect(up.filter((r) => Math.abs(r.forward - (2 - r.widthM / 2)) < 0.001).length).toBe(46);
    // Right only where it was against the wall to begin with.
    expect(up.filter((r) => r.gap > 0).length).toBe(22);
  });

  it('at a level lens and a typical size, is off where nothing is assumed', () => {
    // Side only, level, a typical size: no catalogue number can be wrong here, so what is
    // left is the frame's edge read as a tangent, which is what § 49.9 was filed for.
    const clean = rows.filter((r) => !r.foot && r.tilt === 0 && r.typical);
    expect(cell(clean)).toEqual({ n: 16, dOff: 0, latOff: 4, dMM: 28, latMM: 81 });
  });
});
