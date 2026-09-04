// @vitest-environment jsdom
//
// The plan tab's half of the help card, which for a long time did not say what the two
// lists were.
//
// `StudioHelp` picks its card off `usePathname()`, and `vi.mock` is hoisted to the top of
// a FILE — so the MODULE MOCK is per file. This one wraps the helper's `usePathname` in a
// `vi.fn`, which is what lets one test render both cards; every other test here leaves it
// on `/plan`, and `afterEach` puts it back. That is why this exists beside
// `studio-copy.test.tsx` rather than inside it: that file is mocked to `/model` and pins
// the 3D card, this one defaults to `/plan`. The § G.3 defect was invisible precisely
// because every test that rendered this component was on the other tab, and the one time
// somebody did assert against the plan card the red read as the copy having been deleted.
//
// The group is shared code now (`TwoLists` in `StudioHelp.tsx`), so this is a caller-level
// gate rather than a second copy of the copy.
//
// ── WHAT THIS FILE CANNOT SEE, and it is not a small caveat ────────────────────────
//
// `StudioHelp` renders `onModel ? <ModelHelp/> : <PlanHelp/>`, so the plan card is the
// ELSE branch. **Anything that breaks route plumbing lands on this card**: `usePathname()`
// returning `undefined` or `''`, a typo in the predicate (`endsWith('/mode1')`), the hook
// throwing and being caught. Every `/plan` assertion below, the control included, stays
// green through all of it — what they establish is "the card a non-`/model` route opens",
// which is weaker than it reads.
//
// **One test here is not in that class, deliberately.** The group-order test renders
// `/model` as its second half and asserts that render carries "Walls and the room", so it
// needs `onModel === true` and nothing but a working `usePathname()` produces that.
// Without that heading the test would be satisfied by one card rendered twice, both
// indices 1, and the comparison it exists to make a tautology.
//
// **`studio-copy.test.tsx` is still the file that catches route plumbing** for the copy
// itself. The pair is deliberately asymmetric; the note is here rather than nowhere
// because a fallback branch that cannot be distinguished from a failure is worth knowing
// about at the moment you read the assertions, not after trusting them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { stackedViewport } from './helpers/mount';

// `usePathname` is a SPY over the helper's answer rather than the helper's plain arrow,
// so a single test can render both cards. Everything else in the module object stays as
// `navigationMock` built it. The factory may not close over an import — vitest hoists it
// above every `import` in the file — but `vi` is a global inside it and `await import()`
// resolves at mock time, which is the shape every call site here uses.
vi.mock('next/navigation', async () => {
  const base = (await import('./helpers/mount')).navigationMock('test-room', 'plan');
  return { ...base, usePathname: vi.fn(base.usePathname) };
});

const { StudioHelp } = await import('@/components/studio/StudioHelp');

const PLAN = '/room/test-room/plan';
const MODEL = '/room/test-room/model';

/** The card is a disclosure — the trigger is all that renders until it is pressed. */
function openHelp(pathname: string = PLAN) {
  cleanup();
  vi.mocked(usePathname).mockReturnValue(pathname);
  render(<StudioHelp />);
  fireEvent.click(screen.getByRole('button', { name: 'How this works' }));
}

/** The card's group headings, in document order. `HelpGroup` renders its title as the
 *  `.ds-label` and nothing else in the card uses that class, so this is the rendered
 *  order rather than a reading of the source. */
function groupTitles(): string[] {
  const card = screen.getByRole('note');
  return [...card.querySelectorAll('.ds-label')].map((n) => n.textContent ?? '');
}

afterEach(() => {
  vi.mocked(usePathname).mockReturnValue(PLAN);
});

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

  // WHERE the group sits, which is the whole subject of the fold defect and was gated by
  // nothing until now: every other assertion in this file is a `getByText`, and a
  // `getByText` passes whether the text is second in the card or ninety pixels below its
  // fold. Putting `<TwoLists />` back to third leaves all of them green.
  //
  // jsdom has no layout, so the fold itself is not observable here — DOM ORDER is, and it
  // is the thing that moved. Both cards are asserted because a single pinned card cannot
  // see the defect: the bug was the two DISAGREEING, plan third against model second, and
  // pinning only the one that was wrong would have gone green the moment someone "fixed"
  // it by moving the other.
  it('keeps the group second on BOTH cards, which is what the fold defect was about', () => {
    openHelp(PLAN);
    const plan = groupTitles();
    expect(plan.length, 'no group headings found, so the index below means nothing').toBe(5);
    const planAt = plan.indexOf('The two lists');

    openHelp(MODEL);
    const model = groupTitles();
    expect(model.length).toBe(5);
    const modelAt = model.indexOf('The two lists');

    // Pinned to the same literal on both cards, which IS the agreement. A third
    // assertion comparing the two to each other would be decoration: it can never be
    // the first to fail, so its message would never be read.
    expect(planAt, `plan card groups: ${plan.join(' | ')}`).toBe(1);
    expect(modelAt, `3D card groups: ${model.join(' | ')}`).toBe(1);

    // Without this the test is satisfied by ONE card rendered twice: if the route branch
    // collapsed and `/model` were served the plan card, both lists would be the plan
    // list, both indices 1, and the comparison a tautology. These two headings are the
    // groups the cards do not share.
    expect(plan, 'the first render must be the plan card').toContain('Choosing pieces');
    expect(model, 'the second render must be the 3D card').toContain('Walls and the room');
  });

  // The keyboard half of the same fix, also gated by nothing: deleting `tabIndex={0}`
  // left 18 assertions here and 78 across the help files green, and lint has no opinion
  // either — `jsx-a11y/no-noninteractive-tabindex` is not in Next's subset. The precedent
  // is `tests/reflow.test.ts`'s sash assertion, same shape and same reason.
  //
  // Chrome and Edge do not focus a plain overflow container the way Firefox does, so
  // without this the card is unreachable below its own fold in the two browsers most
  // people use. jsdom cannot see that a card scrolls; it can see whether the card is a
  // legal tab stop and whether it says what it is on arrival.
  it('is a card a keyboard user can land on, and it says what it is when they do', () => {
    openHelp();
    const card = screen.getByRole('note');
    expect(card.tabIndex, 'a scroll box Chrome will not focus cannot be scrolled by keyboard').toBe(0);
    // The accessible name, not the visible heading — a tab stop announced as "note" and
    // nothing else is what `tabIndex` alone produces.
    expect(screen.getByRole('note', { name: 'How this works' })).toBe(card);
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
