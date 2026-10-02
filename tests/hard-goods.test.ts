// The casework, appliances and joinery of `lib/hard-goods.ts`, held to the two rules its
// header states: nothing leaves its box except where the real object does, and a form
// drawn under a group scale is proportions only.
//
// Both are swept over every corner of each shape's size band plus its Library size,
// because the defects these catch live at the corners — a handle placed off the width
// that a narrow piece pushes through its own front, a detail that holds at 600 mm and
// stands outside the box at 450.

import { describe, it, expect } from 'vitest';
import { Euler, Vector3 } from 'three';
import {
  acUnitForm,
  AIR_PURIFIER,
  airPurifierForm,
  chestFreezerForm,
  coffeeTableForm,
  deskForm,
  diningTableForm,
  CONSOLE_BAY,
  CONSOLE_DOOR,
  consoleBays,
  doorForm,
  LAPTOP,
  laptopForm,
  LEVER_PROUD,
  microwaveForm,
  mirrorForm,
  NIGHTSTAND,
  nightstandForm,
  nightstandSlide,
  ovalMirrorForm,
  paintingForm,
  partExtent,
  RADIATOR,
  radiatorForm,
  sideTableForm,
  soundbarForm,
  STOOL,
  stoolForm,
  strutPose,
  tvConsoleForm,
  tvForm,
  washingMachineForm,
  WINDOW,
  windowForm,
  waterDispenserForm,
  type HardPart,
} from '../lib/hard-goods';
import { floorLampForm, tableLampForm, type LampForm } from '../lib/lamp-form';
import { armchairForm, diningChairForm, officeChairForm, ottomanForm } from '../lib/chair-form';
import type { SoftItem } from '../lib/soft-goods';
import { consoleSlabs, doorHandleY, drawerSlide, isParametric, PART_LIBRARY, radiatorFins, stoolSeat, windowPanes, type Category, type Shape } from '../lib/scene-spec';
import { dimRangeFor } from '../lib/dimension-ranges';
import { COFFEE_SHELF, DESK_TOP, DINING_LEG, DINING_TOP, ELL_ARM_DEPTH, ELL_RETURN_WIDTH, surfacePostsLocal } from '../lib/foot-cells';

const EPS = 1e-9;

type Form = (dimMM: readonly number[]) => HardPart[];
interface Row {
  shape: Shape;
  category: Category;
  form: Form;
  /** A wall piece is centred on its origin; a floor piece stands on y = 0. */
  wall: boolean;
  /** Drawn at the stored size rather than group-scaled (§ 36). */
  parametric: boolean;
  /** Drawn on a circle of the width, which the renderer stretches to the depth. */
  round?: boolean;
  /** A wall piece drawn on a circle of the width, which the renderer stretches to the
   *  HEIGHT: the oval mirror. */
  oval?: boolean;
  /** Reaches behind its footprint by design: the open laptop's lid. */
  leansBack?: boolean;
}

/** Every corner of an open laptop's lid boxes, carried into the piece's frame the way
 *  the renderer carries the lid: turned by `-tilt` about `x`, then moved to the hinge. */
function lidWorld(dimMM: readonly number[]) {
  const { lid, hinge } = laptopForm(dimMM);
  const turn = new Euler(-hinge.tilt, 0, 0);
  return lid.map((p) => {
    const { lo, hi } = partExtent(p);
    const pts: Vector3[] = [];
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      pts.push(new Vector3(x, y, z).applyEuler(turn).add(new Vector3(0, hinge.y, hinge.z)));
    }
    return { key: p.key, pts };
  });
}

/** The box the open lid fills in the piece's frame. */
function lidBox(dimMM: readonly number[]): HardPart {
  const pts = lidWorld(dimMM).flatMap((p) => p.pts);
  const lo = [0, 1, 2].map((a) => Math.min(...pts.map((v) => v.getComponent(a))));
  const hi = [0, 1, 2].map((a) => Math.max(...pts.map((v) => v.getComponent(a))));
  return { kind: 'box', key: 'lid', tone: 'body', size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], pos: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] };
}

const ROWS: Row[] = [
  { shape: 'chest-freezer', category: 'fridge', form: chestFreezerForm, wall: false, parametric: false },
  { shape: 'ac-unit', category: 'ac', form: acUnitForm, wall: true, parametric: false },
  { shape: 'soundbar', category: 'tv', form: soundbarForm, wall: false, parametric: false },
  { shape: 'water-dispenser', category: 'fridge', form: waterDispenserForm, wall: false, parametric: false },
  { shape: 'washing-machine', category: 'fridge', form: washingMachineForm, wall: false, parametric: false },
  { shape: 'microwave', category: 'fridge', form: microwaveForm, wall: false, parametric: false },
  { shape: 'tv', category: 'tv', form: tvForm, wall: true, parametric: false },
  { shape: 'tv-console', category: 'shelf', form: tvConsoleForm, wall: false, parametric: true },
  { shape: 'door', category: 'door', form: doorForm, wall: true, parametric: true },
  { shape: 'nightstand', category: 'nightstand', form: (dimMM) => nightstandForm(dimMM), wall: false, parametric: true },
  { shape: 'stool', category: 'chair', form: stoolForm, wall: false, parametric: true, round: true },
  { shape: 'lamp-floor', category: 'lamp', form: (dimMM) => withShade(floorLampForm(dimMM)), wall: false, parametric: false, round: true },
  { shape: 'lamp-table', category: 'lamp', form: (dimMM) => withShade(tableLampForm(dimMM)), wall: false, parametric: false, round: true },
  { shape: 'chair-dining', category: 'chair', form: (dimMM) => { const f = diningChairForm(dimMM); return [...f.parts, cushion('pad', f.pad)]; }, wall: false, parametric: false },
  { shape: 'chair-office', category: 'chair', form: (dimMM) => { const f = officeChairForm(dimMM); return [...f.parts, cushion('seat', f.seat), cushion('back', f.back)]; }, wall: false, parametric: false },
  // Without its scatter cushion, which leans and so is not proportions only — see
  // `armchairForm`; `tests/chair-form.test.ts` holds it inside the chair.
  { shape: 'chair-armchair', category: 'chair', form: (dimMM) => { const f = armchairForm(dimMM); return [...f.parts, cushion('seat', f.seat), cushion('back', f.back)]; }, wall: false, parametric: false },
  { shape: 'ottoman', category: 'ottoman', form: (dimMM) => { const f = ottomanForm(dimMM); return [...f.parts, cushion('top', f.top)]; }, wall: false, parametric: false },
  { shape: 'side-table', category: 'table', form: sideTableForm, wall: false, parametric: false, round: true },
  { shape: 'radiator', category: 'fridge', form: (dimMM) => { const f = radiatorForm(dimMM); return [...f.columns, ...f.fittings]; }, wall: false, parametric: true },
  { shape: 'painting', category: 'painting', form: paintingForm, wall: true, parametric: false },
  { shape: 'mirror', category: 'mirror', form: mirrorForm, wall: true, parametric: false },
  { shape: 'mirror-oval', category: 'mirror', form: ovalMirrorForm, wall: true, parametric: false, oval: true },
  { shape: 'air-purifier', category: 'fridge', form: airPurifierForm, wall: false, parametric: false, round: true },
  { shape: 'coffee-table', category: 'table', form: coffeeTableForm, wall: false, parametric: false },
  { shape: 'desk-standard', category: 'table', form: diningTableForm, wall: false, parametric: true },
  { shape: 'desk-standard', category: 'desk', form: (dimMM) => deskForm(dimMM, false), wall: false, parametric: true },
  { shape: 'desk-l', category: 'desk', form: (dimMM) => deskForm(dimMM, true), wall: false, parametric: true },
  // The open lid as the box its turned corners fill, which leans behind the footprint on
  // purpose (`laptopForm`) and is the one row exempt at the back.
  { shape: 'laptop', category: 'monitor', form: (dimMM) => [...laptopForm(dimMM).base, lidBox(dimMM)], wall: false, parametric: false, leansBack: true },
];

/** A chair's cushion as the box it fills, so every sweep here reaches the cushions too: a
 *  flat one as it lies, a stood-up one (`standUp(0)`, thickness to the front) turned. */
function cushion(key: string, it: SoftItem): HardPart {
  const [w, t, tall] = it.size;
  return { kind: 'box', key, tone: 'body', size: it.rot ? [w, tall, t] : [w, t, tall], pos: it.pos };
}

/** A lamp's parts with its shade among them, as the upright post it is drawn as (an open
 *  one, but its extent is the same), so every sweep here reaches the shade too. */
function withShade(f: LampForm): HardPart[] {
  const { rTop, rBottom, h, y } = f.shade;
  return [...f.parts, { kind: 'post', key: 'shade', tone: 'body', r: rTop, rBottom, h, pos: [0, y, 0] }];
}

type Strut = Extract<HardPart, { kind: 'strut' }>;
const ext = (parts: HardPart[], key: string) => partExtent(parts.find((p) => p.key === key)!);

/** The Library size and every corner of the band. */
function sizes(r: Row): number[][] {
  const lib = PART_LIBRARY.find((p) => p.shape === r.shape);
  const band = dimRangeFor(r.category, r.shape);
  const out: number[][] = [];
  if (lib) out.push(lib.dimMM.slice());
  for (const w of [band.min[0], band.max[0]]) for (const d of [band.min[1], band.max[1]]) for (const h of [band.min[2], band.max[2]]) out.push([w, d, h]);
  return out;
}

/** The door's two named exceptions to the box: the lever furniture on the room face, and
 *  the hinge knuckles wrapping the leaf's edge. */
const DOOR_PROUD = new Set(['backplate', 'keyhole', 'lever-neck', 'lever']);
const isHinge = (key: string) => key.startsWith('hinge-');

describe('partExtent', () => {
  // Every containment assertion here reads it, so a wrong extent is a test that cannot
  // fail. Each kind is drawn by three on a different axis; the extents are what it draws.
  it('reads each kind as three draws it', () => {
    expect(partExtent({ kind: 'box', key: 'b', tone: 'body', size: [2, 4, 6], pos: [1, 1, 1] }))
      .toEqual({ lo: [0, -1, -2], hi: [2, 3, 4] });
    // A post's widest radius, top or foot, on x and z; its height on y.
    expect(partExtent({ kind: 'post', key: 'p', tone: 'body', r: 1, rBottom: 3, h: 4, pos: [0, 2, 0] }))
      .toEqual({ lo: [-3, 0, -3], hi: [3, 4, 3] });
    expect(partExtent({ kind: 'post', key: 'p', tone: 'body', r: 3, rBottom: 1, h: 4, pos: [0, 2, 0] }))
      .toEqual({ lo: [-3, 0, -3], hi: [3, 4, 3] });
    // A disc faces the front: its radius on x and y, its thickness on z.
    expect(partExtent({ kind: 'disc', key: 'd', tone: 'body', r: 2, t: 1, pos: [0, 0, 0] }))
      .toEqual({ lo: [-2, -2, -0.5], hi: [2, 2, 0.5] });
    // A ring reaches its radius plus its tube on the face, and its tube either side.
    expect(partExtent({ kind: 'ring', key: 'r', tone: 'body', r: 2, tube: 0.5, pos: [0, 0, 0] }))
      .toEqual({ lo: [-2.5, -2.5, -0.5], hi: [2.5, 2.5, 0.5] });
    // An upright strut is a post: its radius on x and z, its ends on y.
    expect(partExtent({ kind: 'strut', key: 's', tone: 'body', r: 1, a: [0, 0, 0], b: [0, 4, 0] }))
      .toEqual({ lo: [-1, 0, -1], hi: [1, 4, 1] });
    // A level one along x: its ends on x, its radius on y and z.
    expect(partExtent({ kind: 'strut', key: 's', tone: 'body', r: 1, a: [-2, 0, 0], b: [3, 0, 0] }))
      .toEqual({ lo: [-2, -1, -1], hi: [3, 1, 1] });
    // At 45° in x–y its end discs reach r·sin 45° past each end on both axes, and its
    // full radius across z.
    const e = partExtent({ kind: 'strut', key: 's', tone: 'body', r: 1, a: [0, 0, 0], b: [1, 1, 0] });
    const k = Math.SQRT1_2;
    [[-k, -k, -1], [1 + k, 1 + k, 1]].forEach((want, i) =>
      want.forEach((v, j) => expect((i ? e.hi : e.lo)[j]).toBeCloseTo(v, 12)));
  });
});

describe('strutPose', () => {
  it('turns an upright cylinder onto the strut, end to end', () => {
    // Every direction a leg or a rung can take, including the two the Euler read-back
    // is singular near: straight up and level along x.
    const cases: Array<[[number, number, number], [number, number, number]]> = [
      [[0, 0, 0], [0, 1, 0]],
      [[0, 0, 0], [1, 0, 0]],
      [[0, 0, 0], [-1, 0, 0]],
      [[0, 0, 0], [0, 0, 1]],
      [[0.1, 0.2, -0.3], [-0.2, 0.9, 0.4]],
      [[0.3, 0, 0.1], [0.05, 0.4, -0.02]],
      [[0, 0.1, 0], [0.2, 0.1, -0.2]],
    ];
    for (const [a, b] of cases) {
      const s: Strut = { kind: 'strut', key: 's', tone: 'body', r: 0.01, a, b };
      const pose = strutPose(s);
      const half = new Vector3(0, pose.len / 2, 0).applyEuler(new Euler(...pose.rot, 'XYZ'));
      const top = new Vector3(...pose.pos).add(half);
      const foot = new Vector3(...pose.pos).sub(half);
      [top.x, top.y, top.z].forEach((v, i) => expect(v, `${b} top`).toBeCloseTo(b[i], 12));
      [foot.x, foot.y, foot.z].forEach((v, i) => expect(v, `${a} foot`).toBeCloseTo(a[i], 12));
    }
  });
});

