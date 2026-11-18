// @vitest-environment jsdom
//
// The Inspector's size fields refuse a width the piece's space does not have — the
// user's ruling on the curtain that could be set to 4 m in a 3 m room: "Don't allow if
// it's wider than the available space." `tests/space-bound.test.ts` holds the
// measurement; this holds the FIELD to it, the way a user reaches it — through the
// real plan page's rail, like `tests/mount-height-refusal.test.tsx`.
//
// Three things, each of which could be wrong while the module's own tests pass: the
// size is not written (rule 2 — never resized to fit, and never accepted either), the
// reason is said beside the fields, and the ordinary edit still goes through.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('size-refusal-room'));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

const ID = 'curtain-1';

beforeEach(() => {
  vi.useFakeTimers();
  cleanup();
  // A 4 m × 3 m room; the curtain hangs on the NORTH wall, which is 4 m long.
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

/** The piece's Width, not the room's — the rail has both. Found inside the piece's
 *  own "Exact size" section, by the label a user reads. */
function widthField(): HTMLInputElement {
  const section = screen.getByRole('button', { name: /Exact size/ }).closest('.section') as HTMLElement;
  return within(section).getByLabelText(/^Width$/) as HTMLInputElement;
}

function type(v: string) {
  fireEvent.change(widthField(), { target: { value: v } });
  // The fields commit on a 120 ms debounce.
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

describe('a curtain wider than its wall', () => {
  it('is not written, and says why beside the field', () => {
    render(<PlanPage />);
    type('4.5');
    expect(useStudio.getState().dims[ID], 'no size was stored').toBeUndefined();
    expect(screen.getByText('Curtain can be at most 4.00 m wide here. That is the whole length of the wall it hangs on.')).toBeTruthy();
    // What was typed stays in the field, next to the sentence explaining it.
    expect(widthField().value).toBe('4.5');
  });

  it('while a size that fits goes straight through, and clears the sentence', () => {
    render(<PlanPage />);
    type('4.5');
    type('3.2');
    expect(useStudio.getState().dims[ID]?.[0]).toBeCloseTo(3200, 6);
    expect(screen.queryByText(/can be at most/)).toBeNull();
  });

  it('the arrows stop at the wall, in the field’s own unit', () => {
    render(<PlanPage />);
    expect(Number(widthField().getAttribute('aria-valuemax') ?? widthField().max)).toBeCloseTo(4, 6);
  });
});

// The refusal is about one piece and one typed number. Selecting another piece must not
// carry it over (it used to be cleared in an effect, so it painted one frame on the next
// piece first), and coming back must not resurrect it either: by then the field shows the
// piece's real width again, and a sentence about a number no longer in the field is the
// misleading half of a refusal.
describe('the refusal belongs to the piece and the number it was about', () => {
  const OTHER = 'curtain-2';
  beforeEach(() => {
    const [first] = useScene.getState().parts;
    useScene.setState({
      parts: [first, { ...first, id: OTHER, name: 'Second curtain', pos: [0, 1.1, 1.46], rot: Math.PI } as ScenePart],
    });
  });

  function select(id: string) {
    act(() => {
      useStudio.setState({ selection: [id], selectedPartId: id });
    });
  }

  it('is gone on the next piece, and still gone on the way back', () => {
    render(<PlanPage />);
    type('4.5');
    expect(screen.getByText(/Curtain can be at most 4\.00 m wide here/)).toBeTruthy();

    select(OTHER);
    expect(screen.queryByText(/can be at most/), 'carried onto the other piece').toBeNull();

    select(ID);
    expect(screen.queryByText(/can be at most/), 'resurrected on the way back').toBeNull();
    expect(widthField().value, 'the field shows the real width again').not.toBe('4.5');
    expect(useStudio.getState().dims[ID], 'and nothing was written').toBeUndefined();
  });

  it('is not pinned onto the next piece by a commit that lands after the switch', () => {
    // Type, then switch inside the 120 ms debounce: the pending check still runs, for
    // the FIRST piece, while the second is on screen. Its sentence must not show here.
    render(<PlanPage />);
    fireEvent.change(widthField(), { target: { value: '4.5' } });
    select(OTHER);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText(/can be at most/), 'a late refusal landed on the other piece').toBeNull();
  });
});
