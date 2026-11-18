// @vitest-environment jsdom
//
// The Room tools panel (room check, the furniture list, saved layouts) closes when a
// drag starts, so it is not lying over the room someone is arranging. That close runs
// during render, against the drag last seen (it used to be an effect, which left the
// panel open for the drag's first frame); this holds that it happens at all, which
// nothing did — and that it is the START of a drag that closes it, not every render
// while one is in flight, or a panel opened mid-drag would slam shut on each frame.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('room-tools-drag-room'));

const { RoomTools } = await import('@/components/studio/RoomTools');

beforeEach(() => {
  cleanup();
  useScene.setState({
    parts: [],
    room: { ...useScene.getState().room, width: 4, depth: 3, height: 2.5, footprint: footprintForLayout('rect', 4, 3), layoutId: 'rect' },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [], selectedPartId: null, draggingId: null });
});

const trigger = () => screen.getByTitle('Room check, the furniture list and saved layouts');
const drag = (id: string | null) =>
  act(() => {
    useStudio.setState({ draggingId: id });
  });

describe('the Room tools panel and a drag', () => {
  it('closes when a drag starts', () => {
    render(<RoomTools />);
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    drag('sofa-1');
    expect(trigger().getAttribute('aria-expanded'), 'still open over the drag').toBe('false');
  });

  it('closes on the start only, so it can be reopened while the drag is held', () => {
    render(<RoomTools />);
    drag('sofa-1');
    fireEvent.click(trigger());
    // A re-render with the same drag in flight must not close what was just opened.
    act(() => {
      useStudio.setState({ selection: [] });
    });
    expect(trigger().getAttribute('aria-expanded'), 'shut again by the same drag').toBe('true');

    // And the drag ending is not a reason to close it either.
    drag(null);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });
});
