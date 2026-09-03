// @vitest-environment jsdom
//
// § G.1, part 2 — a wall move must pin the scene for a SEEDED room, and must not for a
// detected one.
//
// `tests/custom-footprint-seed.test.ts` measures the damage in pure logic: a wall move
// writes the room outline and the transform overrides and never a scene snapshot, so the
// next open re-seeds `defaultScene` against the new polygon and the overrides land on
// whatever comes back, by id — up to 9 of 16 pieces lost on one move. That file cannot
// see the WRITE, because the write lives in a component. This one is that half.
//
// `RoomSync` is mounted directly rather than through the plan page. It is not a helper
// being tested instead of its caller — it IS the component that owns every studio-to-IDB
// write, it renders `null`, and the four page-mounting files in this suite cost ~4 s each
// to reach the same subscriber.
//
// The two negative cases are the point as much as the positive one. Pinning on any room
// change would take a re-scan away from a detected room whenever somebody repainted a
// wall, and pinning a detected room at all would take it away permanently — and neither
// failure has a symptom until the user runs a second scan weeks later and it does
// nothing.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { roomStore, type RoomData } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';
import type { ScenePart } from '@/lib/scene-spec';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('wall-pin-room'));

const { RoomSync } = await import('@/components/studio/RoomSync');

const ROOM_ID = 'wall-pin-room';
/** `RoomSync`'s own debounce is 300 ms; every wait here is against that, with room for a
 *  loaded machine. Read from the component rather than typed twice would be better and
 *  is not possible — it is a module-private const in a `'use client'` file. */
const SETTLE = 2000;

function room(over: Partial<RoomData> = {}): RoomData {
  return {
    id: ROOM_ID,
    createdAt: 1,
    name: 'T room',
    layoutId: 't',
    width: 5.5,
    depth: 4.7,
    height: 2.8,
    footprint: footprintForLayout('t', 5.5, 4.7),
    ...over,
  };
}

/** One detected object, in the shape `RoomData` stores them.
 *
 *  `buildSceneFromRoom` branches on `dets.length` alone, so the content is not what is
 *  under test — but the record has to be a real one, because the branch it takes then
 *  runs `placementForSlot` over `box`. A first version of this fixture invented the
 *  fields, and the page threw from inside a `loadFromRoom` that vitest reported as an
 *  *unhandled rejection* beside a test that had already been marked failed for a
 *  different reason. */
const DETECTED: NonNullable<RoomData['detectedObjects']> = [
  {
    id: 1,
    uid: 'det-bed-1',
    label: 'bed',
    conf: 0.9,
    source: 'cloud',
    locked: false,
    box: [0.3, 0.3, 0.4, 0.4],
    category: 'bed',
    shape: 'bed-double',
    dimMM: [1400, 1900, 500],
  },
];

async function mountFor(r: RoomData) {
  cleanup();
  // A fresh store per case: `useScene` outlives the unmount, and a room left over from
  // the previous case would make the wall move below act on the wrong polygon.
  await roomStore.saveRoom(r);
  render(<RoomSync />);
  // The load effect is async and `ready` gates every subscriber, so a wall move
  // dispatched before it lands is silently ignored — which would make this file green
  // for the wrong reason.
  await waitFor(() => expect(useScene.getState().parts.length).toBeGreaterThan(3), { timeout: SETTLE });
}

beforeEach(async () => {
  // Every key for this room, not just the meta: the scene key is what each case
  // asserts the absence of first, and one left behind by the previous case would make
  // that positive control pass for the wrong reason.
  await roomStore.destroyRoom(ROOM_ID);
});

describe('§ G.1 · a wall move and the scene snapshot', () => {
  it('writes no scene key for a seeded room until a wall moves — and then does', async () => {
    await mountFor(room());
    // The positive control. Without it, a test that found a scene key after the move
    // could be finding one that was already there.
    expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeUndefined();

    const seeded = useScene.getState().parts.map((p) => p.id);
    expect(useScene.getState().moveWall(0, 0.1)).toBe(0.1);

    await waitFor(
      async () => expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeDefined(),
      { timeout: SETTLE },
    );
    // And it is the room that was on screen, not the room the seeder would rebuild.
    const saved = (await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID))!;
    expect(saved.map((p) => p.id)).toEqual(seeded);
  });

  it('writes no scene key for a DETECTED room, so a re-scan still rebuilds it', async () => {
    await mountFor(room({ detectedObjects: DETECTED }));
    expect(useScene.getState().moveWall(0, 0.1)).toBe(0.1);
    // Waited out rather than checked immediately: the write is debounced, so an
    // assertion on the next tick would pass whether the branch was gated or not.
    await new Promise((r) => setTimeout(r, SETTLE));
    expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeUndefined();
    // …while the room outline itself still persisted, which is what proves the effect
    // ran at all rather than the subscriber never firing.
    expect((await roomStore.loadRoom(ROOM_ID))!.width).toBeCloseTo(5.5, 5);
    expect((await roomStore.loadRoom(ROOM_ID))!.depth).toBeCloseTo(4.8, 5);
  });

  it('writes no scene key when a wall is only REPAINTED', async () => {
    await mountFor(room());
    const before = useScene.getState().room;
    // A colour change goes through the same subscriber with the same `footprint`
    // reference, which is exactly what `reshaped` is testing for.
    useScene.setState({ room: { ...before, wallColors: { 0: '#c8beb4' } } });
    await new Promise((r) => setTimeout(r, SETTLE));
    expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeUndefined();
    expect((await roomStore.loadRoom(ROOM_ID))!.wallColors).toEqual({ 0: '#c8beb4' });
  });
});
