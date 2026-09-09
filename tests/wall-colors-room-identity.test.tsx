// @vitest-environment jsdom
//
// "Use the colours in my photos" reads a room, awaits four JPEG decodes, and then
// writes through global store setters that outlive the component. This file is
// about the gap in the middle.
//
// Every setter on `useScene` is global. Nothing in the store could say WHICH room
// it held, so a sample started in room A and finished after the studio had
// navigated to room B painted B's walls with A's colours, `RoomSync` persisted
// them, and the success toast named a room that was never photographed. The undo
// action was worse: a toast lives nine seconds, and pressing Undo after switching
// rooms restored A's pre-sample map — usually `{}` — over whatever the user had
// painted in B.
//
// **The control is MOUNTED and pressed**, because that is the difference between
// this file catching the defect and describing it: the gate is a line in an async
// continuation, and the only way to reach it is to move the store while the
// promise is in flight. The regression cases below deliberately do the moving
// between the press and the resolution.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useScene } from '@/lib/scene-store';
import type { RoomData } from '@/lib/storage';
import type { WallColorProposal } from '@/lib/wall-colors';

// Through the shared helper, per `tests/toolchain.test.ts`'s sweep: nine files had
// hand-rolled this same four-hook module object. The route id is FIXED at 'room-a'
// on purpose — the point of this file is that the component keeps its own route
// param while the STORE moves to another room, which is precisely the state an
// async continuation is left in after the studio navigates away.
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('room-a'));

const captures: Array<{ slot: string }> = [{ slot: 'n' }];
let hasCaptures = true;
vi.mock('@/lib/storage', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    roomStore: {
      hasCaptures: () => Promise.resolve(hasCaptures),
      loadCaptures: () => Promise.resolve(captures),
    },
  };
});

/** The sample itself is not under test here — the window between it and the write
 *  is — so it is a promise this file resolves by hand. */
let settle: (p: WallColorProposal | null) => void = () => {};
vi.mock('@/lib/wall-colors', () => ({
  sampleWallColors: () =>
    new Promise<WallColorProposal | null>((resolve) => {
      settle = resolve;
    }),
}));

type Toast = { title?: string; message?: string; action?: { onClick: () => void } };
const toasts: Toast[] = [];
vi.mock('@/components/ui/StorageToast', () => ({
  toast: (spec: Toast) => {
    toasts.push(spec);
    return 1;
  },
}));

const { WallColorsFromPhotos } = await import('@/components/studio/WallColorsFromPhotos');

const roomRecord = (id: string, wallColors: Record<number, string> = {}): RoomData =>
  ({
    id,
    createdAt: 0,
    name: id,
    layoutId: 'rect',
    width: 5.6,
    depth: 4.2,
    height: 2.5,
    wallColors,
  }) as RoomData;

const proposal = (perWall: Record<number, string>): WallColorProposal => ({
  perWall,
  allWalls: null,
  skipped: [],
  furniture: { knownIn: ['n'], blindIn: [] },
});

/** Let timers, `requestAnimationFrame` and the microtask queue drain.
 *  `useBusyAction` yields through `afterPaint`, which is TWO nested rAF callbacks,
 *  and vitest's jsdom runs rAF on a ~16 ms timer — so the press has not even
 *  started until about 32 ms have passed. A bare `Promise.resolve()` (and 25 ms)
 *  stops short of it, and the whole file passed its refusal cases for the wrong
 *  reason: nothing had run at all. */
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 90));
  });

/** Press the button and run up to the point where the sample is pending. */
async function press() {
  const btn = await screen.findByRole('button', { name: /photos/i });
  fireEvent.click(btn);
  await flush();
}

beforeEach(() => {
  hasCaptures = true;
  toasts.length = 0;
  useScene.getState().loadFromRoom(roomRecord('room-a'));
});
afterEach(cleanup);

describe('the store knows which room it is holding', () => {
  it('records the loaded room and clears it for the default scene', () => {
    expect(useScene.getState().loadedRoomId).toBe('room-a');
    useScene.getState().loadFromRoom(undefined);
    expect(useScene.getState().loadedRoomId).toBeNull();
  });
});

