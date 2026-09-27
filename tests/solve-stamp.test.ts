// A solve's answer is applied only to the room it was asked about.
import { describe, expect, it } from 'vitest';
import { sameStamp, stampOf, type SolveInputs } from '@/lib/solve-stamp';

const base = (): SolveInputs => ({
  parts: [],
  room: {},
  positions: {},
  rotations: {},
  dims: {},
  parentIds: {},
  pinned: {},
});

describe('solve stamp', () => {
  it('the same slices are the same room', () => {
    const inputs = base();
    expect(sameStamp(stampOf(inputs), stampOf({ ...inputs }))).toBe(true);
  });

  // Every slot, not examples: a stamp that forgot one input is a solve that can
  // overwrite that kind of edit.
  it.each(Object.keys(base()) as (keyof SolveInputs)[])('a new %s is a different room', (key) => {
    const inputs = base();
    const changed = { ...inputs, [key]: Array.isArray(inputs[key]) ? [] : {} };
    expect(sameStamp(stampOf(inputs), stampOf(changed))).toBe(false);
  });

  it('equal contents in a new object still count as a change — identity, not deep equality', () => {
    // A drag that ends where it started still wrote a new map; treating it as
    // unchanged would be a deep compare of every transform on every answer.
    const inputs = base();
    expect(sameStamp(stampOf(inputs), stampOf({ ...inputs, positions: {} }))).toBe(false);
  });
});
