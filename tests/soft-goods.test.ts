// The cloth in a room — cushions, a duvet, garments, shoes, a curtain — held to the boxes
// they are drawn in.
//
// `lib/soft-goods.ts` replaced boxes with meshes, and a box was its own proof of size: a
// mesh is not. So the two promises that file makes are swept here rather than trusted. A
// unit mesh never leaves [-0.5, 0.5], so an instance scaled to its box stays in that box;
// and a piece's own cloth stays inside the `dimMM` the plan draws, resting on what it rests
// on — measured off the mesh's vertices, not off the boxes they were placed by, which is
// how the first version left every leaning cushion hovering.

import { describe, it, expect } from 'vitest';
import { Euler, Line3, Matrix4, Plane, Quaternion, Vector3 } from 'three';
import {
  bedForm,
  curtainCloth,
  CUSHION_MESH,
  CUSHION_SINK,
  garmentKind,
  GARMENT_KINDS,
  GARMENT_MESH,
  HEADBOARD_T,
  leaningCushion,
  meshExtent,
  PILLOW_LOFT,
  SCATTER_TOP,
  SHOE_KINDS,
  SHOE_LINING_MESH,
  SHOE_SOLE_MESH,
  SHOE_UPPER_MESH,
  sofaForm,
  softHash,
  SCATTER_SETTLE,
  standingHeight,
  THROW_LEAN,
  type SoftItem,
  type SoftMeshData,
} from '../lib/soft-goods';
import { clothesRail, moduleCount, MODULE_RANGE, PART_LIBRARY, shoeRow, type Category, type Shape } from '../lib/scene-spec';
import { dimRangeFor } from '../lib/dimension-ranges';
import { bedPillows } from '../lib/layout-rules';

const EPS = 1e-9;
const IDS = ['a', 'sofa-1', 'p_7f3c', 'zz-99'];

type V3 = [number, number, number];

/** A unit mesh's vertices placed as `useInstanceTransforms` places them. */
function worldPoints(mesh: SoftMeshData, p: SoftItem): Vector3[] {
  const m = new Matrix4().compose(new Vector3(...p.pos), new Quaternion().setFromEuler(new Euler(...(p.rot ?? [0, 0, 0]))), new Vector3(...p.size));
  const out: Vector3[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) out.push(new Vector3(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]).applyMatrix4(m));
  return out;
}

/** The drawn surface sliced at every millimetre of height: each triangle edge cut by the
 *  level plane and kept where the cut lands inside `|x − cx| < half`, the furthest depth one
 *  way (`pick`) per height. Two cloths meet on their faces, between vertices: read off the
 *  vertices alone, a cushion settled 12 mm into a pillow showed as barely touching it, and
 *  read off 4 mm bands of height, a steeply leaning one showed 4 mm deeper than it was. */
function slices(mesh: SoftMeshData, p: SoftItem, cx: number, half: number, pick: (a: number, b: number) => number): Map<number, number> {
  const v = worldPoints(mesh, p);
  const ix = mesh.index;
  const out = new Map<number, number>();
  const level = new Plane(new Vector3(0, 1, 0), 0);
  const hit = new Vector3();
  for (let t = 0; t < ix.length; t += 3)
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const line = new Line3(v[ix[t + i]], v[ix[t + j]]);
      const lo = Math.min(line.start.y, line.end.y);
      const hi = Math.max(line.start.y, line.end.y);
      for (let mm = Math.ceil(lo * 1000); mm <= hi * 1000; mm++) {
        level.constant = -mm / 1000;
        if (!level.intersectLine(line, hit) || Math.abs(hit.x - cx) >= half) continue;
        const was = out.get(mm);
        out.set(mm, was === undefined ? hit.z : pick(was, hit.z));
      }
    }
  return out;
}

