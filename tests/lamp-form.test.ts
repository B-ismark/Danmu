// The floor and table lamps of `lib/lamp-form.ts`: where each one's bulb is, and that the
// light comes from there. `tests/hard-goods.test.ts` holds both forms to the box they
// declare and to § 36's proportions-only rule; this file holds what is particular to a
// lamp — a bulb inside its drum at every size the band allows, a vessel that is one
// turned piece, and an emitter that is the drawn bulb rather than a copy of it.

import { describe, expect, it } from 'vitest';
import { FLOOR_LAMP, TABLE_LAMP, floorLampForm, lampForm, tableLampForm, type LampForm } from '../lib/lamp-form';
import { partExtent, type HardPart } from '../lib/hard-goods';
import { lightAnchor, PART_LIBRARY, type Shape } from '../lib/scene-spec';
import { dimRangeFor } from '../lib/dimension-ranges';

const EPS = 1e-9;
const LAMPS: Array<{ shape: Shape; form: (d: readonly number[]) => LampForm }> = [
  { shape: 'lamp-floor', form: floorLampForm },
  { shape: 'lamp-table', form: tableLampForm },
];

/** The Library size, every corner of the band, and a run of heights and widths between,
 *  because the bulb's fit in its drum is a ratio of two axes and the corners alone would
 *  test only its extremes. */
function sizes(shape: Shape): number[][] {
  const lib = PART_LIBRARY.find((p) => p.shape === shape)!.dimMM;
  const band = dimRangeFor('lamp', shape);
  const out: number[][] = [lib.slice()];
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const w = band.min[0] + ((band.max[0] - band.min[0]) * i) / 8;
      const h = band.min[2] + ((band.max[2] - band.min[2]) * j) / 8;
      out.push([w, w, h]);
    }
  }
  return out;
}

const part = (f: LampForm, key: string): HardPart => {
  const p = f.parts.find((q) => q.key === key);
  if (!p) throw new Error(`no ${key}`);
  return p;
};

describe('a lamp’s bulb', () => {
  for (const { shape, form } of LAMPS) {
    it(`${shape}: hangs inside its drum, clear of both openings, at every size`, () => {
      const all = sizes(shape);
      expect(all.length).toBe(82);
      for (const dimMM of all) {
        const f = form(dimMM);
        const at = `${shape} ${dimMM.join('x')}`;
        const { lo, hi } = partExtent(part(f, 'bulb'));
        const y0 = f.shade.y - f.shade.h / 2;
        const y1 = f.shade.y + f.shade.h / 2;
        // Inside the drum's height, with room to spare top and bottom — a bulb poking out
        // of a shallow shade's mouth was what sizing it off the width alone did.
        expect(lo[1], `${at}: above the shade's mouth`).toBeGreaterThan(y0 + f.shade.h * 0.1);
        expect(hi[1], `${at}: below its top`).toBeLessThan(y1 - f.shade.h * 0.1);
        // And inside its radius, where the drum is narrowest.
        expect(hi[0], `${at}: inside the drum`).toBeLessThan(f.shade.rTop * 0.5);
        // The light comes from its centre.
        const [bx, by, bz] = f.bulb;
        expect([bx, bz]).toEqual([0, 0]);
        expect(by, `${at}: the emitter is the bulb`).toBeCloseTo((lo[1] + hi[1]) / 2, 12);
      }
    });

    it(`${shape}: is carried — its socket reaches into it and stands on the stem below`, () => {
      for (const dimMM of sizes(shape)) {
        const f = form(dimMM);
        const at = `${shape} ${dimMM.join('x')}`;
        const bulb = partExtent(part(f, 'bulb'));
        const socket = partExtent(part(f, 'socket'));
        const stem = partExtent(part(f, shape === 'lamp-floor' ? 'pole' : 'stem'));
        expect(socket.hi[1], `${at}: socket into the bulb`).toBeGreaterThan(bulb.lo[1]);
        expect(socket.hi[1], `${at}: but not through it`).toBeLessThan(bulb.hi[1]);
        expect(socket.lo[1], `${at}: socket on the stem`).toBeCloseTo(stem.hi[1], 12);
      }
    });
  }
});

