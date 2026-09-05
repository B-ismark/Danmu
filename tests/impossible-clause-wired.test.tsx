// @vitest-environment jsdom
//
// **Does the panel hand the solver's own terms to the sentence?**
//
// `impossibleClause` is asserted over hand-built term arrays and `declinedTerms` is
// asserted over real solves, both in `tests/impossible-veto.test.ts`. Nothing joined
// them, and the gap was total: replacing ALL FOUR `impossibleClause(result.declinedTerms)`
// call sites in `RoomTools` with `impossibleClause([])` — the disjunction this whole
// change exists to delete — kept 8 files / 234 tests green and `tsc` clean, and no test in
// the repo contained any of the four strings. Both ends pinned, the wire decoration.
//
// That is `tests/room-tools-findings.test.tsx`'s scar one layer over: *"a finding the
// caller drops is a finding that does not exist"*. There the dropped finding was
// `analyzeRoom`'s sentence; here it is WHICH condition the refusal names.
//
// Two decisions worth defending, because both look like shortcuts and are not:
//
// · **`solveLayout` is mocked, and it has to be.** A single-term refusal cannot be
//   produced by a real solve on any room this app can seed: `declineFor` fires on the
//   SUM of `IMPOSSIBLE_TERMS` rising, every seeded room is legal, so `before.overlap` and
//   `before.outside` are both exactly 0 and an illegal winner raises both at once.
//   Driving this through the real solver would assert the both-terms case only — which is
//   precisely what `impossibleClause([])` also produces, so the mutation would survive and
//   the file would be decoration about decoration. The mock is `importActual`-based:
//   `impossibleClause`, `IMPOSSIBLE_TERMS`, `isWorthOffering` and `lockedForSolve` are all
//   the REAL ones. What is faked is the solver's answer, never the sentence built from it.
//
// · **All four sites, through four presses.** Three would leave the fourth free, and "the
//   branch is wired" is a claim about the branch. `u` at 6 × 4 is the fixture that makes
//   it affordable: its seeded scene reports `zone` (one piece named, so the confined arm)
//   and `cut-off` (no pieces, so the unconfined arm) at once, and shrinking the room under
//   the SAME cast reaches the re-fit offer. `cut-off` is the only movable rule in
//   `RULE_HANDLING` that names no piece, so it is the sole route to the unconfined arm.
//
// What this does NOT prove: no layout, no overflow, no contrast, no pixels, and nothing
// about the toast host — `toast` is spied at the module boundary, so this settles what
// `RoomTools` says and not that the strip renders it. Mounting under jsdom settles wiring
// and nothing else.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { defaultScene } from '@/lib/scene-spec';
import { DEFAULT_WEIGHTS, type CostBreakdown } from '@/lib/layout-score';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';
import type { ToastSpec } from '@/components/ui/StorageToast';
import type { ImpossibleTerm, SolveDecline, SolveResult } from '@/lib/layout-solve';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('clause-room'));

/** Every toast raised during a test, in order and whole — `action` included, because the
 *  re-fit sentence is reached by pressing a button that lives inside a toast. */
const toasts: ToastSpec[] = [];

vi.mock('@/components/ui/StorageToast', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/StorageToast')>(
    '@/components/ui/StorageToast',
  );
  return { ...actual, toast: (spec: ToastSpec) => toasts.push(spec) };
});

const solveSpy = vi.fn();
vi.mock('@/lib/layout-solve', async () => {
  const actual = await vi.importActual<typeof import('@/lib/layout-solve')>('@/lib/layout-solve');
  return { ...actual, solveLayout: (...args: unknown[]) => solveSpy(...args) };
});

const { RoomTools } = await import('@/components/studio/RoomTools');

/** Derived from the weight table rather than typed out, so a new cost term cannot leave a
 *  hand-written fixture one key short of the type it claims to be. `layout-score`'s own
 *  `ZERO` is module-private. */
const ZERO = {
  ...(Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0])) as Record<string, number>),
  total: 0,
} as CostBreakdown;

const HEIGHT = 2.5;