/** How a leaning scatter cushion rests on the pillow behind it, off the sliced surfaces:
 *  how far it must move forward to sit no deeper than `CUSHION_SINK` in (`need`), and how
 *  far its centre is in front of where its back meets the pillow (`clear`). */
function held(s: SoftItem, pillow: SoftItem): { need: number; clear: number } {
  const back = slices(CUSHION_MESH.scatter, s, s.pos[0], s.size[0] * 0.3, Math.min);
  const front = slices(CUSHION_MESH.pillow, pillow, s.pos[0], s.size[0] * 0.3, Math.max);
  let need = -Infinity;
  let meets = 0;
  for (const [k, z] of back) {
    const f = front.get(k);
    if (f !== undefined && f - CUSHION_SINK - z > need) [need, meets] = [f - CUSHION_SINK - z, z];
  }
  return { need, clear: s.pos[2] - meets };
}

function bounds(mesh: SoftMeshData): { lo: V3; hi: V3 } {
  return meshExtent(mesh, [1, 1, 1]);
}

/** The band's corners and the Library size (the band's middle for a shape the Library does
 *  not list — `bed-single` reaches a room through a preset, not the Library): every
 *  combination of min and max per axis. */
function sizes(shape: Shape, category: Category): number[][] {
  const row = PART_LIBRARY.find((p) => p.shape === shape);
  const r = dimRangeFor(category, shape);
  const mid = [0, 1, 2].map((k) => Math.round((r.min[k] + r.max[k]) / 2));
  const out: number[][] = [row ? row.dimMM.slice() : mid];
  for (const w of [r.min[0], r.max[0]]) for (const d of [r.min[1], r.max[1]]) for (const h of [r.min[2], r.max[2]]) out.push([w, d, h]);
  return out;
}

/** Where an item's mesh reaches, in its parent's frame. */
function reach(mesh: SoftMeshData, it: SoftItem): { lo: V3; hi: V3 } {
  const { lo, hi } = meshExtent(mesh, it.size, it.rot);
  return { lo: [lo[0] + it.pos[0], lo[1] + it.pos[1], lo[2] + it.pos[2]], hi: [hi[0] + it.pos[0], hi[1] + it.pos[1], hi[2] + it.pos[2]] };
}

/** Signed volume by the divergence theorem: positive when the winding faces outward. */
function signedVolume(mesh: SoftMeshData): number {
  const p = mesh.positions;
  const ix = mesh.index;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3];
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

