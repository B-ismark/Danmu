import { describe, it, expect } from 'vitest';
import { partIdOf, pickIdsFrom, PART_ID_KEY, type PickNode } from '@/lib/pick-through';

/** A `Pickable`'s group: the node that carries the id. */
function pickable(id: string, parent: PickNode | null = null): PickNode {
  return { userData: { [PART_ID_KEY]: id }, parent };
}

/** Any node in between — a group, a mesh, a helper. */
function child(parent: PickNode | null, userData: Record<string, unknown> | null = null): PickNode {
  return { userData, parent };
}

describe('partIdOf', () => {
  it('finds the id on the node itself', () => {
    expect(partIdOf(pickable('sofa-1'))).toBe('sofa-1');
  });

  it('finds it several groups up, which is where a mesh actually sits', () => {
    const deep = child(child(child(pickable('bed-2'))));
    expect(partIdOf(deep)).toBe('bed-2');
  });

  it('returns null for scenery — the shell, a gizmo, a guide', () => {
    expect(partIdOf(child(child(null)))).toBeNull();
    expect(partIdOf(null)).toBeNull();
    expect(partIdOf(undefined)).toBeNull();
  });

  it('ignores a non-string or empty id rather than trusting it', () => {
    expect(partIdOf({ userData: { [PART_ID_KEY]: 42 } })).toBeNull();
    expect(partIdOf({ userData: { [PART_ID_KEY]: '' } })).toBeNull();
  });

  it('takes the nearest claim when nodes nest', () => {
    // A part inside a part is not something the scene builds, but the rule has to
    // be decidable: the closest ancestor wins.
    const inner = pickable('inner', pickable('outer'));
    expect(partIdOf(child(inner))).toBe('inner');
  });

  it('gives up instead of walking forever on a cycle', () => {
    const a: PickNode = { userData: null, parent: null };
    a.parent = a;
    expect(partIdOf(a)).toBeNull();
  });
});

describe('pickIdsFrom', () => {
  it('keeps raycast order and names each piece once', () => {
    const sofa = pickable('sofa-1');
    const table = pickable('table-1');
    const hits = [
      { object: child(sofa) }, // cushion
      { object: child(sofa) }, // frame
      { object: child(table) },
      { object: child(sofa) }, // the far side of the same sofa
    ];
    expect(pickIdsFrom(hits)).toEqual(['sofa-1', 'table-1']);
  });

  it('drops everything that is not furniture', () => {
    const wall = child(null); // the room shell
    const guide = child(null, { helper: true });
    const lamp = pickable('lamp-1');
    expect(pickIdsFrom([{ object: guide }, { object: wall }, { object: child(lamp) }])).toEqual(['lamp-1']);
  });

  it('survives a malformed intersection list', () => {
    expect(pickIdsFrom([])).toEqual([]);
    expect(pickIdsFrom([{ object: null }, {}])).toEqual([]);
  });
});
