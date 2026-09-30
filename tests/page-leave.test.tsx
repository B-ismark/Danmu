// @vitest-environment jsdom
//
// § 47 — a change made just before the page goes away is saved.
//
// Every save the studio makes waits first: `RoomSync` 300 ms after the last change, and
// the Room section's size boxes 200 ms after the last keystroke, before `RoomSync` has
// even seen it. Each flushed on UNMOUNT, which a reload, a closed tab and a phone that
// backgrounds the browser never do — measured in Chromium, a width typed and reloaded
// straight away came back as it was, 0 of 5, and so did a closed tab and a duplicated
// piece. So each pending save also runs when the page is hidden or left
// (`lib/page-leave.ts`).
//
// What is asserted is that the write STARTS inside the event, synchronously, and that it is
// ONE transaction, so it cannot land in part. Whether the browser lets it finish before
// tearing the page down is not something jsdom can say; the browser probe is that half.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, entries, set } from 'idb-keyval';
import { onPageLeave } from '@/lib/page-leave';
import { leaveNoteKey, readLeaveNote, writeLeaveNote } from '@/lib/leave-note';
import { footprintForLayout } from '@/lib/footprint';
import { roomStore, type RoomData } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio } from '@/lib/store';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('leave-room'));

const { RoomSync } = await import('@/components/studio/RoomSync');
const { RoomDimsEditor } = await import('@/components/studio/RoomDimsEditor');
const { Inspector } = await import('@/components/studio/Inspector');

const ROOM_ID = 'leave-room';
/** The database `lib/storage.ts` writes to, read directly to see everything stored. */
const stored = createStore('keyval-store', 'keyval');

const leave = () => window.dispatchEvent(new Event('pagehide'));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setVisibility('visible');
  localStorage.clear();
});

describe('onPageLeave', () => {
  it('runs every commit before any persist, whichever registered first', () => {
    const order: string[] = [];
    const offs = [
      onPageLeave('persist', () => order.push('persist')),
      onPageLeave('commit', () => order.push('commit')),
    ];
    leave();
    offs.forEach((off) => off());
    expect(order).toEqual(['commit', 'persist']);
  });

  it('runs on the page being hidden, and not on it being shown again', () => {
    const flush = vi.fn();
    const off = onPageLeave('persist', flush);
    setVisibility('hidden');
    expect(flush).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(flush).toHaveBeenCalledTimes(1);
    off();
  });

  it('runs nothing once unregistered', () => {
    const flush = vi.fn();
    onPageLeave('persist', flush)();
    leave();
    expect(flush).not.toHaveBeenCalled();
  });

  it('runs the rest when one throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    const offs = [
      onPageLeave('commit', () => {
        throw new Error('no');
      }),
      onPageLeave('commit', after),
      onPageLeave('persist', after),
    ];
    leave();
    offs.forEach((off) => off());
    expect(after).toHaveBeenCalledTimes(2);
  });
});

function room(): RoomData {
  return {
    id: ROOM_ID,
    createdAt: 1,
    name: 'Leave room',
    layoutId: 'rect',
    width: 6,
    depth: 5,
    height: 2.6,
    footprint: footprintForLayout('rect', 6, 5),
  };
}

