// @vitest-environment jsdom
//
// **Does the panel say the refusal it computed?**
//
// `shuffleRefusal` is asserted over hand-built finding lists in
// `tests/layout-shuffle.test.ts`, and `shuffleBlockers` over real rooms there too.
// Nothing joined either to the screen, and #121 measured what that is worth: all four
// `impossibleClause` call sites in this same component could be reverted to the
// disjunction the whole change existed to delete, with `tsc` clean and the suite green,
// because no test in the repo contained any of the four sentences. A refusal computed
// and not said is a refusal that does not exist.
//
// The two sentences here are a PAIR and that is the point of the file. § 4c is about a
// room that refuses on every press because `isCleanShuffle` is absolute while the other
// gate is relative — so "press Shuffle again for a different try" is advice that cannot
// work there. Asserting only the blocked sentence would pass against a component that
// says it always; asserting only the clean one passes against the component that shipped.
//
// `shuffleRoom` is mocked to refuse, and ONLY it. `shuffleBlockers`, `shuffleRefusal`,
// `analyzeRoom` and `RULE_HANDLING` are all the real ones — what is faked is whether the
// search found something, never what the panel says about it. Driving a real refusal
// would work for the `u` and is a two-minute solve per press for a string comparison.
//
// Since Shuffle became the ideas gallery, the refusal is the gallery's empty state:
// three searches in a row that found nothing (`DRY_SEARCHES`), then the pair of
// sentences in the panel instead of a toast.
//
// What this does NOT prove: no layout, no overflow, no contrast, no pixels. Mounting
// under jsdom settles wiring and nothing else.

import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { analyzeRoom } from '@/lib/clearance';
import { shuffleBlockers } from '@/lib/layout-shuffle';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { DRY_SEARCHES, seatsDown } from '@/lib/layout-ideas';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('shuffle-room'));

let searches = 0;

vi.mock('@/lib/layout-shuffle', async () => {
  const actual = await vi.importActual<typeof import('@/lib/layout-shuffle')>('@/lib/layout-shuffle');
  return {
    ...actual,
    shuffleRoom: () => {
      searches += 1;
      return null;
    },
  };
});

const { RoomTools } = await import('@/components/studio/RoomTools');
const { useIdeas } = await import('@/components/studio/IdeasPanel');

const HEIGHT = 2.5;

function mount(id: 'u' | 'rect' | 'open', w: number, d: number, edit: (parts: ScenePart[]) => ScenePart[] = (p) => p) {
  const footprint = footprintForLayout(id, w, d);
  const parts = edit(defaultScene(id, w, d, { footprint, height: HEIGHT }));
  act(() => {
    useScene.setState({
      parts,
      room: { ...useScene.getState().room, width: w, depth: d, height: HEIGHT, footprint, layoutId: id },
      hydratedRoomId: 'shuffle-room',
    });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [], selectedPartId: null, pinned: {} });
    useSettings.setState({ dimUnit: 'm', stepFree: false });
  });
  render(<RoomTools />);
  return { parts, footprint };
}

const realRaf = globalThis.requestAnimationFrame;

beforeEach(() => {
  searches = 0;
  useIdeas.setState({ session: null });
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  cleanup();
});

// Open the gallery and let it search until it gives up. Each search answers on a later
// microtask (the arranging engine is `lib/layout-offload.ts`), so the refusal is
// awaited rather than read.
async function openIdeasUntilDry(title: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Ideas$/ }));
  });
  const heading = await screen.findByText(title);
  expect(searches, 'the gallery gives up after DRY_SEARCHES empty searches, not before').toBe(DRY_SEARCHES);
  return heading.parentElement!.textContent ?? '';
}

