import { describe, expect, it } from 'vitest';
import { dropMoves, orphanDrops, recordDrops, undoDrops } from '@/lib/orphan-drop';
import { restingOn } from '@/lib/physics';
import type { ScenePart } from '@/lib/scene-spec';

// Reported 2026-10-01: delete a desk and the lamp on it stays at desk height with
// nothing under it. `orphanDrops` is the answer to "what falls when this goes" and it
// is asked of the scene as it STANDS (`restingOn`, the Inspector banner's own
// question), so every fixture below is built so that the banner would say "resting"
// before the delete — `onBefore` asserts it, because a fixture that was never resting
// would pass every "not moved" clause for the wrong reason.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.

const part = (o: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
  ({ name: o.id, rot: 0, locked: false, ...o }) as ScenePart;

/** 1400 x 700 x 750 at the origin: top at 0.75. */
const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0, 0] });
const DESK_TOP = 0.75;
/** 250 x 250 x 500, on the desk. */
const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, DESK_TOP, 0] });
const LAMP_TOP = DESK_TOP + 0.5;
/** 240 x 240 x 100 — a tray of books on the lamp's shade. Wide enough that the lamp
 *  covers most of it, and that it covers most of the lamp: a probe that forgot to look
 *  only BELOW the lamp would find this and call it the lamp's support. */
const book = part({ id: 'book', category: 'other', shape: 'box', dimMM: [240, 240, 100], pos: [0, LAMP_TOP, 0] });
/** 600 x 600 x 420, under the lamp. */
const coffee = part({ id: 'coffee', category: 'table', shape: 'coffee-table', dimMM: [600, 600, 420], pos: [0, 0, 0] });
const chairAt = (x: number) =>
  part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 900], pos: [x, 0, 0] });

const onBefore = (p: ScenePart, scene: ScenePart[]) =>
  restingOn(scene, p.id, p.pos, p.rot, p.dimMM, p.category, p.shape, p.circle);

const doom = (...ids: string[]) => new Set(ids);

