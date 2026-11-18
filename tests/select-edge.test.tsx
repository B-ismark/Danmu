// @vitest-environment jsdom
//
// The list opens at the trigger's left edge and may be WIDER than the trigger — the
// floor's size list carries each size's measure as a trailing hint. In the right rail
// that grew it past the window's right edge, hiding the numbers it was widened for. It
// is measured once open and slid back left until it clears the edge.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Select } from '@/components/ui/Select';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rect = (left: number, width: number) =>
  ({ left, right: left + width, width, top: 100, bottom: 134, height: 34, x: left, y: 100, toJSON() {} }) as DOMRect;

function openAt(triggerLeft: number, triggerWidth: number, listWidth: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('role') === 'listbox') return rect(parseFloat(this.style.left), listWidth);
    return rect(triggerLeft, triggerWidth);
  });
  render(
    <Select options={[{ value: 'a', label: 'Classic', hint: '3.5 in × 17.7 in blocks' }]} value="a" onChange={() => {}} ariaLabel="Size" />,
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Size' }));
  return screen.getByRole('listbox');
}

describe('an open Select stays inside the window', () => {
  it('slides left when it would run past the right edge', () => {
    const w = window.innerWidth; // jsdom: 1024
    const list = openAt(w - 220, 200, 300);
    expect(parseFloat(list.style.left)).toBe(w - 8 - 300);
  });

  it('stays at the trigger when it already fits', () => {
    const list = openAt(40, 200, 300);
    expect(parseFloat(list.style.left)).toBe(40);
  });

  it('is never wider than the window, less its margins', () => {
    const list = openAt(40, 200, 300);
    expect(list.style.maxWidth).toBe('calc(100vw - 16px)');
  });
});