describe('unit meshes stay inside the box an instance is scaled to', () => {
  const UNITS: Array<[string, SoftMeshData]> = [
    ...Object.entries(CUSHION_MESH).map(([k, m]) => [`cushion ${k}`, m] as [string, SoftMeshData]),
    ...GARMENT_KINDS.map((k) => [`garment ${k}`, GARMENT_MESH[k]] as [string, SoftMeshData]),
    ...SHOE_KINDS.map((k) => [`shoe upper ${k}`, SHOE_UPPER_MESH[k]] as [string, SoftMeshData]),
    ...SHOE_KINDS.map((k) => [`shoe lining ${k}`, SHOE_LINING_MESH[k]] as [string, SoftMeshData]),
    ['shoe sole', SHOE_SOLE_MESH],
  ];
  for (const [name, mesh] of UNITS) {
    it(`${name}: within [-0.5, 0.5] on every axis, every index a vertex`, () => {
      const { lo, hi } = bounds(mesh);
      for (let k = 0; k < 3; k++) {
        expect(lo[k]).toBeGreaterThanOrEqual(-0.5 - EPS);
        expect(hi[k]).toBeLessThanOrEqual(0.5 + EPS);
      }
      const n = mesh.positions.length / 3;
      expect(mesh.index.length % 3).toBe(0);
      expect(mesh.index.every((i) => Number.isInteger(i) && i >= 0 && i < n)).toBe(true);
      expect(mesh.positions.every(Number.isFinite)).toBe(true);
    });
  }

  it('a cushion FILLS its box, so the box the plan and the collider read is the cushion', () => {
    for (const mesh of Object.values(CUSHION_MESH)) {
      const { lo, hi } = bounds(mesh);
      for (let k = 0; k < 3; k++) {
        expect(lo[k]).toBeCloseTo(-0.5, 9);
        expect(hi[k]).toBeCloseTo(0.5, 9);
      }
    }
  });

  it('a shoe stands on the floor of its box and a garment hangs from the top of its own', () => {
    for (const k of SHOE_KINDS) {
      expect(bounds(SHOE_UPPER_MESH[k]).lo[1]).toBeCloseTo(-0.5, 9);
      expect(bounds(SHOE_UPPER_MESH[k]).hi[1]).toBeCloseTo(0.5, 9);
    }
    for (const k of GARMENT_KINDS) {
      expect(bounds(GARMENT_MESH[k]).hi[1]).toBeCloseTo(0.5, 9);
      expect(bounds(GARMENT_MESH[k]).lo[1]).toBeCloseTo(-0.5, 9);
    }
  });

  it("a shoe's lining lies just above the floor of its collar, never on it", () => {
    // The lining is the dark insole seen through the opening. Level with the collar's
    // floor it would fight the cloth for the same pixels; under it, it would not show.
    for (const k of SHOE_KINDS) {
      const lining = SHOE_LINING_MESH[k].positions;
      const y = lining[1];
      const zs: number[] = [];
      for (let i = 0; i < lining.length; i += 3) {
        expect(lining[i + 1]).toBe(y);
        zs.push(lining[i + 2]);
      }
      const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
      // The upper along its centre line, over the opening: the lowest of it is the collar floor.
      const up = SHOE_UPPER_MESH[k].positions;
      let floor = Infinity;
      for (let i = 0; i < up.length; i += 3) {
        if (Math.abs(up[i]) < 1e-6 && up[i + 2] >= z0 && up[i + 2] <= z1) floor = Math.min(floor, up[i + 1]);
      }
      expect(floor).toBeLessThan(Infinity);
      expect(y).toBeGreaterThan(floor + 1e-3);
      expect(y).toBeLessThan(floor + 0.03);
    }
  });

  it('the closed meshes are wound outward, so a single-sided material shows their outside', () => {
    // A cushion and a sole are drawn single-sided; wound inward they would render as their
    // own inside, which reads as a hole. The garments, uppers and linings are open and are
    // drawn double-sided, so their winding does not matter and is not asserted.
    for (const mesh of [...Object.values(CUSHION_MESH), SHOE_SOLE_MESH]) expect(signedVolume(mesh)).toBeGreaterThan(0.1);
  });

  it('meshExtent turns points the way three does', () => {
    // The placement maths reads `meshExtent`; the GPU reads three's matrix. If the two
    // disagree about Euler order, a cushion is placed by one turn and drawn at another.
    const size: V3 = [0.4, 0.12, 0.35];
    const rot: V3 = [0.7, -0.4, 0.25];
    const mat = new Matrix4().makeRotationFromEuler(new Euler(rot[0], rot[1], rot[2], 'XYZ')).scale(new Vector3(...size));
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    const p = CUSHION_MESH.scatter.positions;
    const v = new Vector3();
    for (let i = 0; i < p.length; i += 3) {
      v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(mat);
      [v.x, v.y, v.z].forEach((c, k) => {
        lo[k] = Math.min(lo[k], c);
        hi[k] = Math.max(hi[k], c);
      });
    }
    const got = meshExtent(CUSHION_MESH.scatter, size, rot);
    for (let k = 0; k < 3; k++) {
      expect(got.lo[k]).toBeCloseTo(lo[k], 12);
      expect(got.hi[k]).toBeCloseTo(hi[k], 12);
    }
  });
});