describe('every hard good stays inside the box it declares', () => {
  it('the Library carries every shape this file draws', () => {
    for (const r of ROWS) expect(PART_LIBRARY.some((p) => p.shape === r.shape), r.shape).toBe(true);
    expect(ROWS.length).toBe(28);
    expect(ROWS.filter((r) => r.leansBack).map((r) => r.shape)).toEqual(['laptop']);
  });

  for (const r of ROWS) {
    it(`${r.shape}: every part, at every corner of its size band`, () => {
      const all = sizes(r);
      expect(all.length).toBe(9);
      for (const dimMM of all) {
        const [w, dDeclared, hDeclared] = dimMM.map((v) => v / 1000);
        // A round form is a circle of the width, stretched to the depth after; an oval one
        // is stretched to the height.
        const d = r.round ? w : dDeclared;
        const h = r.oval ? w : hDeclared;
        const yLo = r.wall ? -h / 2 : 0;
        const yHi = r.wall ? h / 2 : h;
        const parts = r.form(dimMM);
        const keys = parts.map((p) => p.key);
        expect(new Set(keys).size, `${r.shape} keys are unique`).toBe(keys.length);
        let top = -Infinity;
        for (const p of parts) {
          const at = `${r.shape} ${dimMM.join('x')} ${p.key}`;
          if (p.kind === 'box') for (const s of p.size) expect(s, `${at} has thickness`).toBeGreaterThan(0);
          const { lo, hi } = partExtent(p);
          top = Math.max(top, hi[1]);
          if (r.shape === 'door' && (DOOR_PROUD.has(p.key) || isHinge(p.key))) continue;
          expect(lo[0], `${at} left`).toBeGreaterThanOrEqual(-w / 2 - EPS);
          expect(hi[0], `${at} right`).toBeLessThanOrEqual(w / 2 + EPS);
          expect(lo[1], `${at} bottom`).toBeGreaterThanOrEqual(yLo - EPS);
          expect(hi[1], `${at} top`).toBeLessThanOrEqual(yHi + EPS);
          if (!(r.leansBack && p.key === 'lid')) expect(lo[2], `${at} back`).toBeGreaterThanOrEqual(-d / 2 - EPS);
          expect(hi[2], `${at} front`).toBeLessThanOrEqual(d / 2 + EPS);
        }
        // And reaches it: a form that drew short of its own height would leave a gap the
        // plan, the fit test and anything set on it all disagree with.
        expect(top, `${r.shape} ${dimMM.join('x')} reaches its height`).toBeCloseTo(yHi, 9);
      }
    });
  }

  it('the door’s exceptions are exactly a lever’s reach and a hinge’s wrap', () => {
    for (const dimMM of sizes(ROWS.find((r) => r.shape === 'door')!)) {
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const parts = doorForm(dimMM);
      const proud = parts.filter((p) => DOOR_PROUD.has(p.key));
      expect(proud.map((p) => p.key).sort()).toEqual(['backplate', 'keyhole', 'lever', 'lever-neck']);
      // The furniture stands on the room face only and reaches the lever's front exactly.
      for (const p of proud) {
        const { lo, hi } = partExtent(p);
        expect(lo[2], p.key).toBeGreaterThanOrEqual(d / 2 - 0.001 - EPS);
        expect(lo[0], p.key).toBeGreaterThanOrEqual(-w / 2);
        expect(hi[0], p.key).toBeLessThanOrEqual(w / 2);
        expect(Math.abs(lo[1]) <= h / 2 && Math.abs(hi[1]) <= h / 2, p.key).toBe(true);
      }
      expect(Math.max(...proud.map((p) => partExtent(p).hi[2]))).toBeCloseTo(d / 2 + LEVER_PROUD, 12);
      const hinges = parts.filter((p) => isHinge(p.key));
      expect(hinges.length).toBe(3);
      for (const p of hinges) {
        const { lo, hi } = partExtent(p);
        // A few millimetres past the hinge edge and the room face, and no further.
        expect(lo[0]).toBeGreaterThanOrEqual(-w / 2 - 0.004);
        expect(lo[0]).toBeLessThan(-w / 2);
        expect(hi[2]).toBeLessThanOrEqual(d / 2 + 0.004);
        expect(lo[1]).toBeGreaterThan(-h / 2);
        expect(hi[1]).toBeLessThan(h / 2);
      }
    }
  });
});

describe('a group-scaled form is proportions only (§ 36)', () => {
  // `Draggable` stretches these by `stored / authored` per axis. A form whose parts move
  // and grow along an axis by exactly the factor that axis was scaled — and along no other
  // — is one a group scale reproduces, so what the user sees after a resize is the form
  // drawn at the new size. An absolute (a 20 mm handle) or a cross-axis term (a detail
  // sized off the width that moves when the height changes) breaks that, and the drawn
  // piece stops being the one the arithmetic describes.
  const FACTORS = [0.7, 1.6];
  const SPACE_AXIS = [0, 2, 1];
  const anchor = (p: HardPart) => (p.kind === 'strut' ? p.a : p.pos);
  /** Every length a part carries. */
  const nums = (p: HardPart): number[] => {
    switch (p.kind) {
      case 'box': return [...p.pos, ...p.size];
      case 'post': return [...p.pos, p.r, p.rBottom, p.h];
      case 'disc': return [...p.pos, p.r, p.t];
      case 'ring': return [...p.pos, p.r, p.tube];
      case 'strut': return [...p.a, ...p.b, p.r];
      case 'ball': return [...p.pos, ...p.radii];
    }
  };
  for (const r of ROWS.filter((q) => !q.parametric)) {
    it(`${r.shape}: scaling one axis scales every part on that axis alone`, () => {
      const base = PART_LIBRARY.find((p) => p.shape === r.shape)!.dimMM.slice();
      // A turned lid's box mixes the axes it leans across, so it is no proportion of any
      // one; it is drawn at the authored size and group-scaled with the base all the same,
      // and its own block holds it to the height at every size.
      const form = r.leansBack ? (dim: number[]) => r.form(dim).filter((p) => p.key !== 'lid') : r.form;
      const a = form(base);
      for (let k = 0; k < 3; k++) {
        for (const s of FACTORS) {
          const dim = base.slice();
          dim[k] *= s;
          const b = form(dim);
          expect(b.map((p) => p.key), `${r.shape} same parts`).toEqual(a.map((p) => p.key));
          b.forEach((pb, i) => {
            const pa = a[i];
            for (let j = 0; j < 3; j++) {
              // `dimMM` is [w, d, h]; a part's frame is [x, y, z] with y up and z the
              // depth, so the depth scales z and the height scales y. A ROUND form is
              // drawn on a square of the width and stretched to the depth by its renderer,
              // so there the width scales x and z both and the depth scales nothing.
              // An OVAL one is drawn on a circle of the width stretched to the height, so the
              // width scales x and y and the height scales nothing.
              const f = r.round
                ? (k === 0 && j !== 1) || (k === 2 && j === 1) ? s : 1
                : r.oval
                  ? (k === 0 && j !== 2) || (k === 1 && j === 2) ? s : 1
                  : j === SPACE_AXIS[k] ? s : 1;
              expect(anchor(pb)[j], `${r.shape} ${pa.key} pos[${j}] when axis ${k} x${s}`).toBeCloseTo(anchor(pa)[j] * f, 12);
              if (pa.kind === 'box' && pb.kind === 'box') {
                expect(pb.size[j], `${r.shape} ${pa.key} size[${j}] when axis ${k} x${s}`).toBeCloseTo(pa.size[j] * f, 12);
              }
            }
            // A form on a circle of the width carries its radii off the width alone, and a
            // post's height (a round form) or a disc's thickness (an oval one) off the axis
            // that is not stretched. A radius taken off the height would draw an ellipse
            // the renderer's stretch then distorts again.
            const at = `${r.shape} ${pa.key} when axis ${k} x${s}`;
            const byW = k === 0 ? s : 1;
            if ((r.round || r.oval) && pa.kind === 'post' && pb.kind === 'post') {
              expect(pb.r, `${at} r`).toBeCloseTo(pa.r * byW, 12);
              expect(pb.rBottom, `${at} rBottom`).toBeCloseTo(pa.rBottom * byW, 12);
              expect(pb.h, `${at} h`).toBeCloseTo(pa.h * (k === 2 ? s : 1), 12);
            }
            if (r.oval && pa.kind === 'disc' && pb.kind === 'disc') {
              expect(pb.r, `${at} r`).toBeCloseTo(pa.r * byW, 12);
              expect(pb.t, `${at} t`).toBeCloseTo(pa.t * (k === 1 ? s : 1), 12);
            }
          });
        }
      }
    });

    it(`${r.shape}: scaling all three scales every number`, () => {
      const base = PART_LIBRARY.find((p) => p.shape === r.shape)!.dimMM.slice();
      const a = r.form(base);
      const s = 1.37;
      const b = r.form(base.map((v) => v * s));
      b.forEach((pb, i) => {
        const na = nums(a[i]);
        nums(pb).forEach((v, j) => expect(v, `${r.shape} ${pb.key} [${j}]`).toBeCloseTo(na[j] * s, 12));
      });
    });
  }

  it('the parametric forms are exactly the ones the renderer draws at the stored size', () => {
    expect(ROWS.filter((r) => r.parametric).map((r) => r.shape)).toEqual(['tv-console', 'door', 'nightstand', 'stool', 'radiator', 'desk-standard', 'desk-standard', 'desk-l']);
    for (const r of ROWS) expect(isParametric(r.shape), r.shape).toBe(r.parametric);
    // And none would pass the property above, which is the point of their being
    // parametric: a door's stiles, a console's 18 mm doors, a nightstand's drawer fronts
    // and a stool's 16 mm legs are joinery, not shares.
    for (const r of ROWS.filter((q) => q.parametric)) {
      const base = PART_LIBRARY.find((p) => p.shape === r.shape)!.dimMM.slice();
      const s = 1.37;
      const a = r.form(base);
      const b = r.form(base.map((v) => v * s));
      const homogeneous = a.length === b.length && a.every((p, i) => {
        const nb = nums(b[i]);
        return nums(p).every((v, j) => Math.abs(nb[j] - v * s) < 1e-9);
      });
      expect(homogeneous, r.shape).toBe(false);
    }
  });
});

describe('the TV console', () => {
  it('is cut into bays a door and a set-top box fit', () => {
    expect(CONSOLE_BAY).toBe(0.55);
    expect(CONSOLE_DOOR).toEqual({ recess: 0.018, thick: 0.018, reveal: 0.0025 });
    expect([700, 800, 1000, 1300, 1400, 1600, 1900, 2200, 2500, 2600, 4000].map(consoleBays))
      .toEqual([2, 2, 2, 2, 3, 3, 3, 4, 5, 5, 5]);
  });

  it('has a door in each end bay and an open shelf in every bay between', () => {
    const band = dimRangeFor('shelf', 'tv-console');
    for (const wMM of [band.min[0], 1000, 1600, 2200, band.max[0]]) {
      const dimMM = [wMM, 400, 500];
      const [, d, h] = dimMM.map((v) => v / 1000);
      const parts = tvConsoleForm(dimMM);
      const n = consoleBays(wMM);
      const by = (pre: string) => parts.filter((p) => p.key.startsWith(pre));
      expect(by('door-').map((p) => p.key)).toEqual(['door-0', `door-${n - 1}`]);
      expect(by('pull-').map((p) => p.key)).toEqual(['pull-0', `pull-${n - 1}`]);
      expect(by('shelf-').length).toBe(n - 2);
      expect(by('divider-').length).toBe(n - 1);
      expect(by('leg-').length).toBe(4);
      const { top: t, foot } = consoleSlabs(dimMM[2]);
      for (const door of by('door-')) {
        const e = partExtent(door);
        // Standing back inside its frame, by the recess, at its thickness.
        expect(e.hi[2]).toBeCloseTo(d / 2 - CONSOLE_DOOR.recess, 12);
        expect(e.hi[2] - e.lo[2]).toBeCloseTo(CONSOLE_DOOR.thick, 12);
        // A reveal clear of the bottom and the top.
        expect(e.lo[1]).toBeCloseTo(foot + t + CONSOLE_DOOR.reveal, 12);
        expect(e.hi[1]).toBeCloseTo(h - t - CONSOLE_DOOR.reveal, 12);
        // The pull on the edge nearer the middle, standing on the door's face.
        const pull = parts.find((p) => p.key === door.key.replace('door', 'pull'))!;
        const pe = partExtent(pull);
        const doorMid = (e.lo[0] + e.hi[0]) / 2;
        const pullMid = (pe.lo[0] + pe.hi[0]) / 2;
        expect(Math.abs(pullMid), door.key).toBeLessThan(Math.abs(doorMid));
        expect(pe.lo[0]).toBeGreaterThanOrEqual(e.lo[0]);
        expect(pe.hi[0]).toBeLessThanOrEqual(e.hi[0]);
        expect(pe.lo[2]).toBeLessThan(e.hi[2]);
        expect(pe.hi[2]).toBeGreaterThan(e.hi[2]);
      }
      // The legs carry the bottom: they stop where it starts.
      for (const leg of by('leg-')) expect(partExtent(leg).hi[1]).toBeCloseTo(foot, 12);
      expect(partExtent(parts.find((p) => p.key === 'bottom')!).lo[1]).toBeCloseTo(foot, 12);
    }
  });

  it('stands on legs, not a plinth', () => {
    expect(consoleSlabs(500)).toEqual({ top: 0.03, foot: 0.1 });
    expect(consoleSlabs(800)).toEqual({ top: 0.03, foot: 0.11 });
    expect(consoleSlabs(300).foot).toBeCloseTo(0.06, 12);
  });
});

