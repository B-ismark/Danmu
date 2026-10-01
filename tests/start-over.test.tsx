// @vitest-environment jsdom
//
// The wiring around two room-level resets, mounted rather than reasoned about.
//
// `lib/room-start.ts` and `lib/orphan-drop.ts` are pure and tested on their own; what
// those files cannot reach is the code that CALLS them — the footer deciding whether
// to offer Start over, `startOver` doing the writes and its Undo putting them back,
// and `removeParts` bringing down what stood on a deleted piece. A review mutated each
// of those call sites (no drop loop, no `landed` handed to the Undo, no hidden-map
// reset) and every existing test stayed green. These are the tests that went red.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { startingParts } from '@/lib/room-start';
import type { ScenePart } from '@/lib/scene-spec';
import type { RoomData } from '@/lib/storage';

type Toast = { title: string; action?: { label: string; onClick: () => void } };
const toasts: Toast[] = [];
vi.mock('@/components/ui/StorageToast', () => ({
  toast: (t: Toast) => {
    toasts.push(t);
  },
  StorageToast: () => null,
}));
const asked: Array<{ title: string; icon?: string }> = [];
vi.mock('@/components/ui/Confirm', () => ({
  useConfirm: () => (req: { title: string; icon?: string }) => {
    asked.push(req);
    return Promise.resolve(true);
  },
  useConfirmDeleteRooms: () => () => Promise.resolve(true),
  ConfirmHost: () => null,
}));
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('start-over-room', 'model'));
vi.mock('@/components/studio/CatalogPanel', () => ({ AddPiecesButton: () => null, CatalogPanel: () => null }));

const { removeParts } = await import('@/components/studio/KeyboardShortcuts');
const { RailFooter, startOver } = await import('@/components/studio/RailFooter');

const lastUndo = () => {
  const action = toasts[toasts.length - 1]?.action;
  if (!action) throw new Error('no Undo on the last toast');
  return action.onClick;
};
const startOverButton = () => screen.queryByRole('button', { name: /^Start over/ });

beforeEach(() => {
  cleanup();
  toasts.length = 0;
  asked.length = 0;
  useScene.getState().loadFromRoom(undefined);
  const st = useStudio.getState();
  st.resetTransforms();
  st.setHiddenMap({});
  st.setPinnedMap({});
  st.setSelected(null);
});

describe('the footer offers Start over only when something was changed', () => {
  it('not on a room as it opened', () => {
    render(<RailFooter />);
    expect(startOverButton()).toBeNull();
  });

  it('after a wall is moved — the walls are part of the start', () => {
    // A wall drag carries the furniture with it, so this is never only the walls.
    useScene.getState().moveWall(0, 0.3);
    render(<RailFooter />);
    expect(startOverButton()).not.toBeNull();
  });

  it('not on a saved room opened at its own size, but once it is reshaped', () => {
    // A record, not the starter: the walls it opens with are its own, which is what
    // the start has to be laid out for.
    useScene.getState().loadFromRoom({
      id: 'saved',
      createdAt: 0,
      name: 'Saved',
      layoutId: 'l',
      width: 5.2,
      depth: 4.4,
      height: 2.7,
    } as RoomData);
    const { unmount } = render(<RailFooter />);
    expect(startOverButton()).toBeNull();
    unmount();
    useScene.getState().moveWall(1, -0.25);
    render(<RailFooter />);
    expect(startOverButton()).not.toBeNull();
  });

  it('asks with the put-it-back glyph, not the bin, and then does it', async () => {
    useScene.getState().moveWall(0, 0.3);
    render(<RailFooter />);
    await act(async () => {
      fireEvent.click(startOverButton()!);
    });
    expect(asked.map((r) => r.icon)).toEqual(['rotate-ccw']);
    expect(useScene.getState().room).toEqual(useScene.getState().startRoom);
  });

  it('after the ceiling height alone is changed', () => {
    const { width, depth } = useScene.getState().room;
    useScene.getState().setRoom({ width, depth, height: 3.0 });
    render(<RailFooter />);
    expect(startOverButton()).not.toBeNull();
  });

  it('not after a wall is painted — the paint is not part of the start', () => {
    useScene.getState().setWallColor(0, '#123456');
    render(<RailFooter />);
    expect(startOverButton()).toBeNull();
  });

  it('after a piece is moved, and after one is deleted', () => {
    const id = useScene.getState().parts[0].id;
    useStudio.getState().setPosition(id, [0.1, 0, 0.1]);
    const { unmount } = render(<RailFooter />);
    expect(startOverButton()).not.toBeNull();
    unmount();
    useStudio.getState().resetTransforms();
    useScene.getState().deletePart(id);
    render(<RailFooter />);
    expect(startOverButton()).not.toBeNull();
  });
});