async function mount(ui: React.ReactNode, { photographed = false } = {}) {
  useScene.setState({ parts: [] });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [], selectedPartId: null });
  useSettings.setState({ dimUnit: 'm' });
  await roomStore.destroyRoom(ROOM_ID);
  await roomStore.saveRoom(room());
  if (photographed) {
    await roomStore.saveCapture(ROOM_ID, { slot: 'n', blob: new Blob(['x']), takenAt: 1 });
  }
  const r = render(ui);
  // `ready` gates every subscriber, so a change made before the load lands is ignored.
  await waitFor(() => expect(useScene.getState().hydratedRoomId).toBe(ROOM_ID), { timeout: 2000 });
  return r;
}

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe('RoomSync, when the page is left inside the debounce', () => {
  beforeEach(() => cleanup());

  it('starts one save of the transforms at once, and only once', async () => {
    await mount(<RoomSync />);
    const save = vi.spyOn(roomStore, 'savePending');
    const id = useScene.getState().parts[0].id;
    useStudio.getState().setPosition(id, [0.5, 0, 0.5]);
    expect(save).not.toHaveBeenCalled();
    leave();
    expect(save).toHaveBeenCalledTimes(1);
    const w = save.mock.calls[0][1];
    expect(w.transforms?.positions[id]).toEqual([0.5, 0, 0.5]);
    expect(w.room).toBeUndefined();
    expect(w.parts).toBeUndefined();
    // Hidden and then left fires both events; the second finds nothing to write.
    leave();
    setVisibility('hidden');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('starts the scene write at once', async () => {
    await mount(<RoomSync />);
    const save = vi.spyOn(roomStore, 'savePending');
    const parts = useScene.getState().parts;
    useScene.getState().setParts(parts.slice(1));
    leave();
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0][1].parts as unknown[]).length).toBe(parts.length - 1);
    await waitFor(async () =>
      expect((await roomStore.loadSceneParts<unknown[]>(ROOM_ID))?.length).toBe(parts.length - 1),
    );
  });

  it('starts the room write at once', async () => {
    await mount(<RoomSync />);
    const save = vi.spyOn(roomStore, 'savePending');
    useScene.getState().setRoom({ width: 6, depth: 5, height: 2.9 });
    leave();
    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect((await roomStore.loadRoom(ROOM_ID))!.height).toBeCloseTo(2.9, 5));
  });

  it('writes nothing when nothing is pending', async () => {
    // What is stored, rather than a spy on each save: RoomSync calls one save now, and a
    // spy on the others could only catch those exact calls coming back.
    await mount(<RoomSync />);
    const save = vi.spyOn(roomStore, 'savePending');
    const before = await entries(stored);
    leave();
    await wait(50);
    expect(save).not.toHaveBeenCalled();
    expect(await entries(stored)).toEqual(before);
  });

  // The case three separate saves got wrong: a wall moved, and the furniture it carried.
  it('saves a new outline and the furniture it moved as one', async () => {
    await mount(<RoomSync />);
    const save = vi.spyOn(roomStore, 'savePending');
    const id = useScene.getState().parts[0].id;
    expect(await roomStore.loadSceneParts(ROOM_ID)).toBeUndefined();
    useScene.getState().setRoom({ width: 5.5, depth: 5, height: 2.6 });
    useStudio.getState().setPosition(id, [0.25, 0, 0.25]);
    leave();
    expect(save).toHaveBeenCalledTimes(1);
    const w = save.mock.calls[0][1];
    expect(w.room).toBeDefined();
    expect(w.transforms?.positions[id]).toEqual([0.25, 0, 0.25]);
    await waitFor(async () => {
      const saved = (await roomStore.loadRoom(ROOM_ID))!;
      const xs = saved.footprint!.map(([x]) => x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5.5, 5);
      expect((await roomStore.loadTransforms(ROOM_ID))?.positions[id]).toEqual([0.25, 0, 0.25]);
      // Reshaped, and built by the picker, so the scene is pinned too — see `RoomSync`.
      expect(await roomStore.loadSceneParts(ROOM_ID)).toBeDefined();
    });
  });

  it('pins no scene for a room with a photo waiting to be scanned', async () => {
    await mount(<RoomSync />, { photographed: true });
    const save = vi.spyOn(roomStore, 'savePending');
    useScene.getState().setRoom({ width: 5.5, depth: 5, height: 2.6 });
    leave();
    await save.mock.results[0].value;
    expect((await roomStore.loadRoom(ROOM_ID))!.width).toBeCloseTo(5.5, 5);
    expect(await roomStore.loadSceneParts(ROOM_ID)).toBeUndefined();
  });
});

