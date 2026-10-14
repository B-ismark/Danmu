// @vitest-environment jsdom
//
// "My pieces" lives outside every room, so it is read the way a room file is: a record
// that no longer reads is skipped, and a block that no longer reads is left out AND
// counted, so the shelf can say so.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clear, set } from 'idb-keyval';
import { piecesStore } from '@/lib/storage';
import type { MadeSpec } from '@/lib/made-piece';

const TOP: MadeSpec = {
  sizeMM: [1400, 700, 740],
  blocks: [{ shape: 'worktop', category: 'desk', pos: [0, 0, 0], rot: 0, dimMM: [1400, 700, 740] }],
};

beforeEach(() => clear());

describe('piecesStore', () => {
  it('lists the newest first and forgets on remove', async () => {
    const a = await piecesStore.save('Bench', TOP, 'a');
    await set('piece:b', { ...a, id: 'b', name: 'Desk', savedAt: a.savedAt + 1 });
    expect((await piecesStore.list()).map((p) => p.name)).toEqual(['Desk', 'Bench']);
    await piecesStore.remove('b');
    expect((await piecesStore.list()).map((p) => p.id)).toEqual(['a']);
  });

  it('counts blocks it could not read rather than dropping them silently', async () => {
    await set('piece:x', { id: 'x', name: 'Old', savedAt: 1, made: { ...TOP, blocks: [...TOP.blocks, { shape: 'retired-thing' }] } });
    const [p] = await piecesStore.list();
    expect(p.made.blocks).toHaveLength(1);
    expect(p.dropped).toBe(1);
  });

  it('skips a record with no readable blocks, and says nothing extra for a clean one', async () => {
    await set('piece:y', { id: 'y', name: 'Gone', savedAt: 1, made: { blocks: [{ shape: 'nope' }] } });
    await piecesStore.save('Fine', TOP, 'z');
    const list = await piecesStore.list();
    expect(list.map((p) => p.id)).toEqual(['z']);
    expect(list[0].dropped).toBeUndefined();
  });
});
