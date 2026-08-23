import { describe, expect, it } from 'vitest';
import { applyTransforms, fileSlug, furnitureCsvBlob, groupForList } from '@/lib/exports';
import type { ScenePart } from '@/lib/scene-spec';

/** Minimal part — only the fields these helpers touch matter. */
function part(over: Partial<ScenePart> = {}): ScenePart {
  return {
    id: 'p1',
    name: 'Sofa',
    category: 'seating',
    shape: 'box',
    pos: [0, 0, 0],
    rot: 0,
    dimMM: [2000, 900, 800],
    ...over,
  } as ScenePart;
}

const NO_OVERRIDES = { positions: {}, rotations: {}, dims: {} };

describe('applyTransforms', () => {
  // This is the one that matters. Four copies of this mapping existed; an export
  // that skips it silently ships the room as it was BEFORE anyone arranged it.
  it('prefers the user override over the base value, per field', () => {
    const [p] = applyTransforms([part()], {
      positions: { p1: [1, 2, 3] },
      rotations: { p1: Math.PI },
      dims: { p1: [1, 2, 3] },
    });
    expect(p.pos).toEqual([1, 2, 3]);
    expect(p.rot).toBe(Math.PI);
    expect(p.dimMM).toEqual([1, 2, 3]);
  });

  it('falls back to the base value when no override exists', () => {
    const [p] = applyTransforms([part()], NO_OVERRIDES);
    expect(p.pos).toEqual([0, 0, 0]);
    expect(p.rot).toBe(0);
    expect(p.dimMM).toEqual([2000, 900, 800]);
  });

  it('keeps a rotation override of 0, which is falsy but meaningful', () => {
    // `||` here instead of `??` would silently discard "turned back to square".
    const [p] = applyTransforms([part({ rot: 1.5 })], { ...NO_OVERRIDES, rotations: { p1: 0 } });
    expect(p.rot).toBe(0);
  });

  it('does not mutate the input parts', () => {
    const base = part();
    applyTransforms([base], { positions: { p1: [9, 9, 9] }, rotations: {}, dims: {} });
    expect(base.pos).toEqual([0, 0, 0]);
  });

  it('leaves other parts untouched when one is overridden', () => {
    const out = applyTransforms([part(), part({ id: 'p2' })], { ...NO_OVERRIDES, positions: { p1: [5, 0, 5] } });
    expect(out[0].pos).toEqual([5, 0, 5]);
    expect(out[1].pos).toEqual([0, 0, 0]);
  });
});

describe('groupForList', () => {
  it('collapses identical pieces into one counted row', () => {
    const rows = groupForList([part(), part({ id: 'p2' }), part({ id: 'p3' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
  });

  it('separates pieces that differ in size or colour', () => {
    const rows = groupForList([
      part(),
      part({ id: 'p2', dimMM: [1400, 900, 800] }),
      part({ id: 'p3', color: '#AABBCC' }),
    ]);
    expect(rows).toHaveLength(3);
  });

  it('sorts by name so the file is stable between exports', () => {
    const rows = groupForList([part({ name: 'Table' }), part({ id: 'p2', name: 'Chair' })]);
    expect(rows.map((r) => r.part.name)).toEqual(['Chair', 'Table']);
  });
});

describe('fileSlug', () => {
  it('makes a filename-safe slug', () => {
    expect(fileSlug('  Living Room!  ')).toBe('living-room');
  });

  it('never returns an empty string', () => {
    // An all-punctuation name would otherwise produce `-furniture.csv`.
    expect(fileSlug('***')).toBe('room');
    expect(fileSlug('')).toBe('room');
  });
});

describe('furnitureCsvBlob', () => {
  it('writes a Qty column and one row per group', async () => {
    // csvCell quotes EVERY cell, so the header is fully quoted.
    const text = await furnitureCsvBlob([part(), part({ id: 'p2' })], 'mm').text();
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('"Qty","Name","Category","Width (mm)","Depth (mm)","Height (mm)","Colour"');
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith('"2","Sofa"')).toBe(true);
  });

  it('starts with a UTF-8 BOM, so Excel on Windows does not use the ANSI codepage', async () => {
    // Checked on the BYTES: Blob.text() decodes as UTF-8 and a conforming decoder
    // strips a leading BOM, so the string form cannot see it at all.
    const bytes = new Uint8Array(await furnitureCsvBlob([part()], 'mm').arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('neutralises a formula-injection name rather than writing it through', async () => {
    const text = await furnitureCsvBlob([part({ name: '=HYPERLINK("http://x")' })], 'mm').text();
    // The leading apostrophe is the escape a spreadsheet strips on display, so the
    // cell shows the literal text instead of evaluating it.
    expect(text).toContain('"\'=HYPERLINK(""http://x"")"');
  });
});
