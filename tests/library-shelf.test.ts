// `libraryShelf` — the Library shelf a piece is shown under, beside its name.
//
// It is looked up by SHAPE, so it is only an answer while no shape sits on two shelves;
// a catalogue row that broke that would make the Inspector name whichever row came
// first. A shape the Library does not sell falls back to its CATEGORY's shelf when that
// is one shelf, and is otherwise null — never `category` itself.

import { describe, expect, it } from 'vitest';
import { libraryShelf, PART_LIBRARY } from '@/lib/scene-spec';

describe('libraryShelf', () => {
  it('finds every Library shape on exactly one shelf', () => {
    const shelves = new Map<string, Set<string>>();
    for (const r of PART_LIBRARY) shelves.set(r.shape, (shelves.get(r.shape) ?? new Set()).add(r.group));
    const split = [...shelves].filter(([, g]) => g.size > 1).map(([s, g]) => `${s}: ${[...g].join(', ')}`);
    expect(split).toEqual([]);
    for (const r of PART_LIBRARY) expect(libraryShelf(r.shape, r.category), r.label).toBe(r.group);
  });

  it('names the shelf a person sees, not the internal key', () => {
    expect(libraryShelf('radiator', 'fridge')).toBe('Appliances');
    expect(libraryShelf('bed-double', 'bed')).toBe('Bedroom');
    // The shelf is shown as what the piece IS, so a door is not filed as an appliance.
    expect(libraryShelf('door', 'door')).toBe('Doors & windows');
    expect(libraryShelf('window', 'other')).toBe('Doors & windows');
  });

  it('finds every category but the catch-all on exactly one shelf', () => {
    // What makes the category fallback below an answer rather than a guess: a row that
    // put a second `bed` on another shelf would make a scanned bed read whichever came
    // last. Decide which shelf it is, here, before adding one.
    const shelves = new Map<string, Set<string>>();
    for (const r of PART_LIBRARY) {
      if (r.category !== 'other') shelves.set(r.category, (shelves.get(r.category) ?? new Set()).add(r.group));
    }
    expect([...shelves].filter(([, g]) => g.size > 1).map(([c, g]) => `${c}: ${[...g].join(', ')}`)).toEqual([]);
  });

  it("gives a shape the Library does not sell its category's shelf", () => {
    // A scanned bed is `bed-single`, which the Library no longer sells; it reads as the
    // starter room's bed does. An old room's `closet` is a wardrobe.
    expect(libraryShelf('bed-single', 'bed')).toBe('Bedroom');
    expect(libraryShelf('closet', 'wardrobe')).toBe('Storage');
  });

  it('answers null where the category is the catch-all', () => {
    // The Library's one `other` is the window; a box of unknown kind is not a window.
    expect(libraryShelf('box', 'other')).toBeNull();
  });
});
