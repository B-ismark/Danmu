// A starter room holds only pieces the Library sells, under the names it sells them by.
//
// The user's 2026-10-01 report: a seeded bedroom said "Queen bed" while the Library had
// one "Bed". The pieces had merged in the Library and the seeder kept the old names —
// "Area rug", "Curtains", "Framed print", "Pendant", "Bedside lamp", a single on a shape
// the Library no longer offers — so the room named things nobody could find to add.
// This sweeps every footprint at a spread of sizes and fails on any seeded piece with
// no Library row of the same kind, shape and name.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.

import { describe, expect, it } from 'vitest';
import { defaultScene, PART_LIBRARY } from '@/lib/scene-spec';
import { LAYOUT_IDS } from '@/lib/storage';

const SIZES: [number, number][] = [[2.5, 2.5], [3, 3], [4, 3.5], [5, 4], [6, 5], [8, 6]];

describe('a starter room', () => {
  const seen = new Map<string, number>();
  for (const layout of LAYOUT_IDS) {
    for (const [w, d] of SIZES) {
      for (const p of defaultScene(layout, w, d)) {
        const key = `${p.category} / ${p.shape} / ${p.name}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
  }

  it('names every piece as the Library row it is', () => {
    const rows = new Set(PART_LIBRARY.map((r) => `${r.category} / ${r.shape} / ${r.label}`));
    expect([...seen.keys()].filter((k) => !rows.has(k)).sort()).toEqual([]);
  });

  it('…and the sweep reached the pieces that had drifted', () => {
    // A literal list, so a seeder that stopped placing one of these cannot pass by
    // having nothing left to check.
    const names = new Set([...seen.keys()].map((k) => k.split(' / ')[2]));
    for (const n of ['Bed', 'Rug', 'Curtain', 'Painting', 'Pendant lamp', 'Table lamp', 'TV · 65″', 'TV · 43″']) {
      expect(names, n).toContain(n);
    }
  });
});
