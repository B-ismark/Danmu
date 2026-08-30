// @vitest-environment jsdom
//
// Deleting a merged set, and the one delete gesture that asks first.
//
// The user merged a bed with two nightstands, pressed the right rail's Delete, and
// got the bed removed and both nightstands left standing. The button named one
// piece, they meant the set, and every other surface in the app deletes the set —
// the tree's group row calls `groupMemberIds`, the context menu closes over
// `groupId`, and a drag carries the whole convoy.
//
// The cause was one expression. `RailFooter` called `removeParts([selectedId!])`,
// and `selectedPartId` is the piece a click LANDED on, not what is selected. The
// two are the same for a lone chair and differ for every merged set, which is
// exactly why it survived: the defect is invisible on the pieces anyone tests with.
//
// So the assertions below are about the DIFFERENCE between those two, and the
// regression case deliberately reproduces the old expression rather than trusting
// a comment about it — `it('is the defect that was fixed')` fails the moment the
// two stop differing, which would mean the fixture had stopped being able to
// express the bug.
//
// The rail button is MOUNTED and pressed rather than checked through
// `selectedIds()`, and that is the difference between this file catching the
// defect and describing it. The first version of these tests asserted
// `removeParts(selectedIds())` removes three pieces — true, already true before
// the fix, and green with `RailFooter` still passing `[selectedId!]`. An assertion
// that cannot fail against the bug it guards is decoration; the only way to reach
// this one is to press the actual button.
//
// What this does NOT cover: the keydown binding itself. `deleteSelection` is
// tested directly here; that Delete and Backspace reach it is one `void` call in
// the key switch, and mounting the whole studio to press a key would be a much
// larger test for a much smaller claim.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { selectionForPick, type ScenePart } from '@/lib/scene-spec';