describe('the light comes from the drawn bulb', () => {
  it('is lampForm’s bulb for both lamps, at every size', () => {
    for (const { shape, form } of LAMPS) {
      for (const dimMM of sizes(shape)) {
        const d = dimMM as [number, number, number];
        expect(lightAnchor(shape, d), `${shape} ${dimMM.join('x')}`).toEqual(form(d).bulb);
        expect(lampForm(shape, d)?.bulb).toEqual(form(d).bulb);
      }
    }
    expect(lampForm('sofa', [2000, 900, 800])).toBeNull();
    expect(lightAnchor('sofa', [2000, 900, 800]), 'anything else sits at its origin').toEqual([0, 0, 0]);
  });

  it('moves with the size, where the old constants did not', () => {
    // The two sizes that were measured wrong. A 1500 mm floor lamp emitted from 1.66 m,
    // 160 mm above its own top; a 900 mm table lamp from 0.40 m, in its stem 150 mm below
    // the shade. Each has to be inside its shade now — and the two sizes of each lamp
    // have to DISAGREE, because "put the literal back" collapses them to one answer.
    const floor = lightAnchor('lamp-floor', [400, 400, 1500])[1];
    expect(floor).toBeLessThan(1.5);
    expect(floor).toBeGreaterThan(1.5 * (1 - FLOOR_LAMP.shadeH));
    expect(lightAnchor('lamp-floor', [400, 400, 2000])[1] - floor).toBeGreaterThan(0.4);

    const table = lightAnchor('lamp-table', [250, 250, 900])[1];
    expect(table).toBeGreaterThan(0.9 * (1 - TABLE_LAMP.shadeH));
    expect(table).toBeLessThan(0.9);
    expect(table - lightAnchor('lamp-table', [250, 250, 300])[1]).toBeGreaterThan(0.35);
  });
});

describe('the table lamp’s vessel', () => {
  it('is one turned piece: foot, belly and neck each sink into the next', () => {
    for (const dimMM of sizes('lamp-table')) {
      const f = tableLampForm(dimMM);
      const at = dimMM.join('x');
      const foot = partExtent(part(f, 'foot'));
      const belly = partExtent(part(f, 'belly'));
      const neck = partExtent(part(f, 'neck'));
      const stem = partExtent(part(f, 'stem'));
      expect(belly.lo[1], `${at}: belly into the foot`).toBeLessThan(foot.hi[1]);
      expect(belly.lo[1], `${at}: not through it`).toBeGreaterThan(foot.lo[1]);
      expect(neck.lo[1], `${at}: neck into the belly`).toBeLessThan(belly.hi[1]);
      expect(neck.hi[1], `${at}: and standing out of it`).toBeGreaterThan(belly.hi[1]);
      expect(stem.lo[1], `${at}: the stem stands on the neck`).toBeCloseTo(neck.hi[1], 12);
      // The belly is the vessel's widest part, and narrower than the shade over it.
      for (const p of [foot, neck]) expect(p.hi[0], at).toBeLessThan(belly.hi[0]);
      expect(belly.hi[0], `${at}: under the shade`).toBeLessThan(f.shade.rBottom);
      // The vessel is ceramic and the hardware is brass.
      expect(f.parts.filter((p) => p.tone === 'ceramic').map((p) => p.key)).toEqual(['foot', 'belly', 'neck']);
      expect(f.parts.filter((p) => p.tone === 'brass').map((p) => p.key)).toEqual(['stem', 'socket']);
    }
  });

  it('pins the proportions it was drawn with', () => {
    expect(TABLE_LAMP).toEqual({
      footR: 0.2, footH: 0.03, bellyR: 0.32, bellyH: 0.4, neckR: 0.09, neckH: 0.06,
      stemR: 0.022, shadeH: 0.38, shadeTop: 0.82, socketR: 0.05, socketH: 0.04, bulbR: 0.1,
    });
  });
});

