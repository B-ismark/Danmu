// § 49.9: a ROUND floor piece the photo's side edge cuts off.
//
// `floorFromRound` solves a disc from its box's two sides as the disc's two tangents. When
// the frame cuts one side, that side is the photo's edge, not the disc's, and the piece
// stood where a much narrower one would before `wholeAlong` drew it at its typical width
// there. With its foot in the photo it is now placed by the size it is drawn at
// (`floorFromRoundOneSide`): the one real side, the near rim and the typical radius. Cut at
// its foot as well it is not, because there that read worse than the two tangents, and
// those rows are the control: they must not move. `docs/what-is-still-open.md` § 49.9 has
// the numbers either side of the change.
//
// Every round kind the scan measures on the floor stands as a cylinder at 0.6, 0.8, 1 and
// 1.25 times its typical width, each only where its band allows it, so no width is clamped
// back onto another and fewer than a third of the rows are typical: the fix assumes the
// typical width, and § 49.14 showed that a fixture made mostly of typical pieces cannot
// tell you whether that assumption is right. `cylinder` is round too and is left out,
// because no scan reaches it: `sceneShapeFor` takes only a catalogue shape and it is not
// one. A table lamp stands on the floor here, which is where the floor placer puts one.
//
// Each piece is placed 0, 300 and 800 mm off the north wall of a 6 m room 4 m and 5 m
// deep, on the 106° lens, level and tipped 10° up and down. It is moved across the frame's
// right edge, where that edge meets the FLOOR under the tilt in question, by -1.5, -0.6,
// -0.2 and 0.2 radii: a sliver cut off, mostly in, about half, and more out than in. A
// piece that would stand past the room's side wall is left out. The box is the in-frame
// silhouette (`framedExtent`, § 49.16), not a clamp of the whole one.
// Only the right edge is swept; the left is its mirror, and one test says so.
// Printed on every green run (see `--disableConsoleIntercept` in CLAUDE.md).
import { describe, expect, it } from 'vitest';
import { CAM_HEIGHT, frameCuts, placeFloorObject, wallFrame, type CameraCal } from '@/lib/photo-geometry';
import { defaultAxisFor, type Category, type Shape } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { geoMeasure, type RoomDims } from '@/lib/detect-refine';
import type { Detection } from '@/lib/detection';
import { footprintForLayout } from '@/lib/footprint';
import { floorCylinderPoints, framedExtent, project } from './helpers/project';

const ROOMS: RoomDims[] = [4, 5].map((depth) => ({ width: 6, depth, height: 2.8, footprint: footprintForLayout('rect', 6, depth) }));
const WIDE: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
const KINDS: Array<[Category, Shape]> = [
  ['fan', 'fan-standing'],
  ['plant', 'plant'],
  ['lamp', 'lamp-floor'],
  ['lamp', 'lamp-table'],
  ['chair', 'stool'],
];
const TILTS = [0, -10, 10] as const;
const inPhoto = ([u, v]: [number, number]) => u >= 0 && u <= 1 && v >= 0 && v <= 1;

type Row = {
  /** The room's depth in metres. */
  room: number;
  /** Cut at the side only, so its base row is read as seen, or at its foot too, so its
   *  distance is assumed (the piece stood back against its wall, § 49.10). */
  foot: boolean;
  tilt: number;
  gap: number;
  /** The centre's offset from the frame's edge, in radii. */
  s: number;
  typical: boolean;
  /** Errors in metres: the centre forward, positive toward the far wall, and along the
   *  wall, then the width and height it was built at. Only their sizes are pinned; the
   *  mirror test reads the sign along the wall. */
  dErr: number;
  latErr: number;
  wErr: number;
  hErr: number;
  /** Where the placer stood it, the width it was built at, and the wall it stood by. */
  forward: number;
  widthM: number;
  wall: number;
  /** How far the piece as built reaches past the room's side wall, in metres: at or
   *  below zero inside the room. */
  past: number;
  /** Facts about the fixture itself, from the forward projection and not from the placer:
   *  whether the point of the base nearest the lens is in the photo, whether any of the
   *  base is, and whether any of the top is. */
  nearestInPhoto: boolean;
  baseInPhoto: boolean;
  topInPhoto: boolean;
};