// The dialog is the thing under test in half these cases, so it is controlled
// rather than rendered. `answer` is what the user presses.
let answer = true;
const confirmCalls: Array<{ title: string }> = [];
vi.mock('@/components/ui/Confirm', () => ({
  confirmDialog: (req: { title: string }) => {
    confirmCalls.push({ title: req.title });
    return Promise.resolve(answer);
  },
  useConfirm: () => () => Promise.resolve(true),
  useConfirmDeleteRooms: () => () => Promise.resolve(true),
  ConfirmHost: () => null,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ roomId: 'group-delete-room' }),
  usePathname: () => '/room/group-delete-room/model',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// The footer's other button opens the Library, which pulls the whole catalog
// panel. Nothing here presses it and it is not what this file is about.
vi.mock('@/components/studio/CatalogPanel', () => ({
  AddPiecesButton: () => null,
  CatalogPanel: () => null,
}));

const { removeParts, selectedIds, deleteSelection } = await import(
  '@/components/studio/KeyboardShortcuts'
);
const { RailFooter } = await import('@/components/studio/RailFooter');

function part(p: Partial<ScenePart> & Pick<ScenePart, 'id'>): ScenePart {
  return {
    name: p.id,
    category: 'table',
    shape: 'nightstand',
    dimMM: [450, 400, 550],
    pos: [0, 0, 0],
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

// A bed merged with two nightstands, plus one ungrouped chair that must never be
// touched — the negative half of every assertion here.
const BED = 'bed';
const NS_L = 'nightstand-left';
const NS_R = 'nightstand-right';
const CHAIR = 'chair';

function world(): ScenePart[] {
  return [
    part({ id: BED, name: 'Bed', shape: 'bed-double', category: 'bed', groupId: 'g1' }),
    part({ id: NS_L, name: 'Left nightstand', groupId: 'g1' }),
    part({ id: NS_R, name: 'Right nightstand', groupId: 'g1' }),
    part({ id: CHAIR, name: 'Chair', shape: 'chair-dining', category: 'chair' }),
  ];
}

/** Click the bed, from outside the group — which is what `selectionForPick` calls
 *  a whole-set pick. This is the state the user was in when they pressed Delete. */
function clickTheMergedBed() {
  const parts = useScene.getState().parts;
  useStudio.getState().setSelection(selectionForPick(parts, BED, []), BED);
}

function idsLeft(): string[] {
  return useScene
    .getState()
    .parts.map((p) => p.id)
    .sort();
}

beforeEach(() => {
  cleanup();
  answer = true;
  confirmCalls.length = 0;
  useScene.setState({ parts: world() });
  useStudio.getState().setSelection([], null);
});

describe('the rail button — the surface that actually reported this', () => {
  it('deletes the whole merged set, not the piece the click landed on', () => {
    clickTheMergedBed();
    render(<RailFooter />);
    fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
    expect(idsLeft()).toEqual([CHAIR]);
  });

  it('names the count so the button does not promise one piece and take three', () => {
    clickTheMergedBed();
    render(<RailFooter />);
    expect(
      screen.getByRole('button', { name: 'Delete 3 selected pieces from the scene' }),
    ).toBeTruthy();
  });

  it('still names the piece when one piece is selected', () => {
    useStudio.getState().setSelection([CHAIR], CHAIR);
    render(<RailFooter />);
    expect(screen.getByRole('button', { name: 'Delete Chair from the scene' })).toBeTruthy();
  });

  it('asks nothing first — a pressed button is a decision', () => {
    clickTheMergedBed();
    render(<RailFooter />);
    fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
    expect(confirmCalls).toHaveLength(0);
  });
});

describe('a merged set is selected whole, so it must delete whole', () => {
  it('puts every member in the selection and the clicked piece as primary', () => {
    clickTheMergedBed();
    expect(useStudio.getState().selection.slice().sort()).toEqual([BED, NS_L, NS_R].sort());
    expect(useStudio.getState().selectedPartId).toBe(BED);
  });

  it('deletes all three through selectedIds — what the rail button now passes', () => {
    clickTheMergedBed();
    removeParts(selectedIds());
    expect(idsLeft()).toEqual([CHAIR]);
  });

  it('is the defect that was fixed: the primary id alone deletes only the bed', () => {
    clickTheMergedBed();
    // Verbatim the old expression, so this case fails if the fixture ever stops
    // being able to express the bug — a fixture that cannot reach its defect is
    // the failure mode this repo keeps finding.
    removeParts([useStudio.getState().selectedPartId!]);
    expect(idsLeft()).toEqual([BED, CHAIR, NS_L, NS_R].sort().filter((id) => id !== BED));
    expect(idsLeft()).toContain(NS_L);
    expect(idsLeft()).toContain(NS_R);
  });

  it('still deletes one piece when one piece is selected', () => {
    useStudio.getState().setSelection([CHAIR], CHAIR);
    removeParts(selectedIds());
    expect(idsLeft()).toEqual([BED, NS_L, NS_R].sort());
  });

  it('deletes only the drilled-in member, not the set it belongs to', () => {
    clickTheMergedBed();
    // Second click from INSIDE the group names the one piece (drill-in).
    const parts = useScene.getState().parts;
    const inner = selectionForPick(parts, NS_L, useStudio.getState().selection);
    useStudio.getState().setSelection(inner, NS_L);
    removeParts(selectedIds());
    expect(idsLeft()).toEqual([BED, CHAIR, NS_R].sort());
  });
});

describe('Backspace asks first; the buttons do not', () => {
  it('deletes nothing until the dialog is answered yes', async () => {
    clickTheMergedBed();
    answer = false;
    await deleteSelection();
    expect(confirmCalls).toHaveLength(1);
    expect(idsLeft()).toEqual([BED, CHAIR, NS_L, NS_R].sort());
  });

  it('deletes the whole set once confirmed', async () => {
    clickTheMergedBed();
    answer = true;
    await deleteSelection();
    expect(idsLeft()).toEqual([CHAIR]);
  });

  it('names the count in the title for a set and the piece for a single', async () => {
    clickTheMergedBed();
    await deleteSelection();
    expect(confirmCalls[0].title).toBe('Delete 3 pieces?');

    useScene.setState({ parts: world() });
    useStudio.getState().setSelection([CHAIR], CHAIR);
    await deleteSelection();
    expect(confirmCalls[1].title).toBe('Delete “Chair”?');
  });

  it('asks even for a single piece — the gesture is the axis, not the count', async () => {
    useStudio.getState().setSelection([CHAIR], CHAIR);
    answer = false;
    await deleteSelection();
    expect(confirmCalls).toHaveLength(1);
    expect(idsLeft()).toContain(CHAIR);
  });

  it('does not raise a dialog when nothing is selected', async () => {
    await deleteSelection();
    expect(confirmCalls).toHaveLength(0);
    expect(idsLeft()).toEqual([BED, CHAIR, NS_L, NS_R].sort());
  });

  it('deletes what was selected when the key was pressed, not what is selected when the dialog resolves', async () => {
    clickTheMergedBed();
    const pending = deleteSelection();
    // The selection moves while the dialog is open — a click behind a modal, or
    // any store write. The captured ids must win, or Delete removes something the
    // user never had selected. Same class as a convoy resolving against a fresh
    // world instead of the snapshot it started from.
    useStudio.getState().setSelection([CHAIR], CHAIR);
    await pending;
    expect(idsLeft()).toEqual([CHAIR]);
  });

  it('leaves the piece alone when the dialog is declined and the selection has moved on', async () => {
    clickTheMergedBed();
    answer = false;
    const pending = deleteSelection();
    useStudio.getState().setSelection([CHAIR], CHAIR);
    await pending;
    expect(idsLeft()).toEqual([BED, CHAIR, NS_L, NS_R].sort());
  });
});
