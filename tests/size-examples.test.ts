import { describe, it, expect } from 'vitest';
import { rankLibrary, queryNamesSize, sizeFromQuery } from '@/lib/shape-search';
import { SIZE_EXAMPLES } from '@/lib/size-examples';

// The chips under the Library's search field are promises: pressing one must land on
// the piece it names, at the size it states. Swept over the real list so an example
// that stops parsing fails here rather than on screen.
describe('Library size examples', () => {
  it('has examples to show', () => {
    expect(SIZE_EXAMPLES.length).toBeGreaterThanOrEqual(3);
  });
  for (const ex of SIZE_EXAMPLES) {
    it(`"${ex.text}" ranks ${ex.expect} first`, () => {
      const ranked = rankLibrary(ex.text);
      expect(ranked[0]?.label.toLowerCase()).toContain(ex.expect);
    });
    const want = ex.sizeMM;
    if (want) {
      it(`"${ex.text}" names a size and resolves it`, () => {
        expect(queryNamesSize(ex.text)).toBe(true);
        const top = rankLibrary(ex.text)[0];
        const dim = sizeFromQuery(top, ex.text);
        expect(dim[0]).toBe(want[0]);
        expect(dim[1]).toBe(want[1]);
      });
    }
  }
});