function measure(side: 1 | -1): Row[] {
  const out: Row[] = [];
  for (const room of ROOMS) {
    const wd = wallFrame('n', room.footprint)!.distance;
    for (const tilt of TILTS) {
      const t = (tilt * Math.PI) / 180;
      const cal = { ...WIDE, tiltRad: t };
      for (const [category, shape] of KINDS) {
        const r = dimRangeFor(category, shape);
        const typ = defaultAxisFor(category, shape, 0);
        const h = defaultAxisFor(category, shape, 2) / 1000;
        for (const fw of [0.6, 0.8, 1, 1.25]) {
          const diaMM = typ * fw;
          if (diaMM < r.min[0] || diaMM > r.max[0]) continue;
          const dia = diaMM / 1000;
          for (const gap of [0, 0.3, 0.8]) {
            const f = wd - gap - dia / 2;
            // Where the frame's right edge meets the floor at the centre's distance.
            const edge = (WIDE.k / 2) * (Math.cos(t) * f + Math.sin(t) * CAM_HEIGHT);
            for (const s of [-1.5, -0.6, -0.2, 0.2]) {
              const x = side * (edge + (s * dia) / 2);
              // Near the far wall of the deeper room the frame's edge is past the room's end,
              // where no piece can stand. The rooms are rectangles, so the half-width is the
              // side wall.
              if (Math.abs(x) + dia / 2 > room.width / 2) continue;
              const pts = floorCylinderPoints(x, -f, dia, h);
              const uv = pts.map((p) => project('n', ...p, cal));
              const box = framedExtent(uv);
              if (!box) continue;
              const c = frameCuts(box);
              if (c.left === c.right || c.top) continue;
              const d: Detection = { label: category, conf: 0.9, category, shape, slot: 'n', box };
              const { row } = geoMeasure(d, { n: cal }, room);
              if (row === d || !row.dimMM || !row.position) continue;
              out.push({
                room: room.depth,
                foot: c.bottom,
                tilt,
                gap,
                s,
                typical: fw === 1,
                dErr: -row.position.z - f,
                latErr: row.position.x - x,
                wErr: row.dimMM[0] / 1000 - dia,
                hErr: row.dimMM[2] / 1000 - h,
                forward: -row.position.z,
                widthM: row.dimMM[0] / 1000,
                wall: wd,
                past: Math.abs(row.position.x) + row.dimMM[0] / 2000 - room.width / 2,
                nearestInPhoto: inPhoto(project('n', x, 0, -(f - dia / 2), cal)),
                baseInPhoto: pts.some((p, i) => p[1] === 0 && inPhoto(uv[i])),
                topInPhoto: pts.some((p, i) => p[1] === h && inPhoto(uv[i])),
              });
            }
          }
        }
      }
    }
  }
  return out;
}

type Cell = { n: number; dOff: number; latOff: number; dMM: number; latMM: number; wMM: number; hMM: number };
function cell(rows: Row[]): Cell {
  const mean = (k: 'dErr' | 'latErr' | 'wErr' | 'hErr') =>
    rows.length ? Math.round((1000 * rows.reduce((a, r) => a + Math.abs(r[k]), 0)) / rows.length) : 0;
  return {
    n: rows.length,
    dOff: rows.filter((r) => Math.abs(r.dErr) > 0.1).length,
    latOff: rows.filter((r) => Math.abs(r.latErr) > 0.1).length,
    dMM: mean('dErr'),
    latMM: mean('latErr'),
    wMM: mean('wErr'),
    hMM: mean('hErr'),
  };
}

