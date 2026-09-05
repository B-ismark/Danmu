// @vitest-environment jsdom
//
// § H.3's caller half: does the Library actually ASK for a clear spot?
//
// `tests/spawn-spread.test.ts` gates `openSpotForNewPart` thoroughly and cannot see
// whether `CatalogPanel.spawn` calls it, or passes what it returns on to
// `placeNewPart`. That gap is the exact one that cost a whole feature last cycle:
// `buildSceneFile` was pinned in seventy-five assertions while its only caller passed
// four of five arguments, so the feature was inert and every test was green.
//
// So this clicks the Library, three times, and asks where the three pieces ended up.
//
// It is deliberately NOT a copy of the maths. It asserts the one thing the unit file
// structurally cannot: that three clicks produce three distinct positions rather than
// one position three times, which was the literal bug report.

import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { groundY, verticalExtent } from '@/lib/physics';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('spawn-spread-room'));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

beforeEach(() => {
  cleanup();
  useScene.setState({
    parts: [],
    room: {
      ...useScene.getState().room,
      width: 6, depth: 5, height: 2.5,
      footprint: footprintForLayout('rect', 6, 5), layoutId: 'rect',
    },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {}, hidden: {}, selection: [], selectedPartId: null, catalogOpen: true });
});

/** Click the Library row with exactly this name, `n` times.
 *
 *  An EXACT string, not a regex, and not `[0]` of a loose match. Once a piece is in
 *  the room the plan canvas renders it with `aria-label="Double bed. Arrow keys move
 *  it, hold Shift to turn" ` — which also matches /^Double bed/i and comes FIRST in
 *  DOM order, so the second and third clicks landed on the piece instead of the list
 *  and added nothing. The test read that as the wiring being broken. */
function addFromLibrary(label: string, n: number) {
  for (let i = 0; i < n; i++) {
    const rows = screen.getAllByRole('button', { name: label });
    expect(rows, `no Library row named "${label}"`).toHaveLength(1);
    fireEvent.click(rows[0]);
  }
}

describe('the Library gives each click its own spot', () => {
  it('three clicks are three pieces in three places, facing more than one way', () => {
    render(<PlanPage />);
    addFromLibrary('Double bed', 3);

    const beds = useScene.getState().parts.filter((p) => p.category === 'bed');
    // Named count, not `.length > 0`: a loop over "whatever it found" passes over an
    // empty list, and this file's whole subject is how many distinct answers there are.
    expect(beds).toHaveLength(3);

    const spots = new Set(beds.map((b) => `${b.pos[0].toFixed(3)},${b.pos[2].toFixed(3)}`));
    expect(spots.size, `three beds landed on ${spots.size} spot(s): ${[...spots].join(' | ')}`).toBe(3);

    // The other half of the report. Before this, all three were `rot 0`.
    expect(new Set(beds.map((b) => Math.round((b.rot * 180) / Math.PI))).size).toBeGreaterThan(1);
  });

  it('places against the room as it STANDS, not as it was authored', () => {
    // § H.3 finding 5's caller half. `spawn` read `useScene.getState().parts` — the
    // AUTHORED array — while a drag writes only `useStudio.positions`. So a piece was
    // placed against a room the user had already rearranged.
    //
    // The fixture is the smallest thing that can tell the two apart: one desk,
    // authored at the origin and dragged away. A table lamp is tabletop-prone, so it
    // rests on whatever the placement path believes is under it. Reading the authored
    // array it believes a desk is at the origin and hangs the lamp at that desk's top
    // over empty floor; reading the resolved one it finds nothing there and uses the
    // floor.
    //
    // The unit half (`tests/spawn-resolved-parts.test.ts`) proves `placeNewPart` gives
    // two different answers for the two arrays. It structurally CANNOT see which array
    // the Library hands it, which is this file's whole reason to exist.
    render(<PlanPage />);
    useScene.setState({
      parts: [
        {
          id: 'desk-1', name: 'Desk', category: 'desk', shape: 'desk-standard',
          dimMM: [1400, 700, 750], pos: [0, 0, 0], rot: 0, locked: false,
        },
      ],
    });
    // The drag. Only the override map, because that is all a drag ever writes.
    useStudio.setState({ positions: { 'desk-1': [2, 0, 1.5] } });

    addFromLibrary('Table lamp', 1);
    const lamp = useScene.getState().parts.find((p) => p.category === 'lamp');
    expect(lamp, 'the Library click added nothing').toBeTruthy();

    const deskTop = verticalExtent('desk', 'desk-standard', [1400, 700, 750], 0)[1];
    const floor = groundY('lamp', 'lamp-table', [250, 250, 500], useScene.getState().room.height);

    // Both ends named. Asserting only "is on the floor" would also pass for a path
    // that never consults supports at all, and asserting only "is not at desk height"
    // would pass for a lamp put anywhere else entirely.
    expect(lamp!.pos[1], `lamp at ${lamp!.pos[1]}, desk top ${deskTop}, floor ${floor}`).toBeCloseTo(floor, 6);
    expect(Math.abs(lamp!.pos[1] - deskTop)).toBeGreaterThan(0.5);
  });

  it('leaves the first piece into an empty room where it always went', () => {
    // The wiring must not move the ordinary single-add case. `[0, ?, 0]` is what an
    // unaimed `placeNewPart` produces in a rectangle, and a bed is floor-anchored.
    render(<PlanPage />);
    addFromLibrary('Double bed', 1);
    const bed = useScene.getState().parts.find((p) => p.category === 'bed')!;
    expect([bed.pos[0], bed.pos[2]]).toEqual([0, 0]);
  });
});
