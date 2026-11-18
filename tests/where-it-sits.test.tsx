// @vitest-environment jsdom
//
// Where a piece sits, after the user looked at the Inspector's placement row three times
// and said each time it was not needed — the last time, "the sticking to wall and floor
// feature is mostly not needed".
//
// **The row is gone from the panel; the two operations are on the right-click menu.**
//
// § B.17 first took it from three buttons to two: Surface went once `lib/drag-resolve.ts`
// made it a drag, exactly (asserted below, so it cannot quietly stop being true). The two
// left are the two a drag cannot express:
//
//   · **Move to the nearest wall** moves the piece AND turns it to face the room.
//     `drag-resolve`'s wall snap is gated on `ridesWall` — the TV/mirror/painting/AC/
//     curtain family — so a sofa is never slid onto plaster and never rotated.
//   · **Put on the floor** puts it on the floor WITHOUT moving it in x/z. Dragging it
//     clear also drops it, but somewhere else; "on the floor, under the desk" is only this.
//
// "Mostly" is the word that decided where they went rather than whether they stay: a
// permanent row is the wrong price for something reached for rarely, and the menu
// costs nothing until it is asked for.
//
// Mounted through the real plan page, which mounts the real menu, so both the panel and
// the menu are reached the way a user reaches them.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { resolvePlacement } from '@/lib/drag-resolve';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('where-it-sits-room'));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');
const { openSceneMenu } = await import('@/components/studio/SceneContextMenu');

const LAMP = 'lamp-1';
const TABLE = 'table-1';

/** A small floor-standing piece. Floor-standing is what makes the row render at all — a
 *  wall-mounted part gets the mount-height field instead — so a curtain here would
 *  silently test nothing. */
function lamp(y: number): ScenePart {
  return {
    id: LAMP, name: 'Table lamp', category: 'lamp', shape: 'lamp-table', locked: false,
    dimMM: [200, 200, 300], pos: [0, y, 0], rot: 0, wallMounted: false,
  } as ScenePart;
}

/** The surface. Its top is at 0.45 m, and the lamp is placed at the same x/z so the
 *  support probe finds it — `findSupportDetailed` reads what is under the piece's
 *  centre, so a table anywhere else in the room is not a support. */
function table(): ScenePart {
  return {
    id: TABLE, name: 'Coffee table', category: 'table', shape: 'coffee-table', locked: false,
    dimMM: [1000, 600, 450], pos: [0, 0, 0], rot: 0, wallMounted: false,
  } as ScenePart;
}

function setUp(parts: ScenePart[]) {
  cleanup();
  useScene.setState({
    parts,
    room: {
      ...useScene.getState().room,
      width: 4, depth: 4, height: 2.6,
      footprint: footprintForLayout('rect', 4, 4),
      layoutId: 'rect',
    },
  });
  // No overrides: the row must read the authored transform, not a leftover drag.
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [LAMP], selectedPartId: LAMP });
}

/** Any placement button left in the panel, found by its visible word. */
function placementButtons(): string[] {
  return ['Wall', 'Surface', 'Floor'].filter((word) => screen.queryAllByRole('button', { name: word }).length > 0);
}

const WALL = 'Move to the nearest wall';
const FLOOR = 'Put on the floor';

/** Right-click the piece, the way both surfaces raise the menu, and list what it offers.
 *  `hidden: true` because the menu stays `visibility: hidden` until it has measured its
 *  canvas, which jsdom has no layout to do. */
function rightClick(id: string): string[] {
  act(() => openSceneMenu(100, 100, id));
  return screen.queryAllByRole('menuitem', { hidden: true }).map((b) => b.textContent?.trim() ?? '');
}
const menuItem = (name: string) => {
  const hit = screen.queryAllByRole('menuitem', { hidden: true }).find((b) => b.textContent?.trim() === name);
  if (!hit) throw new Error(`no "${name}" in the menu`);
  return hit;
};

beforeEach(() => cleanup());

