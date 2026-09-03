// @vitest-environment jsdom
//
// The first test in this repo that mounts a component, and it exists for one
// question: **does the panel render the sentence `lib/` already computes?**
//
// Nothing here re-tests `analyzeRoom` — `tests/clearance.test.ts` owns that, including
// this exact finding's wording. What no test could see until now is the step after it.
// Every function in `lib/` is asserted and **nothing checked that a component calls
// one**, so a correct answer computed and then dropped on the floor by its caller was
// invisible to all 82 test files. That is the `blockedBy` scar in `CLAUDE.md` — "a
// finding the caller drops is a finding that does not exist" — and it went a whole
// commit unseen because only a human eye could have caught it.
//
// Why `RoomTools` and not the Inspector: `docs/what-is-still-open.md` § E said Inspector
// and was wrong. `RoomTools.tsx` is what imports `analyzeRoom` and what reads
// `RULE_HANDLING` for the **Try a fix** button; nothing in `Inspector.tsx` touches
// `analyzeRoom` at all.
//
// What this does NOT prove, and must not be read as proving: no layout, no overflow, no
// contrast, no focus ring, no pixels. Mounting under jsdom settles wiring and nothing
// else. The browser items in `docs/visual-check.md` still need a person.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { formatLength } from '@/lib/units';
import { analyzeRoom } from '@/lib/clearance';
import { TURNING_DIAMETER } from '@/lib/clearance-field';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings, type DimUnit } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

// `RoomTools` calls `useParams` to key its saved layouts by room. Mocked rather than
// wrapped in a router, because the route is not what is under test and a real router
// would be a second thing that could fail.
vi.mock('next/navigation', () => ({
  useParams: () => ({ roomId: 'test-room' }),
}));

const { RoomTools } = await import('@/components/studio/RoomTools');

/** A 1.90 m attic with a real door in it — the one combination the range tables
 *  disagree about. `door`'s height floor is 1980 mm and `ROOM_HEIGHT_M.min` is 1800,
 *  so every room between those two has no legal door at all. The user reported it as
 *  "the door doesn't reduce its height", which is exactly right: it cannot. */
const ATTIC = { width: 6, depth: 4, height: 1.9 };

function door(): ScenePart {
  return {
    id: 'door-1',
    name: 'Front door',
    category: 'door',
    shape: 'door',
    dimMM: [900, 50, 2100],
    pos: [0, 1.05, -1.98],
    rot: 0,
    locked: false,
    wallMounted: true,
  } as ScenePart;
}

/** Too tall for the attic and shrinkable, so it gets the other branch of the same
 *  sentence. 2.2 m against a 1.6 m floor. */
function wardrobe(): ScenePart {
  return {
    id: 'wardrobe-1',
    name: 'Tall wardrobe',
    category: 'wardrobe',
    shape: 'wardrobe',
    dimMM: [1800, 600, 2200],
    pos: [2, 1.1, 1.5],
    rot: 0,
    locked: false,
  } as ScenePart;
}

/** Something that HANGS, which is why the sentence has two leads at all. */
function curtain(): ScenePart {
  return {
    id: 'curtain-1',
    name: 'Long curtain',
    category: 'curtain',
    shape: 'curtain',
    dimMM: [1600, 80, 2600],
    pos: [0, 1.3, -1.96],
    rot: 0,
    locked: false,
    wallMounted: true,
  } as ScenePart;
}

/** The shipping default, and the reason § B.12 was a defect: `useSettings.dimUnit` is
 *  `'m'`, so a panel hard-coding centimetres disagreed with the room's own fields
 *  before the user touched anything. Every assertion below is written in it. */
const UNIT: DimUnit = 'm';

/** The shortest a door / a wardrobe goes, written the way a FINDING writes it.
 *
 *  Derived, not typed, for the reason it always was — `clearance.ts` composes the
 *  sentence from `dimRangeFor`'s own floor, so a shape whose minimum is raised later
 *  starts telling the truth without anyone editing a string, and a literal here would
 *  be the copy that goes stale. It now goes through `formatLength` as well, which is
 *  the same call the sentence makes: a change to the rounding or the unit cannot leave
 *  this file green against a panel saying something else. */
const doorFloor = (u: DimUnit) => formatLength(dimRangeFor('door', 'door').min[2], u);
const wardrobeFloor = (u: DimUnit) => formatLength(dimRangeFor('wardrobe', 'wardrobe').min[2], u);