describe('the door', () => {
  const band = dimRangeFor('door', 'door');
  const doors = [[900, 50, 2100], [band.min[0], band.min[1], band.min[2]], [band.max[0], band.max[1], band.max[2]]];

  it('is a frame round four panels thinner than it', () => {
    for (const dimMM of doors) {
      const [, d] = dimMM.map((v) => v / 1000);
      const parts = doorForm(dimMM);
      const frame = parts.filter((p) => /^(stile|rail|muntin)-/.test(p.key));
      const panels = parts.filter((p) => p.key.startsWith('panel-'));
      expect(frame.map((p) => p.key)).toEqual(['stile-hinge', 'stile-latch', 'rail-top', 'rail-lock', 'rail-bottom', 'muntin-low', 'muntin-high']);
      expect(panels.length).toBe(4);
      for (const p of frame) expect((p as Extract<HardPart, { kind: 'box' }>).size[2]).toBeCloseTo(d, 12);
      for (const p of panels) {
        const e = partExtent(p);
        // Recessed on both faces, by the same amount.
        expect(e.hi[2]).toBeLessThan(d / 2);
        expect(e.lo[2]).toBeCloseTo(-e.hi[2], 12);
        expect(e.hi[2] - e.lo[2]).toBeCloseTo(d * 0.45, 12);
      }
    }
  });

  it('fills the leaf with no gap and no overlap between frame and panels', () => {
    // Area on the face: the frame and the panels tile the leaf exactly.
    for (const dimMM of doors) {
      const [w, , h] = dimMM.map((v) => v / 1000);
      const leaf = doorForm(dimMM).filter((p) => /^(stile|rail|muntin|panel)-/.test(p.key));
      const area = leaf.reduce((s, p) => {
        const e = partExtent(p);
        return s + (e.hi[0] - e.lo[0]) * (e.hi[1] - e.lo[1]);
      }, 0);
      expect(area).toBeCloseTo(w * h, 12);
    }
  });

  it('carries its lever at hand height on the latch stile', () => {
    for (const dimMM of doors) {
      const [w, , h] = dimMM.map((v) => v / 1000);
      const parts = doorForm(dimMM);
      const hy = -h / 2 + doorHandleY(dimMM[2]);
      const plate = partExtent(parts.find((p) => p.key === 'backplate')!);
      expect((plate.lo[1] + plate.hi[1]) / 2).toBeCloseTo(hy, 12);
      const lock = partExtent(parts.find((p) => p.key === 'rail-lock')!);
      expect((lock.lo[1] + lock.hi[1]) / 2).toBeCloseTo(hy, 12);
      const latch = partExtent(parts.find((p) => p.key === 'stile-latch')!);
      expect(plate.lo[0]).toBeGreaterThanOrEqual(latch.lo[0]);
      expect(plate.hi[0]).toBeLessThanOrEqual(latch.hi[0]);
      // The lever points back toward the hinge, as a lever does, and stays on the leaf.
      const lever = partExtent(parts.find((p) => p.key === 'lever')!);
      expect(lever.lo[0]).toBeLessThan(plate.lo[0]);
      expect(lever.lo[0]).toBeGreaterThan(-w / 2);
      // On its backplate's height, above the keyhole.
      const key = partExtent(parts.find((p) => p.key === 'keyhole')!);
      expect(lever.lo[1]).toBeGreaterThan(key.hi[1]);
      expect(lever.hi[1]).toBeLessThan(plate.hi[1]);
    }
    expect(LEVER_PROUD).toBe(0.05);
  });
});

describe('the television', () => {
  const tvs = PART_LIBRARY.filter((p) => p.shape === 'tv').map((p) => p.dimMM.slice());

  it('is a frame round a recessed screen, the panel tiling the face exactly', () => {
    expect(tvs.length).toBe(3);
    for (const dimMM of tvs) {
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const parts = tvForm(dimMM);
      const face = parts.filter((p) => /^(frame|chin|screen)/.test(p.key));
      expect(face.map((p) => p.key)).toEqual(['frame-l', 'frame-r', 'frame-top', 'chin', 'screen']);
      const area = face.reduce((acc, p) => {
        const e = partExtent(p);
        return acc + (e.hi[0] - e.lo[0]) * (e.hi[1] - e.lo[1]);
      }, 0);
      expect(area).toBeCloseTo(w * h, 12);
      const screen = ext(parts, 'screen');
      for (const k of ['frame-l', 'frame-r', 'frame-top']) {
        // The frame stands proud of the glass, and on the declared front.
        expect(ext(parts, k).hi[2]).toBeCloseTo(d / 2, 12);
        expect(ext(parts, k).hi[2]).toBeGreaterThan(screen.hi[2]);
      }
      // The panel's back is one plane, and the housing is behind it and smaller.
      const back = ext(parts, 'frame-l').lo[2];
      for (const p of face) expect(partExtent(p).lo[2], p.key).toBeCloseTo(back, 12);
      const housing = ext(parts, 'housing');
      expect(housing.hi[2]).toBeCloseTo(back, 12);
      expect(housing.lo[2]).toBeCloseTo(-d / 2, 12);
      expect(housing.hi[0] - housing.lo[0]).toBeLessThan(w * 0.75);
      expect(housing.hi[1] - housing.lo[1]).toBeLessThan(h * 0.75);
    }
  });

  it('carries its standby light in the chin, where the chin is thickest', () => {
    for (const dimMM of tvs) {
      const parts = tvForm(dimMM);
      const led = ext(parts, 'standby');
      const chin = ext(parts, 'chin');
      expect(led.lo[1]).toBeGreaterThan(chin.lo[1]);
      expect(led.hi[1]).toBeLessThan(chin.hi[1]);
      expect(Math.abs(led.lo[0] + led.hi[0])).toBeLessThan(1e-12);
      // Proud of the chin, flush with the frame — never on the chin's own plane.
      expect(led.hi[2]).toBeGreaterThan(chin.hi[2]);
      expect(led.hi[2]).toBeCloseTo(ext(parts, 'frame-top').hi[2], 12);
    }
  });
});

describe('the nightstand', () => {
  const band = dimRangeFor('nightstand', 'nightstand');
  const stands = [[450, 400, 550], band.min.slice(), band.max.slice(), [band.min[0], band.max[1], band.max[2]]];

  it('holds its joinery', () => {
    expect(NIGHTSTAND).toEqual({ overhang: 0.012, top: 0.022, side: 0.018, front: 0.018, reveal: 0.003 });
  });

  it('stands on four legs that meet the carcass, under a top overhanging it', () => {
    for (const dimMM of stands) {
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const parts = nightstandForm(dimMM);
      const legs = parts.filter((p) => p.key.startsWith('leg-'));
      expect(legs.length).toBe(4);
      const bottom = ext(parts, 'bottom');
      for (const leg of legs) {
        const e = partExtent(leg);
        expect(e.lo[1]).toBeCloseTo(0, 12);
        expect(e.hi[1]).toBeCloseTo(bottom.lo[1], 12);
        // Under the carcass, not the overhang.
        expect(e.lo[0]).toBeGreaterThan(ext(parts, 'side-l').lo[0]);
        expect(e.hi[0]).toBeLessThan(ext(parts, 'side-r').hi[0]);
      }
      const top = ext(parts, 'top');
      expect(top.hi[1]).toBeCloseTo(h, 12);
      expect([top.lo[0], top.hi[0], top.lo[2], top.hi[2]]).toEqual([-w / 2, w / 2, -d / 2, d / 2]);
      const o = Math.min(NIGHTSTAND.overhang, w * 0.03, d * 0.03);
      expect(ext(parts, 'side-l').lo[0]).toBeCloseTo(-w / 2 + o, 12);
      expect(ext(parts, 'side-r').hi[0]).toBeCloseTo(w / 2 - o, 12);
      expect(ext(parts, 'side-l').hi[2]).toBeCloseTo(d / 2 - o, 12);
      expect(ext(parts, 'side-l').hi[1]).toBeCloseTo(top.lo[1], 12);
    }
  });

  it('sets two drawers inside the frame with a reveal round each, a knob centred on it', () => {
    for (const dimMM of stands) {
      const parts = nightstandForm(dimMM);
      const fronts = parts.filter((p) => p.key.startsWith('front-'));
      expect(fronts.map((p) => p.key)).toEqual(['front-0', 'front-1']);
      // Closed, nothing behind them is drawn.
      expect(parts.some((p) => p.key.startsWith('box-'))).toBe(false);
      const l = ext(parts, 'side-l');
      const r = ext(parts, 'side-r');
      const bottom = ext(parts, 'bottom');
      const top = ext(parts, 'top');
      const [f0, f1] = fronts.map(partExtent);
      const rv = NIGHTSTAND.reveal;
      for (const f of [f0, f1]) {
        expect(f.lo[0] - l.hi[0]).toBeCloseTo(rv, 12);
        expect(r.lo[0] - f.hi[0]).toBeCloseTo(rv, 12);
        // A millimetre back from the frame's face.
        expect(l.hi[2] - f.hi[2]).toBeCloseTo(0.001, 12);
      }
      expect(f0.lo[1] - bottom.hi[1]).toBeCloseTo(rv, 12);
      expect(f1.lo[1] - f0.hi[1]).toBeCloseTo(2 * rv, 12);
      expect(top.lo[1] - f1.hi[1]).toBeCloseTo(rv, 12);
      expect(f1.hi[1] - f1.lo[1]).toBeCloseTo(f0.hi[1] - f0.lo[1], 12);
      for (const [i, f] of [f0, f1].entries()) {
        const k = ext(parts, `knob-${i}`);
        expect((k.lo[1] + k.hi[1]) / 2).toBeCloseTo((f.lo[1] + f.hi[1]) / 2, 12);
        expect(k.lo[0] + k.hi[0]).toBeCloseTo(0, 12);
        // Seated into the front, standing out from it.
        expect(k.lo[2]).toBeLessThan(f.hi[2]);
        expect(k.hi[2]).toBeGreaterThan(f.hi[2]);
      }
      // The cavity runs forward to the drawers' backs and stops there: it is what holds
      // them. Air between left both fronts hanging in their reveals, detached.
      expect(ext(parts, 'cavity').hi[2]).toBeCloseTo(f0.lo[2], 9);
    }
  });

  it('opens by sliding the drawers and nothing else, and they stay on their runners', () => {
    expect(nightstandSlide(0, 400)).toBe(0);
    expect(nightstandSlide(1, 400)).toBe(drawerSlide(400));
    expect(nightstandSlide(0.5, 400)).toBeCloseTo(drawerSlide(400) / 2, 12);
    expect(nightstandSlide(2, 400)).toBe(drawerSlide(400));
    expect(nightstandSlide(-1, 400)).toBe(0);
    for (const dimMM of stands) {
      const slide = nightstandSlide(1, dimMM[1]);
      expect(slide).toBeGreaterThan(0);
      const shut = nightstandForm(dimMM);
      const open = nightstandForm(dimMM, slide);
      const moving = /^(front|knob|box)-/;
      expect(open.filter((p) => !p.key.startsWith('box-')).map((p) => p.key)).toEqual(shut.map((p) => p.key));
      for (const p of shut) {
        const q = open.find((x) => x.key === p.key)!;
        const a = partExtent(p);
        const b = partExtent(q);
        const dz = moving.test(p.key) ? slide : 0;
        for (let j = 0; j < 3; j++) {
          expect(b.lo[j], `${p.key} lo[${j}]`).toBeCloseTo(a.lo[j] + (j === 2 ? dz : 0), 12);
          expect(b.hi[j], `${p.key} hi[${j}]`).toBeCloseTo(a.hi[j] + (j === 2 ? dz : 0), 12);
        }
      }
      // From the first millimetres the box is drawn at, to full travel.
      for (const travel of [0.0021, slide / 2, slide]) {
        const at = nightstandForm(dimMM, travel);
        const cavity = ext(at, 'cavity');
        for (const i of [0, 1]) {
          const box = ext(at, `box-${i}`);
          const front = ext(at, `front-${i}`);
          // The box hangs off the back of its front; barely open, it is inside the
          // carcass rather than through its back, and at full travel it is still in it —
          // a drawer that had left its runners would be on the floor.
          expect(box.hi[2]).toBeCloseTo(front.lo[2], 12);
          expect(box.lo[2], `${dimMM.join('x')} open ${travel}`).toBeGreaterThanOrEqual(cavity.lo[2] - 1e-12);
          expect(box.lo[2]).toBeLessThan(front.lo[2] - 0.05);
        }
      }
      for (const i of [0, 1]) {
        const box = ext(open, `box-${i}`);
        const front = ext(open, `front-${i}`);
        expect(box.lo[0]).toBeGreaterThan(front.lo[0]);
        expect(box.hi[0]).toBeLessThan(front.hi[0]);
        expect(box.lo[1]).toBeGreaterThan(front.lo[1]);
        expect(box.hi[1]).toBeLessThan(front.hi[1]);
      }
    }
  });
});

