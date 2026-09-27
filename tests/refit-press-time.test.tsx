// @vitest-environment jsdom
//
// **A press solves the room as it is at the press.**
//
// The Re-fit offer is a toast whose button lives for 14 s. Its `onClick` used to close
// over the parts of the render that RAISED the toast, while the stale-answer stamp
// (`lib/solve-stamp.ts`) was taken when the button was pressed. So: resize a piece, drag
// a chair, press Re-fit — the solve ran on the room from before the drag, the stamp saw
// no change between press and answer, and the answer was written over the drag. A stamp
// guards only the inputs it was taken beside, which is why `useSuggest` now reads the
// room in the same tick as the stamp instead of taking it from a render.
//
// `solveLayout` is mocked for the same reason `tests/impossible-clause-wired.test.tsx`
// mocks it: what is under test is WHICH room reaches the solver, not what it answers.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { DEFAULT_WEIGHTS, type CostBreakdown } from '@/lib/layout-score';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import type { ToastSpec } from '@/components/ui/StorageToast';
import type { SolveResult } from '@/lib/layout-solve';
import type { Footprint } from '@/lib/footprint';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('refit-room'));

const toasts: ToastSpec[] = [];
vi.mock('@/components/ui/StorageToast', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/StorageToast')>(
    '@/components/ui/StorageToast',
  );
  return { ...actual, toast: (spec: ToastSpec) => toasts.push(spec) };
});

const solveSpy = vi.fn();
vi.mock('@/lib/layout-solve', async () => {
  const actual = await vi.importActual<typeof import('@/lib/layout-solve')>('@/lib/layout-solve');
  return { ...actual, solveLayout: (...args: unknown[]) => solveSpy(...args) };
});

const { RoomTools } = await import('@/components/studio/RoomTools');

const ZERO = {
  ...(Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0])) as Record<string, number>),
  total: 0,
} as CostBreakdown;

const HEIGHT = 2.5;

function nothingMoved(parts: ScenePart[]): SolveResult {
  return {
    placements: parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot })),
    declined: 'no-gain',
    declinedTerms: [],
    before: 10,
    after: 10,
    breakdownBefore: ZERO,
    breakdownAfter: ZERO,
    moved: [],
    moves: [],
    finalists: [],
  };
}

const realRaf = globalThis.requestAnimationFrame;

beforeEach(() => {
  toasts.length = 0;
  solveSpy.mockReset();
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  cleanup();
});

describe('the Re-fit toast solves the room as it stands when pressed', () => {
  it('a drag made after the offer appeared reaches the solver', async () => {
    // The same fixture as the re-fit case in `impossible-clause-wired`: `u` 6 × 4 shrunk
    // to 5.5 × 3.8 under the same cast raises the offer.
    const footprint = footprintForLayout('u', 6, 4);
    const parts = defaultScene('u', 6, 4, { footprint, height: HEIGHT });
    act(() => {
      useScene.setState({
        parts,
        room: { ...useScene.getState().room, width: 6, depth: 4, height: HEIGHT, footprint, layoutId: 'u' },
      });
      useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [], selectedPartId: null });
      useSettings.setState({ dimUnit: 'm', stepFree: false });
    });
    render(<RoomTools />);

    const smaller = footprintForLayout('u', 5.5, 3.8);
    act(() => {
      useScene.setState({ room: { ...useScene.getState().room, width: 5.5, depth: 3.8, footprint: smaller } });
    });
    const offer = toasts.find((t) => t.action?.label === 'Re-fit');
    expect(offer, 'the resize must raise the offer this test presses').toBeTruthy();

    // The drag, AFTER the offer — the move the old closure could not see.
    const chair = parts.find((p) => !p.wallMounted)!;
    const dragged: [number, number, number] = [chair.pos[0] + 0.3, chair.pos[1], chair.pos[2] - 0.2];
    act(() => {
      useStudio.setState({ positions: { [chair.id]: dragged } });
    });

    solveSpy.mockImplementation((solved: ScenePart[]) => nothingMoved(solved));
    await act(async () => {
      await offer!.action!.onClick();
    });

    expect(solveSpy).toHaveBeenCalledTimes(1);
    const [solvedParts, solvedFootprint] = solveSpy.mock.calls[0] as [ScenePart[], Footprint];
    expect(solvedParts.find((p) => p.id === chair.id)!.pos, 'the solver was handed the room from before the drag').toEqual(
      dragged,
    );
    expect(solvedFootprint, 'and the room it was handed is the resized one').toEqual(smaller);
    // …and the press was not treated as stale: the stamp and the parts came from one tick.
    expect(toasts.map((t) => t.title)).not.toContain('The room changed during the search');
  });
});
