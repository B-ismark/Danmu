import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Vector3 } from 'three';
import {
  PLANT_LEAF_TONES, PLANT_MAX_LEAVES, PLANT_MIN_LEAVES, PLANT_POT_H, PLANT_POT_R, PART_LIBRARY, isParametric,
  plantForm, plantLeafPoints, type PlantForm,
} from '@/lib/scene-spec';
import { PLANT_LEAF_ASPECT, PLANT_CLUMP_ASPECT, PLANT_FAN_LIFT, PLANT_MAX_CLUMPS } from '@/lib/plant-form';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dimRangeFor } from '@/lib/dimension-ranges';

// "The plant model looks squeezed", and then "can't we make it look more like an actual
// plant". The first was a per-axis stretch of one fixed drawing; the second was a head of
// round balls that read as topiary. The plant is now a botanical silhouette the box picks:
// a fig when it is tall for its spread, an arching bush when it is squat, a blend between.
// `tests/footprint-fidelity.test.tsx` measures its extents through the renderer; this file
// measures what a plant is made of, from `plantForm` itself.

type V3 = [number, number, number];

const band = dimRangeFor('plant', 'plant');
const lib = PART_LIBRARY.find((i) => i.shape === 'plant')!.dimMM;

/** Every legal plant on a 5-step grid per axis, plus the catalogue one: 126 plants. */
function plants(): V3[] {
  const at = (i: 0 | 1 | 2, k: number) => Math.round(band.min[i] + ((band.max[i] - band.min[i]) * k) / 4);
  const out: V3[] = [lib];
  for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) for (let c = 0; c <= 4; c++) out.push([at(0, a), at(1, b), at(2, c)]);
  return out;
}

/** Shapes a person would actually give a plant: nothing more lopsided than 2 : 1 in plan.
 *  The catalogue plant is the first. */
const ORDINARY: V3[] = [
  lib, [300, 300, 600], [600, 600, 1200], [800, 700, 1800], [250, 250, 450],
  [1000, 900, 2000], [500, 300, 900], [1200, 1200, 2600], [150, 150, 400], [800, 800, 1000],
];

