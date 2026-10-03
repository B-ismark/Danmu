// @vitest-environment jsdom
// The info button that replaced the standing hint under the sun dial. It has to
// open under a finger, which is the one thing `Tooltip` deliberately cannot do
// (it latches closed on press), so the gesture sequences are the assertions.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { InfoTip } from '@/components/ui/Tooltip';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const bubble = () => document.body.querySelector<HTMLElement>('[role="tooltip"]');
/** What a screen reader reads as the button's description. */
const description = (btn: HTMLElement) =>
  document.getElementById(btn.getAttribute('aria-describedby') ?? '')?.textContent;

function mount() {
  const r = render(<InfoTip label="About sun direction">Point N at north.</InfoTip>);
  return r.getByRole('button', { name: 'About sun direction' });
}

describe('InfoTip', () => {
  it('a tap opens it and a second tap closes it', () => {
    const btn = mount();
    // What a touch screen dispatches: enter, down, focus, click, leave. The down
    // lands on the button itself, so it must not count as a press elsewhere.
    const tap = () => {
      fireEvent.pointerEnter(btn, { pointerType: 'touch' });
      fireEvent.pointerDown(btn, { pointerType: 'touch' });
      fireEvent.focus(btn);
      fireEvent.click(btn);
      fireEvent.pointerLeave(btn, { pointerType: 'touch' });
    };
    tap();
    expect(bubble()?.textContent).toBe('Point N at north.');
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    tap();
    expect(bubble()).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on mouse hover and closes when the mouse leaves', () => {
    const btn = mount();
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' });
    expect(bubble()).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerLeave(btn, { pointerType: 'mouse' });
    expect(bubble()).toBeNull();
  });

  it('Escape and a press elsewhere both close a pinned bubble', () => {
    const btn = mount();
    fireEvent.click(btn);
    expect(bubble()).not.toBeNull();
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(bubble()).toBeNull();

    fireEvent.click(btn);
    expect(bubble()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(bubble()).toBeNull();
  });

  it('a press pins a hovered bubble, and the next press closes it with the mouse still on it', () => {
    // Closing only the pin used to leave it open under the hover, so the second
    // press did nothing and aria-expanded stayed true.
    const btn = mount();
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' });
    fireEvent.click(btn);
    fireEvent.pointerLeave(btn, { pointerType: 'mouse' });
    expect(bubble(), 'pinned, so leaving keeps it').not.toBeNull();
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' });
    fireEvent.click(btn);
    expect(bubble()).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('inside the phone sheet, Escape closes the bubble and not the sheet', () => {
    // `SheetShell`'s own listener, which runs before React's: it lowers the sheet on
    // an Escape nothing has claimed.
    const lowered = vi.fn();
    const r = render(
      <div data-testid="sheet">
        <InfoTip label="About sun direction">Point N at north.</InfoTip>
      </div>,
    );
    r.getByTestId('sheet').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) lowered();
    });
    const btn = r.getByRole('button', { name: 'About sun direction' });
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(bubble()).toBeNull();
    expect(lowered).not.toHaveBeenCalled();
    // With nothing open, Escape is the sheet's again.
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(lowered).toHaveBeenCalledTimes(1);
  });

  it('the explanation is the description from the first render, and the bubble is not read twice', () => {
    const btn = mount();
    expect(description(btn)).toBe('Point N at north.');
    fireEvent.click(btn);
    expect(bubble()?.getAttribute('aria-hidden')).toBe('true');
    expect(description(btn)).toBe('Point N at north.');
  });

  it('presses go through the bubble to what it covers', () => {
    const btn = mount();
    fireEvent.click(btn);
    expect(bubble()?.style.pointerEvents).toBe('none');
  });

  it.each([
    // A button 60 px from the top: room for one line above, not for four.
    { tall: 20, place: 'top' },
    { tall: 90, place: 'bottom' },
  ])('a $tall px bubble 60 px from the top opens $place', ({ tall, place }) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 60, bottom: 84, left: 100, right: 124, width: 24, height: 24, x: 100, y: 60, toJSON: () => ({}) } as DOMRect,
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(tall);
    fireEvent.click(mount());
    const b = bubble()!;
    expect(b.style.transform).toBe(place === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)');
    expect(b.style.top).toBe(place === 'top' ? '52px' : '92px');
  });
});

describe('the sun dial is gone, and its two jobs have new homes', () => {
  // The dial did two things: it SHOWED where the light came from and it SET which
  // way the room faces. The strip over the canvas shows it now (components/studio/
  // DayStrip.tsx), and the rail's daylight control sets the bearing. Both have to be
  // reachable without a pointer, or deleting the dial deleted a control.
  const ARC = readFileSync('components/studio/DayStrip.tsx', 'utf8');
  const PICKER = readFileSync('components/studio/LightingPicker.tsx', 'utf8');
  it('leaves no dial behind', () => {
    expect(existsSync('components/studio/NorthDial.tsx')).toBe(false);
  });
  it('makes the day strip a keyboard slider for the time of day', () => {
    expect(ARC).toMatch(/role="slider"[\s\S]{0,120}tabIndex=\{0\}[\s\S]{0,80}aria-label="Time of day"/);
    expect(ARC).toMatch(/onKeyDown=/);
  });
  it('keeps the bearing settable, both ways, by name', () => {
    expect(PICKER).toMatch(/aria-label="Turn the room anticlockwise"/);
    expect(PICKER).toMatch(/aria-label="Turn the room clockwise"/);
  });
});