/** The `u` starter, as the SEED path produces it — which is not quite as the load path
 *  does, and that was checked rather than assumed.
 *
 *  `defaultScene` authors `circle` at four sites and misses a fifth: this room's
 *  `lamp-table` is seeded without it while the plant, floor lamp and pendant get it.
 *  `normalizeStoredParts` re-derives the flag, but only on the three paths that load a
 *  PERSISTED snapshot — the seed path hands `defaultScene` straight to `setParts`,
 *  because the seeder is supposed to author it. So a fresh starter room and the same room
 *  after a save disagree about one lamp's footprint (found by the footprint lane, filed in
 *  the research doc's § H.7, unfixed at the time of writing).
 *
 *  It does not reach this file, and that is measured, not argued: `analyzeRoom` over this
 *  scene reports the same two findings — `zone` "Bed hard to get into" and `cut-off` "Part
 *  of the floor is cut off" — with the flag set and with it absent. Both arms of
 *  `tryFixFor` below therefore exist in both worlds. Worth re-running if that fix lands
 *  and this file goes red for no reason you can see. */
function seeded(w: number, d: number) {
  const footprint = footprintForLayout('u', w, d);
  return { footprint, parts: defaultScene('u', w, d, { footprint, height: HEIGHT }) };
}

/** What a refusal actually looks like coming out of the solver: the winner reverted, so
 *  nothing moved and `breakdownAfter` has already been reset to `breakdownBefore`. */
function refusal(
  terms: ImpossibleTerm[],
  parts: ScenePart[],
  declined: SolveDecline = 'impossible',
): SolveResult {
  return {
    placements: parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot })),
    declined,
    declinedTerms: terms,
    before: 10,
    after: 10,
    breakdownBefore: ZERO,
    breakdownAfter: ZERO,
    moved: [],
    moves: [],
    finalists: [],
  };
}

function mount(w = 6, d = 4) {
  const { footprint, parts } = seeded(w, d);
  act(() => {
    useScene.setState({
      parts,
      room: { ...useScene.getState().room, width: w, depth: d, height: HEIGHT, footprint, layoutId: 'u' },
    });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [], selectedPartId: null });
    useSettings.setState({ dimUnit: 'm', stepFree: false });
  });
  render(<RoomTools />);
  return parts;
}

/** The findings list is behind its own disclosure, reached the way
 *  `tests/room-tools-findings.test.tsx` reaches it. */
function openFindings() {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /issue/ }));
  });
}

/** The **Try a fix** button belonging to ONE finding, found through that finding's own
 *  title rather than by position in the list. Two of these are on screen and they take
 *  different branches, so picking by index would silently test one branch twice the day
 *  the report reorders itself. */
function tryFixFor(title: string): HTMLElement {
  // **The fixture's shape, pinned before the walk rather than inferred from it.** The
  // whole file rests on this mount producing exactly two fixable findings — `zone`,
  // which names a piece and so confines the solve, and `cut-off`, which names none and
  // so does not. If either lost `canFix`, the walk below would run past its own row to
  // the list holding both and hand back the OTHER finding's button. The two tests would
  // still fail, because each asserts a branch-discriminating string, but they would fail
  // as a puzzling `toContain` mismatch rather than as "the fixture changed shape". One
  // count says which it is.
  expect(
    screen.queryAllByRole('button', { name: 'Try a fix' }),
    'this mount is supposed to offer exactly two fixable findings — the confined arm and the unconfined one',
  ).toHaveLength(2);
  // Walk OUT from the title to the SMALLEST ancestor holding exactly one such button —
  // the finding's own row. Walking in from the buttons instead matched both findings,
  // because every button's ancestry eventually reaches the list that contains every
  // title: a scope that grows until it is true is not a scope.
  for (let el: HTMLElement | null = screen.getByText(title); el && el.tagName !== 'BODY'; el = el.parentElement) {
    const buttons = within(el).queryAllByRole('button', { name: 'Try a fix' });
    if (buttons.length === 1) return buttons[0];
    if (buttons.length > 1) break;
  }
  throw new Error(`no row with exactly one "Try a fix" around "${title}"`);
}

/** rAF, run through. `useBusyAction` yields TWO frames before doing the work (see
 *  `lib/after-paint.ts`), and jsdom's own rAF is tied to a real timer, which would make
 *  every assertion here a race. Nothing below is about the busy flag —
 *  `tests/busy-action.test.tsx` owns that — so running the frames inline is the whole of
 *  what this needs. */
const realRaf = globalThis.requestAnimationFrame;

beforeEach(() => {
  toasts.length = 0;
  solveSpy.mockReset();
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  cleanup();
});

/** The one thing the panel said. The count is asserted rather than assumed at every site:
 *  a press that raised nothing would otherwise read as a press that said the right thing,
 *  in a file where a stale toast is one line away. */