describe('the stool', () => {
  const band = dimRangeFor('chair', 'stool');
  const stools = [[350, 350, 450], band.min.slice(), band.max.slice(), [band.min[0], band.min[1], band.max[2]], [band.max[0], band.max[1], band.min[2]]];

  it('holds its joinery', () => {
    expect(STOOL).toEqual({ leg: 0.016, rung: 0.01, splayIn: 0.55 });
  });

  it('splays three legs from under the seat to a wider stance, feet on the floor', () => {
    for (const dimMM of stools) {
      const [w, , h] = dimMM.map((v) => v / 1000);
      const parts = stoolForm(dimMM);
      const legs = parts.filter((p): p is Strut => p.key.startsWith('leg-'));
      expect(legs.length).toBe(3);
      const yS = h - stoolSeat(dimMM[2]);
      const radius = ([x, , z]: number[]) => Math.hypot(x, z);
      for (const leg of legs) {
        const e = partExtent(leg);
        // The lowest point of the cut end is ON the floor — not below it, not above.
        expect(e.lo[1], leg.key).toBeCloseTo(0, 9);
        expect(leg.b[1]).toBeCloseTo(yS, 12);
        expect(radius(leg.a), `${leg.key} splays out`).toBeGreaterThan(radius(leg.b) + 0.03);
        // Inside the seat's circle at the floor, which is the footprint the plan draws.
        expect(radius(leg.a) + leg.r).toBeLessThanOrEqual(w / 2 + 1e-12);
        expect(leg.r).toBe(STOOL.leg);
      }
      // A third of a turn apart.
      const bearings = legs.map((l) => Math.atan2(l.a[2], l.a[0]));
      for (let i = 0; i < 3; i++) {
        const gap = (bearings[(i + 1) % 3] - bearings[i] + 4 * Math.PI) % (2 * Math.PI);
        expect(gap).toBeCloseTo((2 * Math.PI) / 3, 12);
      }
      // The seat is the top and spans the width.
      const seat = ext(parts, 'seat');
      expect(seat.hi[1]).toBeCloseTo(h, 12);
      expect(seat.hi[0] - seat.lo[0]).toBeCloseTo(w, 12);
      expect(ext(parts, 'seat-ease').lo[1]).toBeCloseTo(yS, 12);
    }
  });

  it('ties the legs with a ring of stretchers that meet them on their axes', () => {
    for (const dimMM of stools) {
      const parts = stoolForm(dimMM);
      const legs = parts.filter((p): p is Strut => p.key.startsWith('leg-'));
      const rungs = parts.filter((p): p is Strut => p.key.startsWith('rung-'));
      expect(rungs.length).toBe(3);
      // A point on a leg's axis is the foot plus a share of the leg.
      const onLeg = (pt: number[]) => legs.some((l) => {
        const k = (pt[1] - l.a[1]) / (l.b[1] - l.a[1]);
        return k > 0.1 && k < 0.6 && [0, 1, 2].every((i) => Math.abs(l.a[i] + (l.b[i] - l.a[i]) * k - pt[i]) < 1e-12);
      });
      for (const r of rungs) {
        expect(onLeg(r.a), `${r.key} a`).toBe(true);
        expect(onLeg(r.b), `${r.key} b`).toBe(true);
        // Level.
        expect(r.a[1]).toBeCloseTo(r.b[1], 12);
        expect(r.r).toBe(STOOL.rung);
      }
      // Each pair of legs is tied once.
      const ends = rungs.map((r) => [r.a, r.b].map((pt) => legs.findIndex((l) => Math.abs(Math.atan2(l.a[2], l.a[0]) - Math.atan2(pt[2], pt[0])) < 1e-9)).sort().join());
      expect(ends.sort()).toEqual(['0,1', '0,2', '1,2']);
    }
  });
});

describe('the side table', () => {
  it('stacks top, ease, collar, turned column and stepped foot, each on the one below', () => {
    const band = dimRangeFor('table', 'side-table');
    for (const wMM of [band.min[0], 450, band.max[0]]) {
      for (const hMM of [band.min[2], 550, band.max[2]]) {
        const dimMM = [wMM, 450, hMM];
        const [w, , h] = dimMM.map((v) => v / 1000);
        const parts = sideTableForm(dimMM);
        const at = dimMM.join('x');
        const e = (k: string) => ext(parts, k);
        const post = (k: string) => {
          const p = parts.find((q) => q.key === k);
          if (p?.kind !== 'post') throw new Error(k);
          return p;
        };
        // The top: the full square, reaching the height.
        expect(e('top').hi[1]).toBeCloseTo(h, 12);
        for (const k of [0, 2]) {
          expect(e('top').lo[k]).toBeCloseTo(-w / 2, 12);
          expect(e('top').hi[k]).toBeCloseTo(w / 2, 12);
        }
        // Each layer standing on the next, none floating, none buried.
        const chain = ['top', 'top-ease', 'collar', 'column', 'foot-step', 'foot'];
        for (let i = 0; i + 1 < chain.length; i++) {
          expect(e(chain[i]).lo[1], `${at} ${chain[i]} on ${chain[i + 1]}`).toBeCloseTo(e(chain[i + 1]).hi[1], 12);
        }
        expect(e('foot').lo[1]).toBeCloseTo(0, 12);
        // …and each narrower than the one it stands on or hangs from, going inward from
        // the top and outward again to the foot.
        const half = (k: string) => e(k).hi[0];
        expect(half('top-ease')).toBeLessThan(half('top') - EPS);
        expect(half('collar')).toBeLessThan(half('top-ease') - EPS);
        expect(half('column')).toBeLessThan(half('collar') - EPS);
        expect(half('foot-step')).toBeGreaterThan(half('column') + EPS);
        expect(half('foot')).toBeGreaterThan(half('foot-step') + EPS);
        // The column tapers out toward the foot, and each ring stands proud of it at its
        // own height, inside the column's run.
        const col = post('column');
        expect(col.rBottom, at).toBeGreaterThan(col.r);
        const colAt = (y: number) => col.rBottom + (col.r - col.rBottom) * ((y - e('column').lo[1]) / col.h);
        for (const k of ['ring-top', 'ring-foot']) {
          const ring = post(k);
          const re = e(k);
          expect(re.lo[1], `${at} ${k}`).toBeGreaterThan(e('column').lo[1] + EPS);
          expect(re.hi[1], `${at} ${k}`).toBeLessThan(e('column').hi[1] - EPS);
          expect(Math.min(ring.r, ring.rBottom), `${at} ${k} proud`).toBeGreaterThan(colAt(re.hi[1]) + EPS);
          expect(Math.min(ring.r, ring.rBottom)).toBeGreaterThan(colAt(re.lo[1]) + EPS);
        }
        // One ring under the collar, one over the foot.
        expect(e('ring-top').lo[1]).toBeGreaterThan(h / 2);
        expect(e('ring-foot').hi[1]).toBeLessThan(h / 2);
        // The wood is the table's colour; the turned parts a shade darker.
        expect(parts.filter((p) => p.tone === 'body').map((p) => p.key)).toEqual(['top', 'top-ease']);
      }
    }
  });
});

describe('the radiator', () => {
  it('pins its fittings', () => {
    expect(RADIATOR).toEqual({ foot: 0.04, valve: 0.05, row: 0.045 });
  });

  const band = dimRangeFor('fridge', 'radiator');
  const grid: number[][] = [];
  for (const w of [band.min[0], 800, 1200, band.max[0]]) for (const d of [band.min[1], 90, 120, band.max[1]]) for (const h of [band.min[2], 580, band.max[2]]) grid.push([w, d, h]);

  it('is radiatorFins(width) sections, one to four tubes deep by its depth', () => {
    const rowsAt = (dMM: number) => {
      const f = radiatorForm([800, dMM, 580]);
      return new Set(f.columns.filter((p) => p.key.startsWith('tube-')).map((p) => (p as { pos: number[] }).pos[2].toFixed(9))).size;
    };
    expect([60, 70, 90, 120, 160, 200].map(rowsAt)).toEqual([1, 2, 2, 3, 4, 4]);
    for (const dimMM of grid) {
      const f = radiatorForm(dimMM);
      const tubes = f.columns.filter((p) => p.key.startsWith('tube-'));
      const xs = new Set(tubes.map((p) => (p as { pos: number[] }).pos[0].toFixed(9)));
      expect(xs.size, dimMM.join('x')).toBe(radiatorFins(dimMM[0]));
      expect(tubes.length % xs.size).toBe(0);
    }
  });

  it('caps every tube round at both ends, joins each section across its depth and all of them along the width', () => {
    for (const dimMM of grid) {
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const at = dimMM.join('x');
      const { columns, fittings } = radiatorForm(dimMM);
      const tubes = columns.filter((p): p is Extract<HardPart, { kind: 'post' }> => p.kind === 'post');
      expect(tubes.every((t) => t.key.startsWith('tube-'))).toBe(true);
      const n = radiatorFins(dimMM[0]);
      const rows = tubes.length / n;
      const rt = tubes[0].r;
      const pitch = Math.abs(tubes[rows].pos[0] - tubes[0].pos[0]);
      // A real column tube is about an inch across: 14 mm at most, less where the pitch
      // either way is too tight to keep the tubes apart.
      expect(rt, at).toBeCloseTo(Math.min(pitch * 0.38, (d / rows) * 0.42, 0.014), 12);
      // Round tubes, apart from their neighbours both ways.
      expect(2 * rt, `${at} tubes clear along the width`).toBeLessThan(pitch - EPS);
      if (rows > 1) expect(2 * rt, `${at} tubes clear across the depth`).toBeLessThan(Math.abs(tubes[1].pos[2] - tubes[0].pos[2]) - EPS);
      const yTop = h - rt;
      const yFoot = RADIATOR.foot + rt;
      for (const t of tubes) {
        expect(t.rBottom).toBe(t.r);
        const [, i, j] = t.key.split('-');
        const e = partExtent(t);
        // A tube runs between the centres of its two rounded ends…
        expect(e.lo[1], `${at} ${t.key}`).toBeCloseTo(yFoot, 12);
        expect(e.hi[1], `${at} ${t.key}`).toBeCloseTo(yTop, 12);
        for (const [cap, y] of [[`cap-${i}-${j}`, yTop], [`base-${i}-${j}`, yFoot]] as const) {
          const c = columns.find((p) => p.key === cap);
          if (c?.kind !== 'ball') throw new Error(`${at} no ${cap}`);
          expect(c.radii).toEqual([rt, rt, rt]);
          expect(c.pos[0]).toBe(t.pos[0]);
          expect(c.pos[1]).toBeCloseTo(y, 12);
          expect(c.pos[2]).toBe(t.pos[2]);
        }
      }
      // …so the caps are what reach the height, and the foot caps sit on the feet.
      expect(Math.max(...columns.map((p) => partExtent(p).hi[1]))).toBeCloseTo(h, 12);
      expect(Math.min(...columns.map((p) => partExtent(p).lo[1]))).toBeCloseTo(RADIATOR.foot, 12);
      // A joint across the depth at both ends of every section deeper than one tube.
      const joins = columns.filter((p): p is Extract<HardPart, { kind: 'strut' }> => p.kind === 'strut' && p.key.startsWith('join-'));
      expect(joins.length, at).toBe(rows > 1 ? 2 * n : 0);
      const zs = tubes.slice(0, rows).map((t) => t.pos[2]);
      for (const jn of joins) {
        expect(jn.r).toBe(rt);
        expect([jn.a[2], jn.b[2]]).toEqual([Math.min(...zs), Math.max(...zs)]);
        expect([yTop, yFoot].some((y) => Math.abs(jn.a[1] - y) < 1e-12 && Math.abs(jn.b[1] - y) < 1e-12), `${at} ${jn.key} at a cap`).toBe(true);
      }
      // Two headers, first section to last, through the joints, thinner than a tube.
      const headers = columns.filter((p): p is Extract<HardPart, { kind: 'strut' }> => p.kind === 'strut' && p.key.startsWith('header-'));
      expect(headers.map((p) => p.key)).toEqual(['header-top', 'header-foot']);
      const xs = tubes.map((t) => t.pos[0]);
      headers.forEach((hd, k) => {
        expect(hd.r).toBeLessThan(rt);
        expect([hd.a[0], hd.b[0]]).toEqual([Math.min(...xs), Math.max(...xs)]);
        expect(hd.a[1]).toBeCloseTo(k === 0 ? yTop : yFoot, 12);
        expect(hd.b[1]).toBe(hd.a[1]);
      });
      // Every column part is the radiator's own enamel.
      expect(columns.every((p) => p.tone === 'body')).toBe(true);
      // The feet: on the floor under the second section from each end, up to the foot caps'
      // centres, the full depth.
      for (const [side, x] of [['l', xs[rows]], ['r', xs[tubes.length - 1 - rows]]] as const) {
        const ft = ext(fittings, `foot-${side}`);
        expect(ft.lo[1]).toBe(0);
        expect(ft.hi[1]).toBeCloseTo(yFoot, 12);
        expect((ft.lo[0] + ft.hi[0]) / 2).toBeCloseTo(x, 12);
        expect(ft.hi[0] - ft.lo[0], `${at} foot-${side} a 30 mm blade`).toBeCloseTo(Math.min(0.03, pitch), 12);
        expect([ft.lo[2], ft.hi[2]].map((v) => +v.toFixed(12))).toEqual([-d / 2, d / 2].map((v) => +v.toFixed(12)));
      }
      void w;
    }
  });

  it('keeps its valve in the strip at the right-hand end, fed from the last section', () => {
    for (const dimMM of grid) {
      const [w, , h] = dimMM.map((v) => v / 1000);
      const at = dimMM.join('x');
      const { columns, fittings } = radiatorForm(dimMM);
      const vW = Math.min(RADIATOR.valve, w * 0.1);
      const strip = w / 2 - vW;
      // The sections stop at the strip; the valve, its pipe and head stand inside it.
      expect(Math.max(...columns.map((p) => partExtent(p).hi[0])), at).toBeLessThanOrEqual(strip + EPS);
      for (const k of ['pipe', 'valve', 'head', 'head-grip']) {
        const e = ext(fittings, k);
        expect(e.lo[0], `${at} ${k}`).toBeGreaterThanOrEqual(strip - EPS);
        expect(e.hi[0], `${at} ${k}`).toBeLessThanOrEqual(w / 2 + EPS);
      }
      const tubes = columns.filter((p) => p.kind === 'post');
      const yFoot = RADIATOR.foot + (tubes[0] as { r: number }).r;
      const lastX = Math.max(...tubes.map((t) => (t as { pos: number[] }).pos[0]));
      // The pipe up out of the floor to the valve, the tail from the last section to it.
      expect(ext(fittings, 'pipe').lo[1]).toBe(0);
      expect(ext(fittings, 'pipe').hi[1]).toBeCloseTo(yFoot, 12);
      const tail = fittings.find((p) => p.key === 'tail');
      if (tail?.kind !== 'strut') throw new Error('tail');
      expect(tail.a).toEqual([lastX, yFoot, 0]);
      const valve = fittings.find((p) => p.key === 'valve');
      if (valve?.kind !== 'post') throw new Error('valve');
      expect(tail.b).toEqual(valve.pos);
      // The head on the valve, the grip ring round it proud, everything below the top.
      expect(ext(fittings, 'head').lo[1]).toBeCloseTo(ext(fittings, 'valve').hi[1], 12);
      const head = fittings.find((p) => p.key === 'head');
      const grip = fittings.find((p) => p.key === 'head-grip');
      if (head?.kind !== 'post' || grip?.kind !== 'post') throw new Error('head');
      expect(ext(fittings, 'head-grip').lo[1]).toBeGreaterThan(ext(fittings, 'head').lo[1]);
      expect(ext(fittings, 'head-grip').hi[1]).toBeLessThan(ext(fittings, 'head').hi[1]);
      const headAt = (y: number) => head.rBottom + (head.r - head.rBottom) * ((y - ext(fittings, 'head').lo[1]) / head.h);
      expect(grip.rBottom).toBeGreaterThan(headAt(ext(fittings, 'head-grip').lo[1]));
      expect(grip.r).toBeGreaterThan(headAt(ext(fittings, 'head-grip').hi[1]));
      expect(ext(fittings, 'head').hi[1]).toBeLessThan(h);
      expect(['pipe', 'tail', 'valve'].map((k) => fittings.find((p) => p.key === k)!.tone)).toEqual(['steel', 'steel', 'steel']);
      expect(head.tone).toBe('body');
      expect(grip.tone).toBe('trim');
      // A hand-sized head: 60 mm, or half what is left above the valve on a low radiator.
      expect(head.h, at).toBeCloseTo(Math.min(0.06, (h - yFoot) * 0.5), 12);
    }
  });
});

