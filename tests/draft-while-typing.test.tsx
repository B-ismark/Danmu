// @vitest-environment jsdom
//
// A size box keeps what is being typed into it. Both size editors commit on a short
// debounce, and the commit echoes back as a new value — which the boxes used to
// reformat, under the caret, mid-number. Reported from the preview: type "2", pause,
// type ".7", and the field read 2.007 (the pause had turned "2" into "2.00"), which
// then rounded to 2.01. The same echo, clamped, turned a sofa's "1" on the way to
// "1.5" into "1.20". Leaving the box is where the draft is tidied into display form.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';
import { RoomDimsEditor } from '@/components/studio/RoomDimsEditor';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('draft-room'));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

const ID = 'curtain-1';

beforeEach(() => {
  vi.useFakeTimers();
  cleanup();
  useScene.setState({
    parts: [
      {
        id: ID, name: 'Curtain', category: 'curtain', shape: 'curtain',
        dimMM: [1600, 80, 2200], pos: [0, 1.1, -1.46], rot: 0, wallMounted: true,
      } as ScenePart,
    ],
    room: { ...useScene.getState().room, width: 4, depth: 3, height: 2.5, footprint: footprintForLayout('rect', 4, 3), layoutId: 'rect' },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [ID], selectedPartId: ID });
  useSettings.setState({ dimUnit: 'm' });
});

/** Types into a box the way a person does: focus, a value, then a pause long enough
 *  for either editor's debounce to commit and echo back. */
function typeAndPause(field: HTMLInputElement, v: string) {
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: v } });
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

describe('a piece’s size box', () => {
  const width = () => {
    const section = screen.getByRole('button', { name: /Exact size/ }).closest('.section') as HTMLElement;
    return within(section).getByLabelText(/^Width$/) as HTMLInputElement;
  };

  it('keeps "2" as typed through the pause, so ".7" makes 2.7', () => {
    render(<PlanPage />);
    typeAndPause(width(), '2');
    expect(useStudio.getState().dims[ID]?.[0], 'the pause committed').toBeCloseTo(2000, 6);
    expect(width().value, 'and did not rewrite the draft').toBe('2');
    typeAndPause(width(), '2.7');
    expect(useStudio.getState().dims[ID]?.[0]).toBeCloseTo(2700, 6);
    fireEvent.blur(width());
    expect(width().value, 'tidied on the way out').toBe('2.70');
  });

  it('keeps a number below the piece’s floor while it is still being typed', () => {
    // A curtain is at least 0.4 m wide, so "0.1" on the way to "0.15"… is clamped
    // on commit — and must not be rewritten to 0.40 under the caret.
    render(<PlanPage />);
    typeAndPause(width(), '0.1');
    expect(useStudio.getState().dims[ID]?.[0]).toBeCloseTo(400, 6);
    expect(width().value).toBe('0.1');
    // …and once the person leaves, the box shows the size the piece really is.
    fireEvent.blur(width());
    expect(width().value).toBe('0.40');
  });

  it('a refused size stays on screen after leaving, beside its sentence', () => {
    render(<PlanPage />);
    typeAndPause(width(), '4.5');
    fireEvent.blur(width());
    expect(width().value).toBe('4.50');
    expect(screen.getByText(/can be at most 4\.00 m wide/)).toBeTruthy();
  });

  it('shows the next piece’s size when the selection moves, even with the caret still in the box', () => {
    // A held draft belongs to the piece it was typed for: "2" left in the box would
    // otherwise sit beside a curtain one metre wide.
    useScene.setState({
      parts: [
        ...useScene.getState().parts,
        { id: 'curtain-2', name: 'Curtain', category: 'curtain', shape: 'curtain', dimMM: [1000, 80, 2200], pos: [0, 1.1, 1.46], rot: Math.PI, wallMounted: true } as ScenePart,
      ],
    });
    render(<PlanPage />);
    typeAndPause(width(), '2');
    act(() => useStudio.setState({ selection: ['curtain-2'], selectedPartId: 'curtain-2' }));
    expect(width().value).toBe('1.00');
  });

  it('another piece’s edit elsewhere still reaches a box nobody is typing in', () => {
    render(<PlanPage />);
    act(() => useStudio.setState({ dims: { [ID]: [1800, 80, 2200] } }));
    expect(width().value).toBe('1.80');
  });
});

describe('the room’s size boxes', () => {
  const height = () => screen.getByLabelText(/^Height$/) as HTMLInputElement;

  it('keep "2" as typed through the pause, so ".7" makes 2.7', () => {
    render(<RoomDimsEditor />);
    typeAndPause(height(), '2');
    expect(useScene.getState().room.height, 'the pause committed').toBeCloseTo(2, 6);
    expect(height().value, 'and did not rewrite the draft').toBe('2');
    typeAndPause(height(), '2.7');
    expect(useScene.getState().room.height).toBeCloseTo(2.7, 6);
    fireEvent.blur(height());
    expect(height().value).toBe('2.70');
  });

  it('still show a change that came from somewhere else', () => {
    render(<RoomDimsEditor />);
    act(() => useScene.setState({ room: { ...useScene.getState().room, height: 3.1 } }));
    expect(height().value).toBe('3.10');
  });
});