// The one save a reload still ended: with a room edit in it, the save reads the stored room
// before it writes, and a reloading page is gone before the read comes back — a width typed
// and reloaded at once came back as it was, 0 of 5 in Chromium. So the page also writes the
// save down where it can finish, and the next open finishes it (`lib/leave-note.ts`).
describe('RoomSync, when a reload ends the save it started', () => {
  beforeEach(() => cleanup());
  const note = () => readLeaveNote(ROOM_ID);
  const width = (shell: unknown) => (shell as { width: number }).width;

  /** A fresh page: nothing in memory but what storage gives back. */
  async function reopen() {
    useScene.setState({ parts: [], hydratedRoomId: null });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [], selectedPartId: null });
    render(<RoomSync />);
    await waitFor(() => expect(useScene.getState().hydratedRoomId).toBe(ROOM_ID), { timeout: 2000 });
  }

  it('writes the room change down on the way out, at once, and clears it when the save lands', async () => {
    await mount(<RoomSync />);
    const save = vi.spyOn(roomStore, 'savePending');
    const id = useScene.getState().parts[0].id;
    useScene.getState().setRoom({ width: 5.5, depth: 5, height: 2.6 });
    useStudio.getState().setPosition(id, [0.25, 0, 0.25]);
    leave();
    const written = note();
    expect(width(written?.shell)).toBeCloseTo(5.5, 5);
    expect(written?.transforms?.positions[id]).toEqual([0.25, 0, 0.25]);
    await save.mock.results[0].value;
    await waitFor(() => expect(note()).toBeNull());
    // Stamped with the note's own time, so the next open can tell this save landed.
    const [[, stamp]] = (await entries(stored)).filter(([key]) => key === `room:${ROOM_ID}:wrote:room`);
    expect(stamp).toBe(written?.at);
  });

  // A phone backgrounding the browser: the page is hidden, and may be frozen or killed
  // there without ever being left.
  it('writes it down when the page is hidden, too', async () => {
    await mount(<RoomSync />);
    useScene.getState().setRoom({ width: 5.5, depth: 5, height: 2.6 });
    setVisibility('hidden');
    expect(width(note()?.shell)).toBeCloseTo(5.5, 5);
  });

  it('keeps it when the save it stands in for fails, on a page still alive', async () => {
    await mount(<RoomSync />);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi.spyOn(roomStore, 'savePending').mockRejectedValueOnce(new Error('no'));
    useScene.getState().setRoom({ width: 5.5, depth: 5, height: 2.6 });
    leave();
    await expect(save.mock.results[0].value).rejects.toThrow('no');
    await wait(10);
    expect(width(note()?.shell)).toBeCloseTo(5.5, 5);
  });

  it('writes nothing down for a save with no room change in it, which a reload lets finish', async () => {
    await mount(<RoomSync />);
    useStudio.getState().setPosition(useScene.getState().parts[0].id, [0.5, 0, 0.5]);
    leave();
    expect(localStorage.getItem(leaveNoteKey(ROOM_ID))).toBeNull();
  });

  it('writes nothing down when the room is left inside the app, which waits for the save', async () => {
    const { unmount } = await mount(<RoomSync />);
    useScene.getState().setRoom({ width: 5.5, depth: 5, height: 2.6 });
    unmount();
    expect(localStorage.getItem(leaveNoteKey(ROOM_ID))).toBeNull();
  });

  it('finishes it on the next open, when the reload ended it', async () => {
    const { unmount } = await mount(<RoomSync />);
    // The reload: the save starts, and never lands.
    const save = vi.spyOn(roomStore, 'savePending').mockImplementation(() => new Promise<void>(() => {}));
    const id = useScene.getState().parts[0].id;
    useScene.getState().setRoom({ width: 5.5, depth: 5, height: 2.6 });
    useStudio.getState().setPosition(id, [0.25, 0, 0.25]);
    leave();
    expect(save).toHaveBeenCalledTimes(1);
    unmount();
    save.mockRestore();
    expect((await roomStore.loadRoom(ROOM_ID))!.width).toBe(6);

    await reopen();
    const saved = (await roomStore.loadRoom(ROOM_ID))!;
    const xs = saved.footprint!.map(([x]) => x);
    expect(saved.width).toBeCloseTo(5.5, 5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5.5, 5);
    expect((await roomStore.loadTransforms(ROOM_ID))?.positions[id]).toEqual([0.25, 0, 0.25]);
    // Reshaped, and built by the picker, so the scene the furniture's ids belong to is pinned.
    expect(await roomStore.loadSceneParts(ROOM_ID)).toBeDefined();
    // And the room on screen is the one finished, not the one read before it.
    expect(useScene.getState().room.width).toBeCloseTo(5.5, 5);
    expect(useStudio.getState().positions[id]).toEqual([0.25, 0, 0.25]);
    expect(note()).toBeNull();
  });

  it('does not put it back over a room saved since, and forgets it', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    writeLeaveNote(ROOM_ID, {
      at: Date.now() - 60_000,
      shell: { ...room(), width: 5.5, footprint: footprintForLayout('rect', 5.5, 5) },
    });
    // Another tab's save of the room, after the leave.
    await roomStore.savePending(ROOM_ID, { room: { edit: (r) => r } });
    await reopen();
    expect((await roomStore.loadRoom(ROOM_ID))!.width).toBe(6);
    expect(useScene.getState().room.width).toBe(6);
    expect(note()).toBeNull();
  });

  // Each of these changes the room after the leave without writing the change the note
  // holds, and each once made it look landed: they bumped the room's `touched`.
  it.each([
    ['renamed', () => roomStore.renameRoom(ROOM_ID, 'Renamed')],
    ['photographed', () => roomStore.saveCapture(ROOM_ID, { slot: 'n', blob: new Blob(['x']), takenAt: 1 })],
  ])('still finishes it on the next open when the room was %s in between', async (_, change) => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    writeLeaveNote(ROOM_ID, { at: Date.now() - 60_000, shell: { ...room(), width: 5.5 } });
    await change();
    // The room list sees it first, and must leave a save still owed where it is.
    const settle = vi.spyOn(roomStore, 'settleLeaveNotes');
    await roomStore.listRooms();
    await settle.mock.results[0].value;
    expect(note()).not.toBeNull();
    await reopen();
    expect((await roomStore.loadRoom(ROOM_ID))!.width).toBeCloseTo(5.5, 5);
    expect(useScene.getState().room.width).toBeCloseTo(5.5, 5);
    expect(note()).toBeNull();
  });

  it('opens the room as stored, and lets the note go, when it cannot finish it', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    writeLeaveNote(ROOM_ID, { at: Date.now() + 60_000, shell: { ...room(), width: 5.5 } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(roomStore, 'savePending').mockRejectedValueOnce(new Error('no'));
    await reopen();
    expect(error).toHaveBeenCalled();
    expect(useScene.getState().room.width).toBe(6);
    // One try: the width the user now sees is the one they go on from, and a later open
    // must not change it behind them.
    expect(note()).toBeNull();
  });

  it('keeps the note when the room cannot be read either, since no room was seen', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    writeLeaveNote(ROOM_ID, { at: Date.now() + 60_000, shell: { ...room(), width: 5.5 } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(roomStore, 'savePending').mockRejectedValueOnce(new Error('blocked'));
    vi.spyOn(roomStore, 'loadRoom').mockRejectedValueOnce(new Error('blocked'));
    await reopen();
    expect(note()).not.toBeNull();
    // The next open that can read the room finishes it.
    cleanup();
    await reopen();
    expect((await roomStore.loadRoom(ROOM_ID))!.width).toBeCloseTo(5.5, 5);
    expect(useScene.getState().room.width).toBeCloseTo(5.5, 5);
    expect(note()).toBeNull();
  });
});

