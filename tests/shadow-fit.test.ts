import { describe, it, expect } from 'vitest';
import { shadowFit } from '@/lib/shadow-fit';
import { sunDirection } from '@/lib/solar';
import { LIGHTING, KEY_DIR } from '@/lib/lighting-moods';

// The sun's shadow camera, fitted to the room.
//
// This is the file that has to catch a wrong bound, because nothing else can. An
// ortho shadow camera does not complain about geometry outside it — it just does
// not record it, and a caster that is not in the depth map casts nothing. The
// symptom is sunlight coming through a wall, in one mood, at one range of room
// sizes, with a green suite.
//
// So the main assertion is not a number: it is the PROPERTY the fit exists to
// guarantee — every corner of the room's own box projects inside the camera's
// bounds — checked by projecting the corners the same way three.js does. A number
// pinned by hand would only ever confirm the arithmetic I already wrote.

/** The shadow camera's basis, exactly as `Object3D.lookAt` builds it: z away from
 *  the target, x from `up × z`, y from `z × x`. `dist` drops out of the projection
 *  because x and y are both perpendicular to the light direction, so a corner's
 *  camera-space x/y is measured from the room centre either way. */
function basis(dir: readonly [number, number, number]) {
  const z = dir;
  const up: [number, number, number] = [0, 1, 0];
  const cx: [number, number, number] = [
    up[1] * z[2] - up[2] * z[1],
    up[2] * z[0] - up[0] * z[2],
    up[0] * z[1] - up[1] * z[0],
  ];
  const cn = Math.hypot(...cx);
  const x: [number, number, number] = [cx[0] / cn, cx[1] / cn, cx[2] / cn];
  const y: [number, number, number] = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  return { x, y };
}

/** Furthest any corner of the room box lands from the camera's centre, in the
 *  camera's own x/y. This is the number `extent` has to cover. */
function reach(
  width: number,
  depth: number,
  boxH: number,
  dir: readonly [number, number, number],
): number {
  const { x, y } = basis(dir);
  let worst = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Floor and ceiling both — the ceiling corners are the ones a low sun
      // pushes out of the frustum, and they are the reason the box term exists.
      for (const h of [0, boxH]) {
        const p: [number, number, number] = [(sx * width) / 2, h, (sz * depth) / 2];
        worst = Math.max(worst, Math.abs(p[0] * x[0] + p[1] * x[1] + p[2] * x[2]));
        worst = Math.max(worst, Math.abs(p[0] * y[0] + p[1] * y[1] + p[2] * y[2]));
      }
    }
  }
  return worst;
}

/** Every shipped light direction, plus a couple that are not shipped, because the
 *  bearing dial can point any of the sun moods anywhere. `KEY_DIR` is in here too:
 *  the studio moods' key light is blocked by the same shell and fitted by the same
 *  camera, and its elevation (~54°) is not one of the presets'. */
const DIRS: Array<{ name: string; dir: [number, number, number] }> = [
  ...Object.entries(LIGHTING).flatMap(([id, mood]) => {
    if (!mood.sun) return [];
    // Four bearings, because the dial rotates every angle together and a term that
    // depended on azimuth would be right at one bearing and wrong at the others.
    return [0, 37, 143, -90].map((bearing) => {
      const dir = sunDirection(mood.sun!.elevationDeg, mood.sun!.azimuthDeg, bearing);
      return { name: `${id} @ ${bearing}°`, dir: dir! };
    });
  }),
  { name: 'studio key', dir: KEY_DIR },
];

/** Rooms that exist: the two shipped presets, a small bedroom, and an open plan
 *  near the top of what `ROOM_SIDE_M` allows. Heights either side of the default. */
const ROOMS = [
  { w: 3, d: 3, h: 2.4 },
  { w: 5.6, d: 4.2, h: 2.4 },
  { w: 7.5, d: 5.6, h: 3.2 },
  { w: 12, d: 9, h: 2.7 },
];

