import { describe, expect, it } from 'vitest';
import {
  PLANT_LEAF_TONES, PLANT_MAX_LEAVES, PLANT_POT_H, PLANT_POT_R, PART_LIBRARY, isParametric, plantForm, plantLeafRadii,
  type PlantLeaf,
} from '@/lib/scene-spec';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dimRangeFor } from '@/lib/dimension-ranges';

// "The plant model looks squeezed." `PlantGeo` drew one fixed 880 × 700 × 1940 plant and
// `FitToDim` stretched it into the catalogue's 400 × 400 × 1600 per axis — ×0.45 wide and
// ×0.82 tall — so every leaf ball was a tall oval and the pot a tube. The size was right,
// which is why `tests/footprint-fidelity.test.tsx` stayed green: it measures extents, and a
// squashed sphere has the right extents. This file measures the SHAPE.

const band = dimRangeFor('plant', 'plant');
const lib = PART_LIBRARY.find((i) => i.shape === 'plant')!.dimMM;

/** Every legal plant on a 5-step grid per axis, plus the catalogue one: 126 plants. */
function plants(): Array<[number, number, number]> {
  const at = (i: 0 | 1 | 2, k: number) => Math.round(band.min[i] + ((band.max[i] - band.min[i]) * k) / 4);
  const out: Array<[number, number, number]> = [lib];
  for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) for (let c = 0; c <= 4; c++) out.push([at(0, a), at(1, b), at(2, c)]);
  return out;
}

/** A leaf's radius on each axis, metres. */
const radii = (l: PlantLeaf) => l.squash.map((k) => k * l.r) as [number, number, number];

/** How far a leaf reaches from its centre along unit direction `u`. */
const reach = (l: PlantLeaf, u: number[]) => {
  const [rx, ry, rz] = radii(l);
  return 1 / Math.hypot(u[0] / rx, u[1] / ry, u[2] / rz);
};

/** Shapes a person would actually give a plant: nothing more lopsided than 2 : 1 in
 *  plan, a head no flatter than its pot. The catalogue plant is the first. */
const ORDINARY: Array<[number, number, number]> = [
  lib, [300, 300, 600], [600, 600, 1200], [800, 700, 1800], [250, 250, 450],
  [1000, 900, 2000], [500, 300, 900], [1200, 1200, 2600], [150, 150, 400],
];

/** The drawn plant's bounds, metres: pot, stem and every leaf. */
function bounds(dim: [number, number, number]) {
  const g = plantForm(dim);
  let x0 = -g.pot.top, x1 = g.pot.top, z0 = -g.pot.top, z1 = g.pot.top, y1 = g.pot.h;
  for (const l of g.leaves) {
    const [rx, ry, rz] = radii(l);
    x0 = Math.min(x0, l.p[0] - rx); x1 = Math.max(x1, l.p[0] + rx);
    z0 = Math.min(z0, l.p[2] - rz); z1 = Math.max(z1, l.p[2] + rz);
    y1 = Math.max(y1, l.p[1] + ry);
  }
  return { x0, x1, z0, z1, y1 };
}