/** A wall piece's corners: the Library size and the band's four width × height corners. */
function wallSizes(shape: Shape, category: Category): number[][] {
  const band = dimRangeFor(category, shape);
  const out = [PART_LIBRARY.find((p) => p.shape === shape)!.dimMM.slice()];
  for (const w of [band.min[0], band.max[0]]) for (const h of [band.min[2], band.max[2]]) out.push([w, out[0][1], h]);
  return out;
}

/** True when two parts' extents share volume — touching faces do not count. */
function overlap(a: HardPart, b: HardPart): boolean {
  const ea = partExtent(a);
  const eb = partExtent(b);
  return [0, 1, 2].every((k) => ea.lo[k] < eb.hi[k] - EPS && eb.lo[k] < ea.hi[k] - EPS);
}

/** A border's four rails as the window they leave: [x0, x1, y0, y1]. */
function windowOf(parts: HardPart[], key: string): number[] {
  return [ext(parts, `${key}-l`).hi[0], ext(parts, `${key}-r`).lo[0], ext(parts, `${key}-foot`).hi[1], ext(parts, `${key}-head`).lo[1]];
}
/** A border's four rails close round their window: the head and foot run its full width,
 *  and each side runs from the foot's top to the head's foot, so no corner shows the wall
 *  through it and none is drawn twice. */
function closesRing(parts: HardPart[], key: string, at: string) {
  const [l, r, head, foot] = ['l', 'r', 'head', 'foot'].map((k) => ext(parts, `${key}-${k}`));
  for (const [k, e] of [['head', head], ['foot', foot]] as const) {
    expect(e.lo[0], `${at} ${key}-${k} left`).toBeCloseTo(l.lo[0], 12);
    expect(e.hi[0], `${at} ${key}-${k} right`).toBeCloseTo(r.hi[0], 12);
  }
  for (const [k, e] of [['l', l], ['r', r]] as const) {
    expect(e.lo[1], `${at} ${key}-${k} foot`).toBeCloseTo(foot.hi[1], 12);
    expect(e.hi[1], `${at} ${key}-${k} head`).toBeCloseTo(head.lo[1], 12);
  }
  for (const e of [l, r, head, foot]) {
    expect(e.lo[2], `${at} ${key} back`).toBeCloseTo(l.lo[2], 12);
    expect(e.hi[2], `${at} ${key} front`).toBeCloseTo(l.hi[2], 12);
  }
}
const outline = (parts: HardPart[], key: string) => {
  const e = ext(parts, key);
  return [e.lo[0], e.hi[0], e.lo[1], e.hi[1]];
};
const borderOutline = (parts: HardPart[], key: string) => [ext(parts, `${key}-l`).lo[0], ext(parts, `${key}-r`).hi[0], ext(parts, `${key}-foot`).lo[1], ext(parts, `${key}-head`).hi[1]];
const close = (a: number[], b: number[], at: string) => a.forEach((v, i) => expect(v, `${at} [${i}]`).toBeCloseTo(b[i], 12));

describe('the painting', () => {
  it('steps from the frame down through a fillet and a mat to the picture, each filling the window of the one round it', () => {
    for (const dimMM of wallSizes('painting', 'painting')) {
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const at = dimMM.join('x');
      const parts = paintingForm(dimMM);
      // The frame is the piece's own outline; each layer fills the window of the one round
      // it exactly, so no light shows between them and no two draw the same face.
      close(borderOutline(parts, 'frame'), [-w / 2, w / 2, -h / 2, h / 2], `${at} frame`);
      close(borderOutline(parts, 'fillet'), windowOf(parts, 'frame'), `${at} fillet`);
      close(borderOutline(parts, 'mat'), windowOf(parts, 'fillet'), `${at} mat`);
      close(outline(parts, 'ground'), windowOf(parts, 'mat'), `${at} ground`);
      for (const k of ['frame', 'fillet', 'mat']) closesRing(parts, k, at);
      // Each layer stands back from the one round it: the light catches three edges.
      const front = (k: string) => ext(parts, k).hi[2];
      expect(front('frame-head')).toBeCloseTo(d / 2, 12);
      expect(front('fillet-head')).toBeLessThan(front('frame-head') - EPS);
      expect(front('mat-head')).toBeLessThan(front('fillet-head') - EPS);
      expect(front('field-warm')).toBeLessThan(front('mat-head') - EPS);
      expect(front('ground')).toBeLessThan(front('field-warm') - EPS);
      // Everything is backed on the wall.
      for (const p of parts.filter((q) => !q.key.startsWith('field'))) expect(partExtent(p).lo[2], `${at} ${p.key}`).toBeCloseTo(-d / 2, 12);
      // The fields lie on the ground, inside the picture, clear of each other.
      const fields = parts.filter((p) => p.key.startsWith('field'));
      expect(fields.map((p) => p.tone)).toEqual(['art-warm', 'art-ochre', 'art-cool']);
      const g = outline(parts, 'ground');
      for (const f of fields) {
        expect(partExtent(f).lo[2]).toBeCloseTo(front('ground'), 12);
        const o = outline(parts, f.key);
        expect(o[0]).toBeGreaterThan(g[0] + EPS);
        expect(o[1]).toBeLessThan(g[1] - EPS);
        expect(o[2]).toBeGreaterThan(g[2] + EPS);
        expect(o[3]).toBeLessThan(g[3] - EPS);
      }
      for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) expect(overlap(fields[i], fields[j]), `${fields[i].key} ${fields[j].key}`).toBe(false);
      // No two parts share volume: the rails of a border meet at the corners once.
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) expect(overlap(parts[i], parts[j]), `${at} ${parts[i].key} ${parts[j].key}`).toBe(false);
      // The picture's ground is the user's colour; the frame is wood, the fillet gilt.
      expect(parts.filter((p) => p.tone === 'body').map((p) => p.key)).toEqual(['ground']);
      expect(new Set(parts.filter((p) => p.key.startsWith('frame')).map((p) => p.tone))).toEqual(new Set(['wood']));
      expect(new Set(parts.filter((p) => p.key.startsWith('fillet')).map((p) => p.tone))).toEqual(new Set(['brass']));
      expect(new Set(parts.filter((p) => p.key.startsWith('mat')).map((p) => p.tone))).toEqual(new Set(['mat']));
    }
  });

  it('is framed as a real print at the Library size: a 42 mm moulding, a 70 mm mat', () => {
    const parts = paintingForm([800, 30, 600]);
    expect(ext(parts, 'frame-l').hi[0] - ext(parts, 'frame-l').lo[0]).toBeCloseTo(0.042, 12);
    expect(ext(parts, 'frame-head').hi[1] - ext(parts, 'frame-head').lo[1]).toBeCloseTo(0.042, 12);
    expect(ext(parts, 'fillet-l').hi[0] - ext(parts, 'fillet-l').lo[0]).toBeCloseTo(0.008, 12);
    expect(ext(parts, 'mat-l').hi[0] - ext(parts, 'mat-l').lo[0]).toBeCloseTo(0.07, 12);
    expect(ext(parts, 'mat-head').hi[1] - ext(parts, 'mat-head').lo[1]).toBeCloseTo(0.07, 3);
    // 30 mm deep: the frame's face, the fillet 7.5 mm back, the mat 12, the picture 15.
    expect([ext(parts, 'fillet-head').hi[2], ext(parts, 'mat-head').hi[2], ext(parts, 'ground').hi[2]]).toEqual([0.0075, 0.003, 0].map((v) => expect.closeTo(v, 12)));
  });
});

describe('the mirror', () => {
  it('sets its glass behind a bead behind the frame, filling the window exactly', () => {
    for (const dimMM of wallSizes('mirror', 'mirror')) {
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const at = dimMM.join('x');
      const parts = mirrorForm(dimMM);
      // The frame is the piece's outline — not 15 mm past it, as it was.
      close(borderOutline(parts, 'frame'), [-w / 2, w / 2, -h / 2, h / 2], `${at} frame`);
      close(borderOutline(parts, 'bead'), windowOf(parts, 'frame'), `${at} bead`);
      close(outline(parts, 'glass'), windowOf(parts, 'bead'), `${at} glass`);
      for (const k of ['frame', 'bead']) closesRing(parts, k, at);
      // The glass behind the bead, the bead behind the frame's face — never proud of it.
      const front = (k: string) => ext(parts, k).hi[2];
      expect(front('frame-l')).toBeCloseTo(d / 2, 12);
      expect(front('bead-l')).toBeLessThan(front('frame-l') - EPS);
      expect(front('glass')).toBeLessThan(front('bead-l') - EPS);
      for (const p of parts) expect(partExtent(p).lo[2], `${at} ${p.key}`).toBeCloseTo(-d / 2, 12);
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) expect(overlap(parts[i], parts[j]), `${at} ${parts[i].key} ${parts[j].key}`).toBe(false);
      expect(parts.find((p) => p.key === 'glass')!.tone).toBe('mirror');
      expect(new Set(parts.filter((p) => p.key.startsWith('frame')).map((p) => p.tone))).toEqual(new Set(['body']));
      expect(new Set(parts.filter((p) => p.key.startsWith('bead')).map((p) => p.tone))).toEqual(new Set(['trim']));
    }
  });

  it('is a 45 mm frame and a 10 mm bead at the Library size', () => {
    const parts = mirrorForm([600, 30, 1400]);
    const wide = (k: string, axis: number) => ext(parts, k).hi[axis] - ext(parts, k).lo[axis];
    expect(wide('frame-l', 0)).toBeCloseTo(0.045, 12);
    expect(wide('frame-head', 1)).toBeCloseTo(0.045, 3);
    expect(wide('bead-l', 0)).toBeCloseTo(0.010, 3);
    expect(wide('bead-head', 1)).toBeCloseTo(0.010, 3);
  });
});

