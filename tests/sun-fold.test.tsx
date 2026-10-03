// @vitest-environment jsdom
//
// The day over the canvas rests FOLDED — the sun alone at the arc's crown — and opens
// into the arc when it is reached for. Each clause is a way of reaching for it, or of
// leaving it, that a person actually has: a mouse arriving and going, a finger that
// lifts (which reports a leave and is not one), a press elsewhere, the keyboard. And the
// one press that must do nothing but open: the folded disc stands at the crown, not at
// the hour, so treating that press as a grab would jump the day to noon.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(null));

const { SunArc } = await import('@/components/studio/SunArc');
const { useStudio } = await import('@/lib/store');

const WIDTH = 600;
let rect: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // A canvas wide enough for the arc: jsdom lays nothing out, and the control measures
  // its slot before drawing anything.
  rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: WIDTH, height: 200, left: 0, top: 0, right: WIDTH, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  // jsdom has no pointer capture. Without these a grab throws inside the handler and is
  // swallowed, so a press that wrongly started a scrub would pass for one that did not.
  Object.assign(HTMLElement.prototype, {
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  });
  useStudio.setState({ lighting: 'daylight', hour: 9, draggingId: null, selection: [], selectedWall: null });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  rect.mockRestore();
  cleanup();
});

function mount() {
  const { container } = render(<SunArc />);
  const root = container.querySelector('.sun-day')!;
  const handle = container.querySelector<HTMLElement>('[role="slider"]')!;
  const ring = container.querySelector<HTMLElement>('.sun-day__reach')!;
  const ringNow = () => container.querySelector('.sun-day__reach');
  // The crown is the middle of the TRACK's box, which is capped narrower than a wide slot.
  const crown = parseFloat(container.querySelector<HTMLElement>('.sun-day__box')!.style.width) / 2;
  return { root, handle, ring, ringNow, crown, folded: () => root.classList.contains('sun-day--folded') };
}
const x = (el: HTMLElement) => Number(/translate\(([-\d.]+)px/.exec(el.style.transform)![1]);

describe('the day over the canvas, folded', () => {
  it('rests as the sun alone at the crown, whatever the hour', () => {
    const { handle, crown, folded } = mount();
    expect(folded()).toBe(true);
    // 9 o'clock does not move the folded disc off the crown.
    expect(x(handle) + 17).toBeCloseTo(crown, 5);
  });

  it('opens as the pointer comes near, and the sun goes to its hour', () => {
    const { handle, ring, crown, folded } = mount();
    fireEvent.pointerEnter(ring, { pointerType: 'mouse' });
    expect(folded()).toBe(false);
    expect(x(handle) + 17).toBeLessThan(crown - 50); // morning is well left of noon
  });

  // The arc's box is 0–600 × 0–200 here (every element measures that in this file).
  const mouseTo = (clientX: number, clientY: number) =>
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX, clientY });

  it('folds a breath after the mouse leaves the arc, and not if it comes back', () => {
    const { ring, folded } = mount();
    fireEvent.pointerEnter(ring, { pointerType: 'mouse' });
    mouseTo(900, 500);
    act(() => vi.advanceTimersByTime(100));
    mouseTo(300, 120); // back, over the sky under the arc
    act(() => vi.advanceTimersByTime(1000));
    expect(folded()).toBe(false);
    mouseTo(900, 500);
    act(() => vi.advanceTimersByTime(1000));
    expect(folded()).toBe(true);
  });

  it('leaves the sky under the open arc to the room', () => {
    const { ring, ringNow, folded } = mount();
    expect(ringNow()).not.toBeNull();
    fireEvent.pointerEnter(ring, { pointerType: 'mouse' });
    expect(folded()).toBe(false);
    expect(ringNow()).toBeNull();
  });

  it('stays open when a finger lifts, and folds on a press elsewhere', () => {
    const { ring, folded } = mount();
    fireEvent.pointerDown(ring, { pointerType: 'touch', button: 0 });
    expect(folded()).toBe(false);
    fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 900, clientY: 500 });
    act(() => vi.advanceTimersByTime(1000));
    expect(folded()).toBe(false);
    fireEvent.pointerDown(document.body, { pointerType: 'touch', button: 0 });
    expect(folded()).toBe(true);
  });

  it('opens on a press of the folded sun without touching the clock', () => {
    const { handle, folded } = mount();
    fireEvent.pointerDown(handle, { pointerType: 'touch', button: 0 });
    expect(folded()).toBe(false);
    expect(useStudio.getState().hour).toBe(9);
    expect(useStudio.getState().draggingId).toBeNull();
  });

  it('opens for the keyboard, and stays open while the keyboard is on it', () => {
    const { handle, ring, folded } = mount();
    act(() => handle.focus());
    expect(folded()).toBe(false);
    // The mouse wandering off must not fold a clock the arrows are still moving.
    fireEvent.pointerEnter(ring, { pointerType: 'mouse' });
    mouseTo(900, 500);
    act(() => vi.advanceTimersByTime(1000));
    expect(folded()).toBe(false);
    act(() => handle.blur());
    expect(folded()).toBe(true);
  });

  it('does not fold under a mouse that is still on it when the keyboard leaves', () => {
    const { handle, ring, folded } = mount();
    fireEvent.pointerEnter(ring, { pointerType: 'mouse' });
    act(() => handle.focus());
    act(() => handle.blur());
    act(() => vi.advanceTimersByTime(1000));
    expect(folded()).toBe(false);
  });
});
