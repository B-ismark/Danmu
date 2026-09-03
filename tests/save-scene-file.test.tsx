// @vitest-environment jsdom
//
// What `saveSceneFile` actually writes, read out of the Blob it hands the browser.
//
// **This file exists because the highest-consequence finding of a five-lens review was
// a wiring gap no test could see.** `tests/scene-file.test.ts` calls `buildSceneFile`
// directly and pins its behaviour thoroughly; the app's only caller was passing it four
// of the five transform slices, so `parentIds ?? {}` defaulted to empty and an entire
// feature was inert for a rider a drag had placed. Every assertion about the format was
// green, and the button produced a file with a lamp 450 mm inside a desk.
//
// The lesson is narrow enough to state: a gate on a pure function and a gate on the
// screen that calls it are different gates, and the argument list between them is
// exactly where a feature goes missing. So this drives the exported action, not the
// builder, and reads the bytes rather than the arguments.
//
// `downloadBlob` and `roomStore` are the two edges of that action — a DOM anchor click
// and IndexedDB — and both are mocked, because neither is what is being measured.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { footprintForLayout } from '@/lib/footprint';
import type { SceneFile } from '@/lib/scene-file';
import type { ScenePart } from '@/lib/scene-spec';

const saved: Array<{ name: string; blob: Blob }> = [];

vi.mock('@/lib/snapshot', () => ({
  // The Blob is kept whole rather than read here: `downloadBlob` is synchronous and
  // `Blob.text()` is not, so unwrapping it at the seam would need an await the real
  // signature does not have.
  downloadBlob: (blob: Blob, filename: string) => {
    saved.push({ name: filename, blob });
  },
}));

vi.mock('@/lib/storage', async (orig) => {
  const real = await orig<typeof import('@/lib/storage')>();
  return {
    ...real,
    roomStore: { ...real.roomStore, loadRoom: async () => ({ id: 'r1', createdAt: 1, name: 'Front Room' }) },
  };
});

vi.mock('@/components/ui/StorageToast', () => ({ toast: () => {} }));

const { saveSceneFile } = await import('@/components/studio/SceneFile');

const DESK = 'desk-1';
const LAMP = 'lamp-1';

/** Top at 0.45 as authored; the user grows it to 0.90. */
const desk = (): ScenePart =>
  ({
    id: DESK, name: 'Desk', category: 'desk', shape: 'desk-standard', locked: false,
    dimMM: [1400, 700, 450], pos: [0, 0, 0], rot: 0,
  }) as ScenePart;

/** Authored across the room on the FLOOR — this is a rider a drag created, which is
 *  the half `ridingParents` cannot recover on its own and the half that was broken. */
const draggedLamp = (): ScenePart =>
  ({
    id: LAMP, name: 'Lamp', category: 'lamp', shape: 'lamp-table', locked: false,
    dimMM: [300, 300, 400], pos: [1.5, 0, 1.5], rot: 0,
  }) as ScenePart;

async function save(): Promise<SceneFile> {
  saved.length = 0;
  await saveSceneFile('r1');
  expect(saved, 'saveSceneFile wrote no file, so nothing below measures anything').toHaveLength(1);
  return JSON.parse(await saved[0].blob.text()) as SceneFile;
}

beforeEach(() => {
  useScene.setState({
    parts: [desk(), draggedLamp()],
    room: {
      ...useScene.getState().room,
      width: 4, depth: 4, height: 2.5,
      footprint: footprintForLayout('rect', 4, 4), layoutId: 'rect',
    },
  });
  useStudio.setState({
    // The drag: the lamp is on the desk's authored top, and the relation is recorded.
    positions: { [LAMP]: [0, 0.45, 0] },
    rotations: {},
    dims: { [DESK]: [1400, 700, 900] },
    parentIds: { [LAMP]: DESK },
    hidden: {},
  });
});

describe('saveSceneFile hands buildSceneFile every slice it needs', () => {
  it('writes a dragged rider at the height its support is NOW', async () => {
    const file = await save();
    expect(file.parts.find((p) => p.id === DESK)!.dimMM).toEqual([1400, 700, 900]);
    // 0.45 is what the omission produced: the lamp buried 450 mm inside the desk, in a
    // file that opens on a machine which never saw the resize.
    expect(file.parts.find((p) => p.id === LAMP)!.pos).toEqual([0, 0.9, 0]);
  });

  it('carries the relation, so the reader can put it right after any later resize', async () => {
    const file = await save();
    expect(file.parts.find((p) => p.id === LAMP)!.parentId).toBe(DESK);
    expect(file.parts.find((p) => p.id === DESK)!.parentId).toBeUndefined();
  });

  it('still carries hidden, which was the slice that was NOT dropped', async () => {
    // The control. `hidden` came through the same destructure and was passed, so a
    // failure here would mean the harness is wrong rather than the wiring.
    useStudio.setState({ hidden: { [DESK]: true } });
    const file = await save();
    expect(file.parts.find((p) => p.id === DESK)!.hidden).toBe(true);
  });
});