describe('orphanDrops', () => {
  it('drops a lamp whose desk is deleted onto the floor', () => {
    const scene = [desk, lamp];
    expect(onBefore(lamp, scene)).toMatchObject({ on: 'part', id: 'desk' });
    const drops = orphanDrops(scene, doom('desk'));
    expect(drops).toEqual([{ id: 'lamp', from: [0, DESK_TOP, 0], to: [0, 0, 0], supportId: null }]);
  });

  it('lands on the highest top left under it, and names it', () => {
    const scene = [desk, lamp, coffee];
    expect(onBefore(lamp, scene)).toMatchObject({ id: 'desk' });
    const drops = orphanDrops(scene, doom('desk'));
    expect(drops).toHaveLength(1);
    const d = drops[0];
    expect(d.id).toBe('lamp');
    expect(d.supportId).toBe('coffee');
    expect(d.to[1]).toBeCloseTo(0.42, 9);
    // x and z are untouched: gravity moves a piece straight down.
    expect([d.to[0], d.to[2]]).toEqual([0, 0]);
  });

  it('lands on a kept top a little below the one it stood on, not the floor', () => {
    // 30 mm lower than the desk, under the whole lamp. The cap on the search is the
    // lamp's own underside and not some margin beneath it.
    const side = part({ id: 'side', category: 'table', shape: 'side-table', dimMM: [600, 600, 720], pos: [0, 0, 0] });
    const [d] = orphanDrops([desk, lamp, side], doom('desk'));
    expect(d).toMatchObject({ id: 'lamp', supportId: 'side' });
    expect(d.to[1]).toBeCloseTo(0.72, 9);
  });

  it('re-seats a piece on a kept top exactly as high as the one deleted', () => {
    // Two desks of one height with the lamp over both. It does not move, but its
    // support changes, and the caller needs to hear that to move the link.
    const twin = part({ id: 'twin', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0.1, 0, 0] });
    const [d] = orphanDrops([desk, lamp, twin], doom('desk'));
    expect(d).toMatchObject({ id: 'lamp', supportId: 'twin' });
    expect(d.to[1]).toBe(d.from[1]);
  });

  it('does not move a piece beside the desk', () => {
    expect(orphanDrops([desk, lamp, chairAt(1.5)], doom('desk')).map((d) => d.id)).toEqual(['lamp']);
  });

  it('yields nothing when nothing stands on what is deleted', () => {
    expect(orphanDrops([desk, chairAt(2)], doom('desk'))).toEqual([]);
    expect(orphanDrops([desk, lamp], doom('chair'))).toEqual([]);
    expect(orphanDrops([desk, lamp], doom())).toEqual([]);
  });

  it('leaves a wall fixture over the desk alone, even one whose underside meets the desk top', () => {
    // A wall piece's pos[1] is its CENTRE: 0.75 + 0.3 puts its underside exactly on the
    // desk top, so `restingOn` — which does not consult `wallMounted` — would call it
    // resting on the desk if the anchor were not asked.
    const painting = part({
      id: 'painting', category: 'painting', shape: 'painting', dimMM: [800, 30, 600],
      pos: [0, DESK_TOP + 0.3, 0], wallMounted: true,
    });
    expect(onBefore(painting, [desk, painting])).toMatchObject({ on: 'part', id: 'desk' });
    expect(orphanDrops([desk, painting], doom('desk'))).toEqual([]);
  });

  it('leaves a piece already on the floor under a thin doomed one alone', () => {
    // A 30 mm mat is within SUPPORT_Y_EPS of the floor, so a piece at y = 0 "rests on"
    // it by the banner's tolerance. Deleting it changes nothing and must not write an
    // override for a piece that did not move.
    const mat = part({ id: 'mat', category: 'other', shape: 'box', dimMM: [1000, 1000, 30], pos: [0, 0, 0] });
    const chair = chairAt(0);
    expect(onBefore(chair, [mat, chair])).toMatchObject({ on: 'part', id: 'mat' });
    expect(orphanDrops([mat, chair], doom('mat'))).toEqual([]);
  });

  it('drops only the direct rider; what stands on the lamp rides it down', () => {
    const scene = [desk, lamp, book];
    expect(onBefore(book, scene)).toMatchObject({ id: 'lamp' });
    const drops = orphanDrops(scene, doom('desk'));
    // The book is not listed, and the lamp lands on the FLOOR, not on its own book —
    // which is over its footprint and is the highest top there is.
    expect(drops.map((d) => d.id)).toEqual(['lamp']);
    expect(drops[0].to[1]).toBe(0);
    expect(drops[0].supportId).toBeNull();
  });

  it('ignores a taller piece overlapping the footprint when choosing where to land', () => {
    // A wardrobe whose footprint covers the lamp, but which the lamp is not on: its top
    // is far above the lamp's underside, so it is something the lamp is inside.
    const wardrobe = part({ id: 'wardrobe', category: 'wardrobe', shape: 'wardrobe', dimMM: [2400, 600, 2200], pos: [0, 0, 0] });
    const scene = [desk, lamp, wardrobe];
    expect(onBefore(lamp, scene)).toMatchObject({ id: 'desk' });
    const drops = orphanDrops(scene, doom('desk'));
    expect(drops).toHaveLength(1);
    expect(drops[0].to[1]).toBe(0);
    expect(drops[0].supportId).toBeNull();
  });

  it('never rises: a kept top just ABOVE the lamp\'s underside is not something it lands on', () => {
    // 100 mm above the desk top and past the banner's tolerance, so the lamp still
    // rests on the desk by `restingOn`; falling is down only.
    const hutch = part({ id: 'hutch', category: 'shelf', shape: 'bookshelf', dimMM: [600, 600, 850], pos: [0, 0, 0] });
    const scene = [desk, lamp, hutch];
    expect(onBefore(lamp, scene)).toMatchObject({ id: 'desk' });
    expect(orphanDrops(scene, doom('desk'))).toEqual([
      { id: 'lamp', from: [0, DESK_TOP, 0], to: [0, 0, 0], supportId: null },
    ]);
  });

  it('leaves a piece that was already floating where it is', () => {
    // Not resting on the desk, so not an orphan of it: this is about what a delete
    // CAUSES, and the Inspector already reports the piece that was in the air before.
    const hover = part({ id: 'hover', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, DESK_TOP + 0.35, 0] });
    expect(onBefore(hover, [desk, hover])).toBeNull();
    expect(orphanDrops([desk, hover], doom('desk'))).toEqual([]);
  });

  it('does not drop what is itself deleted', () => {
    expect(orphanDrops([desk, lamp], doom('desk', 'lamp'))).toEqual([]);
    // With the lamp gone too, the book falls the whole way.
    const drops = orphanDrops([desk, lamp, book], doom('desk', 'lamp'));
    expect(drops).toEqual([{ id: 'book', from: [0, LAMP_TOP, 0], to: [0, 0, 0], supportId: null }]);
  });

  it('does not mutate its inputs, and hands back a copy of where the piece stood', () => {
    const scene = [desk, lamp];
    const before = JSON.stringify(scene);
    const [d] = orphanDrops(scene, doom('desk'));
    expect(JSON.stringify(scene)).toBe(before);
    d.from[1] = 99;
    expect(lamp.pos[1]).toBe(DESK_TOP);
  });
});