describe('the oval mirror', () => {
  it('is three concentric discs, each set on the one behind, the glass at the front', () => {
    for (const dimMM of wallSizes('mirror-oval', 'mirror')) {
      const [w, d] = dimMM.map((v) => v / 1000);
      const parts = ovalMirrorForm(dimMM);
      expect(parts.map((p) => p.key)).toEqual(['frame', 'bevel', 'glass']);
      const discs = parts.map((p) => {
        if (p.kind !== 'disc') throw new Error(p.key);
        return p;
      });
      for (const p of discs) expect([p.pos[0], p.pos[1]]).toEqual([0, 0]);
      expect(discs[0].r).toBeCloseTo(w / 2, 12);
      expect(discs[1].r).toBeLessThan(discs[0].r);
      expect(discs[2].r).toBeLessThan(discs[1].r);
      const e = parts.map(partExtent);
      expect(e[0].lo[2]).toBeCloseTo(-d / 2, 12);
      expect(e[1].lo[2]).toBeCloseTo(e[0].hi[2], 12);
      expect(e[2].lo[2]).toBeCloseTo(e[1].hi[2], 12);
      expect(e[2].hi[2]).toBeCloseTo(d / 2, 12);
      expect(discs.map((p) => p.tone)).toEqual(['body', 'trim', 'mirror']);
      // A rim showing round the glass: 6% of the width at the bevel, 12% at the frame.
      expect(discs[1].r / discs[0].r).toBeCloseTo(0.92, 12);
      expect(discs[2].r / discs[0].r).toBeCloseTo(0.88, 12);
    }
  });

  it('takes nothing off its height, which the renderer stretches it to', () => {
    const lib = [600, 30, 1100];
    expect(ovalMirrorForm([600, 30, 1900])).toEqual(ovalMirrorForm(lib));
    expect(ovalMirrorForm([600, 30, 400])).toEqual(ovalMirrorForm(lib));
  });
});

describe('the air purifier', () => {
  type Post = Extract<HardPart, { kind: 'post' }>;
  const posts = (dimMM: number[]) => airPurifierForm(dimMM).map((p) => {
    if (p.kind !== 'post') throw new Error(p.key);
    return p;
  });
  const band = dimRangeFor('fridge', 'air-purifier');
  const dims = [[300, 300, 620], [band.min[0], band.min[0], band.min[2]], [band.max[0], band.max[0], band.max[2]]];

  it('stacks plinth, collar, intake, shell, chamfer and outlet, each on the one below', () => {
    for (const dimMM of dims) {
      const at = dimMM.join('x');
      const [w, , h] = dimMM.map((v) => v / 1000);
      const parts = posts(dimMM);
      const e = (k: string) => ext(parts, k);
      const chain = ['plinth', 'collar', 'core', 'shell', 'chamfer', 'outlet'];
      expect(e('plinth').lo[1]).toBe(0);
      for (let i = 0; i + 1 < chain.length; i++) expect(e(chain[i + 1]).lo[1], `${at} ${chain[i + 1]} on ${chain[i]}`).toBeCloseTo(e(chain[i]).hi[1], 12);
      // The body is the full circle; the plinth tucked under it, the outlet sunk in the top.
      const r = (k: string) => parts.find((p) => p.key === k)!;
      expect(r('shell').r).toBeCloseTo(w / 2, 12);
      expect(r('collar').r).toBeCloseTo(w / 2, 12);
      expect(r('collar').rBottom).toBeLessThan(r('collar').r);
      expect(r('plinth').r).toBeLessThan(r('collar').rBottom);
      expect(r('chamfer').rBottom).toBeCloseTo(r('shell').r, 12);
      expect(r('chamfer').r).toBeLessThan(r('chamfer').rBottom);
      expect(r('outlet').r).toBeLessThan(r('chamfer').r);
      // The dial stands on the outlet and is the top; the status light sits on the outlet,
      // between the dial and the outlet's rim.
      expect(e('dial').lo[1]).toBeCloseTo(e('outlet').lo[1], 12);
      expect(e('dial').hi[1]).toBeCloseTo(h, 12);
      expect(e('status').lo[1]).toBeCloseTo(e('outlet').hi[1], 12);
      const led = r('status');
      expect(led.pos[2] - led.r).toBeGreaterThan(r('dial').r);
      expect(led.pos[2] + led.r).toBeLessThan(r('outlet').r);
      expect([led.tone, r('dial').tone, r('core').tone]).toEqual(['led', 'display', 'dark']);
    }
  });

  it('cuts its intake into twenty ribs proud of a dark core, with a slot between each', () => {
    for (const dimMM of dims) {
      const at = dimMM.join('x');
      const parts = posts(dimMM);
      const core = parts.find((p) => p.key === 'core') as Post;
      const ce = partExtent(core);
      const ribs = parts.filter((p) => p.key.startsWith('rib-'));
      expect(ribs.length).toBe(AIR_PURIFIER.ribs);
      expect(AIR_PURIFIER.ribs).toBe(20);
      const pitch = (ce.hi[1] - ce.lo[1]) / ribs.length;
      ribs.forEach((rib, i) => {
        const e = partExtent(rib);
        expect(rib.r, `${at} ${rib.key} proud`).toBeGreaterThan(core.r);
        expect(rib.r, `${at} ${rib.key} inside the shell`).toBeLessThan(dimMM[0] / 2000);
        expect(rib.tone).toBe('grille');
        // Centred in its own pitch, half of it wide: a slot of the same width each side.
        expect((e.lo[1] + e.hi[1]) / 2, `${at} ${rib.key}`).toBeCloseTo(ce.lo[1] + (i + 0.5) * pitch, 12);
        expect(e.hi[1] - e.lo[1], `${at} ${rib.key}`).toBeCloseTo(pitch / 2, 12);
      });
    }
  });
});

describe('the coffee table', () => {
  type Post = Extract<HardPart, { kind: 'post' }>;
  const band = dimRangeFor('table', 'coffee-table');
  const dims: number[][] = [];
  for (const wMM of [band.min[0], 1100, band.max[0]]) {
    for (const dMM of [band.min[1], 600, band.max[1]]) {
      for (const hMM of [band.min[2], 420, band.max[2]]) dims.push([wMM, dMM, hMM]);
    }
  }

  it('hangs an apron under an eased top, on four tapered legs in brass ferrules', () => {
    for (const dimMM of dims) {
      const at = dimMM.join('x');
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const parts = coffeeTableForm(dimMM);
      const e = (k: string) => ext(parts, k);
      const post = (k: string) => parts.find((p) => p.key === k) as Post;
      // The top is the whole footprint and reaches the height; the ease steps in under it.
      expect(e('top').hi[1]).toBeCloseTo(h, 12);
      expect([e('top').lo[0], e('top').hi[0], e('top').lo[2], e('top').hi[2]]).toEqual([-w / 2, w / 2, -d / 2, d / 2]);
      expect(e('top-ease').hi[1], at).toBeCloseTo(e('top').lo[1], 12);
      expect(e('top-ease').hi[0]).toBeLessThan(w / 2 - EPS);
      expect(e('top-ease').hi[2]).toBeLessThan(d / 2 - EPS);
      // Every rail hangs from the ease, to one depth.
      const rails = ['apron-back', 'apron-front', 'apron-l', 'apron-r'];
      for (const k of rails) {
        expect(e(k).hi[1], `${at} ${k}`).toBeCloseTo(e('top-ease').lo[1], 12);
        expect(e(k).lo[1], `${at} ${k}`).toBeCloseTo(e('apron-front').lo[1], 12);
      }
      // The front and back rails run leg centre to leg centre; the side rails stop against
      // their inner faces, so the ring closes and no corner is drawn twice.
      const lx = post('leg-3').pos[0];
      const lz = post('leg-3').pos[2];
      for (const k of ['apron-back', 'apron-front']) {
        expect(e(k).lo[0]).toBeCloseTo(-lx, 12);
        expect(e(k).hi[0]).toBeCloseTo(lx, 12);
      }
      expect(e('apron-front').hi[2] + e('apron-front').lo[2]).toBeCloseTo(2 * lz, 12);
      expect(e('apron-back').hi[2] + e('apron-back').lo[2]).toBeCloseTo(-2 * lz, 12);
      for (const k of ['apron-l', 'apron-r']) {
        expect(e(k).lo[2], `${at} ${k}`).toBeCloseTo(e('apron-back').hi[2], 12);
        expect(e(k).hi[2], `${at} ${k}`).toBeCloseTo(e('apron-front').lo[2], 12);
      }
      expect(e('apron-r').hi[0] + e('apron-r').lo[0]).toBeCloseTo(2 * lx, 12);
      expect(e('apron-l').hi[0] + e('apron-l').lo[0]).toBeCloseTo(-2 * lx, 12);
      // Four legs, one under each corner of the apron; each tapers to its foot and runs up
      // into the ease, so its cap is hidden and the rails meet it inside its own girth.
      for (let i = 0; i < 4; i++) {
        const leg = post(`leg-${i}`);
        const fer = post(`ferrule-${i}`);
        const [sx, sz] = [[-1, -1], [1, -1], [-1, 1], [1, 1]][i];
        expect([leg.pos[0], leg.pos[2]], `${at} leg ${i}`).toEqual([sx * lx, sz * lz]);
        expect([fer.pos[0], fer.pos[2]], `${at} ferrule ${i}`).toEqual([sx * lx, sz * lz]);
        expect(leg.rBottom, at).toBeLessThan(leg.r);
        const le = partExtent(leg);
        expect(le.hi[1], at).toBeGreaterThan(e('top-ease').lo[1] + EPS);
        expect(le.hi[1], at).toBeLessThan(e('top-ease').hi[1] - EPS);
        // The rails sit inside the leg where they meet it, at the apron's foot, where the
        // taper has made the leg thinnest.
        const rAt = leg.rBottom + (leg.r - leg.rBottom) * ((e('apron-front').lo[1] - le.lo[1]) / leg.h);
        expect(e('apron-r').hi[0] - e('apron-r').lo[0], at).toBeLessThan(2 * rAt);
        expect(e('apron-front').hi[2] - e('apron-front').lo[2], at).toBeLessThan(2 * rAt);
        // The ferrule is the foot: on the floor, the leg standing on it, a sleeve wider than
        // the leg's own foot.
        const fe = partExtent(fer);
        expect(fe.lo[1]).toBe(0);
        expect(le.lo[1], at).toBeCloseTo(fe.hi[1], 12);
        expect(fer.r, at).toBeGreaterThan(leg.rBottom);
        expect(fer.tone).toBe('brass');
        // Inside the top's footprint.
        expect(Math.abs(leg.pos[0]) + leg.r, at).toBeLessThan(w / 2);
        expect(Math.abs(leg.pos[2]) + leg.r, at).toBeLessThan(d / 2);
      }
      // The shelf runs leg centre to leg centre, low down, clear of the floor.
      expect([e('shelf').lo[0], e('shelf').hi[0], e('shelf').lo[2], e('shelf').hi[2]]).toEqual([-lx, lx, -lz, lz]);
      expect(e('shelf').lo[1]).toBeGreaterThan(post('ferrule-0').h);
      expect(e('shelf').hi[1]).toBeLessThan(h / 2);
      // The wood is the table's colour; the rails and legs a shade darker.
      expect(parts.filter((p) => p.tone === 'body').map((p) => p.key)).toEqual(['top', 'top-ease', 'shelf']);
    }
  });

  it('draws the Library’s table at the proportions it describes', () => {
    const parts = coffeeTableForm([1100, 600, 420]);
    const mm = (v: number) => Math.round(v * 1000);
    const e = (k: string) => ext(parts, k);
    expect(mm(e('top').hi[1] - e('top').lo[1])).toBe(25);
    expect(mm(e('apron-front').hi[1] - e('apron-front').lo[1])).toBe(59);
    expect(mm(2 * (parts.find((p) => p.key === 'leg-0') as Post).r)).toBe(48);
  });
});

