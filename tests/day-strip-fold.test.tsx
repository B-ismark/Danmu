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
const { glyphAt } = await import('@/lib/day-strip');

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
  const phase = (c: ParentNode) => /celestial--(\w+)/.exec(c.querySelector('.celestial')!.getAttribute('class')!)![1];
  /** One animation frame: the scrub hands its hour to the store at most once a frame. */
  const frame = () => act(() => vi.advanceTimersByTime(20));
  function grabbed() {
    const { container } = render(<DayStrip />);
    const handle = container.querySelector<HTMLElement>('[role="slider"]')!;
    const hit = container.querySelector<HTMLElement>('.day-strip__hit')!;
    fireEvent.pointerEnter(handle, { pointerType: 'mouse' });
    return { container, handle, hit };
  }

  it('scrubs across the horizon, and the glyph goes evening, moon, morning under the hand', () => {
    const { container, hit } = grabbed();
    expect(phase(container)).toBe('morning'); // 09:00
    fireEvent.pointerDown(hit, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: xAt(18) });
    expect(useStudio.getState().draggingId).not.toBeNull();
    frame();
    expect(useStudio.getState().hour).toBeCloseTo(18, 1);
    expect(phase(container)).toBe('evening');
    fireEvent.pointerMove(hit, { pointerType: 'mouse', pointerId: 1, clientX: xAt(21) });
    frame();
    // One track: the drag is not held to the half of the clock it started in.
    expect(useStudio.getState().hour).toBeCloseTo(21, 1);
    expect(phase(container)).toBe('night');
    expect(container.querySelector('.day-strip')!.classList.contains('day-strip--night')).toBe(true);
    fireEvent.pointerMove(hit, { pointerType: 'mouse', pointerId: 1, clientX: xAt(12) });
    frame();
    expect(phase(container)).toBe('day');
    fireEvent.pointerMove(hit, { pointerType: 'mouse', pointerId: 1, clientX: xAt(7) });
    frame();
    expect(phase(container)).toBe('morning');
    fireEvent.pointerUp(hit, { pointerType: 'mouse', pointerId: 1 });
    expect(useStudio.getState().draggingId).toBeNull();
  });

  it('moves the pill with the pointer at once, and the hour at most once a frame', () => {
    const { handle, hit } = grabbed();
    let writes = 0;
    const off = useStudio.subscribe((s, p) => { if (s.hour !== p.hour) writes++; });
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    // The last point is 0.6 px past 16:00 — about two minutes, which the five-minute
    // scrub step rounds away — so "where the pointer is" and "where the hour is" differ.
    const last = xAt(16) + 0.6;
    fireEvent.pointerDown(hit, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: xAt(14) });
    for (const px of [xAt(14.5), xAt(15), xAt(15.5), last]) fireEvent.pointerMove(hit, { pointerType: 'mouse', pointerId: 1, clientX: px });
    // The pill is already where the pointer is; the store has not been written yet.
    expect(x(handle)).toBeCloseTo(last, 5);
    expect(writes).toBe(0);
    expect(useStudio.getState().hour).toBe(9);
    // One frame asked for, not one per event.
    expect(raf).toHaveBeenCalledTimes(1);
    frame();
    // Five pointer events, one write, of the last of them.
    expect(writes).toBe(1);
    expect(useStudio.getState().hour).toBeCloseTo(16, 5);
    // The render the write causes keeps the pill under the hand, not on the snapped hour.
    expect(x(handle)).toBeCloseTo(last, 5);
    raf.mockRestore();
    off();
  });

  it('commits the last hour on release, before it lets go of the gesture', () => {
    const { hit } = grabbed();
    fireEvent.pointerDown(hit, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: xAt(14) });
    frame();
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    fireEvent.pointerMove(hit, { pointerType: 'mouse', pointerId: 1, clientX: xAt(20) });
    // Released inside the same frame: the hour the hand let go at must not be lost, and
    // it must land while `draggingId` is still held, or the undo step closes without it.
    let hourAtRelease: number | null = null;
    const off = useStudio.subscribe((s, p) => { if (p.draggingId && !s.draggingId) hourAtRelease = s.hour; });
    fireEvent.pointerUp(hit, { pointerType: 'mouse', pointerId: 1 });
    off();
    expect(hourAtRelease).toBeCloseTo(20, 1);
    // …and no frame left behind to write it again: the one in flight is cancelled,
    // not left to wake up and find nothing to do.
    expect(cancel).toHaveBeenCalledTimes(1);
    cancel.mockRestore();
    const before = useStudio.getState().hour;
    act(() => useStudio.setState({ hour: 3 }));
    frame();
    expect(useStudio.getState().hour).toBe(3);
    expect(before).toBeCloseTo(20, 1);
  });

  it('puts the pill back on its hour after a drag too short to change it, and after an early Esc', () => {
    // A press on the PILL (not the strip) renders it where the hour is; `move` then
    // writes the pointer's place straight onto it, and React only rewrites a style it
    // sees change. A drag shorter than half a step leaves the hour — and so the rendered
    // place — exactly as it was, and the pill stayed where the pointer let go.
    const { handle } = grabbed();
    fireEvent.pointerDown(handle, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: xAt(9) });
    fireEvent.pointerMove(handle, { pointerType: 'mouse', pointerId: 1, clientX: xAt(9 + 1 / 60) });
    expect(x(handle)).toBeCloseTo(xAt(9 + 1 / 60), 5);
    frame();
    fireEvent.pointerUp(handle, { pointerType: 'mouse', pointerId: 1 });
    expect(useStudio.getState().hour).toBe(9);
    expect(x(handle)).toBeCloseTo(xAt(9), 5);
    // Esc inside the first frame: nothing reached the store, so nothing re-rendered.
    fireEvent.pointerDown(handle, { pointerType: 'mouse', button: 0, pointerId: 2, clientX: xAt(9) });
    fireEvent.pointerMove(handle, { pointerType: 'mouse', pointerId: 2, clientX: xAt(4) });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStudio.getState().hour).toBe(9);
    expect(x(handle)).toBeCloseTo(xAt(9), 5);
  });

  it('puts the hour back on Esc mid-drag, dropping the hour still in flight', () => {
    const { hit } = grabbed();
    fireEvent.pointerDown(hit, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: xAt(22) });
    frame();
    expect(useStudio.getState().hour).toBeCloseTo(22, 1);
    fireEvent.pointerMove(hit, { pointerType: 'mouse', pointerId: 1, clientX: xAt(4) });
    fireEvent.keyDown(window, { key: 'Escape' });
    frame();
    expect(useStudio.getState().hour).toBe(9);
    expect(useStudio.getState().draggingId).toBeNull();
  });

  it('hands the glyph how far the sun has risen', () => {
    const { container } = grabbed();
    const lift = (h: number) => {
      act(() => useStudio.setState({ hour: h }));
      return container.querySelector<SVGElement>('.celestial')!.style.getPropertyValue('--lift');
    };
    // The paint reads `--lift`; a glyph without it would sit on its horizon all day.
    expect(lift(7)).toBe(String(glyphAt(7).lift));
    expect(lift(18.5)).toBe(String(glyphAt(18.5).lift));
    expect(Number(lift(7))).toBeLessThan(1);
    expect(lift(12)).toBe('1');
  });

  it('names the picture in the value text', () => {
    const { handle } = grabbed();
    const said = (h: number) => {
      act(() => useStudio.setState({ hour: h }));
      return handle.getAttribute('aria-valuetext');
    };
    expect(said(7)).toBe('07:00, morning');
    expect(said(12)).toBe('12:00');
    expect(said(18.5)).toBe('18:30, evening');
    expect(said(22)).toBe('22:00, night');
    act(() => useStudio.setState({ lighting: 'overcast' }));
    expect(handle.getAttribute('aria-valuetext')).toBe('22:00, overcast');
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
