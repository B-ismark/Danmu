// `libraryShelf` — the Library shelf a piece is shown under, beside its name.
//
// It is looked up by SHAPE, so it is only an answer while no shape sits on two shelves;
// a catalogue row that broke that would make the Inspector name whichever row came
// first. And a shape the Library does not sell answers null, never `category`.

import { describe, expect, it } from 'vitest';
import { libraryShelf, PART_LIBRARY } from '@/lib/scene-spec';

describe('libraryShelf', () => {
  it('finds every Library shape on exactly one shelf', () => {
    const shelves = new Map<string, Set<string>>();
    for (const r of PART_LIBRARY) shelves.set(r.shape, (shelves.get(r.shape) ?? new Set()).add(r.group));
    const split = [...shelves].filter(([, g]) => g.size > 1).map(([s, g]) => `${s}: ${[...g].join(', ')}`);
    expect(split).toEqual([]);
    for (const r of PART_LIBRARY) expect(libraryShelf(r.shape), r.label).toBe(r.group);
  });

  it('names the shelf a person sees, not the internal key', () => {
    expect(libraryShelf('radiator')).toBe('Appliances');
    expect(libraryShelf('bed-double')).toBe('Bedroom');
  });

  it('answers null for a shape the Library does not sell', () => {
    expect(libraryShelf('bed-single')).toBeNull();
  });
});
