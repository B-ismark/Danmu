// Where a copy goes. Reported 2026-10-01: "duplicating an item should spawn the
// duplicate properly if there's space, it should be next to the main instance, it
// shouldn't spawn inside the main instance". The old seven fixed offsets were sized
// for a chair, so a wardrobe's copy collided at every one of them and fell back to
// `[0, 0]` — the original's own spot.

import { describe, expect, it } from 'vitest';
import { COPY_GAP_M, placeCopies } from '@/lib/duplicate-place';
import { footprintForLayout } from '@/lib/footprint';
import { footFromPart, footOverlap, obbFromPart, obbOverlap, TOUCH_M } from '@/lib/geometry';
import { isSoftFurnishing } from '@/lib/layout-rules';
import { riderRelation } from '@/lib/rider-height';
import { canCollideWith, defaultScene, PART_LIBRARY, placeNewPart, type ScenePart } from '@/lib/scene-spec';

const W = 6;
const H = 2.5;
const fp = footprintForLayout('rect', W, W);

function part(over: Partial<ScenePart> & { id: string }): ScenePart {
  return { category: 'other', name: over.id, shape: 'box', pos: [0, 0, 0], rot: 0, dimMM: [1000, 600, 800], locked: false, ...over };
}

/** The two footprints overlap, by box — the question "is the copy inside the
 *  original", which `collidesAt` cannot answer for a rug or a curtain (soft
 *  furnishings never collide) and so is asked of the geometry directly. */
type At = { pos: [number, number, number]; rot: number };
function overlaps(a: At, b: At, dimA: [number, number, number], dimB = dimA) {
  return obbOverlap(obbFromPart(a.pos, a.rot, dimA), obbFromPart(b.pos, b.rot, dimB), -0.001);
}

const wardrobe = part({ id: 'wardrobe', category: 'wardrobe', shape: 'wardrobe', dimMM: [1000, 600, 2000] });

