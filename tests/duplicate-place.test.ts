// Where a copy goes. Reported 2026-10-01: "duplicating an item should spawn the
// duplicate properly if there's space, it should be next to the main instance, it
// shouldn't spawn inside the main instance". The old seven fixed offsets were sized
// for a chair, so a wardrobe's copy collided at every one of them and fell back to
// `[0, 0]` — the original's own spot.

import { describe, expect, it } from 'vitest';
import { COPY_GAP_M, placeCopies, roomSearch } from '@/lib/duplicate-place';
import { footprintForLayout } from '@/lib/footprint';
import { footFromPart, footInsidePoly, footOverlap, obbFromPart, obbOverlap, TOUCH_M } from '@/lib/geometry';
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

  it('a print hung just above a sideboard is on the WALL, not on the sideboard', () => {
    // Its bottom 0 mm off the sideboard's top: `restingOn` alone calls that resting, and
    // the copy was grounded on the floor when nothing was clear, and announced as not
    // beside anything when something was.
    const z = -W / 2 + 0.015 + 0.02;
    const print = part({ id: 'print', category: 'painting', shape: 'painting', pos: [0, 1.0, z], dimMM: [600, 30, 400], wallMounted: true });
    const sideboard = part({ id: 'sb', category: 'shelf', shape: 'tv-console', pos: [0, 0, -W / 2 + 0.225], dimMM: [1600, 450, 800] });
    const { spots, clear, beside } = placeCopies([print], [print, sideboard], fp, H);
    expect(clear).toBe(true);
    expect(beside).toBe(true);
    expect(spots[0].pos[1]).toBeCloseTo(1.0, 6);
    expect(spots[0].support).toBeNull();
  });

  it('a lamp copied off a desk stays on the desk', () => {
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', pos: [0, 0, 0], dimMM: [1600, 700, 750] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-0.5, 0.75, 0], dimMM: [300, 300, 500] });
    const { spots, clear } = placeCopies([lamp], [desk, lamp], fp, H);
    expect(clear).toBe(true);
    expect(spots[0].pos[0]).toBeCloseTo(-0.5 + 0.3 + COPY_GAP_M, 6);
    expect(spots[0].pos[1]).toBeCloseTo(0.75, 6);
  });

  it('…and still prefers the desk when the side it would try first is off the end', () => {
    // Right: x = 0.75 + 0.35 = 1.1, past the desk's end at 0.8 — the floor. Left stays on.
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', pos: [0, 0, 0], dimMM: [1600, 700, 750] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [0.65, 0.75, 0], dimMM: [300, 300, 500] });
    const { spots } = placeCopies([lamp], [desk, lamp], fp, H);
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
    const { spots, clear } = placeCopies([lamp, desk], [desk, lamp], fp, H);
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
    const { spots, clear } = placeCopies([lamp], world, fp, H);
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
    const { spots, clear } = placeCopies([lamp], world, fp, H);
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
    const { spots, clear, beside } = placeCopies([sofa], parts, tfp, H);
    expect(clear).toBe(true);
    // Found by the search, so the announcement must not say "beside it".
    expect(beside).toBe(false);
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
      const { spots, clear } = placeCopies([src], parts, rfp, H);
      return {
        at: `${lid} ${src.id}`,
        clear,
        touching: touching(src, spots[0], parts),
        moved: Math.abs(spots[0].pos[1] - src.pos[1]) > 1e-6 && !src.wallMounted,
        floored: supportOf[src.id] !== undefined && spots[0].pos[1] === 0,
        // Shrunk a millimetre a side: a piece flush on the plaster is in the room.
        outside:
          !src.wallMounted &&
          !footInsidePoly(footFromPart(spots[0].pos, spots[0].rot, [src.dimMM[0] - 2, src.dimMM[1] - 2, src.dimMM[2]], src.circle, src.shape), rfp),
      };
    });
  });

  it('sweeps every room', () => {
    // A literal: a floor here passed with a room's starter quietly gone.
    expect(rows.length).toBe(72);
  });
  it('all are clear', () => {
    expect(rows.filter((r) => !r.clear).map((r) => r.at)).toEqual([]);
  });
  it('every floor piece is wholly inside the room — a rug included, which collides with nothing', () => {
    expect(rows.filter((r) => r.outside).map((r) => r.at)).toEqual([]);
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

// Found in review of the room-wide search, each run before it was fixed.
describe('what a copy stands on, and where it goes when nothing is clear', () => {
  const ufp = footprintForLayout('u', 6, 5);
  const u = () => defaultScene('u', 6, 5, { footprint: ufp, height: H });

  it('a lamp moved off its nightstand onto the floor is copied beside it, not back onto the nightstand', () => {
    // The authored scene still has it on `nightstand-1`; the room as it stands does not.
    const parts = u().map((p) => (p.id === 'lamp-1' ? { ...p, pos: [0.3, 0, 0.6] as [number, number, number] } : p));
    const lamp = parts.find((p) => p.id === 'lamp-1')!;
    const { spots, clear, beside } = placeCopies([lamp], parts, ufp, H);
    expect(clear).toBe(true);
    expect(beside).toBe(true);
    expect(spots[0].pos[1]).toBe(0);
    expect(spots[0].support).toBeNull();
    expect(Math.hypot(spots[0].pos[0] - 0.3, spots[0].pos[2] - 0.6)).toBeLessThan(1);
  });

  it('says what each copy landed on: the other nightstand, not its original\'s', () => {
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [0, 0, -2], dimMM: [1600, 2000, 500] });
    const nl = part({ id: 'nl', category: 'nightstand', shape: 'nightstand', pos: [-1.05, 0, -2.78], dimMM: [450, 400, 550] });
    const nr = part({ id: 'nr', category: 'nightstand', shape: 'nightstand', pos: [1.05, 0, -2.78], dimMM: [450, 400, 550] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-1.05, 0.55, -2.78], dimMM: [250, 250, 500] });
    const { spots } = placeCopies([lamp], [bed, nl, nr, lamp], fp, H);
    expect(spots[0].support).toEqual({ id: 'nr', copy: false });
  });

  it('…and a lamp copied with its desk is on the COPY of the desk', () => {
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', pos: [0, 0, 0], dimMM: [1200, 600, 750] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [0.3, 0.75, 0], dimMM: [250, 250, 450] });
    const { spots } = placeCopies([lamp, desk], [desk, lamp], fp, H);
    expect(spots[0].support).toEqual({ id: 'desk', copy: true });
    expect(spots[1].support).toBeNull();
  });

  it('copied piece by piece, the copies keep out of each other', () => {
    // Two chairs with one chair-sized gap between them, and a third across the room so
    // the three cannot travel as a set. Both near copies want the one gap.
    const chair = (id: string, x: number, z: number) =>
      part({ id, category: 'chair', shape: 'chair-dining', pos: [x, 0, z], dimMM: [450, 500, 850] });
    const a = chair('a', -2.5, -2.5);
    const b = chair('b', -1.44, -2.5);
    const box = part({ id: 'box', pos: [-0.6, 0, -2.5], dimMM: [600, 600, 600] });
    const c = chair('c', 2.5, 2.5);
    const sources = [a, b, c];
    const { spots } = placeCopies(sources, [a, b, box, c], fp, H);
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        expect(overlaps(spots[i], spots[j], sources[i].dimMM, sources[j].dimMM), `${sources[i].id} × ${sources[j].id}`).toBe(false);
  });

  it('with no clear spot left, copies stay on the floor and spread out rather than stack', () => {
    // A room just big enough for three beds; copy the first again and again.
    const small = footprintForLayout('rect', 3.4, 2.2);
    const bed = (id: string, x: number) =>
      part({ id, category: 'bed', shape: 'bed-single', pos: [x, 0, 0], dimMM: [1000, 2000, 500] });
    let world = [bed('b1', -1.15), bed('b2', 0), bed('b3', 1.15)];
    const copies: At[] = [];
    for (let n = 0; n < 4; n++) {
      const { spots, clear } = placeCopies([world[0]], world, small, H);
      expect(clear).toBe(false);
      // Never climbed onto another bed.
      expect(spots[0].pos[1]).toBe(0);
      expect(spots[0].support).toBeNull();
      copies.push(spots[0]);
      world = [...world, { ...world[0], id: `copy-${n}`, pos: spots[0].pos, rot: spots[0].rot }];
    }
    // No two copies in the same spot.
    for (let i = 0; i < copies.length; i++)
      for (let j = i + 1; j < copies.length; j++)
        expect(Math.hypot(copies[i].pos[0] - copies[j].pos[0], copies[i].pos[2] - copies[j].pos[2])).toBeGreaterThan(0.1);
  });

  it('piece by piece, a lamp whose table is full goes onto the table\'s copy', () => {
    // The lamp fills its table, and a chair across the room keeps the three from
    // travelling as a set. The table's copy is placed first; the lamp's copy must be
    // able to see it — under the probe's id it was taken for the lamp itself.
    const table = part({ id: 'table', category: 'table', shape: 'side-table', pos: [-2, 0, -2], dimMM: [450, 450, 550] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-2, 0.55, -2], dimMM: [400, 400, 500] });
    const far = part({ id: 'far', category: 'chair', shape: 'chair-dining', pos: [2.5, 0, 2.5], dimMM: [450, 500, 850] });
    const { spots, clear } = placeCopies([table, lamp, far], [table, lamp, far], fp, H);
    expect(clear).toBe(true);
    expect(spots[1].support).toEqual({ id: 'table', copy: true });
    expect(spots[1].pos[1]).toBeCloseTo(0.55, 6);
  });

  it('piece by piece for real: the lamp finds the table\'s copy, and a copy sent across the room is not "beside"', () => {
    // Opposite corners, so no shift keeps the three in the room and off themselves: the
    // fallback is the only way out. The far chair is boxed in, so its copy comes from the
    // room search. The table's copy goes first; the lamp fills its table and must SEE
    // that copy — under the probe's id it was taken for the lamp itself.
    const table = part({ id: 'table', category: 'table', shape: 'side-table', pos: [-2.6, 0, -2.6], dimMM: [450, 450, 550] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-2.6, 0.55, -2.6], dimMM: [400, 400, 500] });
    const far = part({ id: 'far', category: 'chair', shape: 'chair-dining', pos: [2.6, 0, 2.6], dimMM: [450, 500, 850] });
    const bx1 = part({ id: 'bx1', pos: [1.9, 0, 2.6], dimMM: [600, 600, 600] });
    const bx2 = part({ id: 'bx2', pos: [2.6, 0, 1.9], dimMM: [600, 600, 600] });
    const { spots, clear, beside } = placeCopies([table, lamp, far], [table, lamp, far, bx1, bx2], fp, H);
    expect(clear).toBe(true);
    expect(beside).toBe(false);
    // Not one shift for the set.
    const shift = (i: number, s: ScenePart) => [spots[i].pos[0] - s.pos[0], spots[i].pos[2] - s.pos[2]];
    expect(Math.hypot(shift(0, table)[0] - shift(2, far)[0], shift(0, table)[1] - shift(2, far)[1])).toBeGreaterThan(0.1);
    expect(spots[1].support).toEqual({ id: 'table', copy: true });
    expect(spots[1].pos[1]).toBeCloseTo(0.55, 6);
    expect(Math.hypot(spots[1].pos[0] - spots[0].pos[0], spots[1].pos[2] - spots[0].pos[2])).toBeLessThan(0.05);
  });

  it('a rider with nowhere clear is made on the floor, not hanging at its surface\'s height', () => {
    const tiny = footprintForLayout('rect', 1.2, 1.2);
    const stand = part({ id: 'stand', category: 'table', shape: 'side-table', pos: [-0.35, 0, -0.35], dimMM: [450, 450, 550] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-0.35, 0.55, -0.35], dimMM: [400, 400, 500] });
    const fill = [
      part({ id: 'f1', pos: [0.3, 0, -0.3], dimMM: [600, 600, 900] }),
      part({ id: 'f2', pos: [-0.3, 0, 0.3], dimMM: [600, 600, 900] }),
      part({ id: 'f3', pos: [0.3, 0, 0.3], dimMM: [600, 600, 900] }),
    ];
    const { spots, clear } = placeCopies([lamp], [stand, lamp, ...fill], tiny, H);
    expect(clear).toBe(false);
    expect(spots[0].pos[1]).toBe(0);
    expect(spots[0].support).toBeNull();
  });

  it('a strip along a wall a little deeper than the piece is found, flush with the wall', () => {
    // The only free floor is 0.55 m along the north wall: less than one search step
    // deeper than a 500 mm chair, so no grid point puts the chair in it — only the clamp
    // to the wall does. Dropping out-of-bounds offsets lost it, and the copy was made
    // overlapping with "No clear space left in the room".
    const block = part({ id: 'block', pos: [0, 0, 0.275], dimMM: [6000, 5450, 900] });
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', pos: [0, 0, 2.7], dimMM: [450, 500, 850] });
    const { spots, clear } = placeCopies([chair], [chair, block], fp, H);
    expect(clear).toBe(true);
    expect(spots[0].pos[2]).toBeCloseTo(-3 + 0.25, 3);
  });

  it('…and along the far wall too, where a flush outline reads as outside the polygon', () => {
    // Ray casting puts a corner exactly ON the +x or +z wall outside and one on the −x
    // or −z wall inside, so the in-room test shrinks the outline a millimetre a side.
    // Without that, the same strip mirrored south was "no clear space".
    const block = part({ id: 'block', pos: [0, 0, -0.275], dimMM: [6000, 5450, 900] });
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', pos: [0, 0, -2.7], dimMM: [450, 500, 850] });
    const { spots, clear } = placeCopies([chair], [chair, block], fp, H);
    expect(clear).toBe(true);
    expect(spots[0].pos[2]).toBeCloseTo(3 - 0.25, 3);
  });

  it('piece by piece, one copy with nowhere clear makes the whole duplicate not clear', () => {
    const small = footprintForLayout('rect', 3.4, 2.2);
    const bed = (id: string, x: number) =>
      part({ id, category: 'bed', shape: 'bed-single', pos: [x, 0, 0], dimMM: [1000, 2000, 500] });
    const world = [bed('b1', -1.15), bed('b2', 0), bed('b3', 1.15)];
    expect(placeCopies([world[0], world[2]], world, small, H).clear).toBe(false);
  });

  it('a whole room selected searches a handful of shifts as a set, not the floor', () => {
    // 0.5–1.8 s per Duplicate when every offset was resolved for every member.
    for (const lid of ['rect', 'l', 't', 'u', 'open'] as const) {
      const [w, d] = lid === 'open' ? [8, 6] : [6, 5];
      const rfp = footprintForLayout(lid, w, d);
      const parts = defaultScene(lid, w, d, { footprint: rfp, height: H });
      // Every offset clamps to the few shifts that keep the room's box in the room.
      expect(roomSearch(parts, rfp, () => 0).offsets, lid).toBeLessThanOrEqual(20);
    }
    // …while one piece still searches the whole floor.
    const one = u().find((p) => p.id === 'bed-1')!;
    expect(roomSearch([one], ufp, () => 0).offsets).toBeGreaterThan(300);
  });
});
