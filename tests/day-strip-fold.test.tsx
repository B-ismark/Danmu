// @vitest-environment jsdom
//
// The day over the canvas rests FOLDED — the pill alone, centred, the strip drawn in
// behind it — and opens when it is reached for. Each clause is a way of reaching for
// it, or of leaving it, that a person actually has: a mouse arriving and going, a
// finger that lifts (which reports a leave and is not one), a press elsewhere, the
// keyboard. And the one press that must do nothing but open: the folded pill stands
// at the centre, not at the hour, so treating that press as a grab would jump the day
// to noon.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(null));

const { DayStrip } = await import('@/components/studio/DayStrip');
const { useStudio } = await import('@/lib/store');

const WIDTH = 600;
let rect: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // A canvas wide enough for the strip: jsdom lays nothing out, and the control measures
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
  const { container } = render(<DayStrip />);
  const root = container.querySelector('.day-strip')!;
  const handle = container.querySelector<HTMLElement>('[role="slider"]')!;
  const ring = container.querySelector<HTMLElement>('.day-strip__reach')!;
  const ringNow = () => container.querySelector('.day-strip__reach');
  // The centre of the STRIP's box, which is capped narrower than a wide slot.
  const centre = parseFloat(container.querySelector<HTMLElement>('.day-strip__box')!.style.width) / 2;
  return { root, handle, ring, ringNow, centre, folded: () => root.classList.contains('day-strip--folded') };
}
/** The handle's centre: its left edge plus half the pill. */
const x = (el: HTMLElement) => Number(/translateX\(([-\d.]+)px/.exec(el.style.transform)![1]) + parseFloat(el.style.width) / 2;

describe('the day over the canvas, folded', () => {
  it('rests as the pill alone at the centre, whatever the hour', () => {
    const { handle, centre, folded } = mount();
    expect(folded()).toBe(true);
    // 9 o'clock does not move the folded pill off the centre.
    expect(x(handle)).toBeCloseTo(centre, 5);
  });

  it('opens as the pointer comes near, and the pill goes to its hour', () => {
    const { handle, ring, centre, folded } = mount();
    fireEvent.pointerEnter(ring, { pointerType: 'mouse' });
    expect(folded()).toBe(false);
    expect(x(handle)).toBeLessThan(centre - 50); // morning is well left of noon
  });

  // The strip's box is 0–600 × 0–200 here (every element measures that in this file).
  const mouseTo = (clientX: number, clientY: number) =>
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX, clientY });

  it('folds a breath after the mouse leaves the strip, and not if it comes back', () => {
    const { ring, folded } = mount();
    fireEvent.pointerEnter(ring, { pointerType: 'mouse' });
    mouseTo(900, 500);
    act(() => vi.advanceTimersByTime(100));
    mouseTo(300, 120); // back, inside the strip's box
    act(() => vi.advanceTimersByTime(1000));
    expect(folded()).toBe(false);
    mouseTo(900, 500);
    act(() => vi.advanceTimersByTime(1000));
    expect(folded()).toBe(true);
  });

  it('only rings the pill while it is folded', () => {
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

  it('opens on a press of the folded pill without touching the clock', () => {
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

  it('lets the keyboard Tab from the clock into Overcast and the turn buttons, and folds once it leaves the strip', () => {
    const { root, handle, folded } = mount();
    act(() => handle.focus());
    const overcast = () => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Overcast');
    const turn = () => root.querySelector<HTMLButtonElement>('[aria-label="Turn the room clockwise"]');
    // A browser's Tab picks the next stop FIRST, then blurs the clock (naming that stop
    // as relatedTarget), and React re-renders inside the blur. If the blur folds the
    // strip the row is gone before focus can land in it and focus falls to the page.
    // So: the blur alone, aimed at the row, must leave the row standing.
    fireEvent.blur(handle, { relatedTarget: overcast()! });
    expect(overcast(), 'the row survives the Tab out of the clock').toBeDefined();
    expect(folded()).toBe(false);
    fireEvent.focus(overcast()!);
    fireEvent.blur(overcast()!, { relatedTarget: turn()! });
    expect(turn(), 'and a Tab between its own buttons').not.toBeNull();
    // Leaving the strip altogether folds it.
    fireEvent.blur(turn()!, { relatedTarget: document.body });
    expect(folded()).toBe(true);
  });
});

describe('the day strip, open', () => {
  // The strip is capped at 520 px with a 43 px inset each end, so x maps to the clock
  // as hour = (x − 43) / 434 × 24.
  const xAt = (hour: number) => 43 + (hour / 24) * 434;
  const glyphIsMoon = (c: ParentNode) => c.querySelector('.celestial')!.classList.contains('celestial--night');

  it('scrubs across the horizon, and the sun turns into the moon under the hand', () => {
    const { container } = render(<DayStrip />);
    const handle = container.querySelector<HTMLElement>('[role="slider"]')!;
    const hit = container.querySelector<HTMLElement>('.day-strip__hit')!;
    fireEvent.pointerEnter(handle, { pointerType: 'mouse' });
    expect(glyphIsMoon(container)).toBe(false);
    fireEvent.pointerDown(hit, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: xAt(18) });
    expect(useStudio.getState().draggingId).not.toBeNull();
    expect(useStudio.getState().hour).toBeCloseTo(18, 1);
    fireEvent.pointerMove(hit, { pointerType: 'mouse', pointerId: 1, clientX: xAt(21) });
    // One track: the drag is not held to the half of the clock it started in.
    expect(useStudio.getState().hour).toBeCloseTo(21, 1);
    expect(glyphIsMoon(container)).toBe(true);
    expect(container.querySelector('.day-strip')!.classList.contains('day-strip--night')).toBe(true);
    fireEvent.pointerMove(hit, { pointerType: 'mouse', pointerId: 1, clientX: xAt(10) });
    expect(glyphIsMoon(container)).toBe(false);
    fireEvent.pointerUp(hit, { pointerType: 'mouse', pointerId: 1 });
    expect(useStudio.getState().draggingId).toBeNull();
  });

  it('puts the hour back on Esc mid-drag', () => {
    const { container } = render(<DayStrip />);
    const handle = container.querySelector<HTMLElement>('[role="slider"]')!;
    const hit = container.querySelector<HTMLElement>('.day-strip__hit')!;
    fireEvent.pointerEnter(handle, { pointerType: 'mouse' });
    fireEvent.pointerDown(hit, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: xAt(22) });
    expect(useStudio.getState().hour).toBeCloseTo(22, 1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStudio.getState().hour).toBe(9);
    expect(useStudio.getState().draggingId).toBeNull();
  });

  it('shows the time beside the glyph, folded and open', () => {
    const { container } = render(<DayStrip />);
    const handle = container.querySelector<HTMLElement>('[role="slider"]')!;
    const row = () => [...handle.children].map((c) => c.className);
    expect(row()).toEqual(['day-strip__glyph', 'day-strip__time mono']);
    expect(handle.textContent).toBe('09:00');
    fireEvent.pointerEnter(handle, { pointerType: 'mouse' });
    expect(row()).toEqual(['day-strip__glyph', 'day-strip__time mono']);
  });
});