describe('a sample lands in the room it was taken from, or nowhere', () => {
  it('paints the walls when the room has not moved', async () => {
    render(<WallColorsFromPhotos />);
    await press();
    settle(proposal({ 0: '#8ca082' }));
    await flush();
    expect(useScene.getState().room.wallColors).toEqual({ 0: '#8ca082' });
  });

  it('writes NOTHING when the studio moved to another room mid-sample', async () => {
    render(<WallColorsFromPhotos />);
    await press();
    // Room B arrives while the photos are decoding — its own wall already painted.
    useScene.getState().loadFromRoom(roomRecord('room-b', { 1: '#c8b49b' }));
    settle(proposal({ 0: '#8ca082' }));
    await flush();
    expect(useScene.getState().loadedRoomId).toBe('room-b');
    expect(useScene.getState().room.wallColors).toEqual({ 1: '#c8b49b' });
    // …and it does not announce a success about a room it did not paint.
    expect(toasts.map((t) => t.title ?? '')).not.toContain(
      expect.stringContaining('took their colour'),
    );
  });

  it('Undo restores the room it sampled, and refuses to touch any other', async () => {
    render(<WallColorsFromPhotos />);
    useScene.setState((s) => ({ room: { ...s.room, wallColors: { 3: '#7a6a58' } } }));
    await press();
    settle(proposal({ 0: '#8ca082' }));
    await flush();
    const undo = toasts.at(-1)!.action!;
    // Same room: Undo puts back exactly what was there at the PRESS, including a
    // wall the user had painted by hand.
    act(() => undo.onClick());
    expect(useScene.getState().room.wallColors).toEqual({ 3: '#7a6a58' });

    // Another room, within the toast's nine seconds: Undo must do nothing at all.
    useScene.getState().loadFromRoom(roomRecord('room-b', { 1: '#c8b49b' }));
    act(() => undo.onClick());
    expect(useScene.getState().room.wallColors).toEqual({ 1: '#c8b49b' });
  });

  it('Undo keeps a wall the user painted WHILE the photos were being read', async () => {
    // The undo snapshot has to be taken at the write, not at the press: four JPEG
    // decodes are long enough to paint a wall by hand, and a snapshot from before
    // them does not contain it — so Undo, which promises to put things back, threw
    // that work away.
    render(<WallColorsFromPhotos />);
    await press();
    act(() => useScene.getState().setWallColor(2, '#efe7d8'));
    settle(proposal({ 0: '#8ca082' }));
    await flush();
    expect(useScene.getState().room.wallColors).toEqual({ 2: '#efe7d8', 0: '#8ca082' });
    act(() => toasts.at(-1)!.action!.onClick());
    expect(useScene.getState().room.wallColors).toEqual({ 2: '#efe7d8' });
  });

  it('refuses when the room was RESHAPED mid-sample, and says so', async () => {
    render(<WallColorsFromPhotos />);
    await press();
    // A wall drag re-derives the footprint, so the sampled wall indices describe a
    // shape that is no longer on screen. `wallColorProposal`'s own in-range check
    // cannot catch this: it ran against the footprint as it was.
    act(() => {
      useScene.getState().moveWall(0, 0.4);
    });
    settle(proposal({ 0: '#8ca082' }));
    await flush();
    expect(useScene.getState().room.wallColors).toEqual({});
    expect(toasts.at(-1)!.title).toMatch(/room changed/i);
  });

  it('an ordinary recolour mid-sample is not mistaken for a reshape', async () => {
    // The reshape test above is only meaningful if the check is about the SHAPE:
    // painting a wall also replaces the `room` object, and refusing then would
    // make the feature fail whenever anything else touched the room.
    render(<WallColorsFromPhotos />);
    await press();
    act(() => useScene.getState().setWallColor(3, '#7a6a58'));
    settle(proposal({ 0: '#8ca082' }));
    await flush();
    expect(useScene.getState().room.wallColors).toEqual({ 3: '#7a6a58', 0: '#8ca082' });
  });
});

describe('the furniture caveat reaches both branches of the answer', () => {
  const blind = (over: Partial<WallColorProposal>): WallColorProposal => ({
    perWall: {},
    allWalls: null,
    skipped: [],
    furniture: { knownIn: [], blindIn: ['n'] },
    ...over,
  });

  it('says it on the one-colour branch, which is the case that needs it most', async () => {
    // Every L/T/U room takes this branch, and so does every room opened from a
    // scene file — which carries no detection boxes at all by design. The caveat
    // was appended only to the per-wall branch, so exactly the case with the least
    // information got a confident success with nothing said.
    render(<WallColorsFromPhotos />);
    await press();
    settle(blind({ allWalls: '#8ca082' }));
    await flush();
    expect(useScene.getState().room.wallColors[0]).toBe('#8ca082');
    expect(toasts.at(-1)!.message).toMatch(/no detected objects/i);
  });

  it('and on the per-wall branch', async () => {
    render(<WallColorsFromPhotos />);
    await press();
    settle(blind({ perWall: { 0: '#8ca082' } }));
    await flush();
    expect(toasts.at(-1)!.message).toMatch(/no detected objects/i);
  });

  it('and says nothing when every photo had furniture to leave out', async () => {
    // The other direction: a caveat that is always printed is not a caveat. This
    // is what made the old flag's false negative visible in the first place — users
    // with a fully scanned room were told it had no detections.
    render(<WallColorsFromPhotos />);
    await press();
    settle(proposal({ 0: '#8ca082' }));
    await flush();
    expect(toasts.at(-1)!.message ?? '').not.toMatch(/detected objects/i);
  });
});

describe('the button appears when the room gains photos', () => {
  it('re-asks on focus rather than once per roomId', async () => {
    hasCaptures = false;
    render(<WallColorsFromPhotos />);
    await flush();
    expect(screen.queryByRole('button', { name: /photos/i })).toBeNull();
    // Photographed elsewhere — another tab, or the capture screen and back without
    // a remount. Asked once per `roomId`, this stayed absent for the rest of the
    // session.
    hasCaptures = true;
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(screen.queryByRole('button', { name: /photos/i })).not.toBeNull();
  });
});