describe('a plant drawn at its own size', () => {
  it('is parametric, so a resize redraws it rather than stretching it', () => {
    // The whole fix. A non-parametric shape is drawn once and a resize arrives as a
    // per-axis group scale in `Draggable`, which squashes a sphere however it was drawn.
    expect(isParametric('plant')).toBe(true);
  });

  it('fills exactly the box it declares, at every legal size', () => {
    for (const dim of plants()) {
      const b = bounds(dim);
      const tag = dim.join('×');
      expect(b.x1 - b.x0, `${tag} width`).toBeCloseTo(dim[0] / 1000, 9);
      expect(b.z1 - b.z0, `${tag} depth`).toBeCloseTo(dim[1] / 1000, 9);
      expect(b.y1, `${tag} height`).toBeCloseTo(dim[2] / 1000, 9);
      expect(b.x0, `${tag} centred`).toBeCloseTo(-b.x1, 9);
      expect(b.z0, `${tag} centred`).toBeCloseTo(-b.z1, 9);
    }
  });

  it('keeps every leaf round at every ordinary plant shape', () => {
    // The complaint itself, asserted on the thing that was wrong: the leaf balls.
    for (const dim of ORDINARY) {
      for (const l of plantForm(dim).leaves) expect(l.squash, `${dim.join('×')} leaf`).toEqual([1, 1, 1]);
    }
  });

  it('presses a leaf flat only where the box is too thin for a round one, never past it', () => {
    let pressed = 0;
    for (const dim of plants()) {
      const g = plantForm(dim);
      for (const l of g.leaves) {
        const [rx, ry, rz] = radii(l);
        expect(rx, `${dim.join('×')} leaf fits the width`).toBeLessThanOrEqual(dim[0] / 2000 + 1e-9);
        expect(rz, `${dim.join('×')} leaf fits the depth`).toBeLessThanOrEqual(dim[1] / 2000 + 1e-9);
        expect(l.p[1] - ry, `${dim.join('×')} leaf below the soil`).toBeGreaterThanOrEqual(g.pot.h - 1e-9);
        // Squashed on one axis at most by the head's own proportions, never stretched.
        for (const k of l.squash) { expect(k).toBeGreaterThan(0); expect(k).toBeLessThanOrEqual(1); }
        if (l.squash.some((k) => k < 1)) pressed++;
      }
    }
    // The band does reach sizes a round ball cannot fill, so this branch is live.
    expect(pressed, 'no legal size needs a pressed leaf, so the floor is dead').toBeGreaterThan(0);
  });

  it('draws a bounded number of leaves, however lopsided the box', () => {
    // A slab of plant 100 mm deep and 1.2 m long needed 2,268 round balls in one draft of
    // this, each its own mesh. The floor on the ball size is what holds this.
    let worst = 0;
    for (const dim of plants()) worst = Math.max(worst, plantForm(dim).leaves.length);
    expect(worst).toBeLessThanOrEqual(60);
  });

  it('stands in a pot that reads as a pot at the catalogue size', () => {
    // What the squeeze did to it: 0.42 × 0.45 = 190 mm across in a 400 mm box and 297 mm
    // tall — a tube. Measured as its own proportion, height over rim diameter.
    const g = plantForm(lib);
    const across = g.pot.top * 2;
    expect(g.pot.h / across, 'pot height over rim width').toBeLessThan(1.25);
    expect(g.pot.h / across).toBeGreaterThan(0.8);
    expect(g.pot.bottom).toBeLessThan(g.pot.top);
    // And the crown is the plant: most of the height is leaves and stem, not pot.
    expect(g.pot.h / (lib[2] / 1000)).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it('caps the pot, so a tall plant is not planted in a tall pot', () => {
    for (const dim of plants()) {
      const g = plantForm(dim);
      expect(g.pot.h).toBeLessThanOrEqual(PLANT_POT_H + 1e-9);
      expect(g.pot.top).toBeLessThanOrEqual(PLANT_POT_R + 1e-9);
      expect(g.pot.top, 'the pot sits inside the box').toBeLessThanOrEqual(Math.min(dim[0], dim[1]) / 2000);
    }
    // The cap is live somewhere in the band, or it is a proportion in disguise.
    const tallest = plantForm([band.max[0], band.max[1], band.max[2]]);
    expect(tallest.pot.h).toBeCloseTo(PLANT_POT_H, 9);
  });

  it('joins the stem to the pot and runs it up into the crown', () => {
    for (const dim of plants()) {
      const g = plantForm(dim);
      expect(g.stem.y0).toBeCloseTo(g.pot.h, 9);
      const lowest = Math.min(...g.leaves.map((l) => l.p[1]));
      expect(g.stem.y1, `${dim.join('×')} stem reaches the lowest leaves`).toBeGreaterThanOrEqual(lowest - 1e-9);
      expect(g.stem.y1).toBeGreaterThan(g.stem.y0);
    }
  });

  it('is one head of foliage, not loose balls: every leaf touches the rest', () => {
    // Connectivity over overlap, from the core outward. A leaf that touches nothing is a
    // green ball floating beside the plant, which is what a spacing bug looks like first.
    // The two extra sizes sit just inside the round regime (2.18 : 1 against
    // `PLANT_HEAD_ASPECT`'s 2.2), where a tip capped to the ellipse's curvature stood
    // clear of the head until the chain joined it. The 5-step grid never lands there.
    for (const dim of [...plants(), [467, 1017, 2600], [1017, 467, 2600]] as Array<[number, number, number]>) {
      const g = plantForm(dim);
      const L = g.leaves;
      const seen = new Set([0]);
      const queue = [0];
      while (queue.length) {
        const i = queue.pop()!;
        for (let j = 0; j < L.length; j++) {
          if (seen.has(j)) continue;
          const v = [L[j].p[0] - L[i].p[0], L[j].p[1] - L[i].p[1], L[j].p[2] - L[i].p[2]];
          const gap = Math.hypot(v[0], v[1], v[2]);
          const u = gap > 0 ? v.map((x) => x / gap) : [1, 0, 0];
          // Sufficient, not necessary: the two meet somewhere on the line between them.
          if (gap < reach(L[i], u) + reach(L[j], u)) { seen.add(j); queue.push(j); }
        }
      }
      expect(seen.size, `${dim.join('×')}: leaves not joined to the head`).toBe(L.length);
    }
  });

  it('shows no daylight through the head, from the front, the side or above', () => {
    // Joined is not the same as solid: a ring of touching balls is joined and you can see
    // straight through the middle of it. So this looks the way a person does — a line of
    // sight through the head — rather than asking whether every point inside it is leaf,
    // which fails on hollows nobody can see. Sight lines fill the middle 70% of the
    // head's silhouette on each of the three views: out past that is the scalloped edge
    // between two outer balls, which is what foliage looks like (at 80% the catalogue
    // plant has one such notch, 144 mm off-centre on the front view).
    const hits = (l: PlantLeaf, o: number[], dir: number[]) => {
      // The leaf as a unit sphere: scale the ray into its frame and solve the quadratic.
      const r = radii(l);
      const po = [0, 1, 2].map((i) => (o[i] - l.p[i]) / r[i]);
      const pd = [0, 1, 2].map((i) => dir[i] / r[i]);
      const A = pd[0] ** 2 + pd[1] ** 2 + pd[2] ** 2;
      const B = 2 * (po[0] * pd[0] + po[1] * pd[1] + po[2] * pd[2]);
      const C = po[0] ** 2 + po[1] ** 2 + po[2] ** 2 - 1;
      return B * B - 4 * A * C >= 0;
    };
    for (const dim of ORDINARY) {
      const g = plantForm(dim);
      const lo = Math.min(...g.leaves.map((l) => l.p[1] - radii(l)[1]));
      const half = [dim[0] / 2000, (dim[2] / 1000 - lo) / 2, dim[1] / 2000];
      const mid = [0, dim[2] / 1000 - half[1], 0];
      let open = 0;
      let rays = 0;
      for (const axis of [0, 1, 2]) {
        const [s1, s2] = [0, 1, 2].filter((i) => i !== axis);
        for (let i = -10; i <= 10; i++) {
          for (let j = -10; j <= 10; j++) {
            const u = (i / 10) * 0.7, v = (j / 10) * 0.7;
            if (u * u + v * v > 0.49) continue;
            const o = [...mid];
            o[s1] += u * half[s1];
            o[s2] += v * half[s2];
            const dir = [0, 0, 0];
            dir[axis] = 1;
            rays++;
            if (!g.leaves.some((l) => hits(l, o, dir))) open++;
          }
        }
      }
      expect(rays).toBeGreaterThan(400);
      expect(open, `${dim.join('×')}: sight lines straight through the head`).toBe(0);
    }
  });

  it('keeps the head to the top of the plant, so it shows a trunk', () => {
    // The original's character: a stem out of the pot and a leafy head, not a column of
    // leaves from the soil up. At the catalogue size the trunk is a real length.
    const g = plantForm(lib);
    const lowest = Math.min(...g.leaves.map((l) => l.p[1] - l.r));
    expect(lowest - g.pot.h, 'bare trunk above the soil, m').toBeGreaterThan(0.3);
    expect(g.leaves.length, 'a head, not a single ball').toBeGreaterThan(8);
  });

  it('stays inside the ellipse the plan draws, not merely its box', () => {
    // `plant` is a round shape: the plan, collision and clearance all see the w × d
    // ELLIPSE. The head filled the box, so at 600 × 300 a tip leaf stood 14.5 mm past
    // the outline and at 300 × 1200 × 2000 one stood 94 mm past it: foliage through a
    // wall the plan swore was clear. Every leaf's widest section is checked here.
    let checked = 0;
    for (const dim of plants()) {
      const A = dim[0] / 2000, E = dim[1] / 2000;
      for (const l of plantForm(dim).leaves) {
        const [rx, , rz] = radii(l);
        for (let k = 0; k < 48; k++) {
          const t = (k / 48) * Math.PI * 2;
          const x = l.p[0] + rx * Math.cos(t), z = l.p[2] + rz * Math.sin(t);
          expect((x / A) ** 2 + (z / E) ** 2, `${dim.join('×')} leaf past the outline`).toBeLessThanOrEqual(1 + 1e-6);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('draws each leaf from the radii the scene uses', () => {
    // One sphere scaled per leaf, so the arithmetic that sizes it is here and not in TSX.
    for (const l of plantForm(lib).leaves) expect(plantLeafRadii(l)).toEqual(radii(l));
  });

  it("has one green in the renderer's palette per tone", () => {
    // `tone` is an index into `LEAF_TONES` in the renderer, which this file cannot import.
    // One colour short and a leaf's colour is undefined, which three draws as white.
    const src = readFileSync(join(process.cwd(), 'components', 'three', 'DynamicPart.tsx'), 'utf8');
    const row = src.match(/const LEAF_TONES = \[([^\]]*)\]/);
    expect(row, 'LEAF_TONES not found').not.toBeNull();
    expect(row![1].match(/#[0-9a-fA-F]{6}/g)?.length).toBe(PLANT_LEAF_TONES);
  });

  it('gives every leaf a tone the scene has', () => {
    for (const dim of plants()) for (const l of plantForm(dim).leaves) {
      expect(l.tone).toBeGreaterThanOrEqual(0);
      expect(l.tone).toBeLessThan(PLANT_LEAF_TONES);
    }
  });

  it('stays finite for a size no field allows', () => {
    // A zero side is outside the band, but a scene file or a stale override can still
    // hand one in before it is clamped. The leaf count divided by it and came back
    // Infinity, and the loop that places leaves never ended: a frozen tab.
    for (const dim of [[0, 400, 1600], [400, 0, 1600], [400, 400, 0], [0, 0, 0], [1e9, 1e9, 1e9]] as Array<[number, number, number]>) {
      const g = plantForm(dim);
      expect(g.leaves.length, dim.join('×')).toBeLessThanOrEqual(PLANT_MAX_LEAVES);
      for (const l of g.leaves) for (const v of [...l.p, l.r]) expect(Number.isFinite(v), dim.join('×')).toBe(true);
    }
  });
});