const tag = (dim: V3) => dim.join('×');
const leafPoints = (g: PlantForm) => g.leaves.flatMap(plantLeafPoints);
const near = (a: V3, b: V3, eps = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= eps;

/** Distance from `p` to the segment `a`–`b`. */
function toSegment(p: V3, a: V3, b: V3) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = L2 > 0 ? Math.min(Math.max((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2, 0), 1) : 0;
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
}

describe('a plant drawn at its own size', () => {
  it('is parametric, so a resize redraws it rather than stretching it', () => {
    // A non-parametric shape is drawn once and a resize arrives as a per-axis group scale
    // in `Draggable`, which squashes every leaf however it was drawn.
    expect(isParametric('plant')).toBe(true);
  });

  it('never distorts a leaf: every one is the same leaf, scaled evenly across its face', () => {
    // The complaint itself. A leaf is the unit leaf scaled [width, width, length]; its
    // width over length is the habit's leaf shape, a slim bush leaf to a broad fig paddle,
    // with ±10% jitter so no two are identical, and never anything the box forced.
    const [lo, hi] = [PLANT_LEAF_ASPECT[0] * 0.9, PLANT_LEAF_ASPECT[1] * 1.1];
    let checked = 0;
    for (const dim of plants()) {
      for (const l of plantForm(dim).leaves) {
        expect(l.size[0], `${tag(dim)} leaf fold scaled with its width`).toBe(l.size[1]);
        const shape = l.size[0] / l.size[2];
        expect(shape, `${tag(dim)} leaf shape`).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(shape, `${tag(dim)} leaf shape`).toBeLessThanOrEqual(hi + 1e-12);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('stays inside the ellipse the plan draws, under the top of its box and out of its pot', () => {
    // `plant` is a round shape: the plan, collision and clearance all see the w × d
    // ELLIPSE. Every point of every leaf is checked, not a leaf's centre or its box.
    // The two extra sizes are low troughs, the one place a drooping leaf reaches down
    // past the rim: a round pot's gate there lets it into the trough's long ends.
    let checked = 0;
    for (const dim of [...plants(), [625, 125, 150], [125, 625, 150]] as V3[]) {
      const g = plantForm(dim);
      const A = dim[0] / 2000, E = dim[1] / 2000, h = dim[2] / 1000;
      const [sx, sz] = g.pot.stretch;
      // The worst point on each test, then one assertion each: a hundred thousand
      // `expect` calls cost twenty seconds and say nothing more.
      let out = 0, top = -Infinity, low = Infinity, inPot = Infinity;
      for (const p of leafPoints(g)) {
        out = Math.max(out, (p[0] / A) ** 2 + (p[2] / E) ** 2);
        top = Math.max(top, p[1]);
        low = Math.min(low, p[1]);
        if (p[1] < g.pot.h) {
          // Inside the pot's wall at that height is inside the pot. Its bottom radius is
          // the smaller one, so the base is a conservative test of the whole wall.
          const r = g.pot.bottom;
          inPot = Math.min(inPot, (p[0] / (r * sx)) ** 2 + (p[2] / (r * sz)) ** 2);
        }
        checked++;
      }
      expect(out, `${tag(dim)} leaf past the outline`).toBeLessThanOrEqual(1 + 1e-9);
      expect(top, `${tag(dim)} leaf above the box`).toBeLessThanOrEqual(h + 1e-9);
      expect(low, `${tag(dim)} leaf through the floor`).toBeGreaterThan(0);
      expect(inPot, `${tag(dim)} leaf inside the pot`).toBeGreaterThanOrEqual(1);
      // Stems too: a stalk is straight between its two ends, and the ellipse is convex.
      for (const s of g.stems) for (const p of [s.from, s.to]) {
        expect((p[0] / A) ** 2 + (p[2] / E) ** 2, `${tag(dim)} stem past the outline`).toBeLessThanOrEqual(1 + 1e-9);
        expect(p[1], `${tag(dim)} stem above the box`).toBeLessThanOrEqual(h + 1e-9);
      }
    }
    expect(checked).toBeGreaterThan(100000);
  });

  it('fills the outline it stays inside, and reaches the top of its box', () => {
    // Inside is half the promise: the plan draws the whole ellipse, so the leaves have to
    // reach it too, or a 1.2 m plant is a 700 mm plant in a 1.2 m circle. Measured as the
    // leaves' span on each axis over the box's side. Across an ordinary plant it is ≥ 92%
    // (the gaps are between leaf tips, which is what foliage looks like); over the whole
    // band, where a 100 mm slab of plant has to be a row of canes, ≥ 90%.
    const spans = (dim: V3) => {
      const pts = leafPoints(plantForm(dim));
      const ext = (i: number) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]));
      return { x: ext(0) / (dim[0] / 1000), z: ext(2) / (dim[1] / 1000), top: Math.max(...pts.map((p) => p[1])) / (dim[2] / 1000) };
    };
    for (const dim of ORDINARY) {
      const s = spans(dim);
      expect(s.x, `${tag(dim)} width filled`).toBeGreaterThanOrEqual(0.92);
      expect(s.z, `${tag(dim)} depth filled`).toBeGreaterThanOrEqual(0.92);
      expect(s.top, `${tag(dim)} height filled`).toBeGreaterThanOrEqual(0.995);
    }
    for (const dim of plants()) {
      const s = spans(dim);
      expect(Math.min(s.x, s.z), `${tag(dim)} plan filled`).toBeGreaterThanOrEqual(0.9);
      expect(s.top, `${tag(dim)} height filled`).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('is one plant: every leaf on a stalk, every stalk from the soil, the trunk or another stalk', () => {
    // A real plant's silhouette is joined up. A leaf that floats, or a stalk that starts
    // in mid-air beside the trunk, is the first thing that reads as a model.
    for (const dim of plants()) {
      const g = plantForm(dim);
      const ySoil = g.pot.h;
      const wood = g.stems.filter((s) => s.wood);
      const green = g.stems.filter((s) => !s.wood);
      for (const l of g.leaves) {
        expect(green.some((s) => near(s.to, l.pos)), `${tag(dim)} leaf with no stalk`).toBe(true);
      }
      const inSoil = (p: V3) =>
        Math.abs(p[1] - ySoil) < 1e-9 &&
        (p[0] / (g.soil.r * g.pot.stretch[0])) ** 2 + (p[2] / (g.soil.r * g.pot.stretch[1])) ** 2 <= 1;
      for (const s of green) {
        const joined =
          inSoil(s.from) ||
          green.some((o) => o !== s && near(o.to, s.from)) ||
          wood.some((w) => toSegment(s.from, w.from, w.to) <= w.size[0] * 0.75 + 1e-9);
        expect(joined, `${tag(dim)} stalk starting in mid-air at ${s.from.map((v) => v.toFixed(3))}`).toBe(true);
      }
      // Joined is not enough on a plant with a trunk: a stalk may rise straight out of the
      // soil beside it only a little way before it leaves the trunk instead, or the blend
      // between bush and fig is a trunk with a cage of sticks around it.
      if (wood.length) {
        for (const s of green.filter((s) => inSoil(s.from))) {
          const upright = Math.hypot(s.to[0] - s.from[0], s.to[2] - s.from[2]) < 1e-9;
          if (upright) expect(s.to[1] - s.from[1], `${tag(dim)} stalk beside the trunk`).toBeLessThanOrEqual(PLANT_FAN_LIFT + 1e-9);
        }
      }
      // The trunk is one piece rooted below the soil, each segment on the last one's end.
      for (const w of wood) {
        const rooted = w.from[1] < ySoil || wood.some((o) => o !== w && near(o.to, w.from));
        expect(rooted, `${tag(dim)} trunk segment floating`).toBe(true);
      }
    }
  });

  it('draws the stems and leaves at the pose the scene gives them', () => {
    // `rot` is what three reads; `axes`, `from` and `to` are what every other check here
    // measures. They must be one rotation, or the tests certify a plant nobody sees.
    const e = new Euler();
    const m = new Matrix4();
    for (const dim of ORDINARY) {
      const g = plantForm(dim);
      for (const l of g.leaves) {
        m.makeRotationFromEuler(e.set(...l.rot));
        l.axes.forEach((axis, i) => {
          const col = new Vector3().setFromMatrixColumn(m, i);
          expect(col.distanceTo(new Vector3(...axis)), `${tag(dim)} leaf axis ${i}`).toBeLessThan(1e-9);
        });
      }
      for (const s of g.stems) {
        m.makeRotationFromEuler(e.set(...s.rot));
        const up = new Vector3(0, s.size[1] / 2, 0).applyMatrix4(m);
        const pos = new Vector3(...s.pos);
        expect(pos.clone().add(up).distanceTo(new Vector3(...s.to)), `${tag(dim)} stem top`).toBeLessThan(1e-9);
        expect(pos.clone().sub(up).distanceTo(new Vector3(...s.from)), `${tag(dim)} stem foot`).toBeLessThan(1e-9);
      }
    }
  });

  it('grows a tall plant as a fig: a bare trunk, then leaves up the top of it', () => {
    const g = plantForm(lib);
    expect(g.habit, 'the catalogue plant is wholly a fig').toBe(1);
    expect(g.stems.some((s) => s.wood), 'a fig has a trunk').toBe(true);
    const lowest = Math.min(...leafPoints(g).map((p) => p[1]));
    expect(lowest - g.pot.h, 'bare trunk above the soil, m').toBeGreaterThan(0.3);
    expect(g.leaves.length).toBeGreaterThanOrEqual(PLANT_MIN_LEAVES);
  });

  it('grows a squat plant as a bush: no trunk, every stem out of the soil, leaves down to it', () => {
    const dim: V3 = [800, 800, 900];
    const g = plantForm(dim);
    expect(g.habit, 'wholly a bush').toBe(0);
    expect(g.stems.some((s) => s.wood), 'a bush has no trunk').toBe(false);
    // Every stalk chain starts in the soil: the only `from` that is no other stalk's `to`.
    const roots = g.stems.filter((s) => !g.stems.some((o) => o !== s && near(o.to, s.from)));
    expect(roots.length).toBeGreaterThanOrEqual(g.leaves.length);
    for (const s of roots) expect(s.from[1], 'stem rooted in the soil').toBeCloseTo(g.pot.h, 9);
    const lowest = Math.min(...leafPoints(g).map((p) => p[1]));
    expect(lowest - g.pot.h, 'leaves reach down to the pot').toBeLessThan(0.15);
  });

  it('turns from bush to fig as the same footprint grows taller, never back', () => {
    // A drag on the height handle walks through every habit; it should only ever go one way.
    for (const [w, d] of [[400, 400], [800, 800], [600, 300], [1200, 1200]]) {
      let last = -1;
      for (let h = band.min[2]; h <= band.max[2]; h += 50) {
        const habit = plantForm([w, d, h]).habit;
        expect(habit, `${w}×${d}×${h}`).toBeGreaterThanOrEqual(last);
        last = habit;
      }
      expect(last, `${w}×${d} reaches a fig at full height`).toBeGreaterThan(0.5);
    }
    // And both ends are reached inside the legal band, so neither habit is dead code.
    const habits = plants().map((dim) => plantForm(dim).habit);
    expect(habits).toContain(0);
    expect(habits).toContain(1);
    expect(habits.some((x) => x > 0 && x < 1), 'no legal size blends the two').toBe(true);
  });

  it('plants a long, narrow box as a row of plants in a trough, and a round one as one plant', () => {
    for (const dim of plants()) {
      const g = plantForm(dim);
      const ratio = Math.max(dim[0], dim[1]) / Math.min(dim[0], dim[1]);
      if (ratio <= PLANT_CLUMP_ASPECT) {
        expect(g.clumps, `${tag(dim)} one plant`).toBe(1);
        expect(g.pot.stretch, `${tag(dim)} round pot`).toEqual([1, 1]);
      } else {
        expect(g.clumps, `${tag(dim)} a row`).toBeGreaterThan(1);
        expect(g.clumps).toBeLessThanOrEqual(PLANT_MAX_CLUMPS);
      }
      // The trough stays inside the box on both axes.
      expect(g.pot.top * g.pot.stretch[0], `${tag(dim)} pot width`).toBeLessThanOrEqual(dim[0] / 2000 + 1e-9);
      expect(g.pot.top * g.pot.stretch[1], `${tag(dim)} pot depth`).toBeLessThanOrEqual(dim[1] / 2000 + 1e-9);
    }
    // The lopsided end of the band is reached, so the trough is live.
    expect(plantForm([band.max[0], band.min[1], band.max[2]]).clumps).toBeGreaterThan(1);
  });

  it('draws a bounded number of leaves, and enough to read as a plant', () => {
    let worst = 0;
    for (const dim of plants()) worst = Math.max(worst, plantForm(dim).leaves.length);
    expect(worst).toBeLessThanOrEqual(PLANT_MAX_LEAVES);
    for (const dim of ORDINARY) expect(plantForm(dim).leaves.length, tag(dim)).toBeGreaterThanOrEqual(PLANT_MIN_LEAVES);
  });

  it('stands in a pot that reads as a pot at the catalogue size', () => {
    const g = plantForm(lib);
    const across = g.pot.top * 2;
    expect(g.pot.h / across, 'pot height over rim width').toBeLessThan(1.25);
    expect(g.pot.h / across).toBeGreaterThan(0.8);
    expect(g.pot.bottom).toBeLessThan(g.pot.top);
    // The plant is most of the height, not the pot.
    expect(g.pot.h / (lib[2] / 1000)).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it('caps the pot, so a tall plant is not planted in a tall pot', () => {
    for (const dim of plants()) {
      const g = plantForm(dim);
      expect(g.pot.h).toBeLessThanOrEqual(PLANT_POT_H + 1e-9);
      expect(g.pot.top).toBeLessThanOrEqual(PLANT_POT_R + 1e-9);
    }
    // The cap is live somewhere in the band, or it is a proportion in disguise.
    expect(plantForm([band.max[0], band.max[1], band.max[2]]).pot.h).toBeCloseTo(PLANT_POT_H, 9);
  });

  it("has one green in the renderer's palette per tone", () => {
    // `tone` is an index into `LEAF_TONES` in the renderer, which this file cannot import.
    // One colour short and a leaf's colour is undefined, which three draws as white.
    const src = readFileSync(join(process.cwd(), 'components', 'three', 'DynamicPart.tsx'), 'utf8');
    const row = src.match(/const LEAF_TONES = \[([^\]]*)\]/);
    expect(row, 'LEAF_TONES not found').not.toBeNull();
    expect(row![1].match(/#[0-9a-fA-F]{6}/g)?.length).toBe(PLANT_LEAF_TONES);
  });

  it('gives every leaf a tone the scene has, and uses them all', () => {
    const used = new Set<number>();
    for (const dim of plants()) for (const l of plantForm(dim).leaves) {
      expect(Number.isInteger(l.tone)).toBe(true);
      expect(l.tone).toBeGreaterThanOrEqual(0);
      expect(l.tone).toBeLessThan(PLANT_LEAF_TONES);
      used.add(l.tone);
    }
    expect(used.size).toBe(PLANT_LEAF_TONES);
  });

  it('stays finite for a size no field allows', () => {
    // A zero side is outside the band, but a scene file or a stale override can still
    // hand one in before it is clamped. A zero divides the ellipse test by zero.
    for (const dim of [[0, 400, 1600], [400, 0, 1600], [400, 400, 0], [0, 0, 0], [NaN, 400, 1600], [1e9, 1e9, 1e9]] as V3[]) {
      const g = plantForm(dim);
      expect(g.leaves.length, tag(dim)).toBeLessThanOrEqual(PLANT_MAX_LEAVES);
      const nums = [
        g.pot.top, g.pot.bottom, g.pot.h, ...g.pot.stretch, g.habit,
        ...g.leaves.flatMap((l) => [...l.pos, ...l.size, ...l.rot]),
        ...g.stems.flatMap((s) => [...s.pos, ...s.size, ...s.rot]),
      ];
      for (const v of nums) expect(Number.isFinite(v), tag(dim)).toBe(true);
    }
  });
});