beforeEach(() => {
  cleanup();
  useScene.setState({
    parts: [door()],
    room: {
      ...useScene.getState().room,
      width: ATTIC.width,
      depth: ATTIC.depth,
      height: ATTIC.height,
      footprint: footprintForLayout('rect', ATTIC.width, ATTIC.depth),
      layoutId: 'rect',
    },
  });
  // No user overrides: the resolved scene is the authored one, so the finding under
  // test comes from the part above and not from a leftover drag in another test.
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [], selectedPartId: null });
  useSettings.setState({ stepFree: false, dimUnit: UNIT });
});

describe('the room panel renders the finding lib/clearance.ts computed', () => {
  it('has a finding to render in the first place', () => {
    // The precondition, asserted rather than assumed. Without this the two tests below
    // could both pass against a room that produces no findings at all — the
    // iterate-over-whatever-you-found shape, where an empty list is vacuously fine.
    const report = analyzeRoom(
      [door()],
      { footprint: footprintForLayout('rect', ATTIC.width, ATTIC.depth), height: ATTIC.height },
      // Handed the same unit the panel is set to. `analyzeRoom`'s own default is `'cm'`
      // — deliberately, so the two callers that never show a finding to anyone are not
      // steered by Settings — so a direct call that left it out would be asserting a
      // sentence the panel does not produce.
      { dimUnit: UNIT },
    );
    const tall = report.issues.filter((i) => i.rule === 'tall');
    expect(tall).toHaveLength(1);
    expect(tall[0].detail).toContain(`does not go any shorter than ${doorFloor(UNIT)}`);
  });

  // § B.12. The panel used to say `198 cm` beside a room field reading `1.9 m`, whatever
  // the user had chosen, because every sentence in `clearance.ts` hard-coded the unit.
  //
  // Two assertions and both are needed. The first is the conversion; the second is the
  // CACHE, because `cachedReport` keys the whole report on its inputs and an input that
  // changes the value without changing the key is a panel that goes on saying the last
  // unit until something else in the room happens to move. `dimUnit` was not in that key
  // when this was written, and adding it is the second half of the fix.
  it.each([
    ['m', '1.98 m'],
    ['cm', '198 cm'],
    ['ft', '6.5 ft'],
    ['in', '78 in'],
  ] as [DimUnit, string][])('writes the finding in %s, and re-renders when the unit changes', (u, shown) => {
    render(<RoomTools />);
    fireEvent.click(screen.getByRole('button', { name: /issue/ }));
    // Switch AWAY first, then to the unit under test — so every row exercises a real
    // change of unit against a warm cache.
    //
    // It used to switch straight from the `beforeEach`'s metres, which made the `'m'`
    // row a no-op: `setState({ dimUnit: 'm' })` over `'m'` changes nothing, so that row
    // never touched the cache key and passed on the first render's sentence. Removing
    // `dimUnit` from `cachedReport`'s key reddened cm, ft and in — and left m green.
    // One vacuous row in four reads as a covered case and is not one.
    act(() => useSettings.setState({ dimUnit: u === 'cm' ? 'm' : 'cm' }));
    act(() => useSettings.setState({ dimUnit: u }));
    expect(doorFloor(u), 'the fixture is the formatter, not a hand-typed string').toBe(shown);
    expect(screen.getByText(new RegExp(`does not go any shorter than ${shown.replace('.', '\\.')}`))).toBeTruthy();
  });

  // The Step-free control names the same turning circle the `turning` finding does, three
  // rows above it, and it is the last label in this panel that was still hard-coded: a
  // module-scope `const TURN_CM = Math.round(TURNING_DIAMETER * 100)` rendered as
  // `{TURN_CM} cm`. § B.12 converted the findings and not the label, so a user on feet
  // read "Step-free · 150 cm" above "A wheelchair needs 4.92 ft to turn on the spot" —
  // the very defect § B.12 was opened for, reintroduced three rows from where it was fixed.
  //
  // This is MOUNTED rather than grepped, and that distinction was measured: a source gate
  // asserting `const turnLabel = (unit: DimUnit)` survived a body rewritten to
  // `` `${Math.round(TURNING_DIAMETER * 100)} cm` `` — the right shape around the wrong
  // value. A gate on a signature cannot see what the function returns.
  it.each(['m', 'cm', 'ft', 'in'] as DimUnit[])(
    'names the turning circle in %s beside the findings, not in centimetres',
    (u) => {
      render(<RoomTools />);
      fireEvent.click(screen.getByRole('button', { name: /issue/ }));
      act(() => useSettings.setState({ dimUnit: u }));
      const expected = formatLength(TURNING_DIAMETER * 1000, u);
      // Reached through the checkbox and its own `<label>`, which is how a screen reader
      // reaches it: the label's text content IS the control's accessible name, so this
      // asserts the name a user hears as well as the glyphs a user sees.
      const box = screen.getByRole('checkbox', { name: /Step-free/ });
      expect(box.closest('label')?.textContent, `Step-free label at ${u}`).toBe(`Step-free · ${expected}`);
    },
  );

  it('counts the problems on the trigger before anything is opened', () => {
    render(<RoomTools />);
    // The chip is the only part of the report visible with the panel shut, and it is
    // the cheapest possible wiring check: a number the component got from `lib/`.
    expect(screen.getByRole('button', { name: /issue/ })).toBeTruthy();
  });

  it('shows the sentence itself once the panel is open', () => {
    render(<RoomTools />);
    // fireEvent, not the DOM's own .click(): React 19 batches state updates and the
    // raw dispatch runs outside act(), so the panel was still shut when the assertion
    // below looked for it. It failed for that reason first, which is worth writing down
    // because the failure looks identical to the sentence not being rendered at all.
    fireEvent.click(screen.getByRole('button', { name: /issue/ }));

    // The whole point. `analyzeRoom` says a 1.90 m room cannot hold any legal door;
    // this asserts the user is told so, in those words, on that surface.
    expect(
      screen.getByText(new RegExp(`does not go any shorter than ${doorFloor(UNIT)}`)),
    ).toBeTruthy();
    // And the title beside it, because `IssueRow` renders `title` and `detail` from two
    // different expressions: rendering one and dropping the other is a live failure
    // mode, and an assertion on only one of them cannot see it.
    expect(screen.getByText('Taller than the room')).toBeTruthy();
  });
  it('gives a piece that CAN be shrunk the opposite sentence', () => {
    // The other half of the same `visual-check.md` item, and the half that makes it an
    // item at all: two pieces too tall for one room, where one of them can be typed
    // smaller and the other cannot. Both sentences come out of the same `for` loop in
    // `clearance.ts`, branching on the piece's own floor rather than on its shape.
    useScene.setState({ parts: [door(), wardrobe()] });
    render(<RoomTools />);
    fireEvent.click(screen.getByRole('button', { name: /issue/ }));

    expect(screen.getByText(new RegExp(`${wardrobeFloor(UNIT)} is as short as this piece goes`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`does not go any shorter than ${doorFloor(UNIT)}`))).toBeTruthy();
  });

  it('and does not give them the same sentence', () => {
    // Named in the item as a thing to look for — "both pieces getting the same
    // sentence" — so it is asserted rather than left to the two `getByText` calls
    // above, which would both pass if one row had been rendered twice. The rows are
    // matched by the pieces' own names, then compared for the phrase that differs.
    useScene.setState({ parts: [door(), wardrobe()] });
    render(<RoomTools />);
    fireEvent.click(screen.getByRole('button', { name: /issue/ }));

    const rows = screen.getAllByText(/Taller than the room/);
    expect(rows).toHaveLength(2);
    const sentences = screen.getAllByText(/tall and the ceiling is/).map((n) => n.textContent ?? '');
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).not.toBe(sentences[1]);
    // The door's row must be the one refusing to shrink, and the wardrobe's the one
    // offering a number — not merely "two different strings", which a swap would also
    // satisfy.
    const doorSentence = sentences.find((s) => s.includes('Front door')) ?? '';
    const wardrobeSentence = sentences.find((s) => s.includes('Tall wardrobe')) ?? '';
    expect(doorSentence).toContain('nothing you type will fit it in here');
    expect(wardrobeSentence).toContain('as short as this piece goes, and that would fit');
  });

  it('tells a piece that HANGS it cannot hang, rather than that it cannot stand', () => {
    // `docs/visual-check.md`'s curtain item. The defect it records was silence: the
    // pass used to skip a wall-mounted piece entirely, because "it will not stand up in
    // here" is wrong about something that hangs — a WORDING problem solved by dropping
    // the check. The sentence branches now and the check stays.
    useScene.setState({ parts: [curtain()] });
    render(<RoomTools />);
    fireEvent.click(screen.getByRole('button', { name: /issue/ }));

    expect(
      screen.getByText(/there is no height it can hang at without crossing the floor or the ceiling/),
    ).toBeTruthy();
    // The half that would still be a defect if only the first line were asserted: the
    // standing wording must be absent, not merely outnumbered.
    expect(screen.queryByText(/it will not stand up in here/)).toBeNull();
  });
});