describe('a copy goes beside the original', () => {
  it('a wardrobe wider than every old offset lands beside itself, not in itself', () => {
    const { spots, clear } = placeCopies([wardrobe], [wardrobe], fp, H);
    expect(clear).toBe(true);
    // Along its own width, one width and the gap over: the first candidate.
    expect(spots[0].pos[0]).toBeCloseTo(1 + COPY_GAP_M, 6);
    expect(spots[0].pos[2]).toBeCloseTo(0, 6);
    expect(spots[0].pos[1]).toBe(0);
    expect(overlaps(spots[0], wardrobe, wardrobe.dimMM)).toBe(false);
  });

  it("'beside' is along the piece's own width, whichever way it faces", () => {
    const turned = { ...wardrobe, rot: Math.PI / 2 };
    const { spots } = placeCopies([turned], [turned], fp, H);
    // Local +x at a quarter turn is world −z.
    expect(spots[0].pos[0]).toBeCloseTo(0, 6);
    expect(spots[0].pos[2]).toBeCloseTo(-(1 + COPY_GAP_M), 6);
    expect(spots[0].rot).toBeCloseTo(Math.PI / 2, 9);
  });

  it('with a wall on one side, it goes to the other', () => {
    // 2.45 + 1.05 = 3.5: the right-hand spot is through the east wall, and the clamp
    // carries it back onto the original. The left-hand spot is clear.
    const atWall = { ...wardrobe, pos: [2.45, 0, 0] as [number, number, number] };
    const { spots, clear } = placeCopies([atWall], [atWall], fp, H);
    expect(clear).toBe(true);
    expect(spots[0].pos[0]).toBeCloseTo(2.45 - 1 - COPY_GAP_M, 6);
  });

  it('a neighbour in the way on the near side sends it to the far side', () => {
    const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', pos: [1.6, 0, 0], dimMM: [1800, 850, 800] });
    const { spots, clear } = placeCopies([wardrobe], [wardrobe, sofa], fp, H);
    expect(clear).toBe(true);
    expect(spots[0].pos[0]).toBeCloseTo(-(1 + COPY_GAP_M), 6);
  });

  it('a print stays on its wall, beside itself, at its height', () => {
    // Where `snapToWall` hangs a 30 mm print: half its depth and the 20 mm gap off the plaster.
    const z = -W / 2 + 0.015 + 0.02;
    const print = part({ id: 'print', category: 'painting', shape: 'painting', pos: [0, 1.75, z], dimMM: [600, 30, 400], wallMounted: true });
    const { spots, clear } = placeCopies([print], [print], fp, H);
    expect(clear).toBe(true);
    expect(spots[0].pos[0]).toBeCloseTo(0.6 + COPY_GAP_M, 6);
    // Not the canonical hanging height: the height THIS print was hung at.
    expect(spots[0].pos[1]).toBeCloseTo(1.75, 6);
    expect(spots[0].pos[2]).toBeCloseTo(z, 6);
    expect(spots[0].rot).toBeCloseTo(0, 9);
  });

  it('a lamp copied off a desk stays on the desk', () => {
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', pos: [0, 0, 0], dimMM: [1600, 700, 750] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-0.5, 0.75, 0], dimMM: [300, 300, 500] });
    const { spots, clear } = placeCopies([lamp], [desk, lamp], fp, H, { lamp: 'desk' });
    expect(clear).toBe(true);
    expect(spots[0].pos[0]).toBeCloseTo(-0.5 + 0.3 + COPY_GAP_M, 6);
    expect(spots[0].pos[1]).toBeCloseTo(0.75, 6);
  });

  it('…and still prefers the desk when the side it would try first is off the end', () => {
    // Right: x = 0.75 + 0.35 = 1.1, past the desk's end at 0.8 — the floor. Left stays on.
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', pos: [0, 0, 0], dimMM: [1600, 700, 750] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [0.65, 0.75, 0], dimMM: [300, 300, 500] });
    const { spots } = placeCopies([lamp], [desk, lamp], fp, H, { lamp: 'desk' });
    expect(spots[0].pos[1]).toBeCloseTo(0.75, 6);
    expect(spots[0].pos[0]).toBeCloseTo(0.65 - 0.3 - COPY_GAP_M, 6);
  });

  it('a set is copied as a set: one offset, the formation kept', () => {
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [0, 0, -1], dimMM: [1600, 2000, 500] });
    const nl = part({ id: 'nl', category: 'nightstand', shape: 'nightstand', pos: [-1.1, 0, -1.7], dimMM: [450, 400, 550] });
    const nr = part({ id: 'nr', category: 'nightstand', shape: 'nightstand', pos: [1.1, 0, -1.7], dimMM: [450, 400, 550] });
    const set = [bed, nl, nr];
    const { spots, clear } = placeCopies(set, set, fp, H);
    expect(clear).toBe(true);
    const dx = spots[0].pos[0] - bed.pos[0];
    const dz = spots[0].pos[2] - bed.pos[2];
    expect(Math.hypot(dx, dz)).toBeGreaterThan(0.5);
    set.forEach((s, i) => {
      expect(spots[i].pos[0] - s.pos[0]).toBeCloseTo(dx, 6);
      expect(spots[i].pos[2] - s.pos[2]).toBeCloseTo(dz, 6);
      for (const o of set) expect(overlaps(spots[i], o, s.dimMM, o.dimMM)).toBe(false);
    });
  });

  it("a desk copied with its lamp: the lamp's copy rides the desk's copy", () => {
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', pos: [0, 0, 0], dimMM: [1600, 700, 750] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-0.5, 0.75, 0], dimMM: [300, 300, 500] });
    // Lamp FIRST in the list: the order given is not the order resolved.
    const { spots, clear } = placeCopies([lamp, desk], [desk, lamp], fp, H, { lamp: 'desk' });
    expect(clear).toBe(true);
    expect(spots[1].pos[0]).toBeCloseTo(1.6 + COPY_GAP_M, 6);
    expect(spots[0].pos[0]).toBeCloseTo(-0.5 + 1.6 + COPY_GAP_M, 6);
    expect(spots[0].pos[1]).toBeCloseTo(0.75, 6);
  });

  it('a set with no room to move AS a set copies each piece beside its own original', () => {
    // Two chairs in opposite corners: any offset that moves one off itself carries the
    // other through a wall, and the clamp corrects the two differently — which, kept,
    // bent the set, and the copies stood wherever the clamps left them.
    const a = part({ id: 'a', category: 'chair', shape: 'chair-dining', pos: [-2.5, 0, -2.5], dimMM: [480, 520, 850] });
    const b = part({ id: 'b', category: 'chair', shape: 'chair-dining', pos: [2.5, 0, 2.5], dimMM: [480, 520, 850] });
    const { spots, clear } = placeCopies([a, b], [a, b], fp, H);
    expect(clear).toBe(true);
    [a, b].forEach((s, i) => {
      expect(Math.hypot(spots[i].pos[0] - s.pos[0], spots[i].pos[2] - s.pos[2])).toBeLessThan(0.6);
      expect(spots[i].pos[1]).toBe(0);
      expect(touching(s, spots[i], [a, b])).toEqual([]);
    });
    expect(overlaps(spots[0], spots[1], a.dimMM, b.dimMM)).toBe(false);
  });

  it('a set the clamp would bend is not copied bent', () => {
    // Stepped east by the set's width, the east chair is clamped back 3.8 m short and the
    // west one is not: both clear, both off their originals, and no longer the pair.
    // Behind them is the one step that keeps both where asked, and a cabinet fills it,
    // so the only spots beside the set are bent ones — the second-best tier's to take.
    const a = part({ id: 'a', category: 'chair', shape: 'chair-dining', pos: [2, 0, 0], dimMM: [480, 520, 850] });
    const b = part({ id: 'b', category: 'chair', shape: 'chair-dining', pos: [-2, 0, 1.5], dimMM: [480, 520, 850] });
    const cab = part({ id: 'cab', category: 'other', shape: 'box', pos: [2, 0, -2.2], dimMM: [1000, 600, 800] });
    const { spots, clear } = placeCopies([a, b], [a, b, cab], fp, H);
    expect(clear).toBe(true);
    const dx = spots[0].pos[0] - a.pos[0];
    const dz = spots[0].pos[2] - a.pos[2];
    expect(spots[1].pos[0] - b.pos[0]).toBeCloseTo(dx, 6);
    expect(spots[1].pos[2] - b.pos[2]).toBeCloseTo(dz, 6);
  });

  it('a step clamped back over the original is not a place, even for a rug', () => {
    // A 2.4 × 1.6 m rug in a 6 × 3.4 m room: every step either way is clamped back over
    // the rug itself, and a rug never collides, so only the footprints can say so.
    const narrow = footprintForLayout('rect', W, 3.4);
    const rug = part({ id: 'rug', category: 'rug', shape: 'rug', pos: [-0.5, 0, 0], dimMM: [2400, 1600, 5] });
    const { spots, clear } = placeCopies([rug], [rug], narrow, H);
    expect(clear).toBe(false);
    expect(spots[0].pos[0]).toBeCloseTo(rug.pos[0], 6);
  });

  it('a step the wall shortened loses to a full step the other way', () => {
    // Right lands at 2.53, 30 mm through the plaster: the clamp pulls it back, still
    // clear of the original. Left is exactly where it was asked to be.
    const near = { ...wardrobe, pos: [1.48, 0, 0] as [number, number, number] };
    const { spots, clear } = placeCopies([near], [near], fp, H);
    expect(clear).toBe(true);
    expect(spots[0].pos[0]).toBeCloseTo(1.48 - 1 - COPY_GAP_M, 6);
  });

  it('no clear space: the copy is still made, never inside the original, and says so', () => {
    // A 2.2 × 1.6 m room: the wardrobe against the back wall, a sofa across the front.
    // Either side is clamped back onto the wardrobe, behind is the wall, and in front
    // is the sofa — so the copy goes in front, overlapping the sofa, and says so.
    const small = footprintForLayout('rect', 2.2, 1.6);
    const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', pos: [0, 0, 0.45], dimMM: [2100, 650, 800] });
    const w = { ...wardrobe, pos: [0, 0, -0.5] as [number, number, number] };
    const { spots, clear } = placeCopies([w], [w, sofa], small, H);
    expect(clear).toBe(false);
    expect(overlaps(spots[0], w, w.dimMM)).toBe(false);
  });
});