describe('sofaForm — the scatter cushions sit on the seat and lean on the back', () => {
  let withTwo = 0;
  let withNone = 0;
  let atBackTop = 0;
  for (const dim of sizes('sofa', 'sofa')) {
    for (const id of IDS) {
      it(`${dim.join('×')} · ${id}`, () => {
        const f = sofaForm({ id, dimMM: dim });
        const cushionTop = f.seatY + f.seatH / 2;
        const backFront = f.backZ + f.backT / 2;
        expect([0, 2]).toContain(f.throws.length);
        if (f.throws.length === 2) withTwo++;
        else withNone++;
        for (const t of f.throws) {
          const { lo, hi } = reach(CUSHION_MESH.scatter, t);
          // On the seat cushions and against the back ones, settled in by the sink.
          expect(lo[1]).toBeCloseTo(cushionTop - CUSHION_SINK, 9);
          expect(lo[2]).toBeCloseTo(backFront - CUSHION_SINK, 9);
          // Between the arms, below the top of the back, inside the sofa's depth.
          expect(lo[0]).toBeGreaterThanOrEqual(-f.innerW / 2 - EPS);
          expect(hi[0]).toBeLessThanOrEqual(f.innerW / 2 + EPS);
          expect(hi[1]).toBeLessThanOrEqual(f.h + EPS);
          if (Math.abs(hi[1] - f.h) < EPS) atBackTop++;
          expect(hi[2]).toBeLessThanOrEqual(f.d / 2 + EPS);
          expect(t.tone).toBe(Math.floor(softHash(id, `throw${Math.sign(t.pos[0])}`) * 64));
        }
        // Two cushions never touch each other.
        if (f.throws.length === 2) {
          const [a, b] = f.throws.map((t) => reach(CUSHION_MESH.scatter, t));
          expect(a.hi[0]).toBeLessThan(b.lo[0]);
        }
      });
    }
  }
  it('the sweep reached every branch', () => {
    // The corners of the band give a sofa with a cushion in each end seat and one too low
    // in the back for any; a sweep that stopped reaching either would pass vacuously.
    // Literals, not floors: the Library size and the four tall corners carry two, the four
    // low corners none, for each of the four ids.
    expect(withTwo).toBe(5 * 4);
    expect(withNone).toBe(4 * 4);
    // Where the back's height is what sizes them, the cushions reach its top EXACTLY: the
    // cap is measured off the cloth, so a cap that overstated it (the turned box's height)
    // or understated it would leave them short of, or through, the line.
    expect(atBackTop).toBeGreaterThan(0);
  });
});