describe('the sun shadow camera fit', () => {
  it('contains the whole room box, at every shipped angle and room size', () => {
    let checked = 0;
    for (const { name, dir } of DIRS) {
      for (const r of ROOMS) {
        for (const tallest of [0.4, 2.0, 3.4]) {
          const fit = shadowFit(r.w, r.d, r.h, tallest, dir);
          const boxH = Math.max(r.h, tallest);
          const need = reach(r.w, r.d, boxH, dir);
          expect(
            fit.extent,
            `${name}, ${r.w}x${r.d}x${r.h}m, tallest ${tallest}m: needs ${need.toFixed(3)}`,
          ).toBeGreaterThanOrEqual(need);
          checked++;
        }
      }
    }
    // Without this the loop above would pass over an empty `DIRS` — the failure
    // mode where a test iterates whatever it found and finds nothing.
    expect(checked).toBe(DIRS.length * ROOMS.length * 3);
    expect(DIRS.length).toBeGreaterThan(12);
  });

  it('does not contain it by being enormous', () => {
    // The other half of the assertion above, and the half that makes it able to
    // fail: `extent = Infinity` satisfies containment perfectly. The fit has to be
    // tight, because `normalBias` is derived from the texel size it produces — a
    // box fitted to ground nothing loosens the bias that stops the floor shadowing
    // itself.
    //
    // Measured against the WORST AZIMUTH rather than against the one azimuth in
    // hand, because being azimuth-free is a deliberate property and not slack: the
    // horizontal term is half the footprint diagonal, which is what the room needs
    // when its diagonal lines up with the camera's axis, and paying that at every
    // other azimuth is what stops the bearing dial reallocating the depth target on
    // every degree of a drag. So the fit is allowed to be as big as the hardest
    // azimuth demands, and 0.5 m of quantisation on top. Nothing else.
    for (const { name, dir } of DIRS) {
      const elevDeg = (Math.asin(Math.min(1, Math.abs(dir[1]))) * 180) / Math.PI;
      for (const r of ROOMS) {
        const fit = shadowFit(r.w, r.d, r.h, 0.4, dir);
        let worst = 0;
        for (let az = 0; az < 360; az += 5) {
          const spun = sunDirection(elevDeg, az, 0);
          if (spun) worst = Math.max(worst, reach(r.w, r.d, r.h, spun));
        }
        expect(fit.extent, `${name} (${elevDeg.toFixed(1)}°), ${r.w}x${r.d}m`).toBeLessThanOrEqual(
          worst + 0.5,
        );
      }
    }
  });

  it('never asks for more than the room box’s own diagonal', () => {
    // A closed-form ceiling over every elevation, which is what stops the fit
    // running away as the sun approaches the horizon. `halfDiag * sin + boxH * cos`
    // is a dot product of (halfDiag, boxH) with a unit vector, so it cannot exceed
    // the length of that pair however the sun moves.
    for (const r of ROOMS) {
      const cap = Math.ceil(Math.hypot(Math.hypot(r.w, r.d) / 2, r.h) * 2) / 2;
      for (const { name, dir } of DIRS) {
        expect(shadowFit(r.w, r.d, r.h, 0.4, dir).extent, `${name}, ${r.w}x${r.d}m`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('needs the height most when the sun is low, and the plan when it is high', () => {
    // The term the old fit was missing, and it does NOT simply grow as the sun
    // drops — which is what I assumed before writing the projection out. The
    // camera's y axis carries the footprint foreshortened by sin(elevation) and the
    // height at cos(elevation), so the two trade places:
    //
    //   · at Day's 58° the footprint dominates (sin 0.85) and the room's height is
    //     worth only 0.53 of itself;
    //   · at Sunrise's 7° the footprint all but vanishes from that axis (sin 0.12)
    //     and the height arrives at full size (cos 0.99).
    //
    // So the height is the term that matters at a low sun specifically, which is
    // exactly the mood where a clipped wall lets the sun in sideways.
    const high = sunDirection(58, 180, 0)!;
    const low = sunDirection(7, 78, 0)!;
    // A narrow room, so the height is the term that decides at both elevations and
    // the 0.5 m quantisation step does not swallow the difference. (On a 12 x 9 m
    // open plan the footprint wins at every elevation and the height is invisible
    // in the answer — true, and the reason this is measured on a small room.)
    const gain = (dir: [number, number, number]) =>
      shadowFit(3, 2.5, 3.5, 0.4, dir).extent - shadowFit(3, 2.5, 2.4, 0.4, dir).extent;
    expect(gain(low)).toBeGreaterThan(0);
    expect(gain(high)).toBeLessThanOrEqual(gain(low));
    // The other way round on a wide, low room: a 5.6 x 4.2 m floor seen from
    // overhead is wider than a 2.4 m wall seen from the side, so there the HIGH sun
    // is the one that needs the bigger box.
    expect(shadowFit(5.6, 4.2, 2.4, 0.4, high).extent).toBeGreaterThan(
      shadowFit(5.6, 4.2, 2.4, 0.4, low).extent,
    );
  });

  it('ignores the azimuth', () => {
    // The horizontal term is half the footprint DIAGONAL, not half a width, so the
    // camera is free to spin about the room centre without re-fitting. If this
    // ever fails, the fit has grown a term that depends on which way the sun is —
    // and a fit that changes with the bearing dial re-allocates the depth target
    // on every degree of a drag.
    const spun = [0, 45, 90, 135, 180, 225, 270, 315].map(
      (az) => shadowFit(7.5, 5.6, 2.4, 1.2, sunDirection(30, az, 0)!).extent,
    );
    expect(new Set(spun).size).toBe(1);
  });

  it('holds a piece that is taller than the room', () => {
    // `lib/clearance.ts` reports a piece that does not fit and deliberately does
    // NOT resize it, so a 3.4 m wardrobe in a 2.4 m room really does stand through
    // the ceiling. It still has to be in the map.
    const dir = sunDirection(7, 78, 0)!;
    const fit = shadowFit(4, 3, 2.4, 3.4, dir);
    expect(fit.extent).toBeGreaterThanOrEqual(reach(4, 3, 3.4, dir));
    // …and the room height still wins when nothing is taller than it.
    expect(shadowFit(4, 3, 2.4, 0.4, dir).extent).toBeLessThan(fit.extent);
  });

  it('quantises the box and steps the map size once', () => {
    const dir = sunDirection(58, 180, 0)!;
    for (const w of [3, 4.1, 5.37, 9.9, 14]) {
      const fit = shadowFit(w, w * 0.8, 2.4, 1, dir);
      expect(fit.extent * 2).toBe(Math.round(fit.extent * 2));
      expect(fit.mapSize).toBe(fit.extent > 8 ? 2048 : 1024);
      // The bias follows the texel size this fit actually produced. Pinning the
      // relationship, not the number: the pair drifting apart is the specific
      // failure that let shadow bleeding back in at 2048.
      expect(fit.normalBias).toBeCloseTo(((2 * fit.extent) / fit.mapSize) * 2, 12);
    }
  });

  it('keeps the near plane clear of the room from any direction', () => {
    // The light has to stand far enough out that the room cannot cross the near
    // plane, and `far` has to reach past the far side of the box. Both are read off
    // the fit rather than written at the light, so this can assert the
    // RELATIONSHIP — the failure being guarded is not a wrong number, it is the
    // three numbers ceasing to agree.
    for (const { name, dir } of DIRS) {
      for (const r of [...ROOMS, { w: 0.2, d: 0.2, h: 0.2 }]) {
        const fit = shadowFit(r.w, r.d, r.h, 2, dir);
        expect(fit.near, `${name}, ${r.w}x${r.d}m near`).toBeLessThan(fit.dist - fit.extent);
        expect(fit.far, `${name}, ${r.w}x${r.d}m far`).toBeGreaterThan(fit.dist + fit.extent);
      }
    }
  });

  it('never fits a zero-sized box', () => {
    // A footprint mid-edit can be degenerate. An ortho camera with zero width
    // renders an empty depth map, which reads as the sun being switched off rather
    // than as a bad number.
    const fit = shadowFit(0, 0, 0, 0, [0, 1, 0]);
    expect(fit.extent).toBeGreaterThan(0);
    expect(fit.mapSize).toBe(1024);
  });
});
