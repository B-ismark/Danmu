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
// gate rather than a second copy of the copy.
//
// ── WHAT THIS FILE CANNOT SEE, and it is not a small caveat ────────────────────────
//
// `StudioHelp` renders `onModel ? <ModelHelp/> : <PlanHelp/>`, so the plan card is the
// ELSE branch — and `navigationMock`'s `tab` parameter defaults to `'plan'`, so even
// deleting the argument here is a no-op. **Anything that breaks route plumbing lands on
// this card**: `usePathname()` returning `undefined` or `''`, a typo in the predicate
// (`endsWith('/mode1')`), the hook throwing and being caught. Every assertion below,
// the control included, stays green through all of it. What this file establishes is
// "the card a non-`/model` route opens", which is weaker than the sentence it replaced
// claimed.
//
// **`studio-copy.test.tsx` is the half that catches route plumbing**, because it needs
// `onModel === true` and nothing but a working `usePathname()` produces that. The pair is
// deliberately asymmetric and this is the loose half; the note is here rather than
// nowhere because a fallback branch that cannot be distinguished from a failure is worth
// knowing about at the moment you read the assertions, not after trusting them.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { stackedViewport } from './helpers/mount';

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
    const nodes = screen.getAllByText(/is what you can add/);
    // ONE element, and the count is the assertion. Joining several nodes and asking
    // `toContain` twice is satisfied by two DIFFERENT elements — split the line into
    // "Catalog, in the left rail, is what you can add" and "Library, on the right of the
    // canvas, is what you can add" and both `toContain`s pass while the copy now tells
    // the user the Catalog is the list to add from.
    expect(nodes, 'the two places must be in ONE sentence, not two').toHaveLength(1);
    const line = nodes[0].textContent ?? '';
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

  // The OTHER branch of the sentence, which no test could reach until
  // `stackedViewport` existed. Below 1023px `DockedShell` renders one column with the
  // Catalog under the room and there is no left rail, so the wide wording is false
  // there — reachable at 200% zoom on a 1280px laptop, which reports 640px.
  it('and names the stacked layout\'s panel instead of a rail that is not there', () => {
    const restore = stackedViewport();
    try {
      openHelp();
      const nodes = screen.getAllByText(/is what you can add/);
      expect(nodes).toHaveLength(1);
      const line = nodes[0].textContent ?? '';
      expect(line).toContain('in the panel under the room');
      expect(line, 'the wide wording must not survive into a stacked shell').not.toContain('left rail');
      // The half that does NOT branch, asserted here too: if a future edit makes the
      // Library sentence conditional as well, this is where it goes wrong first.
      expect(line).toContain('on the right of the canvas');
    } finally {
      restore();
    }
  });

  // A word and a keycap, with the space between them. JSX strips the trailing newline and
  // indent from a text chunk, and `Kb` carries `marginRight` but no left margin, so a line
  // break falling between "Keep" and <Kb>Alt</Kb> rendered "KeepAlt" on screen with nothing
  // in the DOM to notice — the text node really did end in "Keep". Reading the two cards
  // side by side is what surfaced it, which was the stated reason for putting them in one
  // file. Asserted on the RENDERED text, because the source is where it looks correct.
  it('puts a space between a word and the keycap after it', () => {
    openHelp();
    const line = screen.getByText(/lets you pick/).textContent ?? '';
    expect(line).toContain('Keep Alt');
    expect(line, 'JSX ate the space before the keycap').not.toContain('KeepAlt');
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