function said(): ToastSpec {
  expect(
    toasts.map((t) => t.title),
    'exactly one toast per press',
  ).toHaveLength(1);
  return toasts[0];
}

// One case per reachable clause. The negative half carries each row: asserting only that
// "through a wall" appears passes against the disjunction, which CONTAINS it — and the
// disjunction is exactly what a call site that stopped passing its terms produces.
const CASES: { terms: ImpossibleTerm[]; says: string; notSays: string }[] = [
  { terms: ['outside'], says: 'through a wall', notSays: 'inside another' },
  { terms: ['overlap'], says: 'inside another', notSays: 'through a wall' },
];

describe('the refusal names the condition the solver named, at every site that says it', () => {
  describe.each(CASES)('a refusal naming only $terms', ({ terms, says, notSays }) => {
    it('Fix says it', () => {
      const parts = mount();
      solveSpy.mockReturnValue(refusal(terms, parts));
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /^Fix$/ }));
      });
      expect(solveSpy, 'the press must actually have solved').toHaveBeenCalled();
      expect(said().title).toBe('No safe arrangement found');
      expect(said().message).toContain(says);
      expect(
        said().message,
        'a site that stopped passing its terms falls back to the disjunction',
      ).not.toContain(notSays);
    });

    it('a confined Try a fix says it — the finding that names a piece', () => {
      const parts = mount();
      openFindings();
      solveSpy.mockReturnValue(refusal(terms, parts));
      act(() => {
        fireEvent.click(tryFixFor('Bed hard to get into'));
      });
      expect(said().title).toBe('No safe way to move those');
      expect(said().message).toContain(says);
      expect(said().message).not.toContain(notSays);
      // The confined arm's own half: it must offer the WIDER move, which is the only thing
      // separating this sentence from the unconfined one below.
      expect(said().message).toContain('Fix can rearrange the whole room');
    });

    it('an unconfined Try a fix says it — the finding that names no piece', () => {
      const parts = mount();
      openFindings();
      solveSpy.mockReturnValue(refusal(terms, parts));
      act(() => {
        fireEvent.click(tryFixFor('Part of the floor is cut off'));
      });
      expect(said().title).toBe('No safe way to move those');
      expect(said().message).toContain(says);
      expect(said().message).not.toContain(notSays);
      expect(said().message).toContain('Try unlocking a piece');
    });

    it('the re-fit offer after a size change says it', () => {
      const parts = mount();
      // Same cast, smaller room: `u` 6 × 4 reports 2 findings and 5.5 × 3.8 reports 8, so
      // the "that size change left N problems" offer fires. The cast has to be identical
      // or the panel correctly refuses to blame a size nobody touched.
      act(() => {
        useScene.setState({
          room: {
            ...useScene.getState().room,
            width: 5.5,
            depth: 3.8,
            footprint: footprintForLayout('u', 5.5, 3.8),
          },
        });
      });
      const offer = toasts.find((t) => t.action?.label === 'Re-fit');
      expect(
        offer,
        `no re-fit offer was made; toasts: ${toasts.map((t) => t.title).join(' | ') || '(none)'}`,
      ).toBeTruthy();
      toasts.length = 0;
      solveSpy.mockReturnValue(refusal(terms, parts));
      act(() => {
        offer!.action!.onClick();
      });
      expect(said().title).toBe('No safe way to fit that');
      expect(said().message).toContain(says);
      expect(said().message).not.toContain(notSays);
    });
  });

  it('a refusal naming BOTH conditions still says both, joined once', () => {
    const parts = mount();
    solveSpy.mockReturnValue(refusal(['overlap', 'outside'], parts));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Fix$/ }));
    });
    // The two phrases JOINED, not merely both present somewhere in the sentence — which
    // is what pins the order, and the order is `IMPOSSIBLE_TERMS`'. A first draft counted
    // ` or ` occurrences instead and was simply wrong: the remedy clause after it ("Press
    // Fix again …, or unlock a piece") carries a second one, so the count was 2 for a
    // correct sentence. A count over a whole sentence is not a claim about a list.
    expect(said().message).toContain('put a piece inside another one or through a wall');
  });

  it('a decline that is NOT impossible never reaches the clause at all', () => {
    const parts = mount();
    solveSpy.mockReturnValue(refusal([], parts, 'no-gain'));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Fix$/ }));
    });
    expect(said().title).toBe('This is already a good arrangement');
    expect(said().message).not.toContain('through a wall');
    expect(said().message).not.toContain('inside another');
  });
});
