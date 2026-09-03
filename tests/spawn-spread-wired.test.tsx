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
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';

// See tests/library-click-through.test.tsx for why these shims are needed.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }),
});
Element.prototype.scrollIntoView = function scrollIntoView() {};

vi.mock('next/navigation', () => ({
  useParams: () => ({ roomId: 'spawn-spread-room' }),
  usePathname: () => '/room/spawn-spread-room/plan',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

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

  it('leaves the first piece into an empty room where it always went', () => {
    // The wiring must not move the ordinary single-add case. `[0, ?, 0]` is what an
    // unaimed `placeNewPart` produces in a rectangle, and a bed is floor-anchored.
    render(<PlanPage />);
    addFromLibrary('Double bed', 1);
    const bed = useScene.getState().parts.find((p) => p.category === 'bed')!;
    expect([bed.pos[0], bed.pos[2]]).toEqual([0, 0]);
  });
});
