// @vitest-environment jsdom
//
// The wall half of the furniture stop, and the half that had no voice at all.
// jsdom because it drives the real stores — `useSettings` is `persist`ed and wants
// localStorage — and because `announce` dispatches a window event, which is the
// only place the refusal can be observed from.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { moveWallCarrying, wallAttachments } from '@/lib/wall-actions';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { ANNOUNCE_EVENT } from '@/lib/announce';
import { footprintForLayout } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'dimMM'>): ScenePart {
  return {
    id: `p-${++n}`,
    name: 'Sofa',
    category: 'sofa',
    shape: 'sofa',
    pos: [0, 0, 0],
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

/** Wall 0 of a `rect` footprint, and which way `delta > 0` pushes it. Derived
 *  rather than assumed: the preset's vertex order is `footprint.ts`'s business and
 *  a hand-written "wall 0 is north" would be a second copy of it. */
function sideAfter(index: number, delta: number): { width: number; depth: number } {
  const before = useScene.getState().room;
  moveWallCarrying(index, delta);
  const after = useScene.getState().room;
  const out = { width: after.width, depth: after.depth };
  useScene.setState({ room: before });
  return out;
}

/** The index of a wall whose outward normal runs along x, so moving it changes
 *  `width` and not `depth`. */
function widthWall(): number {
  for (let i = 0; i < useScene.getState().room.footprint.length; i++) {
    const s = sideAfter(i, 0.2);
    if (Math.abs(s.width - useScene.getState().room.width) > 1e-6) return i;
  }
  throw new Error('no wall moves the width — the rect preset changed shape');
}

/** …and one whose normal runs along z. Both are derived because the two axes are
 *  where a per-axis rule goes wrong invisibly: every assertion written against one
 *  wall passes a rule that reads the other axis's bound. */
function depthWall(): number {
  for (let i = 0; i < useScene.getState().room.footprint.length; i++) {
    const s = sideAfter(i, 0.2);
    if (Math.abs(s.depth - useScene.getState().room.depth) > 1e-6) return i;
  }
  throw new Error('no wall moves the depth — the rect preset changed shape');
}

let heard: string[] = [];
function onAnnounce(e: Event) {
  heard.push((e as CustomEvent<string>).detail ?? '');
}

function setRoom(width: number, depth: number, parts: ScenePart[]) {
  useScene.setState({
    room: {
      width,
      depth,
      height: 2.5,
      layoutId: 'rect',
      footprint: footprintForLayout('rect', width, depth),
      wallColors: {},
    },
    parts,
    ready: true,
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {} });
  // Start each fixture as a fresh GESTURE. `wallAttachments` is what a drag calls
  // at pointer-down and it is also the only thing that clears the refusal
  // de-duplication, which is module state with a one-second clock — and every test
  // in this file runs inside one millisecond. Without this, a test that happens to
  // end on the same room size, wall and sentence as the next one begins mutes it,
  // and the failure reads as "the refusal was never spoken". Two tests did.
  wallAttachments(0);
}

beforeEach(() => {
  heard = [];
  window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
});
afterEach(() => window.removeEventListener(ANNOUNCE_EVENT, onAnnounce));

describe('a wall will not close on the furniture', () => {
  it('refuses the step that would take the room under the widest piece', () => {
    setRoom(4, 3, [part({ dimMM: [2400, 800, 800], name: 'Sectional' })]);
    const w = widthWall();
    // Down to 2.4 in 0.2 steps is fine; the step that would reach 2.3 is not.
    for (let k = 0; k < 8; k++) moveWallCarrying(w, -0.2);
    expect(useScene.getState().room.width).toBeCloseTo(2.4, 6);
    expect(moveWallCarrying(w, -0.2)).toBe(0);
    expect(useScene.getState().room.width).toBeCloseTo(2.4, 6);
  });

  it('names the piece when it refuses', () => {
    setRoom(2.5, 3, [part({ dimMM: [2400, 800, 800], name: 'Sectional' })]);
    moveWallCarrying(widthWall(), -0.2);
    expect(heard.length).toBe(1);
    expect(heard[0]).toContain('Sectional');
  });

  it('will not accept a step SMALLER than the tolerance once it is on the stop', () => {
    // The behavioural half of pinning `ROOM_SIDE_EPS` small. A review widened it to
    // 40 mm and three test files stayed green, because every drift fixture steps
    // 50 mm — larger than the surviving tolerance, so none of them could see it. At
    // 40 mm the wall walks 40 mm INSIDE the sectional and the store persists a room
    // narrower than the piece standing in it, which is the silent resize this whole
    // feature exists to refuse.
    setRoom(2.4, 3, [part({ dimMM: [2400, 900, 800], name: 'Sectional' })]);
    const w = widthWall();
    expect(moveWallCarrying(w, -0.005)).toBe(0);
    expect(useScene.getState().room.width).toBeCloseTo(2.4, 9);
  });

  it('puts a real NUMBER in the sentence, and one in the right unit', () => {
    // Nothing read the number. A review mutated `formatDim(metres * 1000, unit)` to
    // `formatDim(metres, unit)` — a 1000× error — and to a version with the unit
    // suffix deleted, and both were GREEN across the whole file, because every
    // assertion here matched on the piece's name or on "needs". That is the repo's
    // "a displayed measurement must be derived, never hand-typed" with no gate on
    // the derivation.
    setRoom(2.4, 3, [part({ dimMM: [2400, 900, 800], name: 'Sectional' })]);
    moveWallCarrying(widthWall(), -0.2);
    expect(heard.at(-1)).toMatch(/needs 2\.4\d* m —/);
  });

  it('says "already does not fit" from the wall path, not just as a pure function', () => {
    // The `fits` branch was exercised only by calling `floorRefusal` directly.
    // Hard-coding the flag to `true` inside `wallRefusal` was green: no integration
    // assertion ever reached the other wording.
    setRoom(2, 3, [part({ dimMM: [4000, 800, 800], name: 'Sectional' })]);
    moveWallCarrying(widthWall(), -0.1);
    expect(heard.at(-1)).toContain('already does not fit');
    expect(heard.at(-1)).toContain('4.00');
  });

  it('says a SECOND wall\'s refusal, on the path that never starts a gesture', () => {
    // The de-duplication was keyed on the message text alone, and the message names
    // the piece and the axis but NOT the wall — so two walls on one axis produce
    // byte-identical sentences. The arrow key and the Inspector buttons never call
    // `wallAttachments`, the only reset, so the second wall went permanently silent
    // after the first was refused. Keyed by index now.
    setRoom(2.4, 3, [part({ dimMM: [2400, 900, 800], name: 'Sectional' })]);
    // Through `sideAfter`, which restores the whole room. A hand-rolled probe that
    // put back only `width` left the footprint moved, so every later probe measured
    // an already-shifted polygon and reported all four walls as width walls.
    const start = useScene.getState().room.width;
    const wide = useScene
      .getState()
      .room.footprint.map((_, i) => i)
      .filter((i) => Math.abs(sideAfter(i, 0.2).width - start) > 1e-6);
    expect(wide.length, 'a rect should have two walls that move the width').toBe(2);
    setRoom(2.4, 3, [part({ dimMM: [2400, 900, 800], name: 'Sectional' })]);
    moveWallCarrying(wide[0], -0.05);
    moveWallCarrying(wide[1], -0.05);
    expect(heard.length, 'the second wall was refused in silence').toBe(2);
  });

  it('still lets the room GROW when the piece already does not fit', () => {
    // `roomFloor` pins the floor to the current side here. Without that, pushing
    // out is refused too — the prospective width is still under the piece — and the
    // one gesture that could fix the room is the one blocked.
    setRoom(2, 3, [part({ dimMM: [4000, 800, 800], name: 'Sectional' })]);
    const w = widthWall();
    expect(moveWallCarrying(w, 0.3)).toBeCloseTo(0.3, 9);
    expect(useScene.getState().room.width).toBeCloseTo(2.3, 6);
    expect(moveWallCarrying(w, -0.1)).toBe(0);
  });

  it('lets an empty room shrink to the hard floor and no further', () => {
    // Halves, deliberately: 1.4 − 0.4 is 0.9999999999999999 in binary and is
    // refused — correctly, and by `scene-store.moveWall`'s own bound as much as by
    // this one. A fixture that lands on the floor by exact arithmetic is testing
    // the rule rather than the float.
    setRoom(2, 3, []);
    const w = widthWall();
    expect(moveWallCarrying(w, -0.5)).toBeCloseTo(-0.5, 9);
    expect(moveWallCarrying(w, -0.5)).toBeCloseTo(-0.5, 9);
    expect(useScene.getState().room.width).toBe(1);
    expect(moveWallCarrying(w, -0.1)).toBe(0);
    // The NUMBER in the static message, which nothing read: `formatDim` takes mm
    // and `size()` is handed metres, so dropping the `* 1000` renders "0.00 m" and
    // every assertion that matched on the words alone stayed green.
    expect(heard.at(-1)).toMatch(/than 1\.0*0? m\./);
    expect(heard.at(-1)).toContain('will not go narrower');
    expect(heard.at(-1)).not.toContain('Sofa');
  });

  it('does not blame a piece smaller than the hard floor', () => {
    // A 600 mm stool never binds — the 1 m floor is under it the whole way. Naming
    // it would tell the user to move a stool that is not in anyone's way, and the
    // number in the sentence would be a size the room is already well past. The
    // guard for this is `stop.metres > ROOM_SIDE_M.min`, and dropping it changes
    // nothing an empty-room fixture can observe: there is no stop at all there.
    setRoom(1.1, 3, [part({ dimMM: [600, 600, 700], name: 'Stool' })]);
    const w = widthWall();
    // Clamped to the hard floor, not refused — 1.1 has 100 mm of travel left.
    expect(moveWallCarrying(w, -0.3)).toBeCloseTo(-0.1, 9);
    expect(useScene.getState().room.width).toBeCloseTo(1, 9);
    expect(heard.at(-1)).toContain('will not go narrower');
    expect(heard.at(-1)).not.toContain('Stool');
  });

  it('bounds each axis by ITS OWN side, not by the width for both', () => {
    // The room is too shallow for the piece and comfortably wide enough. `roomFloor`
    // pins the depth floor to 2 (the current depth), so pushing the depth wall out
    // is allowed; reading `current.width` instead would pin it to 4 and refuse the
    // very move that helps. Invisible on any square fixture and on any test that
    // only ever moves a width wall.
    setRoom(5, 2, [part({ dimMM: [4000, 4000, 800], name: 'Sectional' })]);
    const d = depthWall();
    expect(moveWallCarrying(d, 0.3)).toBeCloseTo(0.3, 9);
    expect(useScene.getState().room.depth).toBeCloseTo(2.3, 6);
    // …and it is not merely allowed, it is not even COMPLAINED about. Reading the
    // width's bound for the depth axis leaves the move applied in full (the clamp
    // computes its own limits correctly) and only the sentence wrong, so an
    // assertion on the returned delta alone cannot see it.
    expect(heard, 'growing a too-shallow room was reported as a refusal').toEqual([]);
    expect(moveWallCarrying(d, -0.1)).toBe(0);
  });

  it('reaches the stop exactly, after enough steps to accumulate float drift', () => {
    // Found in a browser, not here: thirty-two presses of the plan's 50 mm step
    // walked a 4 m room to 2.3999999999999995 and the wall stopped at **2.45**,
    // while the sentence underneath said the sectional needs 2.40. A whole step of
    // room refused, and the number the user is told disagreeing with the number
    // they can reach. `ROOM_SIDE_EPS` is what closes it, in `wall-actions` and in
    // `scene-store.moveWall` both — one with a tolerance and one without stops the
    // wall for a reason no message can name.
    //
    // The step count is the assertion: a fixture of two or three moves lands on
    // exact binary values and cannot see this at all.
    setRoom(4, 3, [part({ dimMM: [2400, 900, 800], name: 'Sectional' })]);
    const w = widthWall();
    for (let k = 0; k < 32; k++) moveWallCarrying(w, -0.05);
    expect(useScene.getState().room.width).toBeCloseTo(2.4, 9);
    expect(heard).toEqual([]);
    // …and the step after it is still refused, so the tolerance forgives the
    // arithmetic and not a real 50 mm.
    expect(moveWallCarrying(w, -0.05)).toBe(0);
    expect(heard.at(-1)).toContain('Sectional');
    // The WORDING has to survive the same drift. A room walked exactly onto its
    // stop is 2.3999999999999995, so an untolerant `<=` calls a 2.4 m piece too big
    // for a 2.4 m room and prints "already does not fit" at the one size the user
    // has just worked to reach. Seen in a browser one minute after the tolerance
    // above was added — the first fix moved the defect from the geometry into the
    // sentence, which is exactly the kind of thing that ships.
    expect(heard.at(-1)).toContain('needs');
    expect(heard.at(-1)).not.toContain('already does not fit');
  });

  it('reaches the HARD floor exactly too, which is the store\'s own clamp', () => {
    // The companion to the test above, and it exists because that one could not
    // see `scene-store.moveWall`'s copy of the tolerance: it stops at the
    // FURNITURE floor of 2.4, nowhere near the store's 1 m bound, so deleting the
    // epsilon there left the file green. Sixty steps of 50 mm from 4 m lands on
    // 0.9999999999999998; without the tolerance the store refuses, `moveWall`
    // returns a bare 0, and the wall stops at 1.05 under a message that cannot say
    // why.
    // BOTH axes, because the store spells its clamp out per side and a test that
    // walks one wall leaves the other three comparisons unpinned — deleting the
    // depth tolerance alone was green against a width-only fixture.
    for (const [pick, side, word] of [
      [widthWall, 'width', 'narrower'],
      [depthWall, 'depth', 'shallower'],
    ] as const) {
      heard = [];
      setRoom(4, 4, []);
      const w = pick();
      for (let k = 0; k < 60; k++) moveWallCarrying(w, -0.05);
      expect(useScene.getState().room[side], `${side} did not reach the floor`).toBeCloseTo(1, 9);
      expect(heard, `${side} was refused on the way down`).toEqual([]);
      expect(moveWallCarrying(w, -0.05)).toBe(0);
      expect(heard.at(-1)).toContain(`will not go ${word}`);
    }
  });

  it('stops at the far end too, and says which way it will not go', () => {
    // The stop is a FLOOR, so every fixture above pushes inward and none of them
    // can see the ceiling `ROOM_SIDE_M.max` — deleting that branch entirely left
    // the file green. `moveWall` would still bound the move; what would go is the
    // sentence, which is the whole point of judging it here.
    //
    // The step is CLAMPED rather than refused, which is the contract for a
    // gesture: a wall stops at its limit, it does not decline to move. So 0.5
    // asked from 49.8 lands exactly on 50 and reports the 0.2 it took.
    setRoom(49.8, 49.8, []);
    const w = widthWall();
    expect(moveWallCarrying(w, 0.5)).toBeCloseTo(0.2, 9);
    expect(useScene.getState().room.width).toBeCloseTo(50, 9);
    expect(heard.at(-1)).toContain('will not go wider');
    // …and now there is nowhere left, so the next ask really is refused.
    expect(moveWallCarrying(w, 0.5)).toBe(0);
    const d = depthWall();
    expect(moveWallCarrying(d, 0.5)).toBeCloseTo(0.2, 9);
    expect(heard.at(-1)).toContain('will not go deeper');
  });

  it('takes as much of an oversized step as fits, rather than none of it', () => {
    // The defect this clamp exists for, measured in the units it actually bites
    // in: both drag surfaces feed a raw per-frame pointer delta, and at the plan's
    // minimum zoom one frame of a brisk drag is ~250 mm of floor. Refusing the
    // whole frame left the wall stuck wherever the last frame happened to land —
    // a function of pointer speed, under a message naming an exact stop it could
    // not reach — and `prevTotal` advances on the refused frame, so the wall never
    // catches the pointer again for the rest of the gesture.
    setRoom(4, 3, [part({ dimMM: [2400, 900, 800], name: 'Sectional' })]);
    const w = widthWall();
    expect(moveWallCarrying(w, -1.0)).toBeCloseTo(-1.0, 9); // fits whole
    expect(moveWallCarrying(w, -1.0)).toBeCloseTo(-0.6, 9); // 3.0 → 2.4, clamped
    expect(useScene.getState().room.width).toBeCloseTo(2.4, 9);
    expect(heard.at(-1)).toContain('Sectional');
    expect(moveWallCarrying(w, -1.0)).toBe(0); // nothing left
  });

  it('measures the ROTATED piece, so a turned sofa stops the wall sooner', () => {
    // 2400 x 800 laid along x needs 2.4 m of width; turned a quarter it needs 0.8,
    // and its DEPTH demand becomes 2.4. A stop reading `dimMM[0]` passes the first
    // of these and fails the second.
    setRoom(4, 4, [part({ dimMM: [2400, 800, 800], rot: Math.PI / 2 })]);
    const w = widthWall();
    for (let k = 0; k < 20; k++) moveWallCarrying(w, -0.2);
    expect(useScene.getState().room.width).toBeCloseTo(1, 6);
  });

  it('reads the RESOLVED size — a piece the user resized is the one measured', () => {
    // The `settleHeights` scar: measuring the authored `dimMM` answers about a
    // piece nobody can see. Authored 800 mm, dragged out to 2400.
    const p = part({ dimMM: [800, 800, 800], name: 'Sectional' });
    setRoom(3, 3, [p]);
    useStudio.setState({ dims: { [p.id]: [2400, 800, 800] } });
    const w = widthWall();
    for (let k = 0; k < 10; k++) moveWallCarrying(w, -0.2);
    expect(useScene.getState().room.width).toBeCloseTo(2.4, 6);
  });
});

describe('the refusal says itself once', () => {
  it('does not repeat while a drag keeps pushing into the same stop', () => {
    setRoom(2.5, 3, [part({ dimMM: [2400, 800, 800], name: 'Sectional' })]);
    const w = widthWall();
    for (let k = 0; k < 30; k++) moveWallCarrying(w, -0.05);
    expect(heard.length).toBe(1);
  });

  it('says it again for a NEW gesture', () => {
    // `wallAttachments` is called once at pointer-down and is the only signal a
    // gesture has started. Without the reset, backing off a stopped wall, letting
    // go and pushing in again is refused in silence.
    // Already sitting ON the floor, so the very first step is refused.
    setRoom(2.4, 3, [part({ dimMM: [2400, 800, 800], name: 'Sectional' })]);
    const w = widthWall();
    moveWallCarrying(w, -0.05);
    moveWallCarrying(w, -0.05);
    expect(heard.length).toBe(1);
    wallAttachments(w);
    moveWallCarrying(w, -0.05);
    expect(heard.length).toBe(2);
  });

  it('says it again after a move that was taken', () => {
    setRoom(2.6, 3, [part({ dimMM: [2400, 800, 800], name: 'Sectional' })]);
    const w = widthWall();
    moveWallCarrying(w, -0.3); // refused: would reach 2.3
    expect(heard.length).toBe(1);
    moveWallCarrying(w, -0.1); // taken: 2.5
    moveWallCarrying(w, -0.3); // refused again, and it is news
    expect(heard.length).toBe(2);
  });
});
