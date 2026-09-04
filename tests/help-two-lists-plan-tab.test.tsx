// @vitest-environment jsdom
//
// The plan tab's half of the help card, which for a long time did not say what the two
// lists were.
//
// `StudioHelp` picks its card off `usePathname()`, and `vi.mock` is hoisted to the top of
// a FILE — so one test file can only ever be on one route. That is why this exists beside
// `studio-copy.test.tsx` rather than inside it: that file is mocked to `/model` and pins
// the 3D card, this one is mocked to `/plan`. The § G.3 defect was invisible precisely
// because every test that rendered this component was on the other tab, and the one time
// somebody did assert against the plan card the red read as the copy having been deleted.
//
// The group is shared code now (`TwoLists` in `StudioHelp.tsx`), so this is a caller-level
// gate rather than a second copy of the copy: it asks whether the card a person actually
// opens on `/plan` contains it.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('test-room', 'plan'));

const { StudioHelp } = await import('@/components/studio/StudioHelp');

/** The card is a disclosure — the trigger is all that renders until it is pressed. */
function openHelp() {
  cleanup();
  render(<StudioHelp />);
  fireEvent.click(screen.getByRole('button', { name: 'How this works' }));
}

describe('help on the 2D plan says what the two lists are', () => {
  it('carries the group at all', () => {
    openHelp();
    expect(screen.getByText('The two lists')).toBeTruthy();
  });

  it('and names both places, not a side', () => {
    openHelp();
    // Split across `<b>` elements, so the text is read off the container rather than a
    // single text node — the same shape the model-tab assertion uses.
    const line = screen
      .getAllByText(/is what you can add/)
      .map((n) => n.textContent ?? '')
      .join(' ');
    expect(line).toContain('in the left rail');
    expect(line).toContain('on the right of');
    expect(screen.queryByText(/lists on the left/)).toBeNull();
  });

  it('and Ctrl-click is offered here too, because both lists are the same lists', () => {
    openHelp();
    // The second line of the group. Worth its own assertion: the two lists are the same
    // components on both tabs, so an add gesture that works in one works in the other,
    // and a card that teaches it on one tab only is the same signpost gap one layer down.
    const line = screen
      .getAllByText(/picks a run of rows/)
      .map((n) => n.textContent ?? '')
      .join(' ');
    expect(line).toContain('adds that');
  });

  // THE CONTROL, and it is not a restatement of the three above. Every one of them would
  // also pass if the route branch collapsed and `/plan` were served the 3D card — which is
  // a real mutation, one character of `onModel ?`, and it would break the plan tab's help
  // entirely while making this file greener. So: this must still be the PLAN card.
  it('while still being the plan card and not the 3D one', () => {
    openHelp();
    // Only the plan card has these — a lasso and a page rotation are 2D gestures.
    expect(screen.getByText('Choosing pieces')).toBeTruthy();
    expect(screen.getByText(/turn the page/)).toBeTruthy();
    // And only the 3D card has these.
    expect(screen.queryByText('Walls and the room')).toBeNull();
    expect(screen.queryByText(/Left-drag to orbit/)).toBeNull();
  });
});
