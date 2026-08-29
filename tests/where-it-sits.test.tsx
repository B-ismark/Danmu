// @vitest-environment jsdom
//
// The Inspector's placement row, after the user looked at it in a browser and said the
// section was redundant and took too much horizontal space.
//
// The redundancy is provable rather than a matter of taste: with nothing under a piece,
// `snapToSurface` and `groundToFloor` are the same three lines — y = 0, clear the rigid
// parent. So two of the three buttons did one thing for most pieces, and the third only
// earns its place when something IS below and you want the piece on the floor rather
// than on it, which no drag can express (dragging it clear moves it in x/z).
//
// Hence what these assert: **two** buttons on bare floor, **three** when there is a
// surface under the piece, and the third one is the one that appears. That is the whole
// rule, and it is a rule about a predicate matching an action — the button is shown by
// `supportBelow()` and driven by `snapToSurface`, which make the same call with the same
// arguments, because a control shown by one predicate and driven by another is how a
// button comes to appear when it does nothing.
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
  it('offers two on bare floor — and Surface is the one missing', () => {
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

  it('offers three when the piece is standing on something', () => {
    // The lamp sits at the table's top, so the probe finds the table beneath it.
    setUp([table(), lamp(0.45)]);
    render(<PlanPage />);
    expect(placementButtons()).toEqual(['Wall', 'Surface', 'Floor']);
    // And the surface it would drop onto is named, rather than described as "the
    // surface below" — the id comes back from `findSupportDetailed` and the name from
    // the same resolved list the probe ran against.
    expect(screen.getByRole('button', { name: 'Surface' }).getAttribute('title')).toBe('Drop onto Coffee table');
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

  it('Floor puts the piece on the floor and lets go of what it was on', () => {
    // The capability the third button exists for, and the reason it is not simply
    // deleted: with a table underneath, this is the only way to say "on the floor".
    setUp([table(), lamp(0.45)]);
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor' }));
    const s = useStudio.getState();
    expect(s.positions[LAMP]?.[1]).toBe(0);
    expect(s.parentIds[LAMP]).toBeUndefined();
  });

  it('Surface puts it back on the table, and records what it is standing on', () => {
    // The negative control for the test above: without it, both buttons could be
    // wired to `groundToFloor` and every assertion here would still pass.
    setUp([table(), lamp(0)]);
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor' }));
    expect(useStudio.getState().positions[LAMP]?.[1]).toBe(0);
    // The row re-reads the effective position, so Surface is back once it is grounded
    // — the probe looks at what is under the centre, not at what it is parented to.
    fireEvent.click(screen.getByRole('button', { name: 'Surface' }));
    const s = useStudio.getState();
    expect(s.positions[LAMP]?.[1]).toBeCloseTo(0.45, 6);
    expect(s.parentIds[LAMP]).toBe(TABLE);
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