describe('the delete\'s Undo', () => {
  const [drop] = orphanDrops([desk, lamp], doom('desk'));
  const landedPos = { lamp: drop.to };

  it('gives a never-moved piece no override again, rather than pinning it', () => {
    const records = recordDrops([drop], {}, { lamp: 'desk' });
    expect(records[0]).toMatchObject({ prevPos: undefined, prevParent: 'desk' });
    // `landOn(lamp, undefined)` left no link behind.
    const back = undoDrops(records, landedPos, {});
    expect('lamp' in back.positions).toBe(false);
    expect(back.parentIds).toEqual({ lamp: 'desk' });
  });

  it('restores an override the piece already had, exactly', () => {
    const prev: [number, number, number] = [0.02, DESK_TOP, -0.03];
    const records = recordDrops([drop], { lamp: prev }, {});
    const back = undoDrops(records, landedPos, {});
    expect(back.positions.lamp).toEqual(prev);
    expect('lamp' in back.parentIds).toBe(false);
  });

  it('does not undo a position something wrote since the delete', () => {
    const records = recordDrops([drop], {}, { lamp: 'desk' });
    const moved = { lamp: [1, 0, 1] as [number, number, number] };
    const back = undoDrops(records, moved, { lamp: 'coffee' });
    expect(back.positions).toBe(moved);
    expect(back.parentIds.lamp).toBe('coffee');
  });

  it('returns the same maps when there is nothing to restore', () => {
    const records = recordDrops([drop], {}, {});
    const pos = {};
    const links = {};
    const back = undoDrops(records, pos, links);
    expect(back.positions).toBe(pos);
    expect(back.parentIds).toBe(links);
  });

  it('writes no position for a re-seat that did not move, and restores only the link', () => {
    const twin = part({ id: 'twin', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0.1, 0, 0] });
    const [d] = orphanDrops([desk, lamp, twin], doom('desk'));
    expect(dropMoves(d)).toBe(false);
    const records = recordDrops([d], {}, { lamp: 'desk' });
    // `landOn` left the link on the twin; the position map was never touched.
    const pos = { lamp: [5, 5, 5] as [number, number, number] };
    const back = undoDrops(records, pos, { lamp: 'twin' });
    expect(back.positions).toBe(pos);
    expect(back.parentIds.lamp).toBe('desk');
    // …even when the piece carries an override that happens to equal where it stands,
    // which is exactly what a drop that moved nothing would have to be mistaken for.
    const own = { lamp: [...d.to] as [number, number, number] };
    const again = undoDrops(recordDrops([d], own, { lamp: 'desk' }), own, { lamp: 'twin' });
    expect(again.positions).toBe(own);
  });
});
