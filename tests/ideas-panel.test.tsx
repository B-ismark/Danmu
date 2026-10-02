// @vitest-environment jsdom
//
// The ideas gallery's wiring: open it, press an idea and the room takes it, go back,
// keep one with its heart, keep a piece in place and get ideas from the room on screen,
// and say so when the room changed under it. What each idea IS, is
// `tests/layout-ideas.test.ts`; this file is whether the panel does what those
// functions say with the stores the rest of the studio reads.
//
// `shuffleRoom` is replaced by a stand-in that moves one piece a known distance per
// idea, and only it. The search is two seconds of real solving per call and the panel
// asks for several; nothing here is about which arrangement the solver picks, so a
// deterministic answer is the honest fixture. Everything the panel does with the
// answer (captions, transforms, the session, storage) is real.
//
// What this does NOT prove: no layout, no overflow, no pixels. `scripts/` and the
// fidelity sweep are where those are looked at.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import type { SolveResult } from '@/lib/layout-solve';
import { viewportAt } from './helpers/mount';
import { DRY_SEARCHES } from '@/lib/layout-ideas';
import { ridingParents } from '@/lib/rigid-parent';

const ROOM_ID = 'ideas-room';
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('ideas-room'));

/** How far the stand-in moves its piece for the n-th idea it hands out. */
const step = (n: number) => 0.1 * n;
let handedOut = 0;
let calls = 0;
/** What the stand-in does: hand out four ideas a call; throw; or four once and then
 *  nothing, which is a room that runs dry after one page. */
let mode: 'four' | 'throw' | 'once' = 'four';
/** The room the stand-in was last handed, as the solver would see it. */
let handed: ScenePart[] = [];

vi.mock('@/lib/layout-shuffle', async () => {
  const actual = await vi.importActual<typeof import('@/lib/layout-shuffle')>('@/lib/layout-shuffle');
  return {
    ...actual,
    shuffleRoom: (parts: ScenePart[], _room: unknown, locked: boolean[]) => {
      calls += 1;
      handed = parts;
      if (mode === 'throw') throw new Error('solver fell over');
      if (mode === 'once' && calls > 1) return { tried: 12, clean: 0, ideas: [] };
      const m = parts.findIndex((p, i) => !locked[i] && !p.wallMounted);
      if (m < 0) return null;
      const ideas = Array.from({ length: 4 }, (): SolveResult => {
        handedOut += 1;
        const placements = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
        placements[m] = { ...placements[m], x: placements[m].x + step(handedOut) };
        return { placements, moved: [m] } as unknown as SolveResult;
      });
      return { tried: 4, clean: 4, ideas };
    },
  };
});

const { RoomTools } = await import('@/components/studio/RoomTools');
const { IdeasPanel, useIdeas } = await import('@/components/studio/IdeasPanel');

const W = 6;
const D = 4;
const HEIGHT = 2.5;
let parts: ScenePart[] = [];
let restoreViewport: (() => void) | null = null;

function mount(edit: (parts: ScenePart[]) => ScenePart[] = (p) => p) {
  const footprint = footprintForLayout('rect', W, D);
  parts = edit(defaultScene('rect', W, D, { footprint, height: HEIGHT }));
  act(() => {
    useScene.setState({
      parts,
      room: { ...useScene.getState().room, width: W, depth: D, height: HEIGHT, footprint, layoutId: 'rect' },
      // As `RoomSync` leaves it once the room has loaded; the gallery waits for it.
      hydratedRoomId: ROOM_ID,
    });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {}, selection: [], selectedPartId: null, pinned: {} });
    useSettings.setState({ dimUnit: 'm', stepFree: false });
  });
  render(<RoomTools />);
}

async function openIdeas() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Ideas$/ }));
  });
  return screen.findAllByRole('button', { name: /^Idea \d+:/ });
}

const cards = () => screen.getAllByRole('button', { name: /^Idea \d+:/ });
/** The first piece the stand-in moves: the first one nothing keeps in place. */
const firstMovable = () => parts.find((p) => !p.wallMounted && !p.locked && !useStudio.getState().pinned[p.id])!;

beforeEach(() => {
  handedOut = 0;
  handed = [];
  calls = 0;
  mode = 'four';
  useIdeas.setState({ session: null });
});

afterEach(async () => {
  cleanup();
  restoreViewport?.();
  restoreViewport = null;
  for (const l of await roomStore.listLayouts(ROOM_ID)) await roomStore.deleteLayout(ROOM_ID, l.id);
});

