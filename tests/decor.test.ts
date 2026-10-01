import { describe, it, expect } from 'vitest';
import {
  arrangeDecor,
  decorBlockersBySurface,
  decorRadius,
  decorSpec,
  DECOR_GAP,
  DECOR_PLANT_H,
  DECOR_PLANT_W,
  type DecorBlocker,
} from '@/lib/decor';
import { footCellsLocal } from '@/lib/foot-cells';
import { worldToLocal } from '@/lib/geometry';
import { autoSurfaceDecor, DECOR_KINDS, PART_LIBRARY, supportsDecor, type DecorItem, type ScenePart } from '@/lib/scene-spec';

// Props on a surface used to be placed with no size and drawn at a size the renderer
// rolled for itself, so nothing could keep them apart: a bedside lamp went straight
// through the plant beside it. These pin the size to one place and the layout to it.

const item = (id: string, kind: DecorItem['kind'], x = 0, z = 0): DecorItem => ({ id, kind, x, z });
const radius = (it: DecorItem) => decorRadius(decorSpec(it));
const NIGHTSTAND = { shape: 'nightstand' } as const;

function part(p: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { name: p.id, rot: 0, locked: false, ...p } as ScenePart;
}

/** No two placed props within their radii plus the gap, and none over a blocker. */
function assertClear(placed: DecorItem[], blockers: DecorBlocker[], label = '') {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      expect(Math.hypot(a.x - b.x, a.z - b.z), `${label} ${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(radius(a) + radius(b) + DECOR_GAP - 1e-9);
    }
    for (const bl of blockers) {
      const [lx, lz] = worldToLocal(bl.rot, placed[i].x - bl.cx, placed[i].z - bl.cz);
      const gap = Math.hypot(Math.max(0, Math.abs(lx) - bl.hw), Math.max(0, Math.abs(lz) - bl.hd));
      expect(gap, `${label} ${placed[i].id} over a blocker`).toBeGreaterThanOrEqual(radius(placed[i]) + DECOR_GAP - 1e-9);
    }
  }
}

/** Whether the prop's circle keeps off the L-shaped desk's open corner — worked out
 *  here from the cells rather than read from `lib/decor.ts`'s own hole. */
function clearOfHole(p: DecorItem, shape: ScenePart['shape'], w: number, d: number): boolean {
  const cells = footCellsLocal(shape, w, d);
  if (!cells) return true;
  const [arm, ret] = cells;
  const hole = { x0: -w / 2, x1: ret.x0, z0: arm.z1, z1: d / 2 };
  const r = radius(p);
  const ox = Math.max(0, hole.x0 - p.x, p.x - hole.x1);
  const oz = Math.max(0, hole.z0 - p.z, p.z - hole.z1);
  return Math.hypot(ox, oz) >= r + DECOR_GAP - 1e-9;
}

describe('what a prop is', () => {
  it('is the same prop every time it is asked', () => {
    for (const kind of DECOR_KINDS) expect(decorSpec(item('a-d0', kind))).toEqual(decorSpec(item('a-d0', kind)));
  });

  it('is a tabletop plant, not a scaled-down bush', () => {
    for (let i = 0; i < 40; i++) {
      const s = decorSpec(item(`p${i}`, 'plant'));
      if (s.kind !== 'plant') throw new Error('not a plant');
      expect(s.w).toBeGreaterThanOrEqual(DECOR_PLANT_W[0]);
      expect(s.w).toBeLessThanOrEqual(DECOR_PLANT_W[1]);
      expect(s.h).toBeGreaterThanOrEqual(DECOR_PLANT_H[0]);
      expect(s.h).toBeLessThanOrEqual(DECOR_PLANT_H[1]);
      // Taller than it is wide, which is what makes `plantForm` draw leaves on stems.
      expect(s.h / s.w).toBeGreaterThan(1);
    }
  });

  it('has a radius that holds every book of a stack', () => {
    for (let i = 0; i < 40; i++) {
      const s = decorSpec(item(`b${i}`, 'books'));
      if (s.kind !== 'books') throw new Error('not books');
      const r = decorRadius(s);
      for (const b of s.books) {
        // Every corner of every book, turned by its own yaw, about the stack's centre.
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const cx = (sx * b.w) / 2;
          const cz = (sz * b.d) / 2;
          const x = b.dx + cx * Math.cos(b.yaw) + cz * Math.sin(b.yaw);
          const z = -cx * Math.sin(b.yaw) + cz * Math.cos(b.yaw);
          expect(Math.hypot(x, z)).toBeLessThanOrEqual(r + 1e-12);
        }
      }
    }
  });
});

describe('where a prop goes', () => {
  it('keeps its own spot when that spot is clear', () => {
    const it0 = item('k', 'candle', 0.05, -0.03);
    const out = arrangeDecor([it0], NIGHTSTAND, 0.45, 0.4, []);
    expect(out.placed).toEqual([it0]);
    // The very object, not a copy: nothing downstream sees a change it did not make.
    expect(out.placed[0]).toBe(it0);
    expect(out.unplaced).toEqual([]);
  });

  it('parts two props handed the same spot, and the first keeps it', () => {
    const a = item('same-a', 'vase');
    const b = item('same-b', 'bowl');
    const { placed, unplaced } = arrangeDecor([a, b], { shape: 'coffee-table' }, 1.1, 0.6, []);
    expect(unplaced).toEqual([]);
    expect(placed[0]).toBe(a);
    assertClear(placed, []);
    // …and the second went only as far as it had to: within one lattice step of touching.
    const dist = Math.hypot(placed[1].x, placed[1].z);
    expect(dist).toBeLessThan(radius(a) + radius(b) + DECOR_GAP + 0.02 * Math.SQRT2);
  });

  it('steps aside for a lamp standing where it would have gone', () => {
    // The report: a nightstand with its lamp in the middle and a plant on top of it.
    const lamp: DecorBlocker = { cx: 0, cz: 0, hw: 0.125, hd: 0.125, rot: 0 };
    const plant = item('ns-d0', 'plant', 0, 0);
    const { placed, unplaced } = arrangeDecor([plant], NIGHTSTAND, 0.45, 0.4, [lamp]);
    // A 450 mm top less a 250 mm lamp leaves 100 mm a side; a 160–220 mm plant does
    // not fit beside it, and is said rather than pushed through the lamp.
    expect(placed).toEqual([]);
    expect(unplaced).toEqual(['ns-d0']);
  });

  it('finds the free side when there is one', () => {
    // A 250 mm lamp pushed to the back-left of a 1.1 m console.
    const lamp: DecorBlocker = { cx: -0.4, cz: 0, hw: 0.125, hd: 0.125, rot: 0 };
    const vase = item('v', 'vase', -0.4, 0);
    const { placed, unplaced } = arrangeDecor([vase], { shape: 'coffee-table' }, 1.1, 0.35, [lamp]);
    expect(unplaced).toEqual([]);
    assertClear(placed, [lamp]);
    // It went to the lamp's right, the nearest open side, not across the table.
    expect(placed[0].x).toBeGreaterThan(-0.4 + 0.125);
    expect(placed[0].x).toBeLessThan(-0.4 + 0.125 + radius(vase) + DECOR_GAP + 0.03);
  });

  it('respects a blocker turned against the surface', () => {
    // Long and thin, turned an eighth: its long axis runs along world (1, −1).
    const lamp: DecorBlocker = { cx: 0, cz: 0, hw: 0.3, hd: 0.05, rot: Math.PI / 4 };
    // On that axis — inside the turned box, and well clear of the unturned one.
    const c = item('c', 'candle', 0.15, -0.15);
    const { placed } = arrangeDecor([c], { shape: 'coffee-table' }, 1.1, 0.6, [lamp]);
    expect(placed[0]).not.toBe(c);
    assertClear(placed, [lamp]);
  });

  it('takes the nearest clear spot on the lattice, not the first one found', () => {
    // Worked out the slow way: every lattice point the search could have tried.
    const STEP = 0.02;
    const [w, d] = [1.1, 0.6];
    let checked = 0;
    for (const rot of [0, Math.PI / 8, Math.PI / 4, Math.PI / 3]) {
      for (const [hw, hd] of [[0.2, 0.2], [0.3, 0.06], [0.12, 0.25]]) {
        for (const [x, z] of [[0, 0], [0.03, 0.01], [-0.05, 0.04], [0.07, -0.02]]) {
          const lamp: DecorBlocker = { cx: 0, cz: 0, hw, hd, rot };
          const v = item('near', 'bowl', x, z);
          const r = radius(v);
          const [bx, bz] = [w / 2 - r, d / 2 - r];
          let best = Infinity;
          for (let i = -80; i <= 80; i++) {
            for (let j = -80; j <= 80; j++) {
              const px = x + i * STEP;
              const pz = z + j * STEP;
              if (Math.abs(px) > bx + 1e-9 || Math.abs(pz) > bz + 1e-9) continue;
              const [lx, lz] = worldToLocal(rot, px, pz);
              if (Math.hypot(Math.max(0, Math.abs(lx) - hw), Math.max(0, Math.abs(lz) - hd)) < r + DECOR_GAP) continue;
              best = Math.min(best, Math.hypot(px - x, pz - z));
            }
          }
          const { placed } = arrangeDecor([v], { shape: 'coffee-table' }, w, d, [lamp]);
          expect(Math.hypot(placed[0].x - x, placed[0].z - z), `rot ${rot} box ${hw}×${hd} from ${x},${z}`).toBeCloseTo(best, 9);
          checked++;
        }
      }
    }
    expect(checked).toBe(48);
  });

  it('is clamped onto the surface rather than hung off its edge', () => {
    const books = item('ns-books', 'books', 0.2, 0.2);
    const r = radius(books);
    const { placed } = arrangeDecor([books], NIGHTSTAND, 0.45, 0.4, []);
    expect(placed[0].x).toBeCloseTo(0.225 - r, 12);
    expect(placed[0].z).toBeCloseTo(0.2 - r, 12);
  });

  it('reports what does not fit, in order, and never shrinks it', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item(id, 'bowl'));
    const { placed, unplaced } = arrangeDecor(items, NIGHTSTAND, 0.45, 0.4, []);
    expect(placed.length + unplaced.length).toBe(6);
    expect(unplaced.length).toBeGreaterThan(0);
    assertClear(placed, []);
    // Earlier props win: a later one never moves them. Every prefix lays out exactly
    // as the whole list does, as far as it goes.
    for (let n = 1; n < items.length; n++) {
      const prefix = arrangeDecor(items.slice(0, n), NIGHTSTAND, 0.45, 0.4, []).placed;
      expect(placed.slice(0, prefix.length)).toEqual(prefix);
    }
  });

  it('keeps off the open corner of an L-shaped desk', () => {
    const [w, d] = [1.6, 1.4];
    // At rot 0 the open corner is front-left; aim a vase at the middle of it.
    const v = item('ell', 'vase', -0.35, 0.35);
    const { placed } = arrangeDecor([v], { shape: 'desk-l' }, w, d, []);
    expect(clearOfHole(placed[0], 'desk-l', w, d)).toBe(true);
    expect(clearOfHole(v, 'desk-l', w, d)).toBe(false);
    // …which the same spot on a plain desk would not have needed.
    expect(arrangeDecor([v], { shape: 'desk-standard' }, w, d, []).placed[0]).toBe(v);
  });
});

describe('what stands in a prop’s way', () => {
  const ns = part({ id: 'ns', category: 'nightstand', shape: 'nightstand', pos: [1, 0, 1], dimMM: [450, 400, 550] });
  const lampOn = (pos: [number, number, number], rot = 0) =>
    part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos, rot, dimMM: [250, 250, 500] });

  it('is the lamp standing on the nightstand, in the nightstand’s own frame', () => {
    const out = decorBlockersBySurface([ns, lampOn([1.1, 0.55, 0.95])]);
    expect(Object.keys(out)).toEqual(['ns']);
    expect(out.ns).toHaveLength(1);
    const [b] = out.ns;
    expect(b.cx).toBeCloseTo(0.1, 12);
    expect(b.cz).toBeCloseTo(-0.05, 12);
    expect([b.hw, b.hd]).toEqual([0.125, 0.125]);
    expect(b.rot).toBeCloseTo(0, 12);
  });

  it('turns with the nightstand', () => {
    // The nightstand a quarter turn round; the lamp 100 mm to its world east. In the
    // nightstand's frame, east is the piece's −z (three.js: local +x is (cos r, −sin r)).
    const turned = { ...ns, rot: Math.PI / 2 };
    const out = decorBlockersBySurface([turned, lampOn([1.1, 0.55, 1], Math.PI / 2)]);
    const [b] = out.ns;
    const [lx, lz] = worldToLocal(Math.PI / 2, 0.1, 0);
    expect(b.cx).toBeCloseTo(lx, 12);
    expect(b.cz).toBeCloseTo(lz, 12);
    expect(b.rot).toBeCloseTo(0, 12);
  });

  it('is not a bed that merely touches it', () => {
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [1 + 0.225 + 0.7, 0, 1], dimMM: [1400, 2000, 600] });
    expect(decorBlockersBySurface([ns, bed])).toEqual({});
  });

  it('is not a floor lamp beside it, nor the rug under it', () => {
    const floorLamp = part({ id: 'fl', category: 'lamp', shape: 'lamp-floor', pos: [1 + 0.225 + 0.15, 0, 1], dimMM: [300, 300, 1700] });
    const rug = part({ id: 'rug', category: 'rug', shape: 'rug', pos: [1, 0, 1], dimMM: [2400, 1600, 5] });
    expect(decorBlockersBySurface([ns, floorLamp, rug])).toEqual({});
  });

  it('is a piece hanging over the surface low enough to reach the props', () => {
    // A lamp whose base is 300 mm above the top is in the band; one 400 mm up is not.
    expect(decorBlockersBySurface([ns, lampOn([1, 0.85, 1])]).ns).toHaveLength(1);
    expect(decorBlockersBySurface([ns, lampOn([1, 0.95, 1])])).toEqual({});
  });

  it('clears the props of the report’s lamp', () => {
    const lamp = lampOn([1, 0.55, 1]);
    const blockers = decorBlockersBySurface([ns, lamp]).ns;
    const items = autoSurfaceDecor(ns.category, ns.shape, ns.dimMM, ns.id);
    const { placed } = arrangeDecor(items, ns, 0.45, 0.4, blockers);
    assertClear(placed, blockers, 'nightstand');
  });
});

describe('every surface in the Library', () => {
  const surfaces = PART_LIBRARY.filter((i) => supportsDecor(i.category, i.shape));

  it('covers the surfaces it claims to', () => {
    // A literal, so a surface that stops carrying props is a decision someone made.
    expect(surfaces.length).toBe(SURFACE_COUNT);
  });

  it('arranges its auto decor clear of itself and on the surface', () => {
    let props = 0;
    for (const s of surfaces) {
      for (let seed = 0; seed < 25; seed++) {
        const id = `${s.shape}-${seed}`;
        const items = autoSurfaceDecor(s.category, s.shape, s.dimMM, id);
        const [w, d] = [s.dimMM[0] / 1000, s.dimMM[1] / 1000];
        const { placed, unplaced } = arrangeDecor(items, s, w, d, []);
        expect(placed.length + unplaced.length, id).toBe(items.length);
        props += placed.length;
        assertClear(placed, [], id);
        for (const p of placed) {
          const r = radius(p);
          // Wider than the surface: centred on that axis, keeping its size.
          const inX = 2 * r > w ? Math.abs(p.x) < 1e-9 : Math.abs(p.x) + r <= w / 2 + 1e-9;
          const inZ = 2 * r > d ? Math.abs(p.z) < 1e-9 : Math.abs(p.z) + r <= d / 2 + 1e-9;
          expect(inX && inZ, `${id} ${p.id} off the top`).toBe(true);
          expect(clearOfHole(p, s.shape, w, d), `${id} ${p.id} in the open corner`).toBe(true);
        }
      }
    }
    // The sweep placed something — it is not green because it arranged nothing.
    expect(props).toBeGreaterThan(surfaces.length * 25);
  });
});

// 10 since "Dining / desk table" became a Dining table and a Desk — two rows, one shape.
const SURFACE_COUNT = 10;
