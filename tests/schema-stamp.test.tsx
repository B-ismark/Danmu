// @vitest-environment jsdom
//
// Schema 3 (the pendant became the flush ceiling light) is the first version whose
// migration lives partly OUTSIDE the room record: a moved pendant's override has to be
// lifted, and only opening the room does that. So the version stamp means "the open has
// run", and two writers used to claim it without that being true:
//
// - an older room opened with nothing to move stayed below 3, so the next open read the
//   size the user had since given the NEW light as a pendant's and squashed it back;
// - any `savePending` stamped 3 — a leave note replayed before the room loads included —
//   so the open that followed skipped the lift and the disc hung under the ceiling.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { clear, get, set } from 'idb-keyval';
import { roomStore, ROOM_SCHEMA_VERSION, type RoomData } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('old-room'));
const { RoomSync } = await import('@/components/studio/RoomSync');

const OLD = { id: 'old-room', name: 'Den', createdAt: 1, version: 2, layoutId: 'rect', width: 5, depth: 4, height: 2.6 } as RoomData;
const meta = () => get<RoomData>('room:old-room:meta');

beforeEach(async () => {
  await clear();
});
afterEach(() => cleanup());

describe('a write that is not the open', () => {
  it('stamps an older record no further than the record alone can carry', async () => {
    await set('room:old-room:meta', OLD);
    await roomStore.savePending('old-room', { room: { edit: (r) => ({ ...r, width: 6 }) } });
    expect((await meta())?.width).toBe(6);
    expect((await meta())?.version).toBe(2);
  });

  it('stamps current when it carries the migration', async () => {
    await set('room:old-room:meta', OLD);
    await roomStore.savePending('old-room', { room: { edit: (r) => r, migrated: true } });
    expect((await meta())?.version).toBe(ROOM_SCHEMA_VERSION);
  });

  it('leaves a current record current', async () => {
    await set('room:old-room:meta', { ...OLD, version: ROOM_SCHEMA_VERSION });
    await roomStore.savePending('old-room', { room: { edit: (r) => r } });
    expect((await meta())?.version).toBe(ROOM_SCHEMA_VERSION);
  });

  it('does not move the room up the list when asked not to', async () => {
    await set('room:old-room:meta', OLD);
    await roomStore.savePending('old-room', { room: { edit: (r) => r, migrated: true }, untouched: true });
    expect(await get('room:old-room:touched')).toBeUndefined();
    await roomStore.savePending('old-room', { room: { edit: (r) => r } });
    expect(await get('room:old-room:touched')).toBeTypeOf('number');
  });
});

describe('opening an older room', () => {
  it('stamps it current even when there was nothing to move, without reordering the list', async () => {
    await set('room:old-room:meta', OLD);
    render(<RoomSync />);
    await waitFor(() => expect(useScene.getState().hydratedRoomId).toBe('old-room'));
    await waitFor(async () => expect((await meta())?.version).toBe(ROOM_SCHEMA_VERSION));
    expect(await get('room:old-room:touched')).toBeUndefined();
  });
});

describe('an open room saving its shell', () => {
  // The stamp says the overrides are up to date IN STORAGE. If the open's own write is
  // lost, a later room-only save (a repaint) must not claim it, or no open ever lifts
  // the pendant's override again.
  it('does not stamp current when the open write was lost and no overrides ride along', async () => {
    await set('room:old-room:meta', OLD);
    const real = roomStore.savePending.bind(roomStore);
    const spy = vi.spyOn(roomStore, 'savePending').mockRejectedValueOnce(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RoomSync />);
    await waitFor(() => expect(useScene.getState().hydratedRoomId).toBe('old-room'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    spy.mockImplementation(real);
    useScene.getState().setSite({ bearingDeg: 90 } as never);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await spy.mock.results[1].value;
    expect(spy.mock.calls[1][1].transforms).toBeUndefined();
    expect((await meta())?.version).toBe(2);
    vi.restoreAllMocks();
  });
});