describe('the dining table', () => {
  const band = dimRangeFor('table', 'desk-standard');
  const dims: number[][] = [[1500, 850, 750]];
  for (const wMM of [band.min[0], band.max[0]]) for (const dMM of [band.min[1], band.max[1]]) for (const hMM of [band.min[2], band.max[2]]) dims.push([wMM, dMM, hMM]);

  it('hangs a set-back apron from an eased top, on the legs the tuck rule reads', () => {
    for (const dimMM of dims) {
      const at = dimMM.join('x');
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const parts = diningTableForm(dimMM);
      const e = (k: string) => ext(parts, k);
      // The top and the ease under it are `DINING_TOP`, real thicknesses at every size.
      expect([e('top').lo[0], e('top').hi[0], e('top').lo[2], e('top').hi[2]]).toEqual([-w / 2, w / 2, -d / 2, d / 2]);
      expect(e('top').hi[1]).toBeCloseTo(h, 12);
      expect(e('top').hi[1] - e('top').lo[1]).toBeCloseTo(DINING_TOP.top, 12);
      expect(e('top-ease').hi[1], at).toBeCloseTo(e('top').lo[1], 12);
      expect(e('top-ease').hi[1] - e('top-ease').lo[1]).toBeCloseTo(DINING_TOP.ease, 12);
      expect(e('top-ease').hi[0]).toBeLessThan(w / 2 - EPS);
      expect(e('top-ease').hi[2]).toBeLessThan(d / 2 - EPS);
      // The legs ARE the tuck rule's rectangles, standing on their glides, and run up
      // into the ease so their caps are hidden.
      const posts = surfacePostsLocal('desk-standard', true, w, d);
      expect(posts.length).toBe(4);
      posts.forEach((r, i) => {
        const le = e(`leg-${i}`);
        expect([le.lo[0], le.hi[0], le.lo[2], le.hi[2]], `${at} leg ${i}`).toEqual([r.x0, r.x1, r.z0, r.z1]);
        expect(le.hi[1], at).toBeGreaterThan(e('top-ease').lo[1] + EPS);
        expect(le.hi[1], at).toBeLessThan(e('top-ease').hi[1] - EPS);
        expect(r.x0, at).toBeGreaterThan(e('top-ease').lo[0]);
        expect(r.x1, at).toBeLessThan(e('top-ease').hi[0]);
        const g = e(`glide-${i}`);
        expect(g.lo[1]).toBe(0);
        expect(le.lo[1], at).toBeCloseTo(g.hi[1], 12);
        // A glide is under its leg, a little inside its faces.
        expect(g.lo[0]).toBeGreaterThan(r.x0);
        expect(g.hi[0]).toBeLessThan(r.x1);
        expect(g.lo[2]).toBeGreaterThan(r.z0);
        expect(g.hi[2]).toBeLessThan(r.z1);
      });
      // Every rail hangs from the ease to the depth the tuck rule reads.
      const rails = ['apron-back', 'apron-front', 'apron-l', 'apron-r'];
      for (const k of rails) {
        expect(e(k).hi[1], `${at} ${k}`).toBeCloseTo(e('top-ease').lo[1], 12);
        expect(e(k).hi[1] - e(k).lo[1], `${at} ${k}`).toBeCloseTo(DINING_TOP.apron, 12);
        expect(h - e(k).lo[1]).toBeCloseTo(DINING_TOP.top + DINING_TOP.ease + DINING_TOP.apron, 12);
      }
      // Set back from the legs' outer faces, inside their girth, so no rail's face lies on
      // a leg's.
      const leg3 = e('leg-3');
      expect(e('apron-front').hi[2], at).toBeLessThan(leg3.hi[2] - EPS);
      expect(e('apron-front').lo[2], at).toBeGreaterThan(leg3.lo[2] + EPS);
      expect(e('apron-r').hi[0], at).toBeLessThan(leg3.hi[0] - EPS);
      expect(e('apron-r').lo[0], at).toBeGreaterThan(leg3.lo[0] + EPS);
      expect(e('apron-back').lo[2]).toBeCloseTo(-e('apron-front').hi[2], 12);
      expect(e('apron-l').lo[0]).toBeCloseTo(-e('apron-r').hi[0], 12);
      // The long rails run leg centre to leg centre; the end rails stop against them.
      const lx = (leg3.lo[0] + leg3.hi[0]) / 2;
      expect(e('apron-front').lo[0]).toBeCloseTo(-lx, 12);
      expect(e('apron-front').hi[0]).toBeCloseTo(lx, 12);
      for (const k of ['apron-l', 'apron-r']) {
        expect(e(k).lo[2], `${at} ${k}`).toBeCloseTo(e('apron-back').hi[2], 12);
        expect(e(k).hi[2], `${at} ${k}`).toBeCloseTo(e('apron-front').lo[2], 12);
      }
      // The wood is the table's colour; the frame a shade darker; the glides dark.
      expect(parts.filter((p) => p.tone === 'body').map((p) => p.key)).toEqual(['top', 'top-ease']);
      expect(parts.filter((p) => p.tone === 'dark').length).toBe(4);
    }
  });

  it('keeps its joinery at real sizes on the smallest and largest tables', () => {
    for (const dimMM of [[band.min[0], band.min[1], 750], [band.max[0], band.max[1], 750]]) {
      const parts = diningTableForm(dimMM);
      const mm = (v: number) => Math.round(v * 1000);
      const leg = ext(parts, 'leg-0');
      expect(mm(leg.hi[0] - leg.lo[0])).toBe(mm(DINING_LEG.size));
      expect(mm(leg.lo[0] + dimMM[0] / 2000)).toBe(mm(DINING_LEG.inset));
      const front = ext(parts, 'apron-front');
      expect(mm(front.hi[2] - front.lo[2])).toBe(20);
      expect(mm(leg.hi[2] - leg.lo[2])).toBe(55);
    }
  });
});

describe('the knee room the tuck rule reads is the joinery drawn', () => {
  it('a coffee table’s shelf and a dining table’s apron', () => {
    expect(COFFEE_SHELF).toEqual({ lo: 0.25, hi: 0.3 });
    expect(Math.round((DINING_TOP.top + DINING_TOP.ease + DINING_TOP.apron) * 1000)).toBe(115);
    const coffee = coffeeTableForm([1100, 600, 420]);
    expect(ext(coffee, 'shelf').lo[1]).toBeCloseTo(0.42 * COFFEE_SHELF.lo, 12);
    expect(ext(coffee, 'shelf').hi[1]).toBeCloseTo(0.42 * COFFEE_SHELF.hi, 12);
  });
});

describe('the desk', () => {
  const same = (a: number[], b: number[], msg: string) => a.forEach((v, i) => expect(v, msg).toBeCloseTo(b[i], 12));
  const cases: [boolean, number[][]][] = [false, true].map((lShape) => {
    const band = dimRangeFor('desk', lShape ? 'desk-l' : 'desk-standard');
    const dims: number[][] = [lShape ? [1600, 1400, 750] : [1400, 700, 750]];
    for (const wMM of [band.min[0], band.max[0]]) for (const dMM of [band.min[1], band.max[1]]) for (const hMM of [band.min[2], band.max[2]]) dims.push([wMM, dMM, hMM]);
    return [lShape, dims];
  });

  it('stands its top on the panel and legs the tuck rule reads, each leg on a glide', () => {
    for (const [lShape, dims] of cases) {
      for (const dimMM of dims) {
        const at = `${lShape ? 'L' : 'straight'} ${dimMM.join('x')}`;
        const [w, d, h] = dimMM.map((v) => v / 1000);
        const parts = deskForm(dimMM, lShape);
        const e = (k: string) => ext(parts, k);
        const armD = lShape ? d * ELL_ARM_DEPTH : d;
        const armW = w * ELL_RETURN_WIDTH;
        // A 25 mm top: the long arm against the back, and in L form the return filling
        // the rest of the depth at the right-hand end — the outline the plan draws.
        same([e('top').lo[0], e('top').hi[0], e('top').lo[2], e('top').hi[2]], [-w / 2, w / 2, -d / 2, -d / 2 + armD], at);
        expect(e('top').hi[1]).toBeCloseTo(h, 12);
        expect(e('top').hi[1] - e('top').lo[1]).toBeCloseTo(DESK_TOP.top, 12);
        expect(parts.some((p) => p.key === 'top-return')).toBe(lShape);
        if (lShape) {
          same([e('top-return').lo[0], e('top-return').hi[0], e('top-return').lo[2], e('top-return').hi[2]], [w / 2 - armW, w / 2, -d / 2 + armD, d / 2], at);
          expect(e('top-return').lo[1]).toBeCloseTo(e('top').lo[1], 12);
        }
        const yTop = e('top').lo[1];
        const [panel, ...legs] = surfacePostsLocal(lShape ? 'desk-l' : 'desk-standard', false, w, d);
        expect(legs.length).toBe(2);
        same([e('panel').lo[0], e('panel').hi[0], e('panel').lo[2], e('panel').hi[2]], [panel.x0, panel.x1, panel.z0, panel.z1], at);
        expect(e('panel').lo[1]).toBe(0);
        expect(e('panel').hi[1]).toBeCloseTo(yTop, 12);
        legs.forEach((r, i) => {
          const le = e(`leg-${i}`);
          same([le.lo[0], le.hi[0], le.lo[2], le.hi[2]], [r.x0, r.x1, r.z0, r.z1], `${at} leg ${i}`);
          expect(le.hi[1], at).toBeCloseTo(yTop, 12);
          const g = e(`glide-${i}`);
          expect(g.lo[1]).toBe(0);
          expect(le.lo[1]).toBeCloseTo(g.hi[1], 12);
          expect(g.lo[0]).toBeGreaterThan(r.x0);
          expect(g.hi[0]).toBeLessThan(r.x1);
          expect(g.lo[2]).toBeGreaterThan(r.z0);
          expect(g.hi[2]).toBeLessThan(r.z1);
        });
        // In L form the front leg stands under the return, not in the notch.
        if (lShape) expect(legs[1].x0, at).toBeGreaterThan(w / 2 - armW);
      }
    }
  });

  it('hangs a pencil drawer and a cable tray no lower than the knee room the rule reads', () => {
    for (const [lShape, dims] of cases) {
      for (const dimMM of dims) {
        const at = `${lShape ? 'L' : 'straight'} ${dimMM.join('x')}`;
        const [w, d, h] = dimMM.map((v) => v / 1000);
        const parts = deskForm(dimMM, lShape);
        const e = (k: string) => ext(parts, k);
        const armD = lShape ? d * ELL_ARM_DEPTH : d;
        const yTop = e('top').lo[1];
        const hung = ['drawer-box', 'drawer-front', 'drawer-pull', 'tray', 'tray-back', 'tray-lip'];
        const lowest = Math.min(...hung.map((k) => e(k).lo[1]));
        expect(lowest, at).toBeCloseTo(h - DESK_TOP.hang, 12);
        for (const k of hung) expect(e(k).hi[1], `${at} ${k}`).toBeLessThanOrEqual(yTop + EPS);
        // The drawer box and the tray's back are screwed to the top's underside.
        expect(e('drawer-box').hi[1]).toBeCloseTo(yTop, 12);
        expect(e('tray-back').hi[1]).toBeCloseTo(yTop, 12);
        // The drawer: under the long arm's open front edge, set back from it, between
        // the panel and whatever closes that edge on the right (the front leg, or the
        // return); its front on the box, the pull on its front.
        const [panel, , front] = surfacePostsLocal(lShape ? 'desk-l' : 'desk-standard', false, w, d);
        const xb = lShape ? w / 2 - w * ELL_RETURN_WIDTH : front.x0;
        expect(e('drawer-front').lo[0], at).toBeGreaterThan(panel.x1);
        expect(e('drawer-front').hi[0], at).toBeLessThan(xb);
        expect(e('drawer-front').hi[2], at).toBeLessThan(-d / 2 + armD - EPS);
        expect(e('drawer-front').hi[2], at).toBeGreaterThan(-d / 2 + armD - 0.03);
        expect(e('drawer-front').lo[2]).toBeCloseTo(e('drawer-box').hi[2], 12);
        expect(e('drawer-pull').lo[2]).toBeCloseTo(e('drawer-front').hi[2], 12);
        expect(e('drawer-box').lo[0]).toBeGreaterThan(e('drawer-front').lo[0]);
        expect(e('drawer-box').hi[0]).toBeLessThan(e('drawer-front').hi[0]);
        const py = (e('drawer-pull').lo[1] + e('drawer-pull').hi[1]) / 2;
        expect(py).toBeGreaterThan(e('drawer-front').lo[1]);
        expect(py).toBeLessThan(e('drawer-front').hi[1]);
        // A gap under the top, so the front reads as a drawer and not more desk.
        expect(e('drawer-front').hi[1]).toBeLessThan(yTop - EPS);
        // The tray: a channel across the back, clear of the drawer, the panel and the legs,
        // its back and lip standing on its floor.
        expect(e('tray').hi[2], at).toBeLessThan(e('drawer-box').lo[2]);
        expect(e('tray').lo[0], at).toBeGreaterThan(panel.x1);
        expect(e('tray').hi[0], at).toBeLessThan(surfacePostsLocal(lShape ? 'desk-l' : 'desk-standard', false, w, d)[1].x0);
        for (const k of ['tray-back', 'tray-lip']) expect(e(k).lo[1]).toBeCloseTo(e('tray').hi[1], 12);
        expect(e('tray-back').lo[2]).toBeCloseTo(e('tray').lo[2], 12);
        expect(e('tray-lip').hi[2]).toBeCloseTo(e('tray').hi[2], 12);
        expect(e('tray-lip').hi[1]).toBeLessThan(e('tray-back').hi[1]);
        expect(parts.filter((p) => p.tone === 'body').map((p) => p.key)).toEqual(lShape ? ['top', 'top-return', 'drawer-front'] : ['top', 'drawer-front']);
      }
    }
  });
});

