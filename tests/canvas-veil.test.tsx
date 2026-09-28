// @vitest-environment jsdom
//
// What covers the canvas while a room opens. Before it, the studio drew whatever the
// scene store still held for the length of three IndexedDB reads: the room you had
// just left, or the starter room, someone else's furniture on the screen that was
// supposed to be yours. The veil is up from the first render until `RoomSync` says
// the load is whole, and on the 3D tab until the first frame.
//
// `RoomSync` is the real one, against fake-indexeddb: the question is whether the
// marker it sets is the one the veil reads, and only the real load can answer that.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { roomStore, type RoomData } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('veil-room'));

const { RoomSync } = await import('@/components/studio/RoomSync');
const { CanvasVeil } = await import('@/components/studio/CanvasVeil');

const ROOM = { id: 'veil-room', name: 'Den', createdAt: 1, version: 1, layoutId: 'rect', width: 6, depth: 5, height: 2.6 } as RoomData;

afterEach(() => cleanup());

describe('the canvas veil', () => {
  it('covers the canvas from the first render until the room has loaded, then lifts', async () => {
    // Another room is in the store, as it is after navigating from one to the next.
    act(() => useScene.setState({ hydratedRoomId: 'the-room-before' }));
    await roomStore.saveRoom(ROOM);
    render(
      <>
        <RoomSync />
        <CanvasVeil />
      </>,
    );
    expect(screen.getByRole('status').textContent).toMatch(/Opening your room…/);
    await waitFor(() => expect(screen.queryByText(/Opening your room/)).toBeNull());
    expect(useScene.getState().hydratedRoomId).toBe('veil-room');
    expect(useScene.getState().room.width).toBe(6);
  });

  it('on the 3D tab, stays until the first frame is drawn', () => {
    act(() => useScene.setState({ hydratedRoomId: 'veil-room' }));
    const { rerender } = render(<CanvasVeil building />);
    expect(screen.getByRole('status').textContent).toMatch(/Building the 3D view…/);
    rerender(<CanvasVeil building={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a revisit of the same room still waits for its load, since another tab may have changed it', async () => {
    act(() => useScene.setState({ hydratedRoomId: 'veil-room' }));
    await roomStore.saveRoom(ROOM);
    render(
      <>
        <RoomSync />
        <CanvasVeil />
      </>,
    );
    expect(screen.getByRole('status').textContent).toMatch(/Opening your room…/);
    await waitFor(() => expect(screen.queryByText(/Opening your room/)).toBeNull());
  });
});