describe('RoomSync, when nothing leaves', () => {
  // The ordinary save had the leave's seam, only wider: the outline went on the room's
  // timer and the furniture the wall carried on the transforms' timer, so a reload
  // between the two brought back the new outline with the pieces where they had stood.
  // The stored room is read throughout, as in the size boxes' test below.
  it('saves a new outline and the furniture it moved as one, whichever timer comes due first', async () => {
    await mount(<RoomSync />);
    const id = useScene.getState().parts[0].id;
    useScene.getState().setRoom({ width: 5.5, depth: 5, height: 2.6 });
    await wait(100);
    // Its timer is due 100 ms after the room's.
    useStudio.getState().setPosition(id, [0.25, 0, 0.25]);
    const seen: [boolean, boolean][] = [];
    for (let t = 0; t < 800; t += 25) {
      await wait(25);
      const xs = (await roomStore.loadRoom(ROOM_ID))!.footprint!.map(([x]) => x);
      const moved = (await roomStore.loadTransforms(ROOM_ID))?.positions[id] !== undefined;
      seen.push([Math.abs(Math.max(...xs) - Math.min(...xs) - 5.5) < 1e-6, moved]);
    }
    for (const [outline, moved] of seen) expect(outline).toBe(moved);
    expect(seen.at(-1)).toEqual([true, true]);
  });
});

