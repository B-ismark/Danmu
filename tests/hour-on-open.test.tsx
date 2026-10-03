// @vitest-environment jsdom
//
// The light opens at the clock on every ROOM open, not once per page. The store
// outlives a navigation, so a tab left on the rooms list since the morning, then used
// to open a room in the evening, lit the evening for the morning. And the hour it
// sets is the room's baseline, not an undo step: the first Ctrl+Z must not put the
// clock back to the last room's scrub.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { roomStore, type RoomData } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { useHistory } from '@/lib/history';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('clock-room'));

const { RoomSync } = await import('@/components/studio/RoomSync');

const ROOM = { id: 'clock-room', name: 'Den', createdAt: 1, version: 1, layoutId: 'rect', width: 5, depth: 4, height: 2.6 } as RoomData;

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('opening a room', () => {
  it('sets the light to the clock, as the baseline', async () => {
    useStudio.getState().setHour(9); // the morning's scrub, left in the store
    vi.setSystemTime(new Date(2026, 9, 3, 19, 42));
    useScene.setState({ hydratedRoomId: 'the-room-before' });
    await roomStore.saveRoom(ROOM);
    render(<RoomSync />);
    await waitFor(() => expect(useScene.getState().hydratedRoomId).toBe('clock-room'));
    expect(useStudio.getState().hour).toBeCloseTo(19 + 40 / 60, 9);
    // `seedHistory` makes the opened room the one baseline snapshot; the clock is in it.
    const past = useHistory.getState().past as Array<{ hour: number }>;
    expect(past).toHaveLength(1);
    expect(past[0].hour).toBeCloseTo(19 + 40 / 60, 9);
  });
});
