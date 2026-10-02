// The casework, appliances and joinery of `lib/hard-goods.ts`, held to the two rules its
// header states: nothing leaves its box except where the real object does, and a form
// drawn under a group scale is proportions only.
//
// Both are swept over every corner of each shape's size band plus its Library size,
// because the defects these catch live at the corners — a handle placed off the width
// that a narrow piece pushes through its own front, a detail that holds at 600 mm and
// stands outside the box at 450.

import { describe, it, expect } from 'vitest';
import {
  acUnitForm,
  chestFreezerForm,
  CONSOLE_BAY,
  CONSOLE_DOOR,
  consoleBays,
  doorForm,
  LEVER_PROUD,
  microwaveForm,
  partExtent,
  soundbarForm,
  tvConsoleForm,
  washingMachineForm,
  waterDispenserForm,
  type HardPart,
} from '../lib/hard-goods';
import { consoleSlabs, doorHandleY, PART_LIBRARY, type Category, type Shape } from '../lib/scene-spec';
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
}

const ROWS: Row[] = [
  { shape: 'chest-freezer', category: 'fridge', form: chestFreezerForm, wall: false, parametric: false },
  { shape: 'ac-unit', category: 'ac', form: acUnitForm, wall: true, parametric: false },
  { shape: 'soundbar', category: 'tv', form: soundbarForm, wall: false, parametric: false },
  { shape: 'water-dispenser', category: 'fridge', form: waterDispenserForm, wall: false, parametric: false },
  { shape: 'washing-machine', category: 'fridge', form: washingMachineForm, wall: false, parametric: false },
  { shape: 'microwave', category: 'fridge', form: microwaveForm, wall: false, parametric: false },
  { shape: 'tv-console', category: 'shelf', form: tvConsoleForm, wall: false, parametric: true },
  { shape: 'door', category: 'door', form: doorForm, wall: true, parametric: true },
];

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
  });
});

describe('every hard good stays inside the box it declares', () => {
  it('the Library carries every shape this file draws', () => {
    for (const r of ROWS) expect(PART_LIBRARY.some((p) => p.shape === r.shape), r.shape).toBe(true);
    expect(ROWS.length).toBe(8);
  });

  for (const r of ROWS) {
    it(`${r.shape}: every part, at every corner of its size band`, () => {
      const all = sizes(r);
      expect(all.length).toBe(9);
      for (const dimMM of all) {
        const [w, d, h] = dimMM.map((v) => v / 1000);
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
              // depth, so the depth scales z and the height scales y.
              const f = j === SPACE_AXIS[k] ? s : 1;
              expect(pb.pos[j], `${r.shape} ${pa.key} pos[${j}] when axis ${k} x${s}`).toBeCloseTo(pa.pos[j] * f, 12);
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
      const nums = (p: HardPart): number[] => {
        switch (p.kind) {
          case 'box': return [...p.pos, ...p.size];
          case 'post': return [...p.pos, p.r, p.rBottom, p.h];
          case 'disc': return [...p.pos, p.r, p.t];
          case 'ring': return [...p.pos, p.r, p.tube];
        }
      };
      b.forEach((pb, i) => {
        const na = nums(a[i]);
        nums(pb).forEach((v, j) => expect(v, `${r.shape} ${pb.key} [${j}]`).toBeCloseTo(na[j] * s, 12));
      });
    });
  }

  it('the two parametric forms are exactly the two the renderer draws at the stored size', () => {
    expect(ROWS.filter((r) => r.parametric).map((r) => r.shape)).toEqual(['tv-console', 'door']);
    // And neither would pass the property above, which is the point of their being
    // parametric: a door's stiles and a console's 18 mm doors are joinery, not shares.
    for (const r of ROWS.filter((q) => q.parametric)) {
      const base = PART_LIBRARY.find((p) => p.shape === r.shape)!.dimMM.slice();
      const a = r.form(base);
      const b = r.form([base[0] * 1.6, base[1], base[2]]);
      const same = a.length === b.length && a.every((p, i) => p.kind !== 'box' || b[i].kind !== 'box' || Math.abs((b[i] as typeof p).size[0] - p.size[0] * 1.6) < 1e-9);
      expect(same, r.shape).toBe(false);
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