describe('the shuffle refusal says which of the two "no" it is', () => {
  it('a room that already has a hard finding is told so, and not to press again', async () => {
    // **The fixture's shape, pinned before the assertion rather than assumed.** This
    // whole case rests on `u` at 6 x 4 seeding a room that already carries a finding
    // whose cost term is one `isCleanShuffle` reads. If the seeder ever stops doing
    // that, the assertion below would silently become a test of the OTHER branch and
    // still pass the day someone deleted this one.
    const { parts, footprint } = mount('u', 6, 4);
    const blockers = shuffleBlockers(analyzeRoom(parts, { footprint, height: HEIGHT }).issues);
    expect(
      blockers.length,
      'this fixture is supposed to start with a hard finding — see § 4c',
    ).toBeGreaterThan(0);

    const said = await openIdeasUntilDry('Ideas cannot arrange around this');
    // The title VERBATIM, not lowercased. Half of these are sentences rather than
    // noun phrases — `access` reads "you can't walk to everything" — so the sentence
    // quotes the report instead of splicing it, and quoting keeps the casing.
    expect(said).toContain(`“${blockers[0].title}”`);
    expect(said).toContain('Try Fix first');
    expect(screen.queryByRole('button', { name: 'Look again' }), 'looking again cannot work here').toBeNull();
    // The negative half, and it carries the row: the shipped sentence contains this,
    // so a call site that stopped asking the room passes every positive assertion.
    expect(
      said,
      'a blocked room was told to look again, which is advice that cannot work there',
    ).not.toContain('Look again');
  });

  it('a room with nothing wrong keeps the "look again" refusal, which is true there', async () => {
    const { parts, footprint } = mount('rect', 6, 4);
    expect(
      shuffleBlockers(analyzeRoom(parts, { footprint, height: HEIGHT }).issues),
      'this fixture is supposed to start clean, or it is a second copy of the case above',
    ).toEqual([]);

    const said = await openIdeasUntilDry('No ideas this time');
    expect(said).toContain('Look again for a different try');
    expect(said).not.toContain('Try Fix first');
    // And the advice is a button that works: it asks again.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Look again' }));
    });
    await screen.findByText('No ideas this time');
    expect(searches).toBe(2 * DRY_SEARCHES);
  });

  // User call 2A sets a seat standing on a table down on the floor for the search, and
  // that lowered ottoman stands inside its coffee table: a clash in the room the ideas
  // were arranged against, and not in the room on screen. The empty state is about the
  // room on screen, so it must not send this room to Fix.
  it('a seat set down for the search does not make a clean room read as blocked', async () => {
    const onTable = (parts: ScenePart[]) => {
      const table = parts.find((p) => p.name === 'Coffee table')!;
      const ottoman: ScenePart = {
        ...table, id: 'zz-ottoman', name: 'Ottoman', category: 'ottoman', shape: 'ottoman',
        dimMM: [550, 400, 420], pos: [table.pos[0], table.pos[1] + table.dimMM[2] / 1000, table.pos[2]],
      };
      return [...parts, ottoman];
    };
    const { parts, footprint } = mount('rect', 6, 4, onTable);
    const room = { footprint, height: HEIGHT };
    expect(shuffleBlockers(analyzeRoom(parts, room).issues)).toEqual([]);
    expect(
      shuffleBlockers(analyzeRoom(seatsDown(parts).parts, room).issues).length,
      'set down, the ottoman is inside the table — or this case cannot fail',
    ).toBeGreaterThan(0);
    const said = await openIdeasUntilDry('No ideas this time');
    expect(said).toContain('Look again for a different try');
    expect(said).not.toContain('Try Fix first');
  });

  // User call 1B: a room whose group is worth ungrouping says so, and that ungrouping
  // gives more ideas. Three cases, because the panel can be wrong three ways: say it
  // nowhere, say it for a group held by a kept piece (which does not move at all), or
  // say it for a dining table and its chairs, which move as one block grouped or not.
  const grouped = (...names: string[]) => (parts: ScenePart[]) => {
    const picked = parts.filter((p) => names.includes(p.name));
    expect(picked.length, `the fixture seeds ${names.join(' and ')}`).toBeGreaterThanOrEqual(names.length);
    return parts.map((p) => (picked.includes(p) ? { ...p, groupId: 'set' } : p));
  };

  it('a clean room with a group worth ungrouping says it moves as one, and to ungroup it', async () => {
    const { parts, footprint } = mount('rect', 6, 4, grouped('Sofa', 'Coffee table'));
    expect(shuffleBlockers(analyzeRoom(parts, { footprint, height: HEIGHT }).issues)).toEqual([]);
    const said = await openIdeasUntilDry('No ideas this time');
    expect(said).toContain('Your group moves as one piece: ungroup it for more ideas.');
    expect(screen.getByRole('button', { name: 'Look again' })).toBeTruthy();
  });

  it('a group held by a kept piece is not one that moves, so the sentence is the plain one', async () => {
    const { parts } = mount('rect', 6, 4, grouped('Sofa', 'Coffee table'));
    const member = parts.find((p) => p.groupId === 'set')!;
    act(() => useStudio.setState({ pinned: { [member.id]: true } }));
    const said = await openIdeasUntilDry('No ideas this time');
    expect(said).toContain('Look again for a different try');
    expect(said).not.toContain('group');
  });

  it('a dining table grouped with its chairs is one block either way, so it is not named', async () => {
    const { parts, footprint } = mount('open', 7, 5, grouped('Dining table', 'Dining chair'));
    expect(parts.filter((p) => p.groupId === 'set')).toHaveLength(5);
    expect(shuffleBlockers(analyzeRoom(parts, { footprint, height: HEIGHT }).issues)).toEqual([]);
    const said = await openIdeasUntilDry('No ideas this time');
    expect(said).toContain('Look again for a different try');
    expect(said).not.toContain('group');
  });
});
