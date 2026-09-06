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
// What this does NOT prove: no layout, no overflow, no contrast, no pixels, and nothing
// about the toast host — `toast` is spied at the module boundary. Mounting under jsdom
// settles wiring and nothing else.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { defaultScene } from '@/lib/scene-spec';
import { analyzeRoom } from '@/lib/clearance';
import { shuffleBlockers } from '@/lib/layout-shuffle';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import type { ToastSpec } from '@/components/ui/StorageToast';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('shuffle-room'));

const toasts: ToastSpec[] = [];
vi.mock('@/components/ui/StorageToast', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/StorageToast')>(
    '@/components/ui/StorageToast',
  );
  return { ...actual, toast: (spec: ToastSpec) => toasts.push(spec) };
});

vi.mock('@/lib/layout-shuffle', async () => {
  const actual = await vi.importActual<typeof import('@/lib/layout-shuffle')>('@/lib/layout-shuffle');
  return { ...actual, shuffleRoom: () => null };
});

const { RoomTools } = await import('@/components/studio/RoomTools');

const HEIGHT = 2.5;

function mount(id: 'u' | 'rect', w: number, d: number) {
  const footprint = footprintForLayout(id, w, d);
  const parts = defaultScene(id, w, d, { footprint, height: HEIGHT });
  act(() => {
    useScene.setState({
      parts,
      room: { ...useScene.getState().room, width: w, depth: d, height: HEIGHT, footprint, layoutId: id },
    });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [], selectedPartId: null, pinned: {} });
    useSettings.setState({ dimUnit: 'm', stepFree: false });
  });
  render(<RoomTools />);
  return { parts, footprint };
}

const realRaf = globalThis.requestAnimationFrame;

beforeEach(() => {
  toasts.length = 0;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  cleanup();
});

function pressShuffle() {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /^Shuffle$/ }));
  });
  expect(toasts.map((t) => t.title), 'exactly one toast per press').toHaveLength(1);
  return toasts[0];
}

describe('the shuffle refusal says which of the two "no" it is', () => {
  it('a room that already has a hard finding is told so, and not to press again', () => {
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

    const said = pressShuffle();
    expect(said.title).toBe('Shuffle cannot arrange around this');
    // The title VERBATIM, not lowercased. Half of these are sentences rather than
    // noun phrases — `access` reads "you can't walk to everything" — so the sentence
    // quotes the report instead of splicing it, and quoting keeps the casing.
    expect(said.message).toContain(`“${blockers[0].title}”`);
    expect(said.message).toContain('Try Fix first');
    // The negative half, and it carries the row: the shipped sentence contains this,
    // so a call site that stopped asking the room passes every positive assertion.
    expect(
      said.message,
      'a blocked room was told to press again, which is advice that cannot work there',
    ).not.toContain('Press Shuffle again');
  });

  it('a room with nothing wrong keeps the "press again" refusal, which is true there', () => {
    const { parts, footprint } = mount('rect', 6, 4);
    expect(
      shuffleBlockers(analyzeRoom(parts, { footprint, height: HEIGHT }).issues),
      'this fixture is supposed to start clean, or it is a second copy of the case above',
    ).toEqual([]);

    const said = pressShuffle();
    expect(said.title).toBe('No new arrangement this time');
    expect(said.message).toContain('Press Shuffle again');
    expect(said.message).not.toContain('Try Fix first');
  });
});