describe('RoomSync, opening a room never edited', () => {
  // The store outlives the navigation, and part ids collide across rooms by
  // construction. The load reset the overrides only for a room with saved transforms of
  // its own, so a room never edited opened with the last room's moves, turns, sizes and
  // hidden pieces on its own pieces, and its first save stored them.
  it('shows none of the last room’s changes, and saves none of them', async () => {
    useScene.setState({ parts: [] });
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    const left = {
      positions: { 'sofa-1': [1, 0, 1] as [number, number, number] },
      rotations: { 'sofa-1': 1 },
      dims: { 'sofa-1': [1980, 950, 880] as [number, number, number] },
      hidden: { 'sofa-1': true },
    };
    useStudio.setState(left);
    render(<RoomSync />);
    await waitFor(() => expect(useScene.getState().hydratedRoomId).toBe(ROOM_ID), { timeout: 2000 });
    const s = useStudio.getState();
    expect([s.positions, s.rotations, s.dims, s.hidden]).toEqual([{}, {}, {}, {}]);
    const id = useScene.getState().parts[0].id;
    act(() => useStudio.getState().setPosition(id, [0.25, 0, 0.25]));
    await waitFor(async () => expect(await roomStore.loadTransforms(ROOM_ID)).toBeDefined(), { timeout: 2000 });
    const saved = (await roomStore.loadTransforms(ROOM_ID))!;
    expect(Object.keys(saved.positions)).toEqual([id]);
    expect([saved.rotations, saved.dims, saved.hidden]).toEqual([{}, {}, {}]);
  });
});

describe('the size boxes', () => {
  it('commit what was typed when the page is left inside their 200 ms, and leave the saving to RoomSync', async () => {
    await mount(
      <>
        <RoomSync />
        <RoomDimsEditor />
      </>,
    );
    const save = vi.spyOn(roomStore, 'savePending');
    const edit = vi.spyOn(roomStore, 'editRoom');
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '4.5' } });
    expect(useScene.getState().room.width).toBe(6);
    act(() => leave());
    // The commit ran in the first phase, so the room RoomSync saved carried the width.
    expect(useScene.getState().room.width).toBeCloseTo(4.5, 5);
    // One save, RoomSync's, which carries the outline. The size boxes' own carried only
    // the three numbers and, landing alone, stored a width the outline did not have.
    expect(save).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
    await waitFor(async () => {
      const saved = (await roomStore.loadRoom(ROOM_ID))!;
      expect(saved.width).toBeCloseTo(4.5, 5);
      const xs = saved.footprint!.map(([x]) => x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4.5, 5);
    });
  });

  // Not a leave at all: the size boxes' own save, 200 ms after the keystroke, stored the
  // width with the old outline, and RoomSync's did not land until 300 ms after that. A
  // reload anywhere in between brought the room back half-resized. The stored record is
  // read throughout, so the check does not depend on which moment it happens to land in.
  it('store the width only with the outline it makes, when nothing leaves', async () => {
    await mount(
      <>
        <RoomSync />
        <RoomDimsEditor />
      </>,
    );
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '4.5' } });
    const seen: [number, number][] = [];
    for (let t = 0; t < 900; t += 25) {
      await wait(25);
      const saved = (await roomStore.loadRoom(ROOM_ID))!;
      const xs = saved.footprint!.map(([x]) => x);
      seen.push([saved.width, Math.max(...xs) - Math.min(...xs)]);
    }
    for (const [width, outline] of seen) expect(width).toBeCloseTo(outline, 5);
    expect(seen.at(-1)![0]).toBeCloseTo(4.5, 5);
  });

  // The Room section closed, or another room opened, inside the 200 ms. Left to its
  // timer, the commit ran afterwards against whatever room was on screen by then.
  it('commit what was typed when they go away inside their 200 ms, and not again later', async () => {
    const { rerender } = await mount(
      <>
        <RoomSync />
        <RoomDimsEditor />
      </>,
    );
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '4.5' } });
    rerender(
      <>
        <RoomSync />
      </>,
    );
    expect(useScene.getState().room.width).toBeCloseTo(4.5, 5);
    // A different room on screen now: nothing typed in the last one lands in it.
    act(() => useScene.getState().setRoom({ width: 6, depth: 5, height: 2.6 }));
    await wait(300);
    expect(useScene.getState().room.width).toBe(6);
  });

  // Leaving the room unmounts the boxes and RoomSync together, and RoomSync saves in its
  // own cleanup. In an ordinary effect the boxes committed first only because they sit
  // above RoomSync in the layout; rendered after it, as here, the typed width reached a
  // RoomSync that was no longer listening, and the room stayed 6 m wide.
  it('are saved when the whole room goes away, whichever comes first on screen', async () => {
    const { unmount } = await mount(
      <>
        <RoomSync />
        <RoomDimsEditor />
      </>,
    );
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '4.5' } });
    unmount();
    await waitFor(async () => {
      const saved = (await roomStore.loadRoom(ROOM_ID))!;
      expect(saved.width).toBeCloseTo(4.5, 5);
      const xs = saved.footprint!.map(([x]) => x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4.5, 5);
    });
  });
});

