// @vitest-environment jsdom
//
// The Inspector's placement row, after the user looked at it in a browser and said the
// section was redundant and took too much horizontal space.
//
// **The row is TWO buttons now, always — § B.17, and the premise that shaped it expired.**
//
// This file used to assert two buttons on bare floor and three when something was below,
// because `snapToSurface` and `groundToFloor` are the same three lines with nothing
// underneath. The user then said they did not think the row was needed at all, and the
// answer recorded from that was "keep the operations, drop the row", on the grounds that
// neither Floor-off-a-table nor Surface-back-onto-it was reachable by dragging.
//
// That last part stopped being true when the drag pipeline moved into
// `lib/drag-resolve.ts`. Measured against `resolvePlacement` — and asserted below, so it
// cannot quietly stop being true again — dragging a piece clear of a surface lands it at
// y = 0, and dragging it back over lands it on the surface with `supportId` set. Surface
// is a drag, exactly, so it is gone.
//
// The two that remain are the two a drag cannot express, which is why the row survived
// rather than being deleted as the original answer's letter would have had it:
//
//   · **Wall** moves the piece to the nearest wall AND turns it to face the room.
//     `drag-resolve`'s wall snap is gated on `ridesWall` — the TV/mirror/painting/AC/
//     curtain family — so a sofa is never slid onto plaster and never rotated.
//   · **Floor** puts it on the floor WITHOUT moving it in x/z. Dragging it clear also
//     drops it, but somewhere else; "on the floor, under the desk" is only this.
//
// Mounted through the real plan page, like tests/mount-height-refusal.test.tsx, so the
// Inspector is reached the way a user reaches it rather than through a harness that
// decides for itself when the row renders.
//
// What it does NOT prove: that two buttons at 50% actually fit the narrowest rail. That
// is a width question, `tests/reflow.test.ts` is where widths live, and neither can see
// a rendered glyph. It also cannot see that the heading is gone in a way that looks
// deliberate rather than broken — the item for that is in docs/visual-check.md.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { resolvePlacement } from '@/lib/drag-resolve';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

// See tests/library-click-through.test.tsx for why these shims are needed.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});
Element.prototype.scrollIntoView = function scrollIntoView() {};

vi.mock('next/navigation', () => ({
  useParams: () => ({ roomId: 'where-it-sits-room' }),
  usePathname: () => '/room/where-it-sits-room/plan',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

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

/** The placement buttons, found the way a user picks them out — by their visible word.
 *  Not by a test id and not by counting children of a div, either of which would keep
 *  passing if the labels changed to something meaningless. */
function placementButtons(): string[] {
  return ['Wall', 'Surface', 'Floor'].filter((word) => screen.queryAllByRole('button', { name: word }).length > 0);
}

beforeEach(() => cleanup());

describe('the Inspector placement row shows the buttons that do something', () => {
  it('offers two on bare floor — and Surface is not one of them', () => {
    setUp([lamp(0)]);
    render(<PlanPage />);
    const shown = placementButtons();
    expect(shown).toEqual(['Wall', 'Floor']);
    // Stated as its own assertion as well as through the array, because the array
    // equality would also pass if the row rendered nothing at all and both other
    // words came from somewhere else on the page.
    expect(screen.queryAllByRole('button', { name: 'Surface' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Floor' })).toHaveLength(1);
  });

  it('offers the SAME two when the piece is standing on something', () => {
    // The case that used to grow a third button. The lamp sits at the table's top, so
    // a probe would find the table beneath it — and the row no longer cares, because
    // dragging the lamp back onto the table is what Surface was for. Asserted at the
    // state that used to differ, so re-adding the button anywhere would show up here.
    setUp([table(), lamp(0.45)]);
    render(<PlanPage />);
    expect(placementButtons()).toEqual(['Wall', 'Floor']);
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

  it('drops the heading, and the buttons still say where the piece will sit', () => {
    // The user's actual complaint. "Where it sits" is gone; what replaced it is
    // nothing, because each button is already a word for where the piece will be.
    setUp([lamp(0)]);
    render(<PlanPage />);
    expect(screen.queryByText('Where it sits')).toBeNull();
    for (const word of ['Wall', 'Floor']) {
      const b = screen.getByRole('button', { name: word });
      // An accessible name AND a sentence on hover. The icons-only option the user
      // offered would have left the first of those to be re-earned.
      expect(b.getAttribute('title')).toBeTruthy();
    }
  });

  it('Floor puts the piece on the floor IN PLACE, and lets go of what it was on', () => {
    // The capability this button exists for, and the reason it survived § B.17: with a
    // table underneath, this is the only way to say "on the floor". The x and z
    // assertions are the whole distinction from a drag, which also drops the piece but
    // carries it somewhere else — without them this passes against a button wired to
    // anything that happens to zero the Y.
    const before = lamp(0.45).pos;
    setUp([table(), lamp(0.45)]);
    // The rigid-parent link a drop onto the table would have written. Without it the
    // last assertion is decoration — mutation-checked: deleting `clearParent` from
    // `groundToFloor` left this green, because the fixture had no parent to clear.
    useStudio.setState({ parentIds: { [LAMP]: TABLE } });
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor' }));
    const s = useStudio.getState();
    expect(s.positions[LAMP]?.[1]).toBe(0);
    expect(s.positions[LAMP]?.[0], 'x is untouched — that is what "in place" means').toBe(before[0]);
    expect(s.positions[LAMP]?.[2], 'and so is z').toBe(before[2]);
    expect(s.parentIds[LAMP], 'it stopped riding the table').toBeUndefined();
  });

  it('Wall is the other one a drag cannot reach, and it turns the piece to face the room', () => {
    // The negative control the deleted Surface test used to be: without a second button
    // doing something DIFFERENT, every assertion above would pass with both wired to
    // `groundToFloor`. This is also the operation whose absence from `drag-resolve` is
    // the reason the row was not deleted outright — the wall snap there is gated on
    // `ridesWall`, and a lamp is not in that family.
    setUp([lamp(0)]);
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Wall' }));
    const s = useStudio.getState();
    const moved = s.positions[LAMP]!;
    expect(Math.abs(moved[0]) > 1.5 || Math.abs(moved[2]) > 1.2, `moved to a wall: ${moved.join(', ')}`).toBe(true);
    expect(s.rotations[LAMP], 'and turned to face the room').toBeDefined();
  });

  it('gives a wall-mounted piece none of them', () => {
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
    // …and it gets the one number that does mean something about where it sits.
    expect(screen.getByLabelText(/Height off the floor/i)).toBeTruthy();
  });
});