describe('the ideas gallery', () => {
  it('opens on a page of four beside a laptop rail, each named and counted', async () => {
    mount();
    const found = await openIdeas();
    expect(found).toHaveLength(4);
    // Named from where it puts things, and how much moves: never a score.
    expect(found[0].getAttribute('aria-label')).toMatch(/^Idea 1: .*1 piece moves$/);
    expect(screen.getByRole('region', { name: 'Ideas for this room' }).textContent).toMatch(/1–4 of \d+/);
    expect(document.querySelector('.ideas-grid--wide')).not.toBeNull();
  });

  it('three to a page on a phone (decision D6)', async () => {
    restoreViewport = viewportAt(390, { touch: true });
    mount();
    expect(await openIdeas()).toHaveLength(3);
    expect(document.querySelector('.ideas-grid--phone')).not.toBeNull();
  });

  it('pressing an idea puts the room in it, and Back to your room undoes it', async () => {
    mount();
    await openIdeas();
    const piece = firstMovable();
    await act(async () => {
      fireEvent.click(cards()[1]);
    });
    // Idea 2 moved the piece `step(2)` along x, onto the room as it was.
    expect(useStudio.getState().positions[piece.id][0]).toBeCloseTo(piece.pos[0] + step(2), 9);
    expect(cards()[1].getAttribute('aria-pressed')).toBe('true');
    expect(cards()[0].getAttribute('aria-pressed')).toBe('false');

    // Trying another replaces it rather than stacking on it.
    await act(async () => {
      fireEvent.click(cards()[0]);
    });
    expect(useStudio.getState().positions[piece.id][0]).toBeCloseTo(piece.pos[0] + step(1), 9);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Back to your room/ }));
    });
    expect(useStudio.getState().positions).toEqual({});
    expect(screen.queryByRole('button', { name: /Back to your room/ })).toBeNull();
  });

  // User call 2A: a drag may stand a seat on a coffee table, and Ideas never shows one
  // there. The stand-in moves the sofa and not the ottoman, which is the case that has
  // to be written anyway: left out of `moved`, the ottoman would keep its height with
  // nothing under it once the room took the idea.
  const ottomanOnTable = (seeded: ScenePart[]): ScenePart[] => {
    const table = seeded.find((p) => p.name === 'Coffee table')!;
    const ottoman: ScenePart = {
      ...table, id: 'zz-ottoman', name: 'Ottoman', category: 'ottoman', shape: 'ottoman',
      dimMM: [550, 400, 420], pos: [table.pos[0], table.pos[1] + table.dimMM[2] / 1000, table.pos[2]],
    };
    return [...seeded, ottoman];
  };

  it('a seat standing on the coffee table is on the floor beside it in every idea, and back on the table after', async () => {
    mount(ottomanOnTable);
    const o = parts.at(-1)!;
    expect(ridingParents(parts)[o.id], 'the fixture stands the ottoman on the table').toBe('table-1');
    await openIdeas();
    const set = handed.find((p) => p.id === o.id)!;
    expect(set.pos[1], 'the solver is handed it on the floor').toBe(0);
    expect(set.pos[2], 'beside the table, not inside it').not.toBeCloseTo(o.pos[2], 3);
    expect(firstMovable().id).not.toBe(o.id);
    await act(async () => {
      fireEvent.click(cards()[0]);
    });
    expect(useStudio.getState().positions[o.id]).toEqual(set.pos);
    // It came down, so it is one of the pieces that move.
    expect(cards()[0].getAttribute('aria-label')).toMatch(/2 pieces move$/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Back to your room/ }));
    });
    expect(useStudio.getState().positions).toEqual({});
  });

  it('a seat kept where it is stays on the table: kept means kept', async () => {
    mount(ottomanOnTable);
    const o = parts.at(-1)!;
    act(() => useStudio.setState({ pinned: { [o.id]: true } }));
    await openIdeas();
    expect(handed.find((p) => p.id === o.id)!.pos).toEqual(o.pos);
    await act(async () => {
      fireEvent.click(cards()[0]);
    });
    expect(useStudio.getState().positions[o.id]).toBeUndefined();
  });

  it('the heart keeps an idea as a favourite layout, and a second press lets it go', async () => {
    mount();
    await openIdeas();
    const heart = screen.getByRole('button', { name: 'Save Idea 2 to Layouts' });
    await act(async () => {
      fireEvent.click(heart);
    });
    await vi.waitFor(async () => expect(await roomStore.listLayouts(ROOM_ID)).toHaveLength(1));
    const [saved] = await roomStore.listLayouts(ROOM_ID);
    expect(saved).toMatchObject({ name: 'Idea 2', favourite: true });
    // The idea is the override layer on the authored parts, as "Save current" stores it.
    const piece = firstMovable();
    expect(saved.transforms.positions[piece.id][0]).toBeCloseTo(piece.pos[0] + step(2), 9);
    expect(heart.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      fireEvent.click(heart);
    });
    await vi.waitFor(async () => expect(await roomStore.listLayouts(ROOM_ID)).toHaveLength(0));
    expect(heart.getAttribute('aria-pressed')).toBe('false');
  });

  it('a heart whose layout was deleted in the Layouts tab is not a heart', async () => {
    mount();
    await openIdeas();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Idea 2 to Layouts' }));
    });
    await vi.waitFor(async () => expect(await roomStore.listLayouts(ROOM_ID)).toHaveLength(1));
    const [saved] = await roomStore.listLayouts(ROOM_ID);
    await roomStore.deleteLayout(ROOM_ID, saved.id);
    cleanup();
    render(<RoomTools />);
    await openIdeas();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Idea 2 to Layouts' }).getAttribute('aria-pressed')).toBe('false'),
    );
  });

  it('a second save of the same number gets its own name', async () => {
    mount();
    await roomStore.saveLayout(ROOM_ID, {
      id: 'l-old',
      name: 'Idea 1',
      createdAt: 1,
      parts: [],
      transforms: { positions: {}, rotations: {}, dims: {} },
    });
    await openIdeas();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Idea 1 to Layouts' }));
    });
    await vi.waitFor(async () =>
      expect((await roomStore.listLayouts(ROOM_ID)).map((l) => l.name)).toEqual(['Idea 1', 'Idea 1 (2)']),
    );
  });

  it('keeping a piece asks again from the room on screen, and Back still means the room you started with', async () => {
    mount();
    await openIdeas();
    const piece = firstMovable();
    await act(async () => {
      fireEvent.click(cards()[1]);
    });
    const onScreen = useStudio.getState().positions[piece.id];
    const before = calls;

    await act(async () => {
      useStudio.getState().togglePinned(piece.id);
    });
    await vi.waitFor(() => expect(calls).toBeGreaterThan(before));
    await screen.findAllByRole('button', { name: /^Idea \d+:/ });
    // The kept piece stays where the idea put it, and it is named as kept.
    expect(useStudio.getState().positions[piece.id]).toEqual(onScreen);
    const kept = document.querySelector('.ideas-panel__kept') as HTMLElement;
    expect(within(kept).getByRole('button', { name: `Let ideas move ${piece.name}` })).toBeTruthy();
    // The new ideas move something else, from the room on screen.
    await act(async () => {
      fireEvent.click(cards()[0]);
    });
    expect(useStudio.getState().positions[piece.id]).toEqual(onScreen);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Back to your room/ }));
    });
    expect(useStudio.getState().positions).toEqual({});
  });

  it('a hand edit makes the ideas stale, said, with a way to look again', async () => {
    mount();
    await openIdeas();
    const piece = firstMovable();
    await act(async () => {
      useStudio.setState({ positions: { [piece.id]: [piece.pos[0], piece.pos[1], piece.pos[2] + 0.3] } });
    });
    expect(screen.getByText('The room changed')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^Idea \d+:/ })).toHaveLength(0);
    // Hearts and pages are gone with the cards; nothing applies an idea over the edit.
    expect(screen.queryByRole('button', { name: /Back to your room/ })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find new ideas' }));
    });
    expect(await screen.findAllByRole('button', { name: /^Idea \d+:/ })).toHaveLength(4);
    expect(screen.queryByText('The room changed')).toBeNull();
  });

  it('with every piece kept, it says so and does not search', async () => {
    mount();
    act(() => {
      useStudio.setState({ pinned: Object.fromEntries(parts.map((p) => [p.id, true])) });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Ideas$/ }));
    });
    expect(screen.getByText('Nothing here can move')).toBeTruthy();
    expect(calls).toBe(0);
  });

  it('waits for the room to finish loading before asking anything of it', async () => {
    mount();
    act(() => useScene.setState({ hydratedRoomId: null }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Ideas$/ }));
    });
    expect(screen.getByText('Opening your room…')).toBeTruthy();
    expect(calls, 'nothing asked of the starter room').toBe(0);
    act(() => useScene.setState({ hydratedRoomId: ROOM_ID }));
    expect(await screen.findAllByRole('button', { name: /^Idea \d+:/ })).toHaveLength(4);
    // Begun on the room that loaded, so it is not stale the moment it arrives.
    expect(screen.queryByText('The room changed')).toBeNull();
  });

  it('a search that fails says so, and never that every layout was in the way', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    mode = 'throw';
    mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Ideas$/ }));
    });
    expect(await screen.findByText('The search stopped')).toBeTruthy();
    expect(screen.queryByText('No ideas this time')).toBeNull();
    expect(calls, 'one failure stops the search rather than burning three').toBe(1);
    expect(quiet).toHaveBeenCalled();
    mode = 'four';
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findAllByRole('button', { name: /^Idea \d+:/ })).toHaveLength(4);
  });

  it('a page pressed into a search that then ran dry falls back to the last one with ideas', async () => {
    mode = 'once';
    mount();
    await openIdeas();
    // Next is live while the second page is still being looked for.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'More ideas' }));
    });
    await vi.waitFor(() => {
      const s = useIdeas.getState().session!;
      expect(s.searching === false && s.dry >= DRY_SEARCHES).toBe(true);
    });
    expect(cards(), 'never a blank card').toHaveLength(4);
    expect(screen.getByRole('button', { name: 'More ideas' }).hasAttribute('disabled')).toBe(true);
  });

  it('a double press on a heart saves the idea once', async () => {
    mount();
    await openIdeas();
    const heart = screen.getByRole('button', { name: 'Save Idea 2 to Layouts' });
    await act(async () => {
      fireEvent.click(heart);
      fireEvent.click(heart);
    });
    await vi.waitFor(async () => expect(heart.getAttribute('aria-pressed')).toBe('true'));
    await new Promise((r) => setTimeout(r, 50));
    expect(await roomStore.listLayouts(ROOM_ID)).toHaveLength(1);
  });

  it('an undo back onto an idea from before a piece was kept is not a hand edit', async () => {
    mount();
    await openIdeas();
    const piece = firstMovable();
    await act(async () => {
      fireEvent.click(cards()[1]);
    });
    const idea2 = { ...useStudio.getState().positions };
    await act(async () => {
      fireEvent.click(cards()[2]);
    });
    // Keep a piece other than the one the stand-in moves, so the ideas start again.
    const other = parts.find((p) => p.id !== piece.id && !p.wallMounted && !p.locked)!;
    await act(async () => {
      useStudio.getState().togglePinned(other.id);
    });
    await screen.findAllByRole('button', { name: /^Idea \d+:/ });
    // What undo would restore: idea 2, which the gallery itself put on screen.
    await act(async () => {
      useStudio.setState({ positions: idea2 });
    });
    expect(screen.queryByText('The room changed')).toBeNull();
  });

  it('Back to your room puts back the app\'s record of what it placed, with the room', async () => {
    mount();
    const piece = firstMovable();
    // Fix had placed this piece where it stands; the record says so.
    const fixed = { pos: [piece.pos[0], piece.pos[1], piece.pos[2]] as [number, number, number], rot: piece.rot };
    act(() => useStudio.setState({ positions: { [piece.id]: fixed.pos }, rotations: { [piece.id]: fixed.rot } }));
    const appPlaced = { current: new Map([[piece.id, fixed]]) };
    const anchor = { current: document.createElement('div') };
    render(<IdeasPanel anchorRef={anchor} onClose={() => {}} appPlaced={appPlaced} />);
    await screen.findAllByRole('button', { name: /^Idea \d+:/ });
    await act(async () => {
      fireEvent.click(cards()[0]);
    });
    expect(appPlaced.current.get(piece.id)!.pos[0]).toBeCloseTo(piece.pos[0] + step(1), 9);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Back to your room/ }));
    });
    // Still the app's, so Fix may move it without treating it as placed by hand.
    expect(appPlaced.current.get(piece.id)).toEqual(fixed);
  });

  it('survives the tab switch: the same ideas are there after a remount', async () => {
    mount();
    const first = (await openIdeas()).map((b) => b.getAttribute('aria-label'));
    // Settled: this page and the next are full, so nothing more is being looked for.
    await vi.waitFor(() => expect(useIdeas.getState().session?.searching).toBe(false));
    await vi.waitFor(() => expect(useIdeas.getState().session?.ideas.length).toBe(8));
    const searched = calls;
    cleanup();
    render(<RoomTools />);
    const again = (await openIdeas()).map((b) => b.getAttribute('aria-label'));
    expect(again).toEqual(first);
    expect(calls, 'nothing new was needed to show the same page').toBe(searched);
  });
});