describe('bedForm — linen inside the bed, resting where it rests', () => {
  let scattered = 0;
  let atScatterTop = 0;
  let uprighted = 0;
  for (const shape of ['bed-single', 'bed-double'] as const) {
    for (const dim of sizes(shape, 'bed')) {
      it(`${shape} ${dim.join('×')}`, () => {
        const b = bedForm({ id: 'bed', dimMM: dim }, bedPillows(dim[0]));
        const { w, d, h, top, frameTop } = b;
        const headFace = -d / 2 + HEADBOARD_T / 2;
        for (const p of b.pillows) {
          const { lo, hi } = reach(CUSHION_MESH.pillow, p);
          expect(lo[1]).toBeCloseTo(top - CUSHION_SINK / 2, 9);
          expect(lo[2]).toBeCloseTo(headFace - CUSHION_SINK, 9);
          expect(lo[0]).toBeGreaterThanOrEqual(-w / 2);
          expect(hi[0]).toBeLessThanOrEqual(w / 2);
          // The headboard is drawn to 1.4 h; a pillow over it is a bed without one.
          expect(hi[1]).toBeLessThan(1.4 * h);
        }
        // ...and lies on it along its whole depth, not on one seam. A pillow tipped 10° to
        // look propped touched the mattress at its front and stood 90 mm clear of it at the
        // headboard — the bed's linen floating. Every band across the middle of its depth
        // reaches down to the mattress.
        for (const p of b.pillows) {
          const m = new Matrix4().compose(new Vector3(...p.pos), new Quaternion().setFromEuler(new Euler(...(p.rot ?? [0, 0, 0]))), new Vector3(...p.size));
          const pts = CUSHION_MESH.pillow.positions;
          const bands = 6;
          const low = Array<number>(bands).fill(Infinity);
          const v = new Vector3();
          for (let i = 0; i < pts.length; i += 3) {
            v.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(m);
            const u = (v.z - (p.pos[2] - p.size[2] * 0.4)) / (p.size[2] * 0.8);
            if (u < 0 || u >= 1 || Math.abs(v.x - p.pos[0]) > p.size[0] * 0.4) continue;
            const k = Math.floor(u * bands);
            low[k] = Math.min(low[k], v.y);
          }
          // The pillow's own seam rolls up off the mattress a little, a tenth of its loft.
          low.forEach((y, k) => expect(y - top, `pillow band ${k} of ${bands} clear of the mattress`).toBeLessThan(Math.max(0.01, p.size[1] * 0.1)));
        }
        // Two pillows side by side do not pass through each other.
        if (b.pillows.length === 2) {
          const [l, r] = b.pillows.map((p) => reach(CUSHION_MESH.pillow, p));
          expect(l.hi[0]).toBeLessThanOrEqual(r.lo[0]);
        }
        const foldTop = b.fold.pos[1] + b.fold.size[1] / 2;
        b.scatter.forEach((s, i) => {
          scattered++;
          const { lo, hi } = reach(CUSHION_MESH.scatter, s);
          expect(lo[1]).toBeCloseTo(foldTop - CUSHION_SINK, 9);
          // ...on the sheet, not over the gap behind it: its bottom seam is inside the fold.
          const cloth = worldPoints(CUSHION_MESH.scatter, s);
          const seam = cloth.filter((v) => v.y < lo[1] + 0.005);
          for (const v of seam) {
            expect(v.z, 'scatter cushion stands on the turned-back sheet').toBeGreaterThanOrEqual(b.fold.pos[2] - b.fold.size[2] / 2);
            expect(v.z).toBeLessThanOrEqual(b.fold.pos[2] + b.fold.size[2] / 2);
          }
          // ...and LEANS ON something: its back meets its pillow's front, settled in by the
          // sink and no further. Leaned against where a propped pillow used to be, it stood
          // 30 mm clear of the flat one at its foot and 190 mm clear at its top — a cushion
          // tipped back on nothing, the floating the user reported second.
          const pillow = worldPoints(CUSHION_MESH.pillow, b.pillows[i]);
          const back = slices(CUSHION_MESH.scatter, s, s.pos[0], s.size[0] * 0.3, Math.min);
          const front = slices(CUSHION_MESH.pillow, b.pillows[i], s.pos[0], s.size[0] * 0.3, Math.max);
          const gaps = [...back].filter(([k]) => front.has(k)).map(([k, z]) => z - front.get(k)!);
          expect(gaps.length, 'the cushion and its pillow share heights').toBeGreaterThan(3);
          expect(Math.abs(Math.min(...gaps) + CUSHION_SINK), 'into the pillow by the sink').toBeLessThan(0.001);
          // ...and the pillow HOLDS it: its centre lies between its bottom seam on the sheet
          // and where its back meets the pillow, clear of that point by 10 mm. Touching was
          // not enough — tipped back 17° against a pillow lying flat, it met the pillow low
          // down with its centre 2–9 mm BEHIND the meeting, at every size: a cushion that
          // would fall back onto the pillow, standing in the air, the floating reported third.
          const foot = Math.max(...seam.map((v) => v.z));
          expect(held(s, b.pillows[i]).clear, 'its centre is in front of where it meets the pillow').toBeGreaterThan(0.01);
          expect(s.pos[2], 'and behind its own foot: it leans back').toBeLessThan(foot);
          // ...and lies back no further than it must, or a cushion lying flat would pass: 2°
          // more upright, stood on the same sheet and settled on the same pillow, it is not
          // held. It leans as far as it would fall, not as far as looks safe.
          const lean = Math.PI / 2 - s.rot![0];
          if (lean > THROW_LEAN + 0.035) {
            uprighted++;
            const up = leaningCushion(s.pos[0], s.size[0], s.size[1], s.size[2], lean - 0.035, foldTop, reach(CUSHION_MESH.pillow, b.pillows[i]).hi[2]);
            const settled = { ...up, pos: [up.pos[0], up.pos[1], up.pos[2] + held(up, b.pillows[i]).need] as V3 };
            expect(held(settled, b.pillows[i]).clear, '2° more upright, the pillow does not hold it').toBeLessThan(SCATTER_SETTLE);
          }
          // A pillow it can lean on stands clear of the sheet: at 0.15 h of loft the Library
          // bed's stood 12 mm above it, a ledge nothing rests against.
          const pillowTop = Math.max(...pillow.map((v) => v.y));
          expect(pillowTop - foldTop, 'the pillow stands above the turned-back sheet').toBeGreaterThan(0.025);
          expect(b.pillows[i].size[1]).toBeCloseTo(Math.min(PILLOW_LOFT.max, Math.max(PILLOW_LOFT.min, h * 0.27)), 12);
          expect(hi[1]).toBeLessThanOrEqual(SCATTER_TOP * h + EPS);
          // Sized as it would STAND, so lying back it is the same cushion: stood up on the
          // sheet at the sofa's lean, it would reach no higher than `SCATTER_TOP` either.
          const stood = s.size[0] * standingHeight(s.size[1] / s.size[0], THROW_LEAN) + foldTop - CUSHION_SINK;
          expect(stood).toBeLessThanOrEqual(SCATTER_TOP * h + EPS);
          if (Math.abs(stood - SCATTER_TOP * h) < EPS) atScatterTop++;
          expect(lo[0]).toBeGreaterThanOrEqual(-w / 2);
          expect(hi[0]).toBeLessThanOrEqual(w / 2);
          expect(hi[2]).toBeLessThan(d / 2);
        });
        // The duvet: inside the outline on both floor axes, above the frame, from the
        // pillows to the foot.
        const du = bounds(b.duvet);
        expect(du.lo[0]).toBeGreaterThanOrEqual(-w / 2 + 0.005);
        expect(du.hi[0]).toBeLessThanOrEqual(w / 2 - 0.005);
        expect(du.hi[2]).toBeLessThanOrEqual(d / 2 - 0.005);
        expect(du.lo[1]).toBeGreaterThan(frameTop);
        expect(du.hi[1]).toBeLessThan(1.4 * h);
        // ...and it covers the mattress's top and sides: it is wider and longer than it.
        expect(du.hi[0]).toBeGreaterThan(b.mattress.size[0] / 2);
        expect(du.hi[2]).toBeGreaterThan(b.mattress.size[2] / 2);
        // The turned-back sheet lies across the duvet, inside the bed's width.
        expect(b.fold.size[0] / 2).toBeLessThanOrEqual(w / 2);
      });
    }
  }
  it('the sweep reached the scatter cushions', () => {
    // Literals, not floors: every bed in the sweep that carries cushions,
    // the two whose cushions would stand exactly to the top line, and —
    // the floating the user reported — every one of them leaning back past
    // the old fixed throw lean, which is what it takes for the pillow to
    // hold it.
    expect(scattered).toBe(13);
    expect(atScatterTop).toBe(2);
    expect(uprighted).toBe(13);
  });

  it('is memoised: the same bed is the same object, so the duvet is built once', () => {
    const dim = [1400, 2000, 600];
    const a = bedForm({ id: 'x', dimMM: dim }, bedPillows(1400));
    expect(bedForm({ id: 'x', dimMM: [...dim] }, bedPillows(1400))).toBe(a);
    expect(bedForm({ id: 'x', dimMM: [1400, 2000, 601] }, bedPillows(1400))).not.toBe(a);
    // The id is part of the key — it decides the cushions' tones.
    expect(bedForm({ id: 'y', dimMM: dim }, bedPillows(1400))).not.toBe(a);
  });
});

