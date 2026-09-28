// A room built at its shape's typical size, because the size step was skipped, is
// marked `roughSize: true` until the person gives a size or says the typical one is
// right. The mark is a claim about every number beside it — the studio's size
// boxes, the capture screen's wall lengths, every piece measured off a photo — so
// the thing to hold is that it survives every path a room travels and clears on
// exactly the two that mean "this is my room's size".

import { beforeEach, describe, expect, it } from 'vitest';
import { markRoughSize, type RoomData } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';
import { buildSceneFile, parseSceneFile, SCENE_FILE_FORMAT, SCENE_FILE_VERSION, sceneFileJson } from '@/lib/scene-file';

const ROOM: RoomData = {
  id: 'room-1',
  createdAt: 1_700_000_000_000,
  name: 'Front Room',
  layoutId: 'l',
  width: 6,
  depth: 5,
  height: 2.8,
};
const ROUGH: RoomData = { ...ROOM, roughSize: true };

describe('the saved record', () => {
  it('marks and unmarks without touching anything else', () => {
    expect(markRoughSize(ROOM, true)).toEqual(ROUGH);
    expect(markRoughSize(ROUGH, false)).toEqual(ROOM);
    // Absent, not `false`: absent is what every room saved before the mark means.
    expect('roughSize' in markRoughSize(ROUGH, false)).toBe(false);
    expect(markRoughSize(ROOM, false)).toEqual(ROOM);
    expect(markRoughSize(ROUGH, true)).toEqual(ROUGH);
  });

  // The reason the helper exists. Both savers read the stored record and spread it,
  // so a stored mark would come back after the studio had cleared it; the live
  // room's answer has to win over the record's, in both directions.
  it('takes the live answer over the stored one', () => {
    const stored = { ...ROUGH, width: 4 };
    expect(markRoughSize({ ...stored, width: 7 }, false)).toEqual({ ...ROOM, width: 7 });
  });

  it('does not mutate what it was given', () => {
    const r = { ...ROUGH };
    markRoughSize(r, false);
    expect(r).toEqual(ROUGH);
  });
});

describe('the studio', () => {
  beforeEach(() => useScene.getState().loadFromRoom(undefined));

  it('opens a rough room as rough, and a measured one as measured', () => {
    useScene.getState().loadFromRoom(ROUGH);
    expect(useScene.getState().room.roughSize).toBe(true);
    useScene.getState().loadFromRoom(ROOM);
    expect('roughSize' in useScene.getState().room).toBe(false);
  });

  // A size typed into the Room section is the person's, even when it happens to be
  // the typical one — which is the case a "has it changed" test would get wrong.
  it('a size typed in clears it, even the same size', () => {
    useScene.getState().loadFromRoom(ROUGH);
    useScene.getState().setRoom({ width: 6, depth: 5, height: 2.8 });
    expect('roughSize' in useScene.getState().room).toBe(false);
  });

  it('"These are right" clears it and moves nothing', () => {
    useScene.getState().loadFromRoom(ROUGH);
    const before = useScene.getState().room;
    useScene.getState().confirmSize();
    const after = useScene.getState().room;
    expect('roughSize' in after).toBe(false);
    const { roughSize: _typical, ...shape } = before;
    expect(after).toEqual(shape);
    // The same outline object, so nothing downstream reads it as a reshape.
    expect(after.footprint).toBe(before.footprint);
  });

  // `RoomSync` saves on every change of the room's identity, so a press on a room
  // that is already measured must not be a write nobody asked for.
  it('on a measured room it is not a change at all', () => {
    useScene.getState().loadFromRoom(ROOM);
    const before = useScene.getState().room;
    useScene.getState().confirmSize();
    expect(useScene.getState().room).toBe(before);
  });

  // Dragging a wall is shaping the room by eye, not measuring it.
  it('a wall drag keeps it', () => {
    useScene.getState().loadFromRoom(ROUGH);
    expect(useScene.getState().moveWall(0, 0.3)).not.toBe(0);
    expect(useScene.getState().room.roughSize).toBe(true);
  });
});

describe('the room file', () => {
  const trip = (room: RoomData) => {
    const out = parseSceneFile(sceneFileJson(buildSceneFile(room, [], { positions: {}, rotations: {}, dims: {} }, 1)));
    if (!out.ok) throw new Error(out.error);
    return out;
  };
  const raw = (roughSize: unknown) =>
    parseSceneFile(
      JSON.stringify({
        format: SCENE_FILE_FORMAT,
        version: SCENE_FILE_VERSION,
        exportedAt: 1,
        room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: 2.6, roughSize },
        parts: [],
      }),
    );

  // A file is how a room is handed to someone else. Without the mark, a guessed
  // 6 × 5 m opens on their screen as somebody's measured room.
  it('carries it there and back', () => {
    const { file, dropped } = trip(ROUGH);
    expect(file.room.roughSize).toBe(true);
    expect(dropped).toEqual([]);
  });

  // Asked of the file as WRITTEN. The reader drops a `false`, so asking the file it
  // read back cannot tell "wrote nothing" from "wrote false".
  it('writes nothing for a measured room', () => {
    const written = buildSceneFile(ROOM, [], { positions: {}, rotations: {}, dims: {} }, 1);
    expect('roughSize' in written.room).toBe(false);
    expect(sceneFileJson(written)).not.toContain('roughSize');
  });

  it('reads `false` as measured, quietly, since nothing is lost', () => {
    const out = raw(false);
    expect(out.ok && 'roughSize' in out.file.room).toBe(false);
    expect(out.ok && out.dropped).toEqual([]);
  });

  // A garbled mark might have meant "rough". Reading it as absent makes that room
  // look measured, so it is said, like every other field a file loses.
  it.each([['yes'], [1], [null], [{}]])('says so when the mark is %j', (value) => {
    const out = raw(value);
    if (!out.ok) throw new Error(out.error);
    expect('roughSize' in out.file.room).toBe(false);
    expect(out.dropped).toEqual(["the note that the room's size is a rough guess was unreadable and was left off"]);
  });
});
