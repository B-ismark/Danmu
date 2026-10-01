// @vitest-environment jsdom
//
// Where a tooltip lands beside the right edge of the window.
//
// "Start over" is the last square in the right rail's footer, and its bubble sat
// over the button BESIDE it. The clamp that keeps a bubble on screen used the
// bubble's maximum width (240 px) rather than its drawn one, so every bubble kept
// 120 px clear of the edge: a short label by the edge slid left by the difference.
// jsdom does no layout, so the trigger's box and the bubble's drawn width are
// stubbed — what is under test is the arithmetic and the re-placement after
// measuring, not the browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Tooltip } from '@/components/ui/Tooltip';

const WINDOW = 1280;
/** The Start over square: 32 px, inside the footer's 16 px padding at the window's
 *  right edge, with Add 8 px to its left. */
const TRIGGER = { left: 1232, top: 900, width: 32, height: 32 };
const NEIGHBOUR_CENTRE = TRIGGER.left - 8 - 30;
/** What "Start over" measures as a bubble. */
const DRAWN = 78;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: WINDOW });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...TRIGGER,
    x: TRIGGER.left,
    y: TRIGGER.top,
    right: TRIGGER.left + TRIGGER.width,
    bottom: TRIGGER.top + TRIGGER.height,
    toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'tooltip' ? DRAWN : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'tooltip' ? 28 : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a short tooltip by the right edge', () => {
  it('sits over its own button, not the one beside it', () => {
    const { getByRole } = render(
      <Tooltip label="Start over">
        <button aria-label="Start over">↺</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(getByRole('button', { name: 'Start over' }));
    const bubble = document.body.querySelector<HTMLElement>('[role="tooltip"]');
    expect(bubble).not.toBeNull();
    // `left` is the bubble's centre (it is translated by -50%).
    const centre = parseFloat(bubble!.style.left);
    const own = TRIGGER.left + TRIGGER.width / 2;
    // Inside the window, by its own drawn width…
    expect(centre + DRAWN / 2).toBeLessThanOrEqual(WINDOW - 8);
    // …and over the button it names: its box spans the button's centre, and it is
    // nearer that button than the one beside it. Clamped by the 240 px cap its centre
    // was 1152 and its box ended at 1191, wholly over Add.
    expect(centre - DRAWN / 2).toBeLessThan(own);
    expect(centre + DRAWN / 2).toBeGreaterThan(own);
    expect(Math.abs(centre - own)).toBeLessThan(Math.abs(centre - NEIGHBOUR_CENTRE));
  });

  it('is drawn at its own width, not squeezed by the room left beside the edge', () => {
    const { getByRole } = render(
      <Tooltip label="Start over">
        <button aria-label="Start over">↺</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(getByRole('button', { name: 'Start over' }));
    expect(document.body.querySelector<HTMLElement>('[role="tooltip"]')!.style.width).toBe('max-content');
  });
});
