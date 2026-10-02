// The three chairs of `lib/chair-form.ts`: what is particular to each beyond the box and
// proportions `tests/hard-goods.test.ts` already holds them to. Above all, that the two
// numbers `tuckProfile` reads are the drawing's own — `tests/seat-fit.test.tsx` measures
// the rendered chair against the rule, and this holds the form to it directly, across
// the band, so a share moved in one file and not the other fails here by name.

import { describe, expect, it } from 'vitest';
import { ARMCHAIR, armchairForm, DINING_CHAIR, diningChairForm, OFFICE_CHAIR, officeChairForm } from '../lib/chair-form';
import { partExtent, type HardPart } from '../lib/hard-goods';
import { CUSHION_MESH, meshExtent, type SoftItem } from '../lib/soft-goods';
import { tuckProfile } from '../lib/layout-rules';
import { PART_LIBRARY, type Shape } from '../lib/scene-spec';
import { dimRangeFor } from '../lib/dimension-ranges';

const EPS = 1e-9;

/** The Library size, every corner of the band, and a run of sizes between. */
function sizes(shape: Shape): number[][] {
  const lib = PART_LIBRARY.find((p) => p.shape === shape)!.dimMM;
  const band = dimRangeFor('chair', shape);
  const out: number[][] = [lib.slice()];
  const at = (k: number, t: number) => band.min[k] + (band.max[k] - band.min[k]) * t;
  for (const i of [0, 0.5, 1]) for (const j of [0, 0.5, 1]) for (const k of [0, 0.25, 0.5, 0.75, 1]) out.push([at(0, i), at(1, j), at(2, k)]);
  return out;
}

const get = (parts: HardPart[], key: string) => {
  const p = parts.find((q) => q.key === key);
  if (!p) throw new Error(`no ${key}`);
  return partExtent(p);
};

/** Where a cushion's own surface reaches, as it is drawn. */
const reach = (mesh: keyof typeof CUSHION_MESH, it: SoftItem) => {
  const e = meshExtent(CUSHION_MESH[mesh], it.size, it.rot);
  return { lo: e.lo.map((v, k) => v + it.pos[k]), hi: e.hi.map((v, k) => v + it.pos[k]) };
};

const chair = (shape: Shape, dimMM: number[]) => ({ category: 'chair' as const, shape, dimMM: dimMM as [number, number, number] });

describe('a chair tucks by its own drawing', () => {
  it('keeps the shares the old drawings had, so a chair tucks exactly as far as it did', () => {
    expect(DINING_CHAIR.seatTop).toBe(490 / 1090);
    expect(DINING_CHAIR.back).toBe(55 / 420);
    expect(OFFICE_CHAIR.armTop).toBe(640 / 1150);
    expect(OFFICE_CHAIR.back).toBe(70 / 480);
  });

  it('dining chair: the pad’s top is the tuck height and the uprights’ face is the back', () => {
    const all = sizes('chair-dining');
    expect(all.length).toBe(46);
    for (const dimMM of all) {
      const at = dimMM.join('x');
      const f = diningChairForm(dimMM);
      const t = tuckProfile(chair('chair-dining', dimMM));
      const pad = reach('box', f.pad);
      expect(pad.hi[1] * 1000, `${at}: tuck`).toBeCloseTo(t.tuckMM, 6);
      // Nothing else is higher than the pad in front of the uprights.
      const zBack = Math.max(...f.parts.filter((p) => partExtent(p).hi[1] * 1000 > t.tuckMM + 1e-6).map((p) => partExtent(p).hi[2]));
      expect((zBack + dimMM[1] / 2000) / (dimMM[1] / 1000), `${at}: back`).toBeCloseTo(t.backShare, 9);
      expect(get(f.parts, 'leg-r1').hi[2], `${at}: the uprights carry it`).toBeCloseTo(zBack, 12);
    }
  });

  it('office chair: the armrests’ top is the tuck height and the cushion’s face is the back', () => {
    for (const dimMM of sizes('chair-office')) {
      const at = dimMM.join('x');
      const f = officeChairForm(dimMM);
      const t = tuckProfile(chair('chair-office', dimMM));
      for (const s of [-1, 1]) expect(get(f.parts, `arm${s}`).hi[1] * 1000, `${at}: tuck`).toBeCloseTo(t.tuckMM, 6);
      // The arms are the highest thing in front of the back, the seat well under them.
      const back = reach('box', f.back);
      expect(back.lo[1] * 1000, `${at}: the back stands above the arms`).toBeGreaterThan(t.tuckMM);
      expect((back.hi[2] + dimMM[1] / 2000) / (dimMM[1] / 1000), `${at}: back`).toBeCloseTo(t.backShare, 6);
      expect(reach('box', f.seat).hi[1] * 1000, `${at}: seat under the arms`).toBeLessThan(t.tuckMM - dimMM[2] * 0.05);
      // And every hard part above the arms stands behind the cushion's face.
      for (const p of f.parts) {
        const e = partExtent(p);
        if (e.hi[1] * 1000 > t.tuckMM + 1e-6) expect(e.hi[2], `${at} ${p.key}`).toBeLessThan(back.hi[2]);
      }
    }
  });
});