describe('startOver', () => {
  const extra: ScenePart = {
    id: 'other-99',
    name: 'Added box',
    category: 'other',
    shape: 'box',
    dimMM: [400, 400, 400],
    pos: [0, 0, 0],
    rot: 0,
    locked: false,
  } as ScenePart;

  function editTheRoom() {
    const first = useScene.getState().parts[0].id;
    useScene.getState().addPart(extra);
    const st = useStudio.getState();
    st.setPosition(first, [0.2, 0, 0.2]);
    st.setHiddenMap({ [first]: true });
    st.setPinnedMap({ [first]: true, [extra.id]: true });
    st.setSelected(extra.id);
    return first;
  }

  it('puts back the start, and clears every per-piece edit', () => {
    editTheRoom();
    startOver();
    const { parts, startSource, startRoom } = useScene.getState();
    expect(parts).toEqual(startingParts(startSource, startRoom));
    const st = useStudio.getState();
    expect(st.positions).toEqual({});
    expect(st.hidden).toEqual({});
    expect(st.selectedPartId).toBeNull();
  });

  it('keeps a lock on a piece the start still has, and drops one on a piece it does not', () => {
    const first = editTheRoom();
    startOver();
    expect(useStudio.getState().pinned).toEqual({ [first]: true });
  });

  it('puts the walls and the ceiling back, and keeps the paint', () => {
    // It used to keep today's walls and lay a fresh start out inside them, so a wall
    // drag followed by Start over handed back a different arrangement nobody asked for.
    const opened = useScene.getState().room;
    editTheRoom();
    useScene.getState().moveWall(0, 0.3);
    useScene.getState().setRoom({ width: useScene.getState().room.width, depth: useScene.getState().room.depth, height: 3.1 });
    useScene.getState().setWallColor(1, '#123456');
    startOver();
    const { parts, startSource, startRoom, room } = useScene.getState();
    expect(room.footprint).toEqual(opened.footprint);
    expect([room.width, room.depth, room.height, room.layoutId]).toEqual([opened.width, opened.depth, opened.height, opened.layoutId]);
    expect(room.wallColors).toEqual({ 1: '#123456' });
    expect(parts).toEqual(startingParts(startSource, startRoom));
  });

  it('brings the typical-size mark back with the typical walls', () => {
    useScene.getState().loadFromRoom({
      id: 'typical', createdAt: 0, name: 'Typical', layoutId: 'rect', width: 4, depth: 3.5, height: 2.6, roughSize: true,
    } as RoomData);
    // The person typed a size, which is theirs and clears the mark…
    useScene.getState().setRoom({ width: 4.4, depth: 3.5, height: 2.6 });
    expect(useScene.getState().room.roughSize).toBeUndefined();
    startOver();
    // …and putting the typical size back makes it typical again.
    expect(useScene.getState().room.roughSize).toBe(true);
  });

  it('keeps "these sizes are right" when the walls never moved', () => {
    useScene.getState().loadFromRoom({
      id: 'typical', createdAt: 0, name: 'Typical', layoutId: 'rect', width: 4, depth: 3.5, height: 2.6, roughSize: true,
    } as RoomData);
    useScene.getState().confirmSize();
    editTheRoom();
    startOver();
    expect(useScene.getState().room.roughSize).toBeUndefined();
  });

  it('goes dark once pressed, even after the walls moved — and Undo lights it again', () => {
    editTheRoom();
    useScene.getState().moveWall(0, 0.5);
    startOver();
    const { unmount } = render(<RailFooter />);
    expect(startOverButton()).toBeNull();
    unmount();
    lastUndo()();
    render(<RailFooter />);
    expect(startOverButton()).not.toBeNull();
  });

  it('Undo brings back exactly what was there', () => {
    const first = editTheRoom();
    useScene.getState().moveWall(0, 0.5);
    const parts = useScene.getState().parts;
    const room = useScene.getState().room;
    const startRoom = useScene.getState().startRoom;
    startOver();
    expect(useScene.getState().room).not.toBe(room);
    lastUndo()();
    expect(useScene.getState().parts).toBe(parts);
    // The walls come back with the pieces, and the start stays the one it opened with.
    expect(useScene.getState().room).toBe(room);
    expect(useScene.getState().startRoom).toBe(startRoom);
    const st = useStudio.getState();
    expect(st.positions).toEqual({ [first]: [0.2, 0, 0.2] });
    expect(st.hidden).toEqual({ [first]: true });
    expect(st.pinned).toEqual({ [first]: true, [extra.id]: true });
    expect(st.selectedPartId).toBe(extra.id);
  });

  it('Undo does nothing once another room has opened — the toast outlives the room', () => {
    editTheRoom();
    startOver();
    const undo = lastUndo();
    useScene.setState({ loadedRoomId: 'another-room' });
    const there = useScene.getState().parts;
    undo();
    expect(useScene.getState().parts).toBe(there);
    expect(useStudio.getState().positions).toEqual({});
  });
});

describe('removeParts brings down what stood on what it removed', () => {
  const desk = {
    id: 'desk',
    name: 'Desk',
    category: 'desk',
    shape: 'desk-standard',
    dimMM: [1400, 700, 750],
    pos: [0, 0, 0],
    rot: 0,
    locked: false,
  } as ScenePart;
  const lamp = {
    id: 'lamp',
    name: 'Lamp',
    category: 'lamp',
    shape: 'lamp-table',
    dimMM: [250, 250, 500],
    pos: [0, 0.75, 0],
    rot: 0,
    locked: false,
  } as ScenePart;

  beforeEach(() => {
    useScene.setState({ parts: [desk, lamp] });
    useStudio.getState().setParent('lamp', 'desk');
  });

  it('drops the lamp to the floor and unhooks it from the desk', () => {
    removeParts(['desk']);
    const st = useStudio.getState();
    expect(st.positions.lamp?.[1]).toBe(0);
    expect(st.parentIds.lamp).toBeUndefined();
  });

  it('and its Undo puts the lamp back on the desk with the desk', () => {
    removeParts(['desk']);
    lastUndo()();
    expect(useScene.getState().parts.map((p) => p.id)).toEqual(['desk', 'lamp']);
    const st = useStudio.getState();
    expect(st.positions.lamp).toBeUndefined();
    expect(st.parentIds.lamp).toBe('desk');
  });
});
