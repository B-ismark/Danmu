import { describe, expect, it } from 'vitest';
import { matchMyPieces } from '@/components/studio/MyPiecesShelf';
import type { MyPiece } from '@/lib/storage';

const piece = (name: string): MyPiece => ({ id: name, name, savedAt: 0, made: { sizeMM: [1, 1, 1], blocks: [] } });

describe('the My pieces shelf answers the Library search', () => {
  const shelf = [piece('Office bench 4'), piece('Reading nook'), piece('TV wall')];

  it('shows everything for an empty box', () => {
    expect(matchMyPieces(shelf, '  ')).toHaveLength(3);
  });

  it('needs every word, in any order and case', () => {
    expect(matchMyPieces(shelf, 'BENCH office').map((p) => p.name)).toEqual(['Office bench 4']);
    expect(matchMyPieces(shelf, 'bench nook')).toEqual([]);
  });
});