describe('the window', () => {
  const band = dimRangeFor('other', 'window');
  const dims: number[][] = [[1200, 60, 1200]];
  for (const wMM of [band.min[0], 1400, 2100, band.max[0]]) for (const hMM of [band.min[2], band.max[2]]) dims.push([wMM, 60, hMM]);
  for (const dMM of [band.min[1], band.max[1]]) dims.push([1200, dMM, 1200]);

  it('fills the opening with frame, sashes and glass, and keeps its trim on the plaster outside it', () => {
    for (const dimMM of dims) {
      const at = dimMM.join('x');
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const { parts } = windowForm(dimMM);
      const e = (k: string) => ext(parts, k);
      const keys = parts.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
      const trim = ['casing-head', 'casing-l', 'casing-r', 'sill', 'apron'];
      for (const p of parts) {
        const { lo, hi } = partExtent(p);
        if (trim.includes(p.key)) {
          // Outside the opening, on the wall face, standing off it no further than the sill.
          expect(lo[2], `${at} ${p.key}`).toBeCloseTo(-d / 2, 12);
          expect(hi[1] <= -h / 2 + EPS || lo[1] >= h / 2 - EPS || hi[0] <= -w / 2 + EPS || lo[0] >= w / 2 - EPS, `${at} ${p.key} outside the opening`).toBe(true);
          continue;
        }
        // Everything else is in the opening, within the wall piece's depth — the handles
        // alone standing proud of the sashes' room face.
        expect(lo[0], `${at} ${p.key}`).toBeGreaterThanOrEqual(-w / 2 - EPS);
        expect(hi[0], `${at} ${p.key}`).toBeLessThanOrEqual(w / 2 + EPS);
        expect(lo[1], `${at} ${p.key}`).toBeGreaterThanOrEqual(-h / 2 - EPS);
        expect(hi[1], `${at} ${p.key}`).toBeLessThanOrEqual(h / 2 + EPS);
        expect(lo[2], `${at} ${p.key}`).toBeGreaterThanOrEqual(-d / 2 - EPS);
        if (!p.key.startsWith('handle-')) expect(hi[2], `${at} ${p.key}`).toBeLessThanOrEqual(d / 2 + EPS);
      }
      // The frame's outer faces are the opening's.
      expect([e('frame-head').hi[1], e('frame-foot').lo[1], e('frame-l').lo[0], e('frame-r').hi[0]].map((v) => +v.toFixed(12))).toEqual([h / 2, -h / 2, -w / 2, w / 2].map((v) => +v.toFixed(12)));
      // The casing frames it: up both sides from the sill and across the head, the head
      // running over the side casings' tops.
      const { casing, sillOver, sillReach } = WINDOW;
      expect(e('casing-head').lo[0]).toBeCloseTo(-w / 2 - casing, 12);
      expect(e('casing-head').hi[0]).toBeCloseTo(w / 2 + casing, 12);
      expect(e('casing-head').lo[1]).toBeCloseTo(e('casing-l').hi[1], 12);
      expect(e('casing-l').lo[1]).toBeCloseTo(e('sill').hi[1], 12);
      expect(e('casing-r').lo[1]).toBeCloseTo(e('sill').hi[1], 12);
      expect(e('casing-l').hi[0]).toBeCloseTo(-w / 2, 12);
      expect(e('casing-r').lo[0]).toBeCloseTo(w / 2, 12);
      // The sill is the opening's floor, past the casing each side and reaching into the
      // room; the apron hangs under it, as wide as the casing.
      expect(e('sill').hi[1]).toBeCloseTo(-h / 2, 12);
      expect(e('sill').hi[0]).toBeCloseTo(w / 2 + sillOver, 12);
      expect(sillOver).toBeGreaterThan(casing);
      expect(e('sill').hi[2] - e('sill').lo[2]).toBeCloseTo(Math.max(sillReach, d + 0.06), 12);
      expect(e('sill').hi[2], `${at} the sill stands past the frame`).toBeGreaterThan(e('frame-head').hi[2] + 0.05);
      expect(e('apron').hi[1]).toBeCloseTo(e('sill').lo[1], 12);
      expect(e('apron').hi[0]).toBeCloseTo(w / 2 + casing, 12);
      // The outline DRAWN_RATIO pins: 50 mm of casing over the head, the sill and apron
      // 80 mm under the opening, the sill 60 mm past each side.
      const all = parts.map(partExtent);
      expect(Math.max(...all.map((x) => x.hi[1]))).toBeCloseTo(h / 2 + 0.05, 12);
      expect(Math.min(...all.map((x) => x.lo[1]))).toBeCloseTo(-h / 2 - 0.08, 12);
      expect(Math.max(...all.map((x) => x.hi[0]))).toBeCloseTo(w / 2 + 0.06, 12);
      expect(Math.max(...all.map((x) => x.hi[2]))).toBeCloseTo(e('sill').hi[2], 12);
      if (dimMM[1] === 60) expect(e('sill').hi[2]).toBeCloseTo(-d / 2 + 0.12, 12);
    }
  });

  it('divides the frame into its casements: a sash, a pane and a handle each, mullions between', () => {
    for (const dimMM of dims) {
      const at = dimMM.join('x');
      const [w, d] = dimMM.map((v) => v / 1000);
      const { parts, glass } = windowForm(dimMM);
      const e = (k: string) => ext(parts, k);
      const n = windowPanes(dimMM[0]);
      expect(glass.length, at).toBe(n);
      expect(parts.filter((p) => p.key.startsWith('mullion-')).length).toBe(n - 1);
      expect(parts.filter((p) => p.key.startsWith('handle-')).length).toBe(n);
      const { frame, mullion, sash } = WINDOW;
      // The sashes tile the frame's opening exactly: frame, sash, mullion, sash, …, frame.
      let x = -w / 2 + frame;
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          expect(e(`mullion-${i}`).lo[0], `${at} mullion ${i}`).toBeCloseTo(x, 12);
          x += mullion;
          expect(e(`mullion-${i}`).hi[0]).toBeCloseTo(x, 12);
          expect(e(`mullion-${i}`).hi[1]).toBeCloseTo(e('frame-head').lo[1], 12);
          expect(e(`mullion-${i}`).lo[1]).toBeCloseTo(e('frame-foot').hi[1], 12);
        }
        const l = e(`sash-${i}-l`);
        const r = e(`sash-${i}-r`);
        expect(l.lo[0], `${at} sash ${i}`).toBeCloseTo(x, 12);
        expect(e(`sash-${i}-head`).hi[1]).toBeCloseTo(e('frame-head').lo[1], 12);
        expect(e(`sash-${i}-foot`).lo[1]).toBeCloseTo(e('frame-foot').hi[1], 12);
        x = r.hi[0];
        // The pane fills the sash's opening, and stands inside the sash's depth.
        const g = glass[i];
        expect(g.x0).toBeCloseTo(l.hi[0], 12);
        expect(g.x1).toBeCloseTo(r.lo[0], 12);
        expect(g.y1).toBeCloseTo(e(`sash-${i}-head`).lo[1], 12);
        expect(g.y0).toBeCloseTo(e(`sash-${i}-foot`).hi[1], 12);
        expect(g.z).toBeGreaterThan(l.lo[2]);
        expect(g.z).toBeLessThan(l.hi[2]);
        expect(r.hi[0] - r.lo[0]).toBeCloseTo(sash, 12);
        // The handle stands on the sash's room face, on one of its stiles, at mid-height.
        const hd = e(`handle-${i}`);
        expect(hd.lo[2]).toBeCloseTo(l.hi[2], 12);
        const hx = (hd.lo[0] + hd.hi[0]) / 2;
        const onStile = n === 1 || i % 2 === 0 ? r : l;
        expect(hx, `${at} handle ${i}`).toBeCloseTo((onStile.lo[0] + onStile.hi[0]) / 2, 12);
        expect((hd.lo[1] + hd.hi[1]) / 2).toBeCloseTo(0, 12);
        expect(parts.find((p) => p.key === `handle-${i}`)!.tone).toBe('brass');
      }
      expect(x, `${at} the last sash meets the frame`).toBeCloseTo(w / 2 - frame, 12);
      // A pair of casements opens from the meeting stiles.
      if (n === 2) {
        const h0 = e('handle-0');
        const h1 = e('handle-1');
        expect(h0.hi[0]).toBeLessThan(0);
        expect(h1.lo[0]).toBeGreaterThan(0);
        expect(h1.lo[0] - h0.hi[0]).toBeLessThan(mullion + 2 * sash);
      }
      // Each sash is set in from both faces of the frame, so none of its faces lies on one.
      expect(e('sash-0-l').lo[2]).toBeGreaterThan(-d / 2 + EPS);
      expect(e('sash-0-l').hi[2]).toBeLessThan(d / 2 - EPS);
    }
  });

  it('really draws more panes as it widens, which is why it is parametric', () => {
    expect([600, 1200, 1400, 2100, 3000].map(windowPanes)).toEqual([1, 2, 2, 3, 4]);
    expect(isParametric('window')).toBe(true);
  });
});

describe('the laptop', () => {
  const band = dimRangeFor('monitor', 'laptop');
  const all: number[][] = [[340, 240, 220]];
  for (const w of [band.min[0], band.max[0]]) for (const d of [band.min[1], band.max[1]]) for (const h of [band.min[2], band.max[2]]) all.push([w, d, h]);

  it('opens to exactly its height, leaning back from the hinge', () => {
    for (const dimMM of all) {
      const h = dimMM[2] / 1000;
      const ys = lidWorld(dimMM).flatMap((p) => p.pts.map((v) => v.y));
      expect(Math.max(...ys), `${dimMM}`).toBeCloseTo(h, 12);
      // The lid's top edge is behind the hinge: it leans back, not forward over the keys.
      const top = lidWorld(dimMM).find((p) => p.key === 'lid')!.pts.reduce((a, b) => (b.y > a.y ? b : a));
      expect(top.z).toBeLessThan(laptopForm(dimMM).hinge.z);
      expect(LAPTOP.tilt).toBeGreaterThan(0.2);
      expect(LAPTOP.tilt).toBeLessThan(0.45);
    }
  });

  it('hinges on the back edge of the base, the lid foot inside the footprint', () => {
    for (const dimMM of all) {
      const [w, d] = dimMM.map((v) => v / 1000);
      const { base, hinge } = laptopForm(dimMM);
      const e = (k: string) => ext(base, k);
      expect(e('hinge').lo[2]).toBeGreaterThanOrEqual(-d / 2 - EPS);
      expect(e('hinge').hi[2]).toBeLessThan(-d / 2 + d * 0.15);
      expect(hinge.y).toBeLessThan(e('base').hi[1]);
      expect(hinge.y).toBeGreaterThan(e('base').lo[1]);
      // The lid's lowest corners stay over the deck and above the desk.
      const foot = lidWorld(dimMM).flatMap((p) => p.pts).filter((v) => v.y < e('base').hi[1] + 0.02);
      expect(foot.length).toBeGreaterThan(0);
      for (const v of foot) {
        expect(v.z, `${dimMM}`).toBeGreaterThanOrEqual(-d / 2 - EPS);
        expect(v.y).toBeGreaterThan(0);
        expect(Math.abs(v.x)).toBeLessThanOrEqual(w / 2 + EPS);
      }
    }
  });

  it('faces its screen and bezel forward, out of the shell', () => {
    const { lid } = laptopForm([340, 240, 220]);
    const e = (k: string) => ext(lid, k);
    expect(e('bezel').lo[2]).toBeCloseTo(e('lid').hi[2], 12);
    expect(e('screen').lo[2]).toBeCloseTo(e('bezel').hi[2], 12);
    expect(e('camera').lo[2]).toBeCloseTo(e('bezel').hi[2], 12);
    // The screen sits inside the bezel with a border all round, the camera above it.
    expect(e('screen').lo[0]).toBeGreaterThan(e('bezel').lo[0]);
    expect(e('screen').hi[1]).toBeLessThan(e('camera').lo[1]);
    expect(e('camera').hi[1]).toBeLessThan(e('bezel').hi[1]);
    expect(e('bezel').hi[1]).toBeLessThan(e('lid').hi[1]);
  });

  it('lays its keys on the deck behind a trackpad, every one inside the base', () => {
    for (const dimMM of all) {
      const { base } = laptopForm(dimMM);
      const deck = ext(base, 'base');
      const keys = base.filter((p) => p.key.startsWith('key-'));
      expect(keys.length).toBe(LAPTOP.keyCols * LAPTOP.keyRows + 5);
      for (const k of keys) {
        const x = partExtent(k);
        expect(x.lo[1]).toBeCloseTo(deck.hi[1], 12);
        expect(x.lo[0]).toBeGreaterThanOrEqual(deck.lo[0]);
        expect(x.hi[0]).toBeLessThanOrEqual(deck.hi[0]);
        expect(x.lo[2]).toBeGreaterThanOrEqual(deck.lo[2]);
        expect(x.hi[2]).toBeLessThan(ext(base, 'trackpad').lo[2]);
      }
      // No two keys touch: every row and column keeps a gap.
      const boxes = keys.map(partExtent);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const apart = a.hi[0] <= b.lo[0] || b.hi[0] <= a.lo[0] || a.hi[2] <= b.lo[2] || b.hi[2] <= a.lo[2];
        expect(apart, `${keys[i].key} / ${keys[j].key}`).toBe(true);
      }
      // The space bar is the wide one, centred.
      const sp = ext(base, 'key-space');
      expect(sp.lo[0] + sp.hi[0]).toBeCloseTo(0, 12);
      expect(sp.hi[0] - sp.lo[0]).toBeGreaterThan(4 * (partExtent(keys[0]).hi[0] - partExtent(keys[0]).lo[0]));
      expect(ext(base, 'trackpad').lo[1]).toBeCloseTo(deck.hi[1], 12);
      // The feet carry the base off the desk.
      for (let i = 0; i < 4; i++) {
        expect(ext(base, `foot-${i}`).lo[1]).toBe(0);
        expect(ext(base, `foot-${i}`).hi[1]).toBeCloseTo(deck.lo[1], 12);
      }
    }
  });
});