/** What the copy touches, tuck or no tuck: every piece it could collide with whose
 *  footprint it overlaps. `collidesAt` forgives a chair under its table; this does not. */
function touching(src: ScenePart, at: At, world: ScenePart[]): string[] {
  if (isSoftFurnishing(src)) return [];
  const me = footFromPart(at.pos, at.rot, src.dimMM, src.circle, src.shape);
  const inTheWay = canCollideWith(src, src.dimMM, at.pos[1]);
  return world
    .filter((o) => inTheWay(o) && footOverlap(me, footFromPart(o.pos, o.rot, o.dimMM, o.circle, o.shape), -TOUCH_M))
    .map((o) => o.id);
}

// The user's second look, 2026-10-01: "Duplicated items are offset nicely but it seems
// they don't consider whether they're clipping with an object or not."
describe('a copy touches nothing', () => {
  it("a chair's copy is not tucked under the table beside it", () => {
    // A chair at the table's end, facing it. Its copy beside it, along its width, is
    // under the table's corner — which a DRAG allows, as a tuck. A copy must not.
    const table = part({ id: 'table', category: 'table', shape: 'desk-standard', pos: [0, 0, 0], dimMM: [1600, 900, 750] });
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', pos: [0.4, 0, 0.6], rot: Math.PI, dimMM: [450, 500, 900] });
    const { spots, clear } = placeCopies([chair], [table, chair], fp, H);
    expect(clear).toBe(true);
    expect(touching(chair, spots[0], [table, chair])).toEqual([]);
  });

  it("a nightstand's copy stays on the floor rather than climbing the bed", () => {
    // Against the head wall, beside the bed: its side steps are the bed and the wall's
    // corner, and the resolve's gravity would stand the copy ON the bed.
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [0, 0, -2], dimMM: [1600, 2000, 500] });
    const ns = part({ id: 'ns', category: 'nightstand', shape: 'nightstand', pos: [-1.05, 0, -2.78], dimMM: [450, 400, 550] });
    const { spots, clear } = placeCopies([ns], [bed, ns], fp, H);
    expect(clear).toBe(true);
    expect(spots[0].pos[1]).toBe(0);
    expect(touching(ns, spots[0], [bed, ns])).toEqual([]);
  });

  it("a lamp off a full nightstand goes on the other nightstand, not the bed between", () => {
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [0, 0, -2], dimMM: [1600, 2000, 500] });
    const nl = part({ id: 'nl', category: 'nightstand', shape: 'nightstand', pos: [-1.05, 0, -2.78], dimMM: [450, 400, 550] });
    const nr = part({ id: 'nr', category: 'nightstand', shape: 'nightstand', pos: [1.05, 0, -2.78], dimMM: [450, 400, 550] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-1.05, 0.55, -2.78], dimMM: [250, 250, 500] });
    const world = [bed, nl, nr, lamp];
    const { spots, clear } = placeCopies([lamp], world, fp, H, { lamp: 'nl' });
    expect(clear).toBe(true);
    // On the right-hand nightstand's top, wherever on it the search reached first.
    expect(Math.abs(spots[0].pos[0] - 1.05)).toBeLessThan(0.25);
    expect(spots[0].pos[1]).toBeCloseTo(0.55, 6);
  });

  it('…and with both full, on the floor beside it — never on the bed', () => {
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [0, 0, -2], dimMM: [1600, 2000, 500] });
    const nl = part({ id: 'nl', category: 'nightstand', shape: 'nightstand', pos: [-1.05, 0, -2.78], dimMM: [450, 400, 550] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-1.05, 0.55, -2.78], dimMM: [250, 250, 500] });
    const world = [bed, nl, lamp];
    const { spots, clear } = placeCopies([lamp], world, fp, H, { lamp: 'nl' });
    expect(clear).toBe(true);
    expect(spots[0].pos[1]).toBe(0);
    expect(touching(lamp, spots[0], world)).toEqual([]);
  });

  it('with nothing clear beside it, it goes to the nearest clear spot in the room', () => {
    // The T's sofa: every spot beside it is a lamp, a table or a chair. The first
    // version took the least-bad of those and stood the copy in all three.
    const tfp = footprintForLayout('t', 6, 5);
    const parts = defaultScene('t', 6, 5, { footprint: tfp, height: H });
    const sofa = parts.find((p) => p.category === 'sofa')!;
    const { spots, clear } = placeCopies([sofa], parts, tfp, H);
    expect(clear).toBe(true);
    expect(touching(sofa, spots[0], parts)).toEqual([]);
    expect(overlaps(spots[0], sofa, sofa.dimMM)).toBe(false);
  });
});

