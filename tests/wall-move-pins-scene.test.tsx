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

async function mountFor(r: RoomData, minParts = 4) {
  cleanup();
  // `cleanup()` unmounts React and does NOT touch `useScene`, which is a module
  // global that outlives every case. So the store is emptied by hand — a review
  // caught the earlier version claiming "a fresh store per case" while doing no such
  // thing, and the readiness gate below could then be satisfied by the PREVIOUS
  // case's parts before this room's load effect had run, which is the exact failure
  // the gate exists to prevent.
  useScene.setState({ parts: [] });
  await roomStore.saveRoom(r);
  render(<RoomSync />);
  // The load effect is async and `ready` gates every subscriber, so a wall move
  // dispatched before it lands is silently ignored — which would make this file green
  // for the wrong reason. Gated on the room's own DEPTH as well as on the part count,
  // so a stale store cannot satisfy it.
  //
  // `minParts` is per-case rather than a blanket `> 3`, and the reason is the defect
  // the reset above uncovered: a DETECTED room seeds one part per detection, so the
  // one-detection fixture loads exactly ONE piece. With a shared store and a `> 3`
  // gate, that case was waiting for a number only the previous case's sixteen-piece
  // room could reach — it passed, and it was reading the wrong room.
  await waitFor(() => {
    expect(useScene.getState().parts.length).toBeGreaterThanOrEqual(minParts);
    expect(useScene.getState().room.depth).toBeCloseTo(r.depth, 5);
  }, { timeout: SETTLE });
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
    // One detection means one part, which is the whole point of the fixture — and is
    // why the readiness gate has to be told, rather than assuming a seeded room's
    // dozen.
    await mountFor(room({ detectedObjects: DETECTED }), 1);
    expect(useScene.getState().parts).toHaveLength(1);
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

  it('writes no scene key for a room that has PHOTOS but has not been scanned yet', async () => {
    // The gate that `detectedObjects` alone cannot express, and the one a review found
    // rather than a test. `detectedObjects` says what HAS been scanned, never what is
    // about to be; a room with photographs and no detections is exactly the room a
    // first scan is coming to. `RoomSync`'s load prefers a saved scene over
    // `buildSceneFromRoom` forever and only `destroyRoom` clears the key, so pinning
    // here would make *Detect furniture* — a shipped button on `/workspace` — silently
    // do nothing, permanently.
    await roomStore.saveCapture(ROOM_ID, {
      slot: 'n',
      blob: new Blob(['not a real photograph'], { type: 'image/jpeg' }),
      takenAt: Date.now(),
    });
    await mountFor(room());
    expect(useScene.getState().moveWall(0, 0.1)).toBe(0.1);
    await new Promise((r) => setTimeout(r, SETTLE));
    expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeUndefined();
    // The outline still landed, so this is the pin declining rather than the effect
    // never running.
    expect((await roomStore.loadRoom(ROOM_ID))!.depth).toBeCloseTo(4.8, 5);
  });

  it('pins the scene when the room is RESIZED by typing, not only by dragging a wall', async () => {
    // `setRoom` replaces the footprint array on any width/depth change
    // (`lib/scene-store.ts`), so the Room rail's number fields reach this write too.
    // That was incidental until a review measured it; it is the same defect — a typed
    // width re-seeds `defaultScene` on the next open exactly as a dragged wall does —
    // so it is asserted rather than merely allowed.
    await mountFor(room());
    const seeded = useScene.getState().parts.map((p) => p.id);
    useScene.getState().setRoom({ width: 6.5, depth: 4.7, height: 2.8 });
    await waitFor(
      async () => expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeDefined(),
      { timeout: SETTLE },
    );
    expect((await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID))!.map((p) => p.id)).toEqual(seeded);
  });

  it('does NOT pin when only the ceiling height changes', async () => {
    // The other half of the same gate: `setRoom` keeps the footprint reference when
    // width and depth are unchanged, so a height edit must not pin. Without this, the
    // resize case above would pass just as well against a gate that pinned on every
    // room change at all.
    await mountFor(room());
    useScene.getState().setRoom({ width: 5.5, depth: 4.7, height: 2.4 });
    await new Promise((r) => setTimeout(r, SETTLE));
    expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeUndefined();
    expect((await roomStore.loadRoom(ROOM_ID))!.height).toBeCloseTo(2.4, 5);
  });

  it('pins a wall move that is followed by a REPAINT inside the debounce window', async () => {
    // `roomTimer` is shared, so a second room change replaces the first's timer. When
    // the reshaped flag lived in the subscriber's closure the replacement carried
    // `false`, the wall move's outline landed anyway, and the room came back the new
    // shape with the furniture re-seeded — the exact loss this write prevents,
    // reachable by two ordinary gestures a third of a second apart.
    await mountFor(room());
    const seeded = useScene.getState().parts.map((p) => p.id);
    expect(useScene.getState().moveWall(0, 0.1)).toBe(0.1);
    // Well inside DEBOUNCE_MS (300), so the first timer is cleared, never fired.
    await new Promise((r) => setTimeout(r, 80));
    const now = useScene.getState().room;
    useScene.setState({ room: { ...now, wallColors: { 1: '#8f9e83' } } });
    await waitFor(
      async () => expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeDefined(),
      { timeout: SETTLE },
    );
    expect((await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID))!.map((p) => p.id)).toEqual(seeded);
  });

  it('flushes a wall move made just before the room is left', async () => {
    // This effect's cleanup used to clear the timer and write nothing, unlike the two
    // either side of it. A wall dragged within 300 ms of navigating away lost the pin
    // AND the outline — the outline half predates the pin and was silent data loss on
    // its own.
    await mountFor(room());
    const seeded = useScene.getState().parts.map((p) => p.id);
    expect(useScene.getState().moveWall(0, 0.1)).toBe(0.1);
    cleanup(); // unmount inside the debounce window
    await waitFor(
      async () => expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeDefined(),
      { timeout: SETTLE },
    );
    expect((await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID))!.map((p) => p.id)).toEqual(seeded);
    expect((await roomStore.loadRoom(ROOM_ID))!.depth).toBeCloseTo(4.8, 5);
  });

  it('hands the pinned room back on the next open, through the real load path', async () => {
    // The round trip, which nothing else here covers: the two cases above prove the
    // key is WRITTEN, and the consumer is `RoomSync`'s own load
    // (`if (savedScene) setParts(normalizeStoredParts(savedScene))`). If that
    // normalisation dropped pieces, every assertion above would stay green while the
    // commit's claim — that the room you leave is the room you get back — was false.
    await mountFor(room());
    const seeded = useScene.getState().parts.map((p) => p.id);
    expect(useScene.getState().moveWall(0, 0.1)).toBe(0.1);
    await waitFor(
      async () => expect(await roomStore.loadSceneParts<ScenePart[]>(ROOM_ID)).toBeDefined(),
      { timeout: SETTLE },
    );

    // Leave and come back. The room meta now carries the moved outline, so a re-seed
    // would produce the re-seeded list and this would fail.
    cleanup();
    useScene.setState({ parts: [] });
    render(<RoomSync />);
    await waitFor(() => expect(useScene.getState().parts.length).toBeGreaterThan(3), { timeout: SETTLE });
    expect(useScene.getState().parts.map((p) => p.id)).toEqual(seeded);
  });
});