describe('curtainCloth — the folds stay inside the curtain', () => {
  const PLEAT = MODULE_RANGE.curtain!;
  for (const dim of sizes('curtain', 'curtain')) {
    it(dim.join('×'), () => {
      const [w, d, h] = dim.map((v) => v / 1000);
      const { lo, hi } = bounds(curtainCloth(dim, moduleCount(w, PLEAT)));
      expect(lo[0]).toBeCloseTo(-w / 2, 9);
      expect(hi[0]).toBeCloseTo(w / 2, 9);
      expect(lo[2]).toBeGreaterThanOrEqual(-d / 2);
      expect(hi[2]).toBeLessThanOrEqual(d / 2);
      expect(lo[1]).toBeCloseTo(-h / 2, 9);
      expect(hi[1]).toBeLessThanOrEqual(h / 2);
      // It has folds at all: a flat sheet would pass every bound above.
      expect(hi[2] - lo[2]).toBeGreaterThan(Math.min(d, 0.02) * 0.5);
    });
  }
  it('is memoised by size and pleats', () => {
    const a = curtainCloth([1600, 80, 2200], 9);
    expect(curtainCloth([1600, 80, 2200], 9)).toBe(a);
    expect(curtainCloth([1600, 80, 2200], 10)).not.toBe(a);
  });
});