// Every piece of every starter room, copied where it stands: none touches anything,
// and every one stands on what its original stands on. Swept rather than sampled,
// because the three defects above were each found in a room nobody had picked.
describe('every starter piece copies clear of everything', () => {
  const rows = (['rect', 'l', 't', 'u', 'open'] as const).flatMap((lid) => {
    const [w, d] = lid === 'open' ? [8, 6] : [6, 5];
    const rfp = footprintForLayout(lid, w, d);
    const parts = defaultScene(lid, w, d, { footprint: rfp, height: H });
    const supportOf = riderRelation(parts, {});
    return parts.map((src) => {
      const { spots, clear } = placeCopies([src], parts, rfp, H, supportOf);
      return {
        at: `${lid} ${src.id}`,
        clear,
        touching: touching(src, spots[0], parts),
        moved: Math.abs(spots[0].pos[1] - src.pos[1]) > 1e-6 && !src.wallMounted,
        floored: supportOf[src.id] !== undefined && spots[0].pos[1] === 0,
      };
    });
  });

  it('sweeps every room', () => {
    expect(rows.length).toBeGreaterThan(60);
  });
  it('all are clear', () => {
    expect(rows.filter((r) => !r.clear).map((r) => r.at)).toEqual([]);
  });
  it('none touches anything', () => {
    expect(rows.filter((r) => r.touching.length > 0).map((r) => `${r.at} → ${r.touching}`)).toEqual([]);
  });
  it('none changes height, but for the riders whose surface is full', () => {
    expect(rows.filter((r) => r.moved && !r.floored).map((r) => r.at)).toEqual([]);
    // Named, not counted: the U's bedside lamps, on nightstands with room for one.
    expect(rows.filter((r) => r.moved).map((r) => r.at)).toEqual(['u lamp-1', 'u lamp-2']);
  });
});

// The assertion is the sweep, not the examples: every piece in the Library, at its
// Library size, placed the way a Library click places it, copied in an empty room.
// Every one must come back clear and not overlapping its original.
describe('every Library piece copies beside itself in an empty room', () => {
  const room = { width: W, depth: W, height: H, footprint: fp };
  const rows = PART_LIBRARY.map((it) => {
    const at = placeNewPart(it.category, it.shape, it.dimMM, room, []);
    const src = part({ id: 'src', category: it.category, shape: it.shape, dimMM: it.dimMM, pos: at.pos, rot: at.rot, wallMounted: at.wallMounted });
    const { spots, clear } = placeCopies([src], [src], fp, H);
    return { label: it.label, clear, inside: overlaps(spots[0], src, src.dimMM) };
  });

  it('sweeps the whole catalogue', () => {
    expect(rows.length).toBe(PART_LIBRARY.length);
    expect(rows.length).toBeGreaterThan(40);
  });

  it('none lands inside its original', () => {
    expect(rows.filter((r) => r.inside).map((r) => r.label)).toEqual([]);
  });

  it('all find clear space', () => {
    expect(rows.filter((r) => !r.clear).map((r) => r.label)).toEqual([]);
  });
});
