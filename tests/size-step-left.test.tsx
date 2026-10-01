// @vitest-environment jsdom
//
// When a size box on the shape picker counts as LEFT.
//
// A box that is not a size yet is only called out once the person has left it —
// red under a box you are still typing in is a scold, not a help. The box is the
// whole field, input and chevrons: pressing a chevron moves focus to it (Chrome
// focuses a clicked button, `tabIndex={-1}` or not), and a blur handler that took
// every focusout for leaving marked the axis left on the first chevron press. From
// then on the field was judged live, so clearing it to type a new number turned it
// red under the person's fingers.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(null));

import LayoutPickPage from '@/app/onboarding/layout-pick/page';
import { quietResizeObserver } from './helpers/mount';

// The preview measures itself; jsdom has no layout to measure, and none is needed here.
quietResizeObserver();

afterEach(cleanup);

function widthField() {
  render(<LayoutPickPage />);
  const input = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
  const field = input.closest('label')!;
  const chevron = field.querySelector<HTMLButtonElement>('button[title="Increase"]')!;
  expect(chevron).not.toBeNull();
  return { input, chevron };
}

describe('a size box on the shape picker', () => {
  it('is not left when focus moves to its own chevron', () => {
    const { input, chevron } = widthField();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.focusOut(input, { relatedTarget: chevron });
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('is left when focus goes anywhere else', () => {
    const { input, chevron } = widthField();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.focusOut(input, { relatedTarget: chevron });
    // …and out of the field from the chevron, which is leaving it too.
    fireEvent.focusOut(chevron, { relatedTarget: document.body });
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('is left when focus goes nowhere', () => {
    const { input } = widthField();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.focusOut(input, { relatedTarget: null });
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
