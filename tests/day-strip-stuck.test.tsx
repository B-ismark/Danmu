// @vitest-environment jsdom
//
// The ways the day strip used to get stuck, found hunting "the sun slider bugs out
// sometimes": a finger's first press scrubbing from the folded pill, a capture lost
// with no up or cancel, a slot that collapses under a drag, and an arrow key that
// wrapped the pill from one end of the strip to the other.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(null));

const { DayStrip } = await import('@/components/studio/DayStrip');
const { useStudio, SUN_DRAG_ID } = await import('@/lib/store');

let width = 600;
let rect: ReturnType<typeof vi.spyOn>;
let resize: (() => void) | null = null;

beforeEach(() => {
  width = 600;
  rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width, height: 200, left: 0, top: 0, right: width, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
  Object.assign(HTMLElement.prototype, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resize = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  useStudio.setState({ lighting: 'daylight', hour: 9, draggingId: null, selection: [], selectedWall: null });
});
afterEach(() => {
  rect.mockRestore();
  vi.unstubAllGlobals();
  cleanup();
});

function mount() {
  const { container } = render(<DayStrip />);
  return {
    container,
    root: container.querySelector('.day-strip')!,
    handle: container.querySelector<HTMLElement>('[role="slider"]')!,
    hit: container.querySelector<HTMLElement>('.day-strip__hit')!,
  };
}
const grab = (hit: HTMLElement) => {
  fireEvent.pointerEnter(hit, { pointerType: 'mouse' });
  fireEvent.pointerDown(hit, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 300 });
  expect(useStudio.getState().draggingId).toBe(SUN_DRAG_ID);
};

describe('the day strip does not get stuck', () => {
  it('a finger\'s first press opens the pill and starts no scrub, though it "enters" first', () => {
    const { handle, root } = mount();
    fireEvent.pointerEnter(handle, { pointerType: 'touch' });
    expect(root.classList.contains('day-strip--folded'), 'a touch enter must not open it by itself').toBe(true);
    fireEvent.pointerDown(handle, { pointerType: 'touch', button: 0, pointerId: 3, clientX: 100 });
    expect(root.classList.contains('day-strip--folded')).toBe(false);
    expect(useStudio.getState().draggingId).toBeNull();
    expect(useStudio.getState().hour).toBe(9);
  });

  it('lets the sun go when pointer capture is lost with no up or cancel', () => {
    const { hit } = mount();
    grab(hit);
    fireEvent.lostPointerCapture(hit, { pointerId: 1 });
    expect(useStudio.getState().draggingId).toBeNull();
  });

  it('lets the sun go when the slot collapses under a drag', () => {
    const { hit } = mount();
    grab(hit);
    width = 0;
    act(() => resize?.());
    expect(useStudio.getState().draggingId).toBeNull();
  });

  it('keyboard arrows stop at the ends instead of wrapping across the strip', () => {
    const { handle } = mount();
    act(() => useStudio.setState({ hour: 23.9 }));
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(useStudio.getState().hour).toBeGreaterThan(23.9);
    act(() => useStudio.setState({ hour: 0.1 }));
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(useStudio.getState().hour).toBe(0);
  });
});
