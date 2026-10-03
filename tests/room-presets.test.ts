// @vitest-environment jsdom
//
// Two screens make rooms from a preset — the New room page and the empty Rooms
// page's "Try the starter room" — through one recipe, so the two cannot drift.
// What the recipe owes the room is pinned here: the name the card will show, the
// outline, and whether the size is the user's or a typical stand-in.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clear } from 'idb-keyval';
import { roomStore } from '@/lib/storage';
import { createPresetRoom, PRESET_HEIGHT, ROOM_PRESETS } from '@/lib/room-presets';

beforeEach(async () => {
  await clear();
});

describe('createPresetRoom', () => {
  it('with no size, builds the typical one and says the size is rough', async () => {
    const id = await createPresetRoom('rect');
    const room = await roomStore.loadRoom(id);
    expect(room).toMatchObject({
      id,
      name: 'Living room',
      layoutId: 'rect',
      width: 6,
      depth: 4,
      height: PRESET_HEIGHT,
      roughSize: true,
    });
  });

  it('a typed size is the user’s, even where it equals the typical one', async () => {
    const id = await createPresetRoom('u', { width: 6, depth: 5, height: 2.8 });
    const room = await roomStore.loadRoom(id);
    expect(room).toMatchObject({ name: 'Bedroom', layoutId: 'u', width: 6, depth: 5, height: 2.8 });
    expect(room?.roughSize).toBeUndefined();
    // …and a size that differs is the one built.
    const own = await roomStore.loadRoom(await createPresetRoom('u', { width: 4.2, depth: 3.6, height: 2.5 }));
    expect(own).toMatchObject({ width: 4.2, depth: 3.6, height: 2.5 });
  });

  it('every preset makes a room named for its starter, each with its own id', async () => {
    const ids = await Promise.all(ROOM_PRESETS.map((p) => createPresetRoom(p.id)));
    expect(new Set(ids).size).toBe(ROOM_PRESETS.length);
    const rooms = await Promise.all(ids.map((id) => roomStore.loadRoom(id)));
    expect(rooms.map((r) => [r?.layoutId, r?.name])).toEqual(ROOM_PRESETS.map((p) => [p.id, p.starter]));
  });
});
