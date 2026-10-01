// Where a copy goes. Reported 2026-10-01: "duplicating an item should spawn the
// duplicate properly if there's space, it should be next to the main instance, it
// shouldn't spawn inside the main instance". The old seven fixed offsets were sized
// for a chair, so a wardrobe's copy collided at every one of them and fell back to
// `[0, 0]` — the original's own spot.

import { describe, expect, it } from 'vitest';
import { COPY_GAP_M, placeCopies } from '@/lib/duplicate-place';
import { footprintForLayout } from '@/lib/footprint';
import { obbFromPart, obbOverlap } from '@/lib/geometry';
import { PART_LIBRARY, placeNewPart, type ScenePart } from '@/lib/scene-spec';

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