describe('a round floor piece cut at one side of the photo (§ 49.9)', () => {
  const rows = measure(1);
  const pick = (room: number, foot: boolean, tilt: number) =>
    rows.filter((r) => r.room === room && r.foot === foot && r.tilt === tilt);
  const table = (room: number, foot: boolean) => Object.fromEntries(TILTS.map((t) => [t, cell(pick(room, foot, t))]));

  it('prints the measurement', () => {
    console.log(
      '\n§ 49.9 · round floor pieces cut at one side: rows · distance / along the wall more than 100 mm off · mean error in mm: distance / along the wall / width / height',
    );
    for (const room of [4, 5])
      for (const foot of [false, true])
        for (const t of TILTS) {
          const c = cell(pick(room, foot, t));
          const lens = t === 0 ? 'level     ' : t < 0 ? `${-t}° up    ` : `${t}° down  `;
          console.log(
            `  ${room} m deep  ${foot ? 'side + foot' : 'side only  '} ${lens} n=${String(c.n).padStart(3)}  ${c.dOff} / ${c.latOff}  (${c.dMM} / ${c.latMM} / ${c.wMM} / ${c.hMM})`,
          );
        }
  });

  it('is a fixture whose typical rows are under a third', () => {
    expect([rows.length, rows.filter((r) => r.typical).length]).toEqual([957, 282]);
  });

  it('pins the table, so a change to the round placer has to say what it moved', () => {
    // Side only, placed by the size it is drawn at. Before, along the wall: 53 / 266 mm in
    // the 4 m room, 53 / 119 / 265 in the 5 m, and 11 / 131, 15 / 20 / 80 rows off. The
    // tipped cells moved again when the seen side came to be read at the end its column is
    // extreme, rather than at the piece's top tipped down and its base tipped up, which are
    // the opposite ends: along the wall 130 → 59 mm tipped down in the 4 m room, and 88 → 53
    // up and 139 → 62 down in the 5 m; 68 / 13 / 46 rows more than 100 mm off → 24 / 4 / 17.
    expect(table(4, false)).toEqual({
      0: { n: 60, dOff: 8, latOff: 13, dMM: 39, latMM: 66, wMM: 89, hMM: 10 },
      [-10]: { n: 0, dOff: 0, latOff: 0, dMM: 0, latMM: 0, wMM: 0, hMM: 0 },
      10: { n: 135, dOff: 2, latOff: 24, dMM: 20, latMM: 59, wMM: 75, hMM: 132 },
    });
    // Cut at the foot as well, still the two tangents. Level they cannot move; tipped they
    // did, because the two tangents read their seen side at its own end too now, and the
    // frame's edge where the frame's bottom row crosses it, as they did before. The distance
    // is the one assumed (the piece's back on its wall), so the rows set 300 and 800 mm off
    // their wall are read at the wrong distance whatever the solve does; on the rows at the
    // wall, where the assumption is right, along the wall 193 → 121 mm (4 m) and 210 → 133
    // (5 m) at 10° up, in distance 96 → 133 and 101 → 122. That trade is the frame's edge,
    // still read as a tangent, and is not this change's to fix (§ 49.9).
    expect(table(4, true)).toEqual({
      0: { n: 143, dOff: 101, latOff: 101, dMM: 341, latMM: 376, wMM: 103, hMM: 141 },
      [-10]: { n: 134, dOff: 106, latOff: 108, dMM: 289, latMM: 300, wMM: 114, hMM: 106 },
      10: { n: 69, dOff: 27, latOff: 23, dMM: 110, latMM: 103, wMM: 86, hMM: 148 },
    });
    expect(table(5, false)).toEqual({
      0: { n: 79, dOff: 0, latOff: 11, dMM: 10, latMM: 53, wMM: 67, hMM: 8 },
      [-10]: { n: 31, dOff: 0, latOff: 4, dMM: 35, latMM: 53, wMM: 74, hMM: 7 },
      10: { n: 84, dOff: 0, latOff: 17, dMM: 14, latMM: 62, wMM: 76, hMM: 109 },
    });
    expect(table(5, true)).toEqual({
      0: { n: 66, dOff: 35, latOff: 35, dMM: 130, latMM: 134, wMM: 86, hMM: 33 },
      [-10]: { n: 155, dOff: 123, latOff: 136, dMM: 338, latMM: 349, wMM: 90, hMM: 95 },
      10: { n: 1, dOff: 1, latOff: 1, dMM: 109, latMM: 112, wMM: 0, hMM: 79 },
    });
  });

  it('cut at the left edge instead, is the mirror image', () => {
    const left = measure(-1);
    expect(left).toHaveLength(rows.length);
    const worst = Math.max(...left.map((l, i) => Math.max(Math.abs(l.dErr - rows[i].dErr), Math.abs(l.latErr + rows[i].latErr), Math.abs(l.wErr - rows[i].wErr))));
    expect(worst).toBeLessThan(1e-9);
  });

  // What the candidate ran into, pinned on the fixture's own projection rather than on the
  // placer, so each holds whatever the placer does next.
  it('hides the point of its base nearest the lens unless only a sliver is cut', () => {
    // A disc's nearest point sits straight ahead of its centre. It is past the frame's edge
    // once the centre is more than `(k/2)·cos(tilt)` radii inside it (1.33 level on this
    // lens), so of the four offsets only the sliver keeps it in the photo, and the bottom
    // row is otherwise where the frame's edge crosses the base, further off than the near
    // face. The one-sided solve as first written read it as the near face and came back
    // further out than the solve it replaced; it solves for that crossing now.
    //
    // The slivers are where the one-sided solve COSTS, and the reason is on the box: a
    // sliver's frame edge nearly is its second tangent, so the two tangents nearly measured
    // its radius, and the typical radius replaces that on a piece that is not typical. Level
    // there, 25 / 35 mm became 25 / 67 in distance / along the wall.
    const side = rows.filter((r) => !r.foot);
    expect(side.every((r) => r.nearestInPhoto === (r.s === -1.5))).toBe(true);
    const hidden = TILTS.map((t) => {
      const seen = side.filter((r) => r.tilt === t);
      return [seen.length, seen.filter((r) => !r.nearestInPhoto).length];
    });
    expect(hidden).toEqual([[139, 100], [31, 27], [219, 157]]);
    expect(cell(side.filter((r) => r.nearestInPhoto && r.tilt === 0))).toEqual({ n: 39, dOff: 2, latOff: 12, dMM: 25, latMM: 67, wMM: 65, hMM: 12 });
  });

  it('tipped up in the 4 m room, shows no floor at all, so every piece is cut at its foot too', () => {
    // Tipped 10° up on this lens, the bottom of the frame meets the floor beyond a wall 2 m
    // off, so no floor is in the photo and no piece shows its base, and every one of them
    // reaches the frame's bottom: its distance is assumed (§ 49.10) rather than read off a
    // floor contact that is not there. The 5 m room is the control, its wall far enough off
    // for the floor in front of it to be in the photo, and there every piece cut at the
    // side only shows its base.
    //
    // The first version of this fixture measured the offset from the LEVEL lens's edge,
    // which tipped up sits wider than where the edge meets the floor, so it stood 46 pieces
    // with their whole base out of the photo and only their side in it, and the placer read
    // that side as a floor contact beyond the wall. That box exists, a piece mostly out of
    // the frame with only its upper part in it, and it is not measured here.
    const up = (room: number, foot: boolean) => rows.filter((r) => r.room === room && r.foot === foot && r.tilt === -10);
    expect([
      [up(4, false).length, up(4, true).length, up(4, true).filter((r) => r.baseInPhoto).length],
      [up(5, false).length, up(5, false).filter((r) => !r.baseInPhoto).length],
    ]).toEqual([[0, 134, 0], [31, 0]]);
  });

  it('at a level lens and a typical size, is exact', () => {
    // Side only, level, a typical size: no catalogue number can be wrong here, so all that
    // was left was the frame's edge read as a tangent, which is what § 49.9 was filed for —
    // 25 mm in distance and 64 along the wall. Placed by the size it is drawn at, nothing is.
    const clean = rows.filter((r) => !r.foot && r.tilt === 0 && r.typical);
    expect(cell(clean)).toEqual({ n: 37, dOff: 0, latOff: 0, dMM: 0, latMM: 0, wMM: 0, hMM: 0 });
  });

  it('tipped, at a typical size, is exact wherever its top is in the photo', () => {
    // The tipped half of the test above, and what reading each side at its own end bought:
    // the seen side read at the opposite end left these 149 mm off along the wall on
    // average, 39 of the 59 by more than 100 mm. The 12 whose top has left through the
    // frame's side edge are placed exactly too; only their height is wrong, read off a top
    // row that is the frame's and not the piece's, and that is filed rather than fixed
    // (§ 49.9): a top the photo did not see is a height the placer should report as cut.
    const tipped = rows.filter((r) => !r.foot && r.tilt !== 0 && r.typical);
    expect(cell(tipped.filter((r) => r.topInPhoto))).toEqual({ n: 59, dOff: 0, latOff: 0, dMM: 0, latMM: 0, wMM: 0, hMM: 0 });
    expect(cell(tipped.filter((r) => !r.topInPhoto))).toEqual({ n: 12, dOff: 0, latOff: 0, dMM: 0, latMM: 0, wMM: 0, hMM: 461 });
  });

  it('is exact close up and tipped steeply down, where the height took more passes than it had', () => {
    // Where the seen side is extreme at the piece's top, the height is a fixed point of the
    // tangency, and the first version iterated it and stopped at eight passes. Close to the
    // lens and tipped steeply its rate nears one, so there the count and not the photo set
    // the answer: on this grid five stopped on the count, and three of them by more than a
    // millimetre, a 900 mm round table 300 tall, 800 mm out at 40° down, read 988 × 215 and
    // 62 mm along the wall. It is bisected now. None of the fixture's rows is tipped past
    // 10°, so without this the bisection is a line nothing measures. The count is a literal,
    // so a grid that stopped reaching the case would say so.
    const room = ROOMS[1];
    let n = 0;
    for (const deg of [25, 30, 35, 40]) for (const dist of [0.8, 1.2]) for (const lateral of [1.2, 1.8])
      for (const dia of [0.25, 0.4, 0.6, 0.9]) for (const h of [0.3, 0.5, 0.9]) {
        const cal = { ...WIDE, tiltRad: (deg * Math.PI) / 180 };
        const pts = floorCylinderPoints(lateral, -dist, dia, h);
        const uv = pts.map((p) => project('n', ...p, cal));
        const box = framedExtent(uv);
        if (!box) continue;
        const cut = frameCuts(box);
        if (!cut.right || cut.left || cut.bottom || cut.top || !pts.some((p, i) => p[1] === h && inPhoto(uv[i]))) continue;
        n++;
        const where = `${dia * 1000} × ${h * 1000} at ${deg}° down, ${dist} m out, ${lateral} m across`;
        const g = placeFloorObject(box, 'n', room, cal, { depthM: dia, round: true, whole: { widthM: dia, heightM: h } });
        expect(g, where).not.toBeNull();
        expect([g!.widthMM, g!.heightMM], where).toEqual([Math.round(dia * 1000), Math.round(h * 1000)]);
        // The rim is a 720-gon, which sits a few microns inside the circle.
        expect(Math.hypot(g!.position.x - lateral, g!.position.z + dist), where).toBeLessThan(1e-5);
      }
    expect(n).toBe(93);
  });

  it('stops the typical radius at the side wall', () => {
    // The typical radius is an assumption, so the side wall bounds it, as it bounds a
    // typical width grown from the edge the photo saw. For one commit nothing did, and 33
    // of these pieces stood through the wall, by up to 337 mm; they stand at it now, and
    // no piece reaches past it by more than the millimetre a width is rounded to. Every one
    // is a piece smaller than its kind's typical size. There are 47 of them since the seen
    // side came to be read at its own end, the 14 more all tipped: the old read had pulled a
    // small piece's centre in from the wall, so its typical radius reached the wall less.
    const atWall = rows.filter((r) => r.past > -0.001);
    expect([atWall.length, atWall.filter((r) => !r.foot).length, Math.max(...rows.map((r) => r.past)) < 0.0006]).toEqual([47, 47, true]);
    expect([atWall.filter((r) => r.typical).length, atWall.filter((r) => r.tilt === 0).length]).toEqual([0, 16]);
    // The one the review found: a 180 mm plant 90 mm off the wall, 2.3 m out, cut at the
    // frame's right edge on a level lens. Grown to the typical 400 mm it stood 297 mm
    // through the wall; stopped there it is 185 mm wide, its edge on the plaster.
    const room = ROOMS[1];
    const pts = floorCylinderPoints(2.9, -2.3, 0.18, 0.6);
    const box = framedExtent(pts.map((p) => project('n', ...p, WIDE)))!;
    expect(frameCuts(box)).toEqual({ left: false, right: true, top: false, bottom: false });
    const drawn = placeFloorObject(box, 'n', room, WIDE, { depthM: 0.4, round: true, whole: { widthM: 0.4, heightM: 0.6 } })!;
    expect([drawn.widthMM, +(drawn.position.x + drawn.widthMM / 2000).toFixed(3)]).toEqual([185, 3]);
  });

  it('keeps the size the photo shows, even where it reaches past the wall', () => {
    // The wall bounds the assumption and never what was seen. Typed 5.8 m wide, the room's
    // wall is at 2.9 m and the same plant is seen reaching 2.99: it keeps the 180 mm the
    // photo shows it at, where the two tangents put it, rather than shrinking to fit. A
    // typical size smaller than the one seen changes nothing either.
    const room = { width: 5.8, depth: 5, height: 2.8, footprint: footprintForLayout('rect', 5.8, 5) };
    const box = framedExtent(floorCylinderPoints(2.9, -2.3, 0.18, 0.6).map((p) => project('n', ...p, WIDE)))!;
    const tangents = placeFloorObject(box, 'n', room, WIDE, { depthM: 0.4, round: true })!;
    for (const widthM of [0.4, 0.04]) {
      const drawn = placeFloorObject(box, 'n', room, WIDE, { depthM: 0.4, round: true, whole: { widthM, heightM: 0.6 } })!;
      expect(drawn.widthMM).toBe(180);
      expect(drawn.position.x).toBeCloseTo(tangents.position.x, 6);
    }
    expect(tangents.widthMM).toBe(180);
  });

  it('falls back to the two tangents where the typical size cannot close the box', () => {
    // A flat sliver at the frame's edge: its top row sits so close to its bottom one that a
    // piece of the typical radius would need its far rim below the floor, so the one-sided
    // solve has no height to give. The two tangents still answer, and the piece is drawn at
    // its typical width from the edge the photo saw, as it was before § 49.9. No row of the
    // fixture reaches this, so without it the fallback is a line nothing runs. Tipped 10°
    // down the height is bisected, and it is the bracket's floor that has none to give.
    const whole = { widthM: 0.4, heightM: 0.5 };
    for (const cal of [WIDE, { ...WIDE, tiltRad: (10 * Math.PI) / 180 }])
    for (const box of [[0.97, 0.92, 0.03, 0.03], [0, 0.92, 0.03, 0.03]] as Array<[number, number, number, number]>) {
      const drawn = placeFloorObject(box, 'n', ROOMS[1], cal, { depthM: 0.4, round: true, whole })!;
      const tangents = placeFloorObject(box, 'n', ROOMS[1], cal, { depthM: 0.4, round: true })!;
      const seenEdge = tangents.position.x - Math.sign(tangents.position.x) * (tangents.widthMM / 2000);
      expect([drawn.position.z, drawn.heightMM, drawn.widthMM]).toEqual([tangents.position.z, tangents.heightMM, 400]);
      expect(drawn.position.x - Math.sign(drawn.position.x) * 0.2).toBeCloseTo(seenEdge, 3);
    }
  });
});