describe('placement lives on the right-click menu, not in the panel', () => {
  it('the panel has no placement row, on bare floor or on a table', () => {
    for (const parts of [[lamp(0)], [table(), lamp(0.45)]]) {
      setUp(parts);
      render(<PlanPage />);
      // The panel IS showing the lamp — otherwise "no buttons" is free.
      expect(screen.getAllByText('Table lamp').length).toBeGreaterThan(0);
      expect(placementButtons()).toEqual([]);
    }
  });

  it('the menu offers both, and Surface is not one of them', () => {
    setUp([table(), lamp(0.45)]);
    render(<PlanPage />);
    const items = rightClick(LAMP);
    expect(items).toContain(WALL);
    expect(items).toContain(FLOOR);
    expect(items.some((t) => /surface/i.test(t))).toBe(false);
  });

  // Why Surface could go, asserted rather than asserted-in-a-comment. `resolvePlacement`
  // is the one resolve both tabs run, so this is the real path a user's drag takes.
  //
  // Mutation-checked: making `drag-resolve`'s gravity step keep `input.currentY` for a
  // floor-standing piece — which is what it did before the pipeline was extracted, and
  // the state the § B.17 note was written in — turns the first number into 0.45 and this
  // goes red. That is the assertion that stops the button being removable on a stale
  // premise a second time.
  it('a drag reproduces both halves of what Surface did', () => {
    const world = [table()];
    const move = (from: [number, number, number], toX: number, toZ: number) =>
      resolvePlacement({
        part: { ...lamp(0), pos: from } as ScenePart,
        rawX: toX, rawZ: toZ, rot: 0, dim: [220, 220, 450],
        parts: world, footprint: footprintForLayout('rect', 5, 4),
        roomHeight: 2.6, snapMode: 'off', currentY: from[1],
      });

    const off = move([0, 0.45, 0], 1.9, 1.4);
    expect(off.pos[1], 'dragged clear of the table, it drops to the floor').toBe(0);
    expect(off.supportId, 'and rests on nothing').toBeUndefined();

    const back = move([1.9, 0, 1.4], 0, 0);
    expect(back.pos[1], 'dragged back over it, it climbs onto the top').toBeCloseTo(0.45, 6);
    expect(back.supportId, 'and names what it is standing on').toBe(TABLE);
  });

  it('Put on the floor puts the piece on the floor IN PLACE, and lets go of what it was on', () => {
    // The capability this button exists for, and the reason it survived § B.17: with a
    // table underneath, this is the only way to say "on the floor". The x and z
    // assertions are the whole distinction from a drag, which also drops the piece but
    // carries it somewhere else — without them this passes against a button wired to
    // anything that happens to zero the Y.
    const before = lamp(0.45).pos;
    setUp([table(), lamp(0.45)]);
    // The rigid-parent link a drop onto the table would have written. Without it the
    // last assertion is decoration — mutation-checked: deleting `clearParent` from
    // `putOnFloor` left this green, because the fixture had no parent to clear.
    useStudio.setState({ parentIds: { [LAMP]: TABLE } });
    render(<PlanPage />);
    rightClick(LAMP);
    fireEvent.click(menuItem(FLOOR));
    const s = useStudio.getState();
    expect(s.positions[LAMP]?.[1]).toBe(0);
    expect(s.positions[LAMP]?.[0], 'x is untouched — that is what "in place" means').toBe(before[0]);
    expect(s.positions[LAMP]?.[2], 'and so is z').toBe(before[2]);
    expect(s.parentIds[LAMP], 'it stopped riding the table').toBeUndefined();
  });

  it('Move to the nearest wall is the other one a drag cannot reach, and it turns the piece to face the room', () => {
    // The negative control the deleted Surface test used to be: without a second button
    // doing something DIFFERENT, every assertion above would pass with both wired to
    // `putOnFloor`. This is also the operation whose absence from `drag-resolve` is
    // the reason the row was not deleted outright — the wall snap there is gated on
    // `ridesWall`, and a lamp is not in that family.
    // A deliberately crooked starting angle, and it is the whole assertion below.
    //
    // The lamp used to start at `rot: 0` under an `expect(…).toBeDefined()`, which
    // cannot fail for a WRONG rotation: `setRotation(id, part.rot)` writes 0, the
    // override exists, and the check is green. Writing the start angle back instead of the wall's passed — so the
    // half of Wall this file's header argues it survived § B.17 *for* was the half
    // nothing guarded. 0.7 rad is not a multiple of π/2, so no wall can legitimately
    // produce it and writing the start value back is now red.
    const crooked = 0.7;
    setUp([{ ...lamp(0), rot: crooked }]);
    render(<PlanPage />);
    rightClick(LAMP);
    fireEvent.click(menuItem(WALL));
    const s = useStudio.getState();
    const moved = s.positions[LAMP]!;
    expect(Math.abs(moved[0]) > 1.5 || Math.abs(moved[2]) > 1.2, `moved to a wall: ${moved.join(', ')}`).toBe(true);
    const turned = s.rotations[LAMP];
    expect(turned, 'and turned to face the room').toBeDefined();
    expect(turned, 'the start angle was written back rather than the wall’s').not.toBeCloseTo(crooked, 3);
    // A wall in a rectangular room faces one of four ways, so the snapped angle is a
    // quarter turn. This is what "faces the room" means in a number.
    const quarters = Math.abs(turned! / (Math.PI / 2));
    expect(quarters, `${turned} is not a quarter turn`).toBeCloseTo(Math.round(quarters), 5);
  });

  it('gives a wall-mounted piece neither, in the panel or the menu', () => {
    // The row is for pieces that stand on something. A part fixed to the building has
    // nowhere else to be put, and for the ceiling family "Wall" would slide a fan
    // sideways onto the plaster.
    const tv = {
      id: 'tv-1', name: 'TV', category: 'tv', shape: 'tv', locked: false,
      dimMM: [1200, 80, 700], pos: [0, 1.2, -1.95], rot: 0, wallMounted: true,
    } as ScenePart;
    cleanup();
    useScene.setState({
      parts: [tv],
      room: { ...useScene.getState().room, width: 4, depth: 4, height: 2.6, footprint: footprintForLayout('rect', 4, 4), layoutId: 'rect' },
    });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: ['tv-1'], selectedPartId: 'tv-1' });
    render(<PlanPage />);
    expect(placementButtons()).toEqual([]);
    const items = rightClick('tv-1');
    expect(items.length, 'the menu did open').toBeGreaterThan(0);
    expect(items).not.toContain(WALL);
    expect(items).not.toContain(FLOOR);
    // …and it gets the one number that does mean something about where it sits.
    expect(screen.getByLabelText(/Height off the floor/i)).toBeTruthy();
  });
});