describe('garments and shoes', () => {
  it('a long garment is a dress or a coat, a short one a shirt or trousers, and every kind hangs', () => {
    const long = new Set(Array.from({ length: 64 }, (_, t) => garmentKind(true, t)));
    const short = new Set(Array.from({ length: 64 }, (_, t) => garmentKind(false, t)));
    expect([...long].sort()).toEqual(['coat', 'dress']);
    expect([...short].sort()).toEqual(['shirt', 'trousers']);
  });

  it('a rail hangs more than one kind, and every garment its own seeded kind', () => {
    const kinds = new Set<string>();
    for (const id of ['a', 'rail-1', 'p_7f3c', 'zz-99', 'x', 'r2']) {
      for (const g of clothesRail({ id, dimMM: [1200, 450, 1600] }).garments) {
        expect(GARMENT_KINDS).toContain(g.kind);
        kinds.add(g.kind);
      }
    }
    expect(kinds.size).toBeGreaterThan(2);
  });

  it('every shoe is a sole and an upper of one kind, the upper standing on the sole', () => {
    const kinds = new Set<string>();
    for (const id of ['a', 'rack-1', 'p_7f3c', 'zz-99']) {
      const boxes = shoeRow({ id, dimMM: [800, 300, 900] });
      const soles = boxes.filter((b) => b.sole);
      const uppers = boxes.filter((b) => !b.sole);
      expect(uppers.length).toBe(soles.length);
      soles.forEach((s, i) => {
        const u = uppers[i];
        kinds.add(s.kind);
        expect(u.kind).toBe(s.kind);
        expect(u.tier).toBe(s.tier);
        expect(u.pos[0]).toBeCloseTo(s.pos[0], 12);
        expect(u.pos[1] - u.size[1] / 2).toBeCloseTo(s.pos[1] + s.size[1] / 2, 12);
        // A hair inside the sole all round, so the sole shows as a welt.
        expect(u.size[0]).toBeLessThan(s.size[0]);
        expect(u.size[2]).toBeLessThan(s.size[2]);
      });
    }
    expect([...kinds].sort()).toEqual([...SHOE_KINDS].sort());
  });
});