describe('the dining chair', () => {
  it('is joined: the seat on its legs, rails set in from the legs’ faces, the back in the uprights', () => {
    for (const dimMM of sizes('chair-dining')) {
      const at = dimMM.join('x');
      const [w, , h] = dimMM.map((v) => v / 1000);
      const f = diningChairForm(dimMM);
      const pad = reach('box', f.pad);
      for (const s of [-1, 1]) {
        const front = get(f.parts, `leg-f${s}`);
        const rear = get(f.parts, `leg-r${s}`);
        expect(front.lo[1], `${at}: on the floor`).toBe(0);
        expect(rear.lo[1]).toBe(0);
        expect(front.hi[1], `${at}: the front legs carry the pad`).toBeCloseTo(pad.lo[1], 12);
        const crest = get(f.parts, 'crest');
        expect(rear.hi[1], `${at}: the uprights run into the crest`).toBeGreaterThan(crest.lo[1]);
        expect(rear.hi[1]).toBeLessThan(crest.hi[1]);
        expect(rear.lo[2], `${at}: the crest is set into them from behind`).toBeLessThan(crest.hi[2]);
        // The side rail stands in from the leg's outer face and its ends are inside both legs.
        const rail = get(f.parts, `rail-side${s}`);
        expect(Math.abs(s < 0 ? rail.lo[0] : rail.hi[0]), `${at}: inset`).toBeLessThan(w / 2 - EPS);
        expect(rail.lo[2], `${at}: in the rear leg`).toBeGreaterThan(rear.lo[2]);
        expect(rail.lo[2]).toBeLessThan(rear.hi[2]);
        expect(rail.hi[2], `${at}: in the front leg`).toBeGreaterThan(front.lo[2]);
        expect(rail.hi[2]).toBeLessThan(front.hi[2]);
        expect(rail.hi[1], `${at}: under the pad`).toBeLessThan(pad.lo[1]);
      }
      // A low stretcher, and the slats standing in both back rails.
      expect(get(f.parts, 'stretcher-1').hi[1], at).toBeLessThan(h * 0.2);
      const low = get(f.parts, 'rail-low');
      const crest = get(f.parts, 'crest');
      for (const i of [0, 1, 2]) {
        const slat = get(f.parts, `slat-${i}`);
        expect(slat.lo[1], `${at} slat ${i}`).toBeLessThan(low.hi[1]);
        expect(slat.lo[1]).toBeGreaterThan(low.lo[1]);
        expect(slat.hi[1]).toBeGreaterThan(crest.lo[1]);
        expect(slat.hi[1]).toBeLessThan(crest.hi[1]);
      }
      expect(low.lo[1], `${at}: the back starts above the seat`).toBeGreaterThan(pad.hi[1]);
    }
  });
});

describe('the office chair', () => {
  it('rolls on five casters, one straight ahead, under a star that carries its lift', () => {
    for (const dimMM of sizes('chair-office')) {
      const at = dimMM.join('x');
      const f = officeChairForm(dimMM);
      const casters = f.parts.filter((p) => p.key.startsWith('caster-'));
      expect(casters.length).toBe(5);
      for (const c of casters) expect(partExtent(c).lo[1], `${at} ${c.key} on the floor`).toBeCloseTo(0, 12);
      const ahead = partExtent(casters[0]);
      expect((ahead.lo[0] + ahead.hi[0]) / 2, `${at}: one ahead`).toBeCloseTo(0, 12);
      expect(ahead.hi[2], at).toBeGreaterThan(dimMM[1] / 2000 * 0.9);
      // Each caster's stem stands in it and reaches its spoke.
      for (let i = 0; i < 5; i++) {
        const stem = get(f.parts, `stem-${i}`);
        const spoke = get(f.parts, `spoke-${i}`);
        expect(stem.lo[1], `${at} ${i}`).toBeLessThan(partExtent(casters[i]).hi[1]);
        expect(stem.hi[1]).toBeGreaterThan(spoke.lo[1]);
      }
      // Hub, cover, lift, mechanism: each reaches into the next.
      const chain = ['hub', 'cover', 'lift', 'mechanism', 'pan'].map((k) => get(f.parts, k));
      for (let i = 1; i < chain.length; i++) expect(chain[i].lo[1], `${at} ${i}`).toBeLessThanOrEqual(chain[i - 1].hi[1] + EPS);
      // The seat cushion sits on the pan, and the back cushion on its shell.
      expect(reach('box', f.seat).lo[1], at).toBeLessThan(get(f.parts, 'pan').hi[1]);
      const back = reach('box', f.back);
      const shell = get(f.parts, 'shell');
      expect(back.lo[2], `${at}: into the shell`).toBeLessThan(shell.hi[2]);
      expect(back.hi[1], `${at}: the back is the chair's top`).toBeCloseTo(dimMM[2] / 1000, 9);
    }
  });
});