describe('the Exact size fields', () => {
  it('commit what was typed when the page is left inside their 120 ms, before RoomSync saves', async () => {
    await mount(
      <>
        <RoomSync />
        <Inspector />
      </>,
    );
    const part = useScene.getState().parts.find((p) => p.category === 'sofa') ?? useScene.getState().parts[0];
    act(() => useStudio.setState({ selection: [part.id], selectedPartId: part.id }));
    const save = vi.spyOn(roomStore, 'savePending');
    const width = screen.getAllByRole('spinbutton')[0];
    const typed = (Number((width as HTMLInputElement).value) * 0.9).toFixed(2);
    fireEvent.change(width, { target: { value: typed } });
    expect(useStudio.getState().dims[part.id]).toBeUndefined();
    act(() => leave());
    expect(useStudio.getState().dims[part.id]).toBeDefined();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].transforms?.dims[part.id]).toEqual(useStudio.getState().dims[part.id]);
  });

  it('commit what was typed when they go away inside their 120 ms, and not again later', async () => {
    const { rerender } = await mount(
      <>
        <RoomSync />
        <Inspector />
      </>,
    );
    const part = useScene.getState().parts.find((p) => p.category === 'sofa') ?? useScene.getState().parts[0];
    act(() => useStudio.setState({ selection: [part.id], selectedPartId: part.id }));
    const width = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(width, { target: { value: (Number((width as HTMLInputElement).value) * 0.9).toFixed(2) } });
    rerender(
      <>
        <RoomSync />
      </>,
    );
    expect(useStudio.getState().dims[part.id]).toBeDefined();
    // A different room on screen now, holding a piece with the same id.
    act(() => useStudio.setState({ dims: {} }));
    await wait(200);
    expect(useStudio.getState().dims[part.id]).toBeUndefined();
  });

  it('are saved when the whole room goes away, whichever comes first on screen', async () => {
    const { unmount } = await mount(
      <>
        <RoomSync />
        <Inspector />
      </>,
    );
    const part = useScene.getState().parts.find((p) => p.category === 'sofa') ?? useScene.getState().parts[0];
    act(() => useStudio.setState({ selection: [part.id], selectedPartId: part.id }));
    const width = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(width, { target: { value: (Number((width as HTMLInputElement).value) * 0.9).toFixed(2) } });
    unmount();
    await waitFor(async () => expect((await roomStore.loadTransforms(ROOM_ID))?.dims[part.id]).toBeDefined());
  });
});

