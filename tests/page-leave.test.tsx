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
import { onPageLeave } from '@/lib/page-leave';
import { footprintForLayout } from '@/lib/footprint';
import { roomStore, type RoomData } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio } from '@/lib/store';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('leave-room'));

const { RoomSync } = await import('@/components/studio/RoomSync');
const { RoomDimsEditor } = await import('@/components/studio/RoomDimsEditor');
const { Inspector } = await import('@/components/studio/Inspector');

const ROOM_ID = 'leave-room';

const leave = () => window.dispatchEvent(new Event('pagehide'));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setVisibility('visible');
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
    const save = vi.spyOn(roomStore, 'saveOnLeave');
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
    const save = vi.spyOn(roomStore, 'saveOnLeave');
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
    const save = vi.spyOn(roomStore, 'saveOnLeave');
    useScene.getState().setRoom({ width: 6, depth: 5, height: 2.9 });
    leave();
    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect((await roomStore.loadRoom(ROOM_ID))!.height).toBeCloseTo(2.9, 5));
  });

  it('writes nothing when nothing is pending', async () => {
    await mount(<RoomSync />);
    const saves = [
      vi.spyOn(roomStore, 'saveOnLeave'),
      vi.spyOn(roomStore, 'saveTransforms'),
      vi.spyOn(roomStore, 'saveSceneParts'),
      vi.spyOn(roomStore, 'editRoom'),
    ];
    leave();
    for (const s of saves) expect(s).not.toHaveBeenCalled();
  });

  // The case three separate saves got wrong: a wall moved, and the furniture it carried.
  it('saves a new outline and the furniture it moved as one', async () => {
    await mount(<RoomSync />);
    const save = vi.spyOn(roomStore, 'saveOnLeave');
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
    const save = vi.spyOn(roomStore, 'saveOnLeave');
    useScene.getState().setRoom({ width: 5.5, depth: 5, height: 2.6 });
    leave();
    await save.mock.results[0].value;
    expect((await roomStore.loadRoom(ROOM_ID))!.width).toBeCloseTo(5.5, 5);
    expect(await roomStore.loadSceneParts(ROOM_ID)).toBeUndefined();
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
    const save = vi.spyOn(roomStore, 'saveOnLeave');
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
    const save = vi.spyOn(roomStore, 'saveOnLeave');
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
    await roomStore.saveOnLeave(ROOM_ID, {
      transforms: T,
      parts: [],
      room: { edit: (r) => ({ ...r, height: 2.9 }) },
    });
    // The room, the transforms, the scene and the room's last-touched time.
    expect(puts).toHaveLength(4);
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
      roomStore.saveOnLeave(ROOM_ID, {
        transforms: T,
        room: {
          edit: () => {
            throw new Error('no');
          },
        },
      }),
    ).rejects.toBeDefined();
    expect(await roomStore.loadTransforms(ROOM_ID)).toBeUndefined();
    expect((await roomStore.loadRoom(ROOM_ID))!.height).toBeCloseTo(2.6, 5);
  });

  it('writes the rest, and no room, when there is no stored room', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveOnLeave(ROOM_ID, { transforms: T, room: { edit: (r) => r, pin: [] } });
    expect(await roomStore.loadRoom(ROOM_ID)).toBeUndefined();
    expect((await roomStore.loadTransforms(ROOM_ID))?.positions.a).toEqual([1, 0, 1]);
    expect(await roomStore.loadSceneParts(ROOM_ID)).toBeUndefined();
  });

  it('pins a newer part list over the pin, and never a detected room', async () => {
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom(room());
    await roomStore.saveOnLeave(ROOM_ID, { parts: ['newer'], room: { edit: (r) => r, pin: ['older'] } });
    expect(await roomStore.loadSceneParts(ROOM_ID)).toEqual(['newer']);
    await roomStore.destroyRoom(ROOM_ID);
    await roomStore.saveRoom({
      ...room(),
      detectedObjects: [{ id: 0, label: 'sofa', conf: 0.9, locked: true, box: [0, 0, 1, 1] }],
    });
    await roomStore.saveOnLeave(ROOM_ID, { room: { edit: (r) => r, pin: ['older'] } });
    expect(await roomStore.loadSceneParts(ROOM_ID)).toBeUndefined();
  });
});