describe('the floor lamp', () => {
  it('stands on a weighted disc, its shade a near-upright drum as wide as the lamp', () => {
    for (const dimMM of sizes('lamp-floor')) {
      const f = floorLampForm(dimMM);
      const w = dimMM[0] / 1000;
      const h = dimMM[2] / 1000;
      const at = dimMM.join('x');
      const base = part(f, 'base');
      if (base.kind !== 'post') throw new Error('base is a post');
      // Wide and low: most of the lamp's width, a sixtieth of its height.
      expect(base.rBottom, at).toBeCloseTo(w * 0.47, 12);
      expect(base.h, at).toBeCloseTo(h * FLOOR_LAMP.baseH, 12);
      expect(base.pos[1] - base.h / 2, `${at}: on the floor`).toBeCloseTo(0, 12);
      // The drum reaches the declared width at its mouth and leans in only a little.
      expect(f.shade.rBottom, at).toBeCloseTo(w / 2, 12);
      expect(f.shade.rTop / f.shade.rBottom, at).toBeCloseTo(FLOOR_LAMP.shadeTop, 12);
      expect(f.shade.y + f.shade.h / 2, `${at}: its top is the lamp's`).toBeCloseTo(h, 12);
      // Everything stacks without a gap: base, collar, pole, socket.
      const ys = ['base', 'collar', 'pole', 'socket'].map((k) => partExtent(part(f, k)));
      for (let i = 1; i < ys.length; i++) expect(ys[i].lo[1], `${at} ${i}`).toBeCloseTo(ys[i - 1].hi[1], 12);
      expect(f.parts.filter((p) => p.tone === 'brass').length).toBe(4);
    }
  });

  it('pins the proportions it was drawn with', () => {
    expect(FLOOR_LAMP).toEqual({
      baseR: 0.45, baseH: 0.016, collarR: 0.11, collarH: 0.012, poleR: 0.04,
      shadeH: 0.19, shadeTop: 0.86, socketR: 0.06, socketH: 0.035, bulbR: 0.12,
    });
  });
});

describe('a round lamp reads its width radially and its height upward', () => {
  // `hard-goods.test.ts`'s separability sweep reads positions, which on a lamp are all on
  // its axis — so it cannot see a radius that moves with the height. This can.
  const radial = (p: HardPart): number[] =>
    p.kind === 'post' ? [p.r, p.rBottom] : p.kind === 'ball' ? [p.radii[0], p.radii[2]] : [];
  const upward = (p: HardPart): number[] =>
    p.kind === 'post' ? [p.h, p.pos[1]] : p.kind === 'ball' ? [p.radii[1], p.pos[1]] : [];
  for (const { shape, form } of LAMPS) {
    it(shape, () => {
      const base = PART_LIBRARY.find((p) => p.shape === shape)!.dimMM.slice();
      const a = form(base);
      for (const s of [0.7, 1.6]) {
        const wide = form([base[0] * s, base[1], base[2]]);
        const tall = form([base[0], base[1], base[2] * s]);
        a.parts.forEach((p, i) => {
          radial(wide.parts[i]).forEach((v, j) => expect(v, `${p.key} r${j} ×w`).toBeCloseTo(radial(p)[j] * s, 12));
          upward(wide.parts[i]).forEach((v, j) => expect(v, `${p.key} y${j} ×w`).toBeCloseTo(upward(p)[j], 12));
          radial(tall.parts[i]).forEach((v, j) => expect(v, `${p.key} r${j} ×h`).toBeCloseTo(radial(p)[j], 12));
          upward(tall.parts[i]).forEach((v, j) => expect(v, `${p.key} y${j} ×h`).toBeCloseTo(upward(p)[j] * s, 12));
        });
        expect(wide.shade.rBottom).toBeCloseTo(a.shade.rBottom * s, 12);
        expect(tall.shade.h).toBeCloseTo(a.shade.h * s, 12);
        expect(tall.shade.rTop).toBeCloseTo(a.shade.rTop, 12);
      }
    });
  }
  it('has no part kinds the two readers above do not cover', () => {
    for (const { form } of LAMPS) {
      for (const p of form([300, 300, 1000]).parts) expect(['post', 'ball']).toContain(p.kind);
    }
    expect(EPS).toBeGreaterThan(0);
  });
});