describe('the way-out save', () => {
  const T = { positions: { a: [1, 0, 1] as [number, number, number] }, rotations: {}, dims: {} };

  /** The transaction each put and each commit was made on. */
  function watchTransactions() {
    const puts: IDBTransaction[] = [];
    const commits: IDBTransaction[] = [];
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      puts.push(this.transaction);
      return put.apply(this, args);
    });
    const commit = IDBTransaction.prototype.commit;
    vi.spyOn(IDBTransaction.prototype, 'commit').mockImplementation(function (this: IDBTransaction) {
      commits.push(this);
      return commit.apply(this);
    });
    return { puts, commits };
  }

  it('is one transaction, committed as soon as its last put is made', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    const { puts, commits } = watchTransactions();
    await roomStore.savePending(ROOM_ID, {
      transforms: T,
      parts: [],
      room: { edit: (r) => ({ ...r, height: 2.9 }) },
    });
    // The room, the transforms and the scene, each with the time its data was taken, and
    // the room's last-touched time.
    expect(puts).toHaveLength(7);
    expect(new Set(puts).size).toBe(1);
    expect(commits).toEqual([puts[0]]);
    expect((await roomStore.loadRoom(ROOM_ID))!.height).toBeCloseTo(2.9, 5);
    expect((await roomStore.loadTransforms(ROOM_ID))?.positions.a).toEqual([1, 0, 1]);
    expect(await roomStore.loadSceneParts(ROOM_ID)).toEqual([]);
  });

  it('lands none of it when the room edit fails', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    await expect(
      roomStore.savePending(ROOM_ID, {
        transforms: T,
        room: {
          edit: () => {
            throw new Error('no');
          },
        },
      }),
      // The edit's own error, not the abort it caused: that says nothing about why.
    ).rejects.toThrow('no');
    expect(await roomStore.loadTransforms(ROOM_ID)).toBeUndefined();
    expect((await roomStore.loadRoom(ROOM_ID))!.height).toBeCloseTo(2.6, 5);
  });

  it('lands none of it when a value cannot be stored, and says which', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    const unstorable = { ...T, positions: { a: () => 0 } } as unknown as typeof T;
    await expect(
      roomStore.savePending(ROOM_ID, { transforms: unstorable, room: { edit: (r) => ({ ...r, height: 2.9 }) } }),
    ).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(await roomStore.loadTransforms(ROOM_ID)).toBeUndefined();
    expect((await roomStore.loadRoom(ROOM_ID))!.height).toBeCloseTo(2.6, 5);
  });

  // The replayed leave note's: a part written after the leave was written by the save that
  // landed after all, or by something newer, and either way is not the note's to overwrite.
  // A part nothing has written since is owed, whatever else happened to the room — the
  // room's `touched` is set later than the note in every row, as a rename, a photo or an
  // older save committing late would set it.
  it.each([
    ['nothing written since', {}, { room: true, transforms: true }],
    ['each part written before it', { room: 4_999, transforms: 4_999 }, { room: true, transforms: true }],
    ['the save itself landed', { room: 5_000, transforms: 5_000 }, { room: false, transforms: false }],
    ['the room written since', { room: 5_001 }, { room: false, transforms: true }],
    ['the positions written since', { transforms: 5_001 }, { room: true, transforms: false }],
  ])('with a time to stand down at and %s, writes each part still owed', async (_, written, lands) => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    await set(`room:${ROOM_ID}:touched`, 9_000, stored);
    for (const [part, t] of Object.entries(written)) await set(`room:${ROOM_ID}:wrote:${part}`, t, stored);
    await roomStore.savePending(ROOM_ID, {
      at: 5_000,
      transforms: T,
      room: { edit: (r) => ({ ...r, height: 2.9 }) },
      unlessSavedSince: 5_000,
    });
    expect((await roomStore.loadRoom(ROOM_ID))!.height).toBeCloseTo(lands.room ? 2.9 : 2.6, 5);
    expect((await roomStore.loadTransforms(ROOM_ID))?.positions.a).toEqual(lands.transforms ? [1, 0, 1] : undefined);
    // With nothing owed nothing is written at all, not even the time the room list shows.
    const [[, touched]] = (await entries(stored)).filter(([key]) => key === `room:${ROOM_ID}:touched`);
    if (!lands.room && !lands.transforms) expect(touched).toBe(9_000);
    else expect(touched).not.toBe(9_000);
  });

  it('stamps each part it writes with the time its data was taken, and a replay raises it', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    await roomStore.savePending(ROOM_ID, { at: 7_000, transforms: T, parts: [], room: { edit: (r) => r } });
    const stamps = async () =>
      Object.fromEntries(
        (await entries(stored)).filter(([key]) => String(key).startsWith(`room:${ROOM_ID}:wrote:`)).map(([key, t]) => [String(key).split(':').pop(), t]),
      );
    expect(await stamps()).toEqual({ room: 7_000, transforms: 7_000, scene: 7_000 });
    await roomStore.savePending(ROOM_ID, { at: 8_000, transforms: T, unlessSavedSince: 8_000 });
    expect(await stamps()).toEqual({ room: 7_000, transforms: 8_000, scene: 7_000 });
    // The re-scan's writers stamp what they write, too.
    const before = Date.now();
    await roomStore.saveSceneParts(ROOM_ID, []);
    await roomStore.saveTransforms(ROOM_ID, T);
    const after = await stamps();
    expect(after.room).toBe(7_000);
    expect(after.scene).toBeGreaterThanOrEqual(before);
    expect(after.transforms).toBeGreaterThan(after.scene as number);
  });

  // A re-scan drops the arrangement after a leave it knows nothing about. The note's shell
  // is still owed; its old furniture and positions are not the scan's to have put back.
  it.each([
    ['part list', { parts: ['old'] }, undefined],
    ['pinned part list', {}, ['old']],
  ])('puts a note’s shell back after a re-scan, and not the %s or the positions the scan dropped', async (_, carried, pin) => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    const at = Date.now() - 60_000;
    await roomStore.forgetArrangement(ROOM_ID);
    await roomStore.savePending(ROOM_ID, {
      at,
      transforms: T,
      ...carried,
      room: { edit: (r) => ({ ...r, height: 2.9 }), pin },
      unlessSavedSince: at,
    });
    expect((await roomStore.loadRoom(ROOM_ID))!.height).toBeCloseTo(2.9, 5);
    expect(await roomStore.loadTransforms(ROOM_ID)).toBeUndefined();
    expect(await roomStore.loadSceneParts(ROOM_ID)).toBeUndefined();
  });

  it('takes the room’s leave note with it when the room is deleted, either way, and no other', async () => {
    for (const remove of [roomStore.destroyRoom, roomStore.clearRoom]) {
      await roomStore.saveRoom(room());
      writeLeaveNote(ROOM_ID, { at: 1, shell: room() });
      writeLeaveNote('other-room', { at: 1, shell: room() });
      await remove(ROOM_ID);
      expect(readLeaveNote(ROOM_ID)).toBeNull();
      expect(readLeaveNote('other-room')).not.toBeNull();
    }
  });

  // A closed tab's note: its save landed, and the page that would have cleared it is gone.
  it('has the room list clear each note that is done with, and keep each save still owed', async () => {
    const at = 5_000;
    // The room's stamp; every room is `touched` after the note, as any change would leave it.
    const rooms = { saved: 5_001, landed: 5_000, owed: 4_999, 'never-stamped': null, gone: undefined } as const;
    for (const [id, wroteRoom] of Object.entries(rooms)) {
      await roomStore.destroyRoom(id);
      if (wroteRoom !== undefined) {
        await roomStore.saveRoom({ ...room(), id });
        await set(`room:${id}:touched`, 9_000, stored);
        if (wroteRoom !== null) await set(`room:${id}:wrote:room`, wroteRoom, stored);
      }
      writeLeaveNote(id, { at, shell: room() });
    }
    // Its room landed and its positions did not: still owed.
    writeLeaveNote('landed-half', { at, shell: room(), transforms: T });
    await roomStore.saveRoom({ ...room(), id: 'landed-half' });
    await set('room:landed-half:wrote:room', at, stored);
    const settle = vi.spyOn(roomStore, 'settleLeaveNotes');
    await roomStore.listRooms();
    expect(settle).toHaveBeenCalledTimes(1);
    await settle.mock.results[0].value;
    expect(readLeaveNote('saved')).toBeNull();
    expect(readLeaveNote('landed')).toBeNull();
    expect(readLeaveNote('gone')).toBeNull();
    expect(readLeaveNote('owed')).not.toBeNull();
    expect(readLeaveNote('never-stamped')).not.toBeNull();
    expect(readLeaveNote('landed-half')).not.toBeNull();
    for (const id of [...Object.keys(rooms), 'landed-half']) await roomStore.destroyRoom(id);
  });

  it('says so, and throws nothing, when the room list cannot settle the notes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(roomStore, 'settleLeaveNotes').mockRejectedValueOnce(new Error('blocked'));
    await expect(roomStore.listRooms()).resolves.toBeDefined();
    await wait(10);
    expect(error).toHaveBeenCalledWith('[room] could not settle the leave notes', expect.any(Error));
  });

  it('writes the rest, and no room, when there is no stored room', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.savePending(ROOM_ID, { transforms: T, room: { edit: (r) => r, pin: [] } });
    expect(await roomStore.loadRoom(ROOM_ID)).toBeUndefined();
    expect((await roomStore.loadTransforms(ROOM_ID))?.positions.a).toEqual([1, 0, 1]);
    expect(await roomStore.loadSceneParts(ROOM_ID)).toBeUndefined();
  });

  it('pins a newer part list over the pin, and never a detected room', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    await roomStore.savePending(ROOM_ID, { parts: ['newer'], room: { edit: (r) => r, pin: ['older'] } });
    expect(await roomStore.loadSceneParts(ROOM_ID)).toEqual(['newer']);
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom({
      ...room(),
      detectedObjects: [{ id: 0, label: 'sofa', conf: 0.9, locked: true, box: [0, 0, 1, 1] }],
    });
    await roomStore.savePending(ROOM_ID, { room: { edit: (r) => r, pin: ['older'] } });
    expect(await roomStore.loadSceneParts(ROOM_ID)).toBeUndefined();
  });
});
