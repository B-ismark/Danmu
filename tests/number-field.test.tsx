// @vitest-environment jsdom
//
// A NumberField's chevrons, pressed: where the focus ends up.
//
// A pressed button takes focus by default, so a press on a chevron moved it out of the
// field onto a button inside `aria-hidden` — focused, and announced as not being there —
// and Up and Down then stepped nothing, since the field they step had lost focus.
// Measured in Chromium on the layout picker's width field: after one press on the up
// chevron, focus sat on `button[title=Increase]` and ArrowUp left the value alone.
//
// jsdom does not move focus on a mouse-down at all, so the two halves are asserted
// apart: the mouse-down's default (the focus move) is cancelled, and the press itself
// puts focus in the field, as a native spinner's arrows do.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NumberField } from '@/components/ui/NumberField';

// Pointer capture, which jsdom does not implement and a chevron calls on every press.
beforeEach(() => {
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
});
afterEach(cleanup);

function Field() {
  const [v, setV] = useState('3.00');
  return <NumberField value={v} onChange={setV} step={0.05} ariaLabel="Width in m" />;
}

// By title: the chevrons are aria-hidden, so a role query does not see them.
const chevron = (name: 'Increase' | 'Decrease') => screen.getByTitle(name);

describe('pressing a NumberField chevron', () => {
  it.each(['Increase', 'Decrease'] as const)('%s does not take focus on its mouse-down', (name) => {
    render(<Field />);
    // `fireEvent` returns false when a handler cancelled the event's default.
    expect(fireEvent.mouseDown(chevron(name))).toBe(false);
  });

  it.each([
    ['Increase', '3.05'],
    ['Decrease', '2.95'],
  ] as const)('%s puts focus in the field and steps it', (name, stepped) => {
    render(<Field />);
    const input = screen.getByLabelText('Width in m');
    expect(document.activeElement).not.toBe(input);
    fireEvent.pointerDown(chevron(name));
    fireEvent.pointerUp(chevron(name));
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe(stepped);
  });
});
