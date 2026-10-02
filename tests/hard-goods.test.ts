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
  chestFreezerForm,
  CONSOLE_BAY,
  CONSOLE_DOOR,
  consoleBays,
  doorForm,
  LEVER_PROUD,
  microwaveForm,
  NIGHTSTAND,
  nightstandForm,
  nightstandSlide,
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
  waterDispenserForm,
  type HardPart,
} from '../lib/hard-goods';
import { floorLampForm, tableLampForm, type LampForm } from '../lib/lamp-form';
import { armchairForm, diningChairForm, officeChairForm, ottomanForm } from '../lib/chair-form';
import type { SoftItem } from '../lib/soft-goods';
import { consoleSlabs, doorHandleY, drawerSlide, isParametric, PART_LIBRARY, radiatorFins, stoolSeat, type Category, type Shape } from '../lib/scene-spec';
import { dimRangeFor } from '../lib/dimension-ranges';

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
    expect(ROWS.length).toBe(19);
  });

  for (const r of ROWS) {
    it(`${r.shape}: every part, at every corner of its size band`, () => {
      const all = sizes(r);
      expect(all.length).toBe(9);
      for (const dimMM of all) {
        const [w, dDeclared, h] = dimMM.map((v) => v / 1000);
        // A round form is a circle of the width, stretched to the depth after.
        const d = r.round ? w : dDeclared;
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
          expect(lo[2], `${at} back`).toBeGreaterThanOrEqual(-d / 2 - EPS);
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
      const a = r.form(base);
      for (let k = 0; k < 3; k++) {
        for (const s of FACTORS) {
          const dim = base.slice();
          dim[k] *= s;
          const b = r.form(dim);
          expect(b.map((p) => p.key), `${r.shape} same parts`).toEqual(a.map((p) => p.key));
          b.forEach((pb, i) => {
            const pa = a[i];
            for (let j = 0; j < 3; j++) {
              // `dimMM` is [w, d, h]; a part's frame is [x, y, z] with y up and z the
              // depth, so the depth scales z and the height scales y. A ROUND form is
              // drawn on a square of the width and stretched to the depth by its renderer,
              // so there the width scales x and z both and the depth scales nothing.
              const f = r.round
                ? (k === 0 && j !== 1) || (k === 2 && j === 1) ? s : 1
                : j === SPACE_AXIS[k] ? s : 1;
              expect(anchor(pb)[j], `${r.shape} ${pa.key} pos[${j}] when axis ${k} x${s}`).toBeCloseTo(anchor(pa)[j] * f, 12);
              if (pa.kind === 'box' && pb.kind === 'box') {
                expect(pb.size[j], `${r.shape} ${pa.key} size[${j}] when axis ${k} x${s}`).toBeCloseTo(pa.size[j] * f, 12);
              }
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
    expect(ROWS.filter((r) => r.parametric).map((r) => r.shape)).toEqual(['tv-console', 'door', 'nightstand', 'stool', 'radiator']);
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