describe('the armchair', () => {
  it('stands on turned legs under rolled arms, its cushions between them', () => {
    for (const dimMM of sizes('chair-armchair')) {
      const at = dimMM.join('x');
      const [w, d, h] = dimMM.map((v) => v / 1000);
      const f = armchairForm(dimMM);
      for (const s of [-1, 1]) {
        const arm = get(f.parts, `arm${s}`);
        const roll = get(f.parts, `roll${s}`);
        for (const sz of [-1, 1]) {
          const leg = get(f.parts, `leg-${s}${sz}`);
          expect(leg.hi[1], `${at}: the legs carry the arms`).toBeCloseTo(arm.lo[1], 12);
          expect(leg.lo[0] >= arm.lo[0] && leg.hi[0] <= arm.hi[0], `${at}: under the arm`).toBe(true);
        }
        // The roll is centred on the arm's top edge and a little proud of both faces.
        expect((roll.lo[1] + roll.hi[1]) / 2, at).toBeCloseTo(arm.hi[1], 12);
        expect(roll.lo[0], at).toBeLessThan(arm.lo[0]);
        expect(roll.hi[0], at).toBeGreaterThan(arm.hi[0]);
        expect(roll.hi[2], at).toBeGreaterThan(arm.hi[2]);
      }
      const seat = reach('box', f.seat);
      expect(seat.lo[0], `${at}: between the arms`).toBeGreaterThan(get(f.parts, 'arm-1').hi[0]);
      expect(seat.hi[0]).toBeLessThan(get(f.parts, 'arm1').lo[0]);
      expect(seat.hi[1], at).toBeCloseTo(h * ARMCHAIR.seatTop, 9);
      // The scatter cushion rests on the seat and leans on the back, inside the chair.
      const sc = reach('scatter', f.scatter);
      const back = reach('box', f.back);
      expect(sc.lo[1], `${at}: on the seat`).toBeLessThan(seat.hi[1]);
      expect(sc.lo[1]).toBeGreaterThan(seat.hi[1] - 0.02);
      expect(sc.lo[2], `${at}: against the back`).toBeLessThan(back.hi[2]);
      expect(sc.lo[2]).toBeGreaterThan(back.hi[2] - 0.02);
      for (let k = 0; k < 3; k++) {
        const half = [w, h, d][k] / 2;
        const lo = k === 1 ? 0 : -half;
        const hi = k === 1 ? h : half;
        expect(sc.lo[k], `${at} scatter ${k}`).toBeGreaterThanOrEqual(lo - EPS);
        expect(sc.hi[k], `${at} scatter ${k}`).toBeLessThanOrEqual(hi + EPS);
      }
    }
  });
});

describe('the proportions they were drawn with', () => {
  it('are pinned', () => {
    expect(DINING_CHAIR).toEqual({
      seatTop: 490 / 1090, back: 55 / 420, leg: 0.075, frontLeg: 0.075, rearLeg: 0.095, pad: 0.05,
      apron: 0.08, railInset: 0.015, rail: 0.04, stretcherY: 0.13, stretcherH: 0.03, crest: 0.07,
      crestD: 0.075, slat: 0.07,
    });
    expect(OFFICE_CHAIR).toEqual({
      armTop: 640 / 1150, back: 70 / 480, seatTop: 0.47, caster: 0.45, spoke: 0.022, backTh: 0.1, backY: 0.6,
    });
    expect(ARMCHAIR).toEqual({ legH: 0.17, legR: 0.032, arm: 0.13, armTop: 0.64, roll: 0.07, seatTop: 0.49 });
  });
});
