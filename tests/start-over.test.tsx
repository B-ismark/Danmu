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
import { cleanup, render, screen } from '@testing-library/react';
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
vi.mock('@/components/ui/Confirm', () => ({
  confirmDialog: () => Promise.resolve(true),
  useConfirm: () => () => Promise.resolve(true),
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

  it('not after a wall is moved and nothing else — the walls are not what it undoes', () => {
    // The start used to be built for TODAY's walls, which a starter's pieces were not
    // laid out for, so this alone lit the button and pressing it re-laid the room.
    useScene.getState().moveWall(0, 0.3);
    render(<RailFooter />);
    expect(startOverButton()).toBeNull();
  });

  it('nor on a saved room opened at its own size, then reshaped', () => {
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
    expect(startOverButton()).toBeNull();
  });

  it('nor after the ceiling height alone is changed', () => {
    const { width, depth } = useScene.getState().room;
    useScene.getState().setRoom({ width, depth, height: 3.0 });
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

  it('puts back the start for the walls as they are, and clears every per-piece edit', () => {
    editTheRoom();
    startOver();
    const { parts, startSource, room } = useScene.getState();
    expect(parts).toEqual(startingParts(startSource, room));
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

  it('builds for the walls as they are NOW, so a wall moved since is honoured', () => {
    editTheRoom();
    useScene.getState().moveWall(0, 0.3);
    startOver();
    const { parts, startSource, room } = useScene.getState();
    expect(parts).toEqual(startingParts(startSource, room));
  });

  it('Undo brings back exactly what was there', () => {
    const first = editTheRoom();
    const parts = useScene.getState().parts;
    startOver();
    lastUndo()();
    expect(useScene.getState().parts).toBe(parts);
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
